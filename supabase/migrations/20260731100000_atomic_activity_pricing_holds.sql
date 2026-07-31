-- Commerce R1: award a scarce Early-Bird price in the same critical section
-- that reserves activity capacity. The Commerce API computes membership and
-- channel precedence first; this RPC owns only the final scarcity allocation.

CREATE OR REPLACE FUNCTION public.activity_early_bird_fill(
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_session_date DATE
)
RETURNS TABLE (committed_count INTEGER, active_holds_count INTEGER, fill_count INTEGER)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      SELECT COUNT(*)::INTEGER
      FROM public.session_registrations sr
      WHERE sr.venue_id = p_venue_id
        AND sr.activity_session_id = p_activity_session_id
        AND sr.session_date = p_session_date
        AND sr.status IN ('confirmed', 'checked_in', 'no_show')
        AND sr.metadata->>'pricing_reason' = 'early_bird'
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.capacity_holds ch
      WHERE ch.venue_id = p_venue_id
        AND ch.scope_type = 'activity_session'
        AND ch.scope_id = p_activity_session_id::TEXT
        AND ch.session_date = p_session_date
        AND ch.status = 'active'
        AND ch.expires_at > now()
        AND ch.metadata->>'applied_price_type' = 'early_bird'
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.session_registrations sr
      WHERE sr.venue_id = p_venue_id
        AND sr.activity_session_id = p_activity_session_id
        AND sr.session_date = p_session_date
        AND sr.status IN ('confirmed', 'checked_in', 'no_show')
        AND sr.metadata->>'pricing_reason' = 'early_bird'
    ) + (
      SELECT COUNT(*)::INTEGER
      FROM public.capacity_holds ch
      WHERE ch.venue_id = p_venue_id
        AND ch.scope_type = 'activity_session'
        AND ch.scope_id = p_activity_session_id::TEXT
        AND ch.session_date = p_session_date
        AND ch.status = 'active'
        AND ch.expires_at > now()
        AND ch.metadata->>'applied_price_type' = 'early_bird'
    );
$$;

