-- Commerce V2 R1: server-owned persistent drafts and customer-owned guest
-- participation. Guest access remains possession-based through a hashed,
-- revocable draft token; authenticated drafts are scoped to their auth user.

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS draft_scope TEXT NOT NULL DEFAULT 'default';

UPDATE public.commerce_orders
SET draft_scope = LEFT(
  COALESCE(
    NULLIF(BTRIM(metadata->>'draft_scope'), ''),
    NULLIF(BTRIM(metadata->>'source'), ''),
    'default'
  ),
  160
)
WHERE draft_scope = 'default';

UPDATE public.commerce_orders
SET status = 'expired',
    expires_at = COALESCE(expires_at, now())
WHERE status = 'draft'
  AND user_id IS NULL
  AND expires_at IS NOT NULL
  AND expires_at <= now();

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY venue_id, user_id, draft_scope
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS position
  FROM public.commerce_orders
  WHERE status = 'draft'
    AND user_id IS NOT NULL
)
UPDATE public.commerce_orders orders
SET status = 'expired',
    expires_at = COALESCE(orders.expires_at, now()),
    metadata = COALESCE(orders.metadata, '{}'::jsonb)
      || jsonb_build_object('expiry_reason', 'r1_duplicate_authenticated_draft')
FROM ranked
WHERE orders.id = ranked.id
  AND ranked.position > 1;

UPDATE public.commerce_orders
SET expires_at = now() + interval '24 hours'
WHERE status = 'draft'
  AND user_id IS NULL
  AND expires_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_active_user_draft
  ON public.commerce_orders (venue_id, user_id, draft_scope)
  WHERE status = 'draft' AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commerce_orders_draft_expiry
  ON public.commerce_orders (status, expires_at)
  WHERE status = 'draft' AND user_id IS NULL;

ALTER TABLE public.session_registrations
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.session_registrations
  ADD CONSTRAINT session_registrations_owner_required
  CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL) NOT VALID;
ALTER TABLE public.session_registrations
  VALIDATE CONSTRAINT session_registrations_owner_required;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_registrations_guest_customer_once
  ON public.session_registrations (activity_session_id, session_date, customer_id)
  WHERE user_id IS NULL AND customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_registrations_commerce_source_once
  ON public.session_registrations (source_type, source_id)
  WHERE source_type = 'commerce_order' AND source_id IS NOT NULL;

ALTER TABLE public.access_entitlements
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.access_entitlements
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_owner_required
  CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_owner_required;

CREATE INDEX IF NOT EXISTS idx_access_entitlements_customer_active
  ON public.access_entitlements (venue_id, customer_id, status)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_entitlements_source_customer_once
  ON public.access_entitlements (source_type, source_id, customer_id, entitlement_type);

