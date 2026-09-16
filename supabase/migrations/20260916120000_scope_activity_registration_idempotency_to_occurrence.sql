-- A reusable entitlement can fund more than one activity occurrence. Its
-- source identity is therefore idempotent only inside the requested
-- activity_session_id + session_date, never across all registrations.

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
    WHERE source_type = p_source_type
      AND source_id = p_source_id
      AND activity_session_id = p_activity_session_id
      AND session_date = p_session_date
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
      SET status = 'committed',
          committed_at = COALESCE(committed_at, now()),
          metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('registration_id', v_existing.id)
      WHERE id = p_hold_id
        AND venue_id = p_venue_id
        AND scope_type = 'activity_session'
        AND scope_id = p_activity_session_id::TEXT
        AND session_date = p_session_date
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
      WHERE activity_session_id = p_activity_session_id
        AND session_date = p_session_date
        AND (
          (p_source_type IS NOT NULL AND source_type = p_source_type AND source_id = p_source_id)
          OR (p_user_id IS NOT NULL AND user_id = p_user_id)
          OR (p_user_id IS NULL AND p_customer_id IS NOT NULL AND customer_id = p_customer_id)
        )
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

REVOKE ALL ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) TO service_role;

COMMENT ON FUNCTION public.commit_activity_registration_capacity(
  UUID, UUID, DATE, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, UUID, JSONB, UUID
) IS 'Atomically commits one canonical activity occurrence registration. Source idempotency is scoped to activity_session_id plus Stockholm occurrence date so reusable access can fund multiple occurrences without ticket aliasing.';