CREATE OR REPLACE FUNCTION public.acquire_activity_pricing_hold(
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_session_date DATE,
  p_user_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_regular_price_minor INTEGER DEFAULT 0,
  p_regular_price_type TEXT DEFAULT 'regular_price',
  p_quoted_price_minor INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS TABLE (
  ok BOOLEAN,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT,
  applied_price_type TEXT,
  final_price_minor INTEGER,
  early_bird_remaining INTEGER,
  quote_changed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_existing public.capacity_holds%ROWTYPE;
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_early_bird_price_minor INTEGER;
  v_early_bird_slots INTEGER;
  v_early_bird_committed INTEGER := 0;
  v_early_bird_holds INTEGER := 0;
  v_scarcity_mode TEXT;
  v_price_type TEXT := COALESCE(NULLIF(BTRIM(p_regular_price_type), ''), 'regular_price');
  v_final_price_minor INTEGER := GREATEST(COALESCE(p_regular_price_minor, 0), 0);
BEGIN
  PERFORM public.capacity_lock_scope(
    p_venue_id,
    'activity_session',
    p_activity_session_id::TEXT,
    p_session_date
  );

  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE id = p_activity_session_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'activity_session_not_found'; END IF;

  UPDATE public.capacity_holds
  SET status = 'expired',
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('release_reason', 'lazy_expired_before_pricing_acquire')
  WHERE venue_id = p_venue_id
    AND scope_type = 'activity_session'
    AND scope_id = p_activity_session_id::TEXT
    AND session_date = p_session_date
    AND status = 'active'
    AND expires_at <= now();

  SELECT * INTO v_existing
  FROM public.capacity_holds ch
  WHERE ch.venue_id = p_venue_id
    AND ch.scope_type = 'activity_session'
    AND ch.scope_id = p_activity_session_id::TEXT
    AND ch.session_date = p_session_date
    AND ch.status = 'active'
    AND ch.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL
        AND ch.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''))
      OR (p_source_id IS NOT NULL AND ch.source_id = p_source_id)
    )
  ORDER BY ch.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    final_price_minor := COALESCE((v_existing.metadata->>'final_price_minor')::INTEGER, v_final_price_minor);
    applied_price_type := COALESCE(v_existing.metadata->>'applied_price_type', v_price_type);
    v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_session', p_activity_session_id::TEXT, NULL);
    v_committed := public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);
    v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);
    available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds, 0) END;
    early_bird_remaining := NULLIF((v_existing.metadata->>'early_bird_remaining')::INTEGER, -1);
    quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> final_price_minor;
    ok := true;
    hold_id := v_existing.id;
    reason := 'existing_hold';
    RETURN NEXT;
    RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_session', p_activity_session_id::TEXT, NULL);
  v_committed := public.capacity_committed_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date);

  IF v_capacity IS NOT NULL AND (v_committed + v_holds) >= v_capacity THEN
    ok := false;
    hold_id := NULL;
    available_count := 0;
    reason := 'capacity_full';
    applied_price_type := v_price_type;
    final_price_minor := v_final_price_minor;
    early_bird_remaining := NULL;
    quote_changed := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_scarcity_mode := COALESCE(NULLIF(v_session.scarcity_mode, ''), NULLIF(v_session.metadata->>'scarcity_mode', ''), 'none');
  v_early_bird_price_minor := COALESCE(v_session.early_bird_price_minor, (v_session.metadata->>'early_bird_price_minor')::INTEGER);
  v_early_bird_slots := COALESCE(v_session.early_bird_slots, (v_session.metadata->>'early_bird_slots')::INTEGER);

  IF v_scarcity_mode = 'early_bird'
    AND v_early_bird_price_minor > 0
    AND v_early_bird_slots > 0 THEN
    SELECT COUNT(*)::INTEGER INTO v_early_bird_committed
    FROM public.session_registrations sr
    WHERE sr.venue_id = p_venue_id
      AND sr.activity_session_id = p_activity_session_id
      AND sr.session_date = p_session_date
      AND sr.status IN ('confirmed', 'checked_in', 'no_show')
      AND sr.metadata->>'pricing_reason' = 'early_bird';

    SELECT COUNT(*)::INTEGER INTO v_early_bird_holds
    FROM public.capacity_holds ch
    WHERE ch.venue_id = p_venue_id
      AND ch.scope_type = 'activity_session'
      AND ch.scope_id = p_activity_session_id::TEXT
      AND ch.session_date = p_session_date
      AND ch.status = 'active'
      AND ch.expires_at > now()
      AND ch.metadata->>'applied_price_type' = 'early_bird';

    IF (v_early_bird_committed + v_early_bird_holds) < v_early_bird_slots
      AND v_final_price_minor > v_early_bird_price_minor THEN
      v_price_type := 'early_bird';
      v_final_price_minor := v_early_bird_price_minor;
    END IF;
  END IF;

  INSERT INTO public.capacity_holds (
    venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, expires_at, metadata
  ) VALUES (
    p_venue_id, 'activity_session', p_activity_session_id::TEXT, p_session_date,
    p_user_id, p_customer_id, p_source_type, p_source_id,
    NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 600), 1)),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'applied_price_type', v_price_type,
      'final_price_minor', v_final_price_minor,
      'regular_price_minor', GREATEST(COALESCE(p_regular_price_minor, 0), 0),
      'early_bird_remaining', CASE
        WHEN v_scarcity_mode = 'early_bird' AND v_early_bird_slots > 0
          THEN GREATEST(v_early_bird_slots - v_early_bird_committed - v_early_bird_holds
            - CASE WHEN v_price_type = 'early_bird' THEN 1 ELSE 0 END, 0)
        ELSE -1
      END
    )
  ) RETURNING id INTO hold_id;

  ok := true;
  available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds - 1, 0) END;
  reason := 'held';
  applied_price_type := v_price_type;
  final_price_minor := v_final_price_minor;
  early_bird_remaining := CASE
    WHEN v_scarcity_mode = 'early_bird' AND v_early_bird_slots > 0
      THEN GREATEST(v_early_bird_slots - v_early_bird_committed - v_early_bird_holds
        - CASE WHEN v_price_type = 'early_bird' THEN 1 ELSE 0 END, 0)
    ELSE NULL
  END;
  quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> v_final_price_minor;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.activity_early_bird_fill(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activity_early_bird_fill(UUID, UUID, DATE) TO service_role;

COMMENT ON FUNCTION public.acquire_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) IS 'Atomically reserves activity capacity and freezes the awarded scarcity price after membership/channel precedence.';
