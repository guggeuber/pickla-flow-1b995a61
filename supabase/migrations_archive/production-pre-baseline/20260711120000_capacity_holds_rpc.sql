-- Foundation R2: capacity holds and atomic Play Right commits.
--
-- capacity_holds is lock truth only. It is not a participant, ticket,
-- registration, revenue row, or PeopleRow source. Mutating paths must use the
-- RPC family below so capacity is checked and committed inside Postgres.

CREATE TABLE IF NOT EXISTS public.capacity_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('activity_session', 'booking_group')),
  scope_id TEXT NOT NULL,
  session_date DATE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  source_type TEXT,
  source_id UUID,
  idempotency_key TEXT,
  stripe_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released', 'expired', 'conflict')),
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capacity_holds_scope
  ON public.capacity_holds (venue_id, scope_type, scope_id, session_date, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_capacity_holds_user_scope
  ON public.capacity_holds (venue_id, scope_type, scope_id, session_date, user_id, status)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capacity_holds_stripe_session
  ON public.capacity_holds (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capacity_holds_active_idempotency
  ON public.capacity_holds (venue_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'active';

DROP TRIGGER IF EXISTS trg_capacity_holds_updated_at ON public.capacity_holds;
CREATE TRIGGER trg_capacity_holds_updated_at
  BEFORE UPDATE ON public.capacity_holds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.capacity_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read capacity holds" ON public.capacity_holds;
CREATE POLICY "Venue staff read capacity holds"
  ON public.capacity_holds FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Service role manages capacity holds" ON public.capacity_holds;
CREATE POLICY "Service role manages capacity holds"
  ON public.capacity_holds FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.capacity_lock_scope(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(COALESCE(p_venue_id::TEXT, '')),
    hashtext(COALESCE(p_scope_type, '') || ':' || COALESCE(p_scope_id, '') || ':' || COALESCE(p_session_date::TEXT, ''))
  );

  IF p_scope_type = 'activity_session' THEN
    PERFORM 1
    FROM public.activity_sessions
    WHERE id = p_scope_id::UUID
      AND venue_id = p_venue_id
    FOR UPDATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_committed_count(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_exclude_registration_id UUID DEFAULT NULL,
  p_exclude_participant_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.session_registrations sr
    WHERE sr.venue_id = p_venue_id
      AND sr.activity_session_id = p_scope_id::UUID
      AND sr.session_date = p_session_date
      AND sr.status IN ('confirmed', 'checked_in', 'no_show')
      AND (p_exclude_registration_id IS NULL OR sr.id <> p_exclude_registration_id);
  ELSIF p_scope_type = 'booking_group' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.booking_participants bp
    WHERE bp.venue_id = p_venue_id
      AND bp.booking_group_key = p_scope_id
      AND bp.payment_status IN ('paid', 'free')
      AND (p_exclude_participant_id IS NULL OR bp.id <> p_exclude_participant_id);
  ELSE
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_active_holds_count(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_exclude_hold_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.capacity_holds ch
  WHERE ch.venue_id = p_venue_id
    AND ch.scope_type = p_scope_type
    AND ch.scope_id = p_scope_id
    AND ch.session_date = p_session_date
    AND ch.status = 'active'
    AND ch.expires_at > now()
    AND (p_exclude_hold_id IS NULL OR ch.id <> p_exclude_hold_id);

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_scope_capacity(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_capacity INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity INTEGER;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT capacity INTO v_capacity
    FROM public.activity_sessions
    WHERE id = p_scope_id::UUID
      AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'booking_group' THEN
    RETURN NULLIF(GREATEST(COALESCE(p_capacity, 0), 0), 0);
  END IF;

  RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_fill(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_capacity INTEGER DEFAULT NULL
)
RETURNS TABLE (
  capacity INTEGER,
  committed_count INTEGER,
  active_holds_count INTEGER,
  fill_count INTEGER,
  available_count INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
  committed_count := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  active_holds_count := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  fill_count := committed_count + active_holds_count;
  available_count := CASE
    WHEN capacity IS NULL THEN NULL
    ELSE GREATEST(capacity - fill_count, 0)
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_capacity_hold(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_capacity INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS TABLE (
  ok BOOLEAN,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_existing public.capacity_holds%ROWTYPE;
BEGIN
  IF p_scope_type NOT IN ('activity_session', 'booking_group') THEN
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, p_scope_type, p_scope_id, p_session_date);

  UPDATE public.capacity_holds
  SET status = 'expired',
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('release_reason', 'lazy_expired_before_acquire')
  WHERE venue_id = p_venue_id
    AND scope_type = p_scope_type
    AND scope_id = p_scope_id
    AND session_date = p_session_date
    AND status = 'active'
    AND expires_at <= now();

  SELECT * INTO v_existing
  FROM public.capacity_holds ch
  WHERE ch.venue_id = p_venue_id
    AND ch.scope_type = p_scope_type
    AND ch.scope_id = p_scope_id
    AND ch.session_date = p_session_date
    AND ch.status = 'active'
    AND ch.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL AND ch.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '')) OR
      (p_source_id IS NOT NULL AND ch.source_id = p_source_id) OR
      (p_user_id IS NOT NULL AND ch.user_id = p_user_id AND COALESCE(ch.source_type, '') = COALESCE(p_source_type, ''))
    )
  ORDER BY ch.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    ok := true;
    hold_id := v_existing.id;
    v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
    v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds, 0) END;
    reason := 'existing_hold';
    RETURN NEXT;
    RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
  v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);

  IF v_capacity IS NOT NULL AND (v_committed + v_holds) >= v_capacity THEN
    ok := false;
    hold_id := NULL;
    available_count := 0;
    reason := 'capacity_full';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.capacity_holds (
    venue_id,
    scope_type,
    scope_id,
    session_date,
    user_id,
    customer_id,
    source_type,
    source_id,
    idempotency_key,
    expires_at,
    metadata
  )
  VALUES (
    p_venue_id,
    p_scope_type,
    p_scope_id,
    p_session_date,
    p_user_id,
    p_customer_id,
    p_source_type,
    p_source_id,
    NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 600), 1)),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO hold_id;

  ok := true;
  available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds - 1, 0) END;
  reason := 'held';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_capacity_hold_stripe_session(
  p_hold_id UUID,
  p_stripe_session_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_hold_id IS NULL OR NULLIF(BTRIM(COALESCE(p_stripe_session_id, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.capacity_holds
  SET stripe_session_id = p_stripe_session_id,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stripe_session_id', p_stripe_session_id)
  WHERE id = p_hold_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_capacity_hold(
  p_hold_id UUID,
  p_reason TEXT DEFAULT 'released'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.capacity_holds
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'released' END,
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('release_reason', COALESCE(p_reason, 'released'))
  WHERE id = p_hold_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id for activity capacity commit';
  END IF;
  IF p_status NOT IN ('confirmed', 'checked_in', 'no_show') THEN
    RAISE EXCEPTION 'Unsupported committed activity status: %', p_status;
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);

  SELECT * INTO v_existing
  FROM public.session_registrations
  WHERE activity_session_id = p_activity_session_id
    AND session_date = p_session_date
    AND user_id = p_user_id
  LIMIT 1;

  IF v_existing.id IS NOT NULL AND v_existing.status IN ('confirmed', 'checked_in', 'no_show') THEN
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

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_session', p_activity_session_id::TEXT, NULL);
  v_committed := public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_existing.id, NULL);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date, v_hold.id);

  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conflict_at', now(), 'conflict_reason', 'capacity_full_after_payment')
      WHERE id = v_hold.id;
    END IF;
    ok := false;
    registration_id := NULL;
    reason := 'capacity_full';
    available_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

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
  ON CONFLICT (activity_session_id, session_date, user_id)
  DO UPDATE SET
    venue_id = EXCLUDED.venue_id,
    customer_id = COALESCE(EXCLUDED.customer_id, public.session_registrations.customer_id),
    status = EXCLUDED.status,
    price_paid_sek = EXCLUDED.price_paid_sek,
    stripe_session_id = COALESCE(EXCLUDED.stripe_session_id, public.session_registrations.stripe_session_id),
    source_type = COALESCE(EXCLUDED.source_type, public.session_registrations.source_type),
    source_id = COALESCE(EXCLUDED.source_id, public.session_registrations.source_id),
    metadata = COALESCE(public.session_registrations.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = now()
  RETURNING id INTO registration_id;

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
    ELSE GREATEST(v_capacity - public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date) - public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date), 0)
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_booking_participant_capacity(
  p_venue_id UUID,
  p_booking_id UUID,
  p_booking_group_key TEXT,
  p_session_date DATE,
  p_capacity INTEGER,
  p_invite_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_display_name TEXT DEFAULT 'Spelare',
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'player',
  p_price_minor INTEGER DEFAULT 0,
  p_payment_status TEXT DEFAULT 'free',
  p_payment_method TEXT DEFAULT NULL,
  p_payment_stripe_session_id TEXT DEFAULT NULL,
  p_booking_receipt_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_hold_id UUID DEFAULT NULL,
  p_participant_id UUID DEFAULT NULL
)
RETURNS TABLE (
  ok BOOLEAN,
  participant_id UUID,
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
  v_existing public.booking_participants%ROWTYPE;
  v_allow BOOLEAN := false;
BEGIN
  IF p_payment_status NOT IN ('paid', 'free') THEN
    RAISE EXCEPTION 'Committed booking participant status must be paid or free';
  END IF;

  PERFORM public.capacity_lock_scope(p_venue_id, 'booking_group', p_booking_group_key, p_session_date);

  IF p_participant_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.booking_participants
    WHERE id = p_participant_id
      AND venue_id = p_venue_id
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.booking_participants
    WHERE venue_id = p_venue_id
      AND booking_group_key = p_booking_group_key
      AND user_id = p_user_id
      AND payment_status <> 'cancelled'
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.payment_status IN ('paid', 'free') THEN
    IF p_hold_id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'committed',
          committed_at = COALESCE(committed_at, now())
      WHERE id = p_hold_id
        AND status = 'active';
    END IF;
    ok := true;
    participant_id := v_existing.id;
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
      AND scope_type = 'booking_group'
      AND scope_id = p_booking_group_key
      AND session_date = p_session_date
    FOR UPDATE;
  ELSIF NULLIF(BTRIM(COALESCE(p_payment_stripe_session_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE stripe_session_id = p_payment_stripe_session_id
      AND venue_id = p_venue_id
      AND scope_type = 'booking_group'
      AND scope_id = p_booking_group_key
      AND session_date = p_session_date
    FOR UPDATE;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'booking_group', p_booking_group_key, p_capacity);
  v_committed := public.capacity_committed_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date, NULL, v_existing.id);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date, v_hold.id);

  IF v_hold.id IS NOT NULL AND v_hold.status = 'active' AND v_hold.expires_at > now() THEN
    v_allow := true;
  ELSIF v_capacity IS NULL OR (v_committed + v_holds) < v_capacity THEN
    v_allow := true;
  END IF;

  IF NOT v_allow THEN
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.capacity_holds
      SET status = 'conflict',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conflict_at', now(), 'conflict_reason', 'capacity_full_after_payment')
      WHERE id = v_hold.id;
    END IF;
    ok := false;
    participant_id := NULL;
    reason := 'capacity_full';
    available_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.booking_participants
    SET invite_id = COALESCE(p_invite_id, invite_id),
        customer_id = COALESCE(p_customer_id, customer_id),
        user_id = COALESCE(p_user_id, user_id),
        display_name = COALESCE(NULLIF(BTRIM(p_display_name), ''), display_name),
        email = COALESCE(NULLIF(BTRIM(p_email), ''), email),
        phone = COALESCE(NULLIF(BTRIM(p_phone), ''), phone),
        role = COALESCE(NULLIF(BTRIM(p_role), ''), role),
        price_minor = GREATEST(COALESCE(p_price_minor, price_minor), 0),
        payment_status = p_payment_status,
        payment_method = COALESCE(p_payment_method, payment_method),
        payment_stripe_session_id = COALESCE(NULLIF(BTRIM(p_payment_stripe_session_id), ''), payment_stripe_session_id),
        booking_receipt_id = COALESCE(p_booking_receipt_id, booking_receipt_id),
        metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO participant_id;
  ELSE
    INSERT INTO public.booking_participants (
      venue_id,
      booking_id,
      booking_group_key,
      invite_id,
      customer_id,
      user_id,
      display_name,
      email,
      phone,
      role,
      price_minor,
      payment_status,
      payment_method,
      payment_stripe_session_id,
      booking_receipt_id,
      metadata
    )
    VALUES (
      p_venue_id,
      p_booking_id,
      p_booking_group_key,
      p_invite_id,
      p_customer_id,
      p_user_id,
      COALESCE(NULLIF(BTRIM(p_display_name), ''), 'Spelare'),
      NULLIF(BTRIM(p_email), ''),
      NULLIF(BTRIM(p_phone), ''),
      COALESCE(NULLIF(BTRIM(p_role), ''), 'player'),
      GREATEST(COALESCE(p_price_minor, 0), 0),
      p_payment_status,
      p_payment_method,
      NULLIF(BTRIM(p_payment_stripe_session_id), ''),
      p_booking_receipt_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO participant_id;
  END IF;

  IF v_hold.id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'committed',
        committed_at = COALESCE(committed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('booking_participant_id', participant_id)
    WHERE id = v_hold.id;
  END IF;

  ok := true;
  reason := 'committed';
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(v_capacity - public.capacity_committed_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date) - public.capacity_active_holds_count(p_venue_id, 'booking_group', p_booking_group_key, p_session_date), 0)
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking_participant_capacity(
  p_participant_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cancelled_count INTEGER := 0;
BEGIN
  UPDATE public.booking_participants
  SET payment_status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_participant_id
    AND payment_status <> 'cancelled';
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  UPDATE public.capacity_holds
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'released' END,
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'release_reason', 'booking_participant_cancelled',
        'actor_user_id', p_actor_user_id
      )
  WHERE source_id = p_participant_id
    AND scope_type = 'booking_group'
    AND status = 'active';

  RETURN v_cancelled_count > 0;
END;
$$;

-- Reminder for manual SQL editor deploys:
-- NOTIFY pgrst, 'reload schema';
