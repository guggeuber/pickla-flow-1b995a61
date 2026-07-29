-- Commerce R1B: pay first, claim an account later.
-- Existing commerce_orders/customers remain the financial and identity truth.

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commerce_orders_claim_window
  ON public.commerce_orders (claim_expires_at)
  WHERE status IN ('paid', 'attention')
    AND claimed_user_id IS NULL;

ALTER TABLE public.session_registrations
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.session_registrations
  DROP CONSTRAINT IF EXISTS session_registrations_owner_required;
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
  DROP CONSTRAINT IF EXISTS access_entitlements_owner_required;
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

CREATE TABLE IF NOT EXISTS public.commerce_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE CASCADE,
  activity_session_id UUID REFERENCES public.activity_sessions(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK (event_name IN (
    'activity_sheet_opened',
    'logged_out_cta_clicked',
    'checkout_started',
    'guest_purchase_succeeded',
    'checkout_abandoned',
    'claim_completed',
    'account_activated'
  )),
  journey_id_hash TEXT,
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerce_events_funnel
  ON public.commerce_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_events_order
  ON public.commerce_events (commerce_order_id, created_at)
  WHERE commerce_order_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_commerce_events_order_milestone_once;
CREATE UNIQUE INDEX idx_commerce_events_order_milestone_once
  ON public.commerce_events (commerce_order_id, event_name);

ALTER TABLE public.commerce_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commerce_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commerce_events TO service_role;

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

  IF NULLIF(BTRIM(COALESCE(p_source_type, '')), '') IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.session_registrations
    WHERE source_type = p_source_type AND source_id = p_source_id
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

  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed', 'checked_in', 'no_show') THEN
    IF p_hold_id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'committed', committed_at = COALESCE(committed_at, now())
      WHERE id = p_hold_id AND status = 'active';
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

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_session', p_activity_session_id::TEXT, NULL);
  v_committed := public.capacity_committed_count(
    p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_existing.id, NULL
  );
  v_holds := public.capacity_active_holds_count(
    p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_hold.id
  );

  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('conflict_at', now(), 'conflict_reason', 'capacity_full_after_payment')
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
        stripe_session_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), ''), stripe_session_id),
        source_type = COALESCE(p_source_type, source_type),
        source_id = COALESCE(p_source_id, source_id),
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO registration_id;
  ELSE
    BEGIN
      INSERT INTO public.session_registrations (
        venue_id, activity_session_id, session_date, user_id, customer_id,
        status, price_paid_sek, stripe_session_id, source_type, source_id, metadata
      ) VALUES (
        p_venue_id, p_activity_session_id, p_session_date, p_user_id, p_customer_id,
        p_status, GREATEST(COALESCE(p_price_paid_sek, 0), 0),
        NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), ''),
        p_source_type, p_source_id, COALESCE(p_metadata, '{}'::jsonb)
      )
      RETURNING id INTO registration_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO registration_id
      FROM public.session_registrations
      WHERE (p_source_type IS NOT NULL AND source_type = p_source_type AND source_id = p_source_id)
         OR (p_user_id IS NOT NULL AND activity_session_id = p_activity_session_id AND session_date = p_session_date AND user_id = p_user_id)
         OR (p_user_id IS NULL AND p_customer_id IS NOT NULL AND activity_session_id = p_activity_session_id AND session_date = p_session_date AND customer_id = p_customer_id)
      ORDER BY created_at
      LIMIT 1;
      IF registration_id IS NULL THEN RAISE; END IF;
    END;
  END IF;

  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'committed',
        committed_at = COALESCE(committed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('registration_id', registration_id)
    WHERE id = v_hold.id;
  END IF;

  ok := true;
  reason := 'committed';
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(
      v_capacity
        - public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date)
        - public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date),
      0
    )
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_commerce_guest_identity(
  p_order_id UUID,
  p_customer_id UUID,
  p_display_name TEXT
)
RETURNS TABLE(order_id UUID, registration_id UUID, guest_claimed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_registration_id UUID;
  v_name TEXT := LEFT(NULLIF(BTRIM(COALESCE(p_display_name, '')), ''), 120);
BEGIN
  IF v_name IS NULL THEN RAISE EXCEPTION 'display_name_required'; END IF;
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'commerce_order_not_claimable'; END IF;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN RAISE EXCEPTION 'commerce_customer_mismatch'; END IF;
  IF v_order.claim_expires_at IS NOT NULL AND v_order.claim_expires_at <= now() THEN RAISE EXCEPTION 'commerce_claim_expired'; END IF;

  UPDATE public.customers
  SET display_name = v_name, updated_at = now()
  WHERE id = p_customer_id AND organization_id = v_order.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_customer_scope_mismatch'; END IF;

  UPDATE public.commerce_orders
  SET guest_name = v_name, guest_claimed_at = COALESCE(public.commerce_orders.guest_claimed_at, now())
  WHERE id = p_order_id
  RETURNING public.commerce_orders.guest_claimed_at INTO guest_claimed_at;

  SELECT l.session_registration_id INTO v_registration_id
  FROM public.commerce_order_lines l
  WHERE l.commerce_order_id = p_order_id AND l.commerce_kind = 'participation'
  LIMIT 1;

  IF v_registration_id IS NOT NULL THEN
    UPDATE public.session_registrations
    SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object('display_name', v_name, 'display_name_confirmed_at', now())
    WHERE id = v_registration_id AND customer_id = p_customer_id;
  END IF;

  order_id := p_order_id;
  registration_id := v_registration_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_commerce_activity_order(
  p_order_id UUID,
  p_customer_id UUID,
  p_user_id UUID
)
RETURNS TABLE(order_id UUID, registration_id UUID, claimed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_auth_email TEXT;
  v_auth_confirmed TIMESTAMPTZ;
  v_customer_auth_user_id UUID;
  v_registration public.session_registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'commerce_order_not_claimable'; END IF;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN RAISE EXCEPTION 'commerce_customer_mismatch'; END IF;
  IF v_order.claim_expires_at IS NOT NULL AND v_order.claim_expires_at <= now() THEN RAISE EXCEPTION 'commerce_claim_expired'; END IF;
  IF v_order.claimed_user_id IS NOT NULL AND v_order.claimed_user_id <> p_user_id THEN RAISE EXCEPTION 'commerce_order_already_claimed'; END IF;

  SELECT lower(email), email_confirmed_at INTO v_auth_email, v_auth_confirmed
  FROM auth.users WHERE id = p_user_id;
  IF v_auth_email IS NULL OR v_auth_confirmed IS NULL THEN RAISE EXCEPTION 'verified_account_required'; END IF;
  IF v_auth_email IS DISTINCT FROM lower(v_order.guest_email) THEN RAISE EXCEPTION 'commerce_claim_email_mismatch'; END IF;

  SELECT auth_user_id INTO v_customer_auth_user_id
  FROM public.customers
  WHERE id = p_customer_id AND organization_id = v_order.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_customer_scope_mismatch'; END IF;
  IF v_customer_auth_user_id IS NOT NULL AND v_customer_auth_user_id <> p_user_id THEN RAISE EXCEPTION 'commerce_customer_already_claimed'; END IF;

  UPDATE public.customers SET auth_user_id = p_user_id, updated_at = now() WHERE id = p_customer_id;

  SELECT sr.* INTO v_registration
  FROM public.commerce_order_lines l
  JOIN public.session_registrations sr ON sr.id = l.session_registration_id
  WHERE l.commerce_order_id = p_order_id AND l.commerce_kind = 'participation'
  LIMIT 1
  FOR UPDATE OF sr;

  IF v_registration.id IS NOT NULL THEN
    IF v_registration.user_id IS NOT NULL AND v_registration.user_id <> p_user_id THEN
      RAISE EXCEPTION 'commerce_registration_already_claimed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.session_registrations other
      WHERE other.activity_session_id = v_registration.activity_session_id
        AND other.session_date = v_registration.session_date
        AND other.user_id = p_user_id
        AND other.id <> v_registration.id
        AND other.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'commerce_registration_claim_conflict';
    END IF;
    UPDATE public.session_registrations SET user_id = p_user_id, updated_at = now() WHERE id = v_registration.id;
    UPDATE public.access_entitlements
    SET user_id = p_user_id
    WHERE source_type = 'session_ticket'
      AND source_id = v_registration.id
      AND customer_id = p_customer_id;
  END IF;

  UPDATE public.booking_receipts SET user_id = p_user_id WHERE commerce_order_id = p_order_id;
  UPDATE public.commerce_orders
  SET user_id = p_user_id,
      claimed_user_id = p_user_id,
      claimed_at = COALESCE(public.commerce_orders.claimed_at, now())
  WHERE id = p_order_id
  RETURNING public.commerce_orders.claimed_at INTO claimed_at;

  order_id := p_order_id;
  registration_id := v_registration.id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_commerce_guest_identity(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_guest_identity(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.claim_commerce_activity_order(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_commerce_activity_order(UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.acquire_capacity_hold(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_capacity_hold(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER
) TO service_role;

COMMENT ON COLUMN public.commerce_orders.claim_expires_at IS
  'Expiry for mutating claim actions. Receipt access remains possession-based through receipt_token_hash.';
COMMENT ON TABLE public.commerce_events IS
  'Privacy-safe Commerce funnel events. Never store names, email, phone, raw tokens or provider metadata.';

-- Rollback is additive-first: stop the R1B frontend/functions, then drop the
-- three R1B RPCs, commerce_events, claim columns, guest entitlement indexes,
-- and restore NOT NULL owner columns only after all guest rows are reconciled.