CREATE OR REPLACE FUNCTION public.commit_activity_registration_capacity(
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_session_date DATE,
  p_user_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'confirmed',
  p_price_paid_sek INTEGER DEFAULT 0,
  p_stripe_session_id TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_hold_id UUID DEFAULT NULL
)
RETURNS TABLE (
  ok BOOLEAN,
  registration_id UUID,
  reason TEXT,
  available_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_hold public.capacity_holds%ROWTYPE;
  v_existing public.session_registrations%ROWTYPE;
  v_allow BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Missing registration owner';
  END IF;
  IF p_status NOT IN ('confirmed', 'checked_in', 'no_show') THEN
    RAISE EXCEPTION 'Unsupported committed activity status: %', p_status;
  END IF;

  PERFORM public.capacity_lock_scope(
    p_venue_id,
    'activity_session',
    p_activity_session_id::TEXT,
    p_session_date
  );

  IF NULLIF(BTRIM(COALESCE(p_source_type, '')), '') IS NOT NULL
     AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.session_registrations
    WHERE source_type = p_source_type
      AND source_id = p_source_id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.session_registrations
    WHERE activity_session_id = p_activity_session_id
      AND session_date = p_session_date
      AND user_id = p_user_id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL AND p_user_id IS NULL AND p_customer_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.session_registrations
    WHERE activity_session_id = p_activity_session_id
      AND session_date = p_session_date
      AND user_id IS NULL
      AND customer_id = p_customer_id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL
     AND v_existing.status IN ('confirmed', 'checked_in', 'no_show') THEN
    IF p_hold_id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'committed',
          committed_at = COALESCE(committed_at, now())
      WHERE id = p_hold_id
        AND status = 'active';
    END IF;
    ok := true;
    registration_id := v_existing.id;
    reason := 'already_committed';
    available_count := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE id = p_hold_id
      AND venue_id = p_venue_id
      AND scope_type = 'activity_session'
      AND scope_id = p_activity_session_id::TEXT
      AND session_date = p_session_date
    FOR UPDATE;
  ELSIF NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE stripe_session_id = p_stripe_session_id
      AND venue_id = p_venue_id
      AND scope_type = 'activity_session'
      AND scope_id = p_activity_session_id::TEXT
      AND session_date = p_session_date
    FOR UPDATE;
  END IF;

  v_capacity := public.capacity_scope_capacity(
    p_venue_id,
    'activity_session',
    p_activity_session_id::TEXT,
    NULL
  );
  v_committed := public.capacity_committed_count(
    p_venue_id,
    'activity_session',
    p_activity_session_id::TEXT,
    p_session_date,
    v_existing.id,
    NULL
  );
  v_holds := public.capacity_active_holds_count(
    p_venue_id,
    'activity_session',
    p_activity_session_id::TEXT,
    p_session_date,
    v_hold.id
  );

  IF v_hold.id IS NOT NULL
     AND v_hold.status = 'active'
     AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'conflict_at', now(),
              'conflict_reason', 'capacity_full_after_payment'
            )
      WHERE id = v_hold.id;
    END IF;
    ok := false;
    registration_id := NULL;
    reason := 'capacity_full';
    available_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.session_registrations
    SET venue_id = p_venue_id,
        activity_session_id = p_activity_session_id,
        session_date = p_session_date,
        user_id = COALESCE(p_user_id, user_id),
        customer_id = COALESCE(p_customer_id, customer_id),
        status = p_status,
        price_paid_sek = GREATEST(COALESCE(p_price_paid_sek, 0), 0),
        stripe_session_id = COALESCE(
          NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), ''),
          stripe_session_id
        ),
        source_type = COALESCE(p_source_type, source_type),
        source_id = COALESCE(p_source_id, source_id),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || COALESCE(p_metadata, '{}'::jsonb),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO registration_id;
  ELSE
    INSERT INTO public.session_registrations (
      venue_id,
      activity_session_id,
      session_date,
      user_id,
      customer_id,
      status,
      price_paid_sek,
      stripe_session_id,
      source_type,
      source_id,
      metadata
    )
    VALUES (
      p_venue_id,
      p_activity_session_id,
      p_session_date,
      p_user_id,
      p_customer_id,
      p_status,
      GREATEST(COALESCE(p_price_paid_sek, 0), 0),
      NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), ''),
      p_source_type,
      p_source_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO registration_id;
  END IF;

  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'committed',
        committed_at = COALESCE(committed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('registration_id', registration_id)
    WHERE id = v_hold.id;
  END IF;

  ok := true;
  reason := 'committed';
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(
      v_capacity
        - public.capacity_committed_count(
            p_venue_id,
            'activity_session',
            p_activity_session_id::TEXT,
            p_session_date
          )
        - public.capacity_active_holds_count(
            p_venue_id,
            'activity_session',
            p_activity_session_id::TEXT,
            p_session_date
          ),
      0
    )
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) TO service_role;
REVOKE ALL ON FUNCTION public.acquire_capacity_hold(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_capacity_hold(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER
) TO service_role;
COMMENT ON COLUMN public.commerce_orders.draft_scope IS
  'Server-owned draft context. Authenticated users have at most one active draft per venue and scope.';
COMMENT ON COLUMN public.access_entitlements.customer_id IS
  'Canonical customer owner for guest access. user_id remains the owner for authenticated access.';

-- Manual SQL Editor reminder after deployment:
-- NOTIFY pgrst, 'reload schema';
