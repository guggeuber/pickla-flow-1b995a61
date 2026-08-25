-- Pickla League V1 selling and fulfillment.
-- All functions that mutate team capacity are service-role-only. Browser code
-- never performs count-then-insert and individual membership pricing is never
-- consulted for the team product.

CREATE OR REPLACE FUNCTION public.capacity_lock_scope(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE
) RETURNS VOID
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
    PERFORM 1 FROM public.activity_sessions
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id FOR UPDATE;
  ELSIF p_scope_type = 'activity_series' THEN
    PERFORM 1 FROM public.activity_series
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id FOR UPDATE;
  ELSIF p_scope_type = 'league_season' THEN
    PERFORM 1 FROM public.league_seasons
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id FOR UPDATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_scope_capacity(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_capacity INTEGER DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v_capacity INTEGER;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT capacity INTO v_capacity FROM public.activity_sessions
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'activity_series' THEN
    SELECT capacity INTO v_capacity FROM public.activity_series
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'league_season' THEN
    SELECT team_capacity INTO v_capacity FROM public.league_seasons
    WHERE id = p_scope_id::UUID AND venue_id = p_venue_id;
    RETURN NULLIF(GREATEST(COALESCE(v_capacity, 0), 0), 0);
  ELSIF p_scope_type = 'booking_group' THEN
    RETURN NULLIF(GREATEST(COALESCE(p_capacity, 0), 0), 0);
  END IF;
  RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_committed_count(
  p_venue_id UUID,
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_session_date DATE,
  p_exclude_registration_id UUID DEFAULT NULL,
  p_exclude_participant_id UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  IF p_scope_type = 'activity_session' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.session_registrations registration
    WHERE registration.venue_id = p_venue_id
      AND registration.activity_session_id = p_scope_id::UUID
      AND registration.session_date = p_session_date
      AND registration.status IN ('confirmed', 'checked_in', 'no_show')
      AND (p_exclude_registration_id IS NULL OR registration.id <> p_exclude_registration_id);
  ELSIF p_scope_type = 'booking_group' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.booking_participants participant
    WHERE participant.venue_id = p_venue_id
      AND participant.booking_group_key = p_scope_id
      AND participant.payment_status IN ('paid', 'free')
      AND (p_exclude_participant_id IS NULL OR participant.id <> p_exclude_participant_id);
  ELSIF p_scope_type = 'activity_series' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.series_commitments commitment
    WHERE commitment.venue_id = p_venue_id
      AND commitment.activity_series_id = p_scope_id::UUID
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active';
  ELSIF p_scope_type = 'league_season' THEN
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.league_team_entries entry
    JOIN public.league_seasons season ON season.id = entry.league_season_id
    WHERE season.venue_id = p_venue_id
      AND entry.league_season_id = p_scope_id::UUID
      AND entry.status = 'active';
  ELSE
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;
  RETURN COALESCE(v_count, 0);
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
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_ttl_seconds INTEGER DEFAULT 600
) RETURNS TABLE(ok BOOLEAN, hold_id UUID, available_count INTEGER, reason TEXT)
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
  IF p_scope_type NOT IN ('activity_session', 'booking_group', 'activity_series', 'league_season') THEN
    RAISE EXCEPTION 'Unsupported capacity scope_type: %', p_scope_type;
  END IF;
  PERFORM public.capacity_lock_scope(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  UPDATE public.capacity_holds
  SET status = 'expired', released_at = now(),
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('release_reason', 'lazy_expired_before_acquire')
  WHERE venue_id = p_venue_id AND scope_type = p_scope_type AND scope_id = p_scope_id
    AND session_date = p_session_date AND status = 'active' AND expires_at <= now()
    AND stripe_session_id IS NULL;

  SELECT * INTO v_existing FROM public.capacity_holds hold
  WHERE hold.venue_id = p_venue_id AND hold.scope_type = p_scope_type
    AND hold.scope_id = p_scope_id AND hold.session_date = p_session_date
    AND hold.status = 'active' AND hold.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL AND hold.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''))
      OR (p_source_id IS NOT NULL AND hold.source_id = p_source_id)
    )
  ORDER BY hold.created_at DESC LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    ok := true; hold_id := v_existing.id;
    v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
    v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
    available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds, 0) END;
    reason := 'existing_hold'; RETURN NEXT; RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, p_scope_type, p_scope_id, p_capacity);
  v_committed := public.capacity_committed_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, p_scope_type, p_scope_id, p_session_date);
  IF v_capacity IS NOT NULL AND (v_committed + v_holds) >= v_capacity THEN
    ok := false; hold_id := NULL; available_count := 0; reason := 'capacity_full'; RETURN NEXT; RETURN;
  END IF;
  INSERT INTO public.capacity_holds (
    venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, expires_at, metadata
  ) VALUES (
    p_venue_id, p_scope_type, p_scope_id, p_session_date, p_user_id, p_customer_id,
    p_source_type, p_source_id, NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 600), 1)),
    COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO hold_id;
  ok := true;
  available_count := CASE WHEN v_capacity IS NULL THEN NULL ELSE GREATEST(v_capacity - v_committed - v_holds - 1, 0) END;
  reason := 'held'; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_capacity_hold(UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_capacity_hold(UUID, TEXT, TEXT, DATE, INTEGER, UUID, UUID, TEXT, UUID, TEXT, JSONB, INTEGER)
  TO service_role;

-- Hold identifiers are internal Commerce capabilities. The legacy function was
-- SECURITY DEFINER and browser-executable; keep the lifecycle primitive
-- service-role-only and retire abandoned League checkout state with it.
CREATE OR REPLACE FUNCTION public.release_capacity_hold(
  p_hold_id UUID,
  p_reason TEXT DEFAULT 'released'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold public.capacity_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_hold FROM public.capacity_holds WHERE id = p_hold_id FOR UPDATE;
  IF v_hold.id IS NULL OR v_hold.status <> 'active' THEN RETURN false; END IF;

  UPDATE public.capacity_holds
  SET status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'released' END,
      released_at = now(),
      metadata = COALESCE(metadata, '{}'::JSONB)
        || jsonb_build_object('release_reason', COALESCE(p_reason, 'released'))
  WHERE id = v_hold.id;

  IF v_hold.scope_type = 'league_season' THEN
    UPDATE public.league_team_entries
    SET status = 'cancelled', team_name_reserved = false,
        cancelled_at = COALESCE(cancelled_at, now()),
        purchase_provenance = purchase_provenance || jsonb_build_object(
          'abandoned_at', now(), 'abandonment_reason', COALESCE(p_reason, 'released')
        )
    WHERE capacity_hold_id = v_hold.id AND status = 'pending';

    UPDATE public.league_team_members member
    SET status = 'inactive', effective_until = COALESCE(effective_until, now())
    FROM public.league_team_entries entry
    WHERE entry.capacity_hold_id = v_hold.id AND entry.id = member.team_entry_id
      AND entry.status = 'cancelled' AND member.status = 'pending';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_capacity_hold(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_capacity_hold(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.league_team_capacity_fill(p_league_season_id UUID)
RETURNS TABLE (
  team_capacity INTEGER,
  active_teams INTEGER,
  active_holds INTEGER,
  fill_count INTEGER,
  available_count INTEGER,
  early_bird_allocated INTEGER,
  early_bird_remaining INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_season RECORD; v_product RECORD;
BEGIN
  SELECT season.*, series.access_product_id, series.start_date
  INTO v_season
  FROM public.league_seasons season
  JOIN public.activity_series series ON series.id = season.activity_series_id
  WHERE season.id = p_league_season_id;
  IF v_season.id IS NULL THEN RAISE EXCEPTION 'league_season_not_found'; END IF;
  SELECT * INTO v_product FROM public.access_products WHERE id = v_season.access_product_id;
  team_capacity := v_season.team_capacity;
  SELECT COUNT(*)::INTEGER INTO active_teams FROM public.league_team_entries
    WHERE league_season_id = p_league_season_id AND status = 'active';
  SELECT COUNT(*)::INTEGER INTO active_holds FROM public.capacity_holds
    WHERE scope_type = 'league_season' AND scope_id = p_league_season_id::TEXT
      AND status = 'active' AND (expires_at > now() OR stripe_session_id IS NOT NULL);
  fill_count := active_teams + active_holds;
  available_count := GREATEST(team_capacity - fill_count, 0);
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.league_team_entries entry
      WHERE entry.league_season_id = p_league_season_id AND entry.status = 'active'
        AND entry.pricing_reason = 'early_bird')
    +
    (SELECT COUNT(*)::INTEGER FROM public.capacity_holds hold
      WHERE hold.scope_type = 'league_season' AND hold.scope_id = p_league_season_id::TEXT
        AND hold.status = 'active' AND (hold.expires_at > now() OR hold.stripe_session_id IS NOT NULL)
        AND hold.metadata->>'applied_price_type' = 'early_bird')
  INTO early_bird_allocated;
  early_bird_remaining := CASE WHEN v_product.scarcity_mode = 'early_bird'
    THEN GREATEST(COALESCE(v_product.early_bird_slots, 0) - early_bird_allocated, 0)
    ELSE NULL END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.league_team_capacity_fill(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.league_team_capacity_fill(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_league_team_entry(
  p_league_season_id UUID,
  p_captain_user_id UUID,
  p_captain_customer_id UUID,
  p_player_customer_id UUID,
  p_team_name TEXT,
  p_registration_request_id TEXT,
  p_source_id UUID,
  p_age_confirmed BOOLEAN,
  p_quoted_price_minor INTEGER DEFAULT NULL,
  p_ttl_seconds INTEGER DEFAULT 1920
) RETURNS TABLE (
  ok BOOLEAN,
  team_entry_id UUID,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT,
  applied_price_type TEXT,
  base_price_minor INTEGER,
  final_price_minor INTEGER,
  early_bird_remaining INTEGER,
  quote_changed BOOLEAN,
  team_capacity INTEGER,
  team_fill_before INTEGER,
  allocation_position INTEGER,
  early_bird_allocation_position INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season RECORD;
  v_series RECORD;
  v_product RECORD;
  v_captain RECORD;
  v_player RECORD;
  v_existing public.league_team_entries%ROWTYPE;
  v_existing_hold public.capacity_holds%ROWTYPE;
  v_team_name TEXT;
  v_request_id TEXT;
  v_active_teams INTEGER;
  v_active_holds INTEGER;
  v_early_bird_allocated INTEGER;
  v_session_count INTEGER;
  v_price_type TEXT := 'league_team_base_price';
  v_base_price INTEGER;
  v_final_price INTEGER;
BEGIN
  IF p_age_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'league_18_plus_confirmation_required'; END IF;
  IF p_captain_customer_id = p_player_customer_id THEN RAISE EXCEPTION 'league_players_must_be_distinct'; END IF;
  v_team_name := public.normalize_league_team_name(p_team_name);
  v_request_id := BTRIM(COALESCE(p_registration_request_id, ''));
  IF char_length(v_team_name) NOT BETWEEN 3 AND 40 OR v_team_name ~ '[<>]' THEN
    RAISE EXCEPTION 'league_team_name_invalid';
  END IF;
  IF char_length(v_request_id) < 16 OR p_source_id IS NULL THEN RAISE EXCEPTION 'league_registration_request_invalid'; END IF;

  SELECT season.* INTO v_season FROM public.league_seasons season
    WHERE season.id = p_league_season_id FOR UPDATE;
  IF v_season.id IS NULL THEN RAISE EXCEPTION 'league_season_not_found'; END IF;
  PERFORM public.capacity_lock_scope(v_season.venue_id, 'league_season', v_season.id::TEXT,
    (SELECT start_date FROM public.activity_series WHERE id = v_season.activity_series_id));
  SELECT * INTO v_series FROM public.activity_series WHERE id = v_season.activity_series_id FOR UPDATE;
  SELECT * INTO v_product FROM public.access_products WHERE id = v_series.access_product_id FOR UPDATE;
  IF v_series.status <> 'active' OR v_product.id IS NULL OR v_product.product_kind <> 'league_team'
     OR v_product.status <> 'active' OR v_product.is_active IS DISTINCT FROM true
     OR v_product.commerce_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'league_registration_unavailable';
  END IF;
  IF (v_series.registration_opens_at IS NOT NULL AND now() < v_series.registration_opens_at)
     OR (v_series.registration_closes_at IS NOT NULL AND now() >= v_series.registration_closes_at) THEN
    RAISE EXCEPTION 'league_registration_closed';
  END IF;
  IF v_season.team_capacity <> 6 OR v_season.players_per_team <> 2
     OR v_season.league_night_count <> 5 OR v_season.matches_per_team_per_night <> 2
     OR v_season.blocks_per_night <> 2 THEN RAISE EXCEPTION 'league_v1_configuration_invalid'; END IF;
  SELECT COUNT(*)::INTEGER INTO v_session_count FROM public.activity_sessions session
  WHERE session.series_id = v_series.id AND session.session_type = 'league'
    AND session.closed_to_public = true AND session.is_active = true
    AND session.publish_status = 'published' AND session.start_time = TIME '18:00'
    AND session.end_time = TIME '20:00' AND session.capacity = 12
    AND cardinality(session.court_ids) = 3;
  IF v_session_count <> 5 THEN RAISE EXCEPTION 'league_night_sessions_invalid'; END IF;

  SELECT id, organization_id, auth_user_id, status, merged_into_id INTO v_captain
  FROM public.customers WHERE id = p_captain_customer_id;
  SELECT id, organization_id, status, merged_into_id INTO v_player
  FROM public.customers WHERE id = p_player_customer_id;
  IF v_captain.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_player.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_captain.auth_user_id IS DISTINCT FROM p_captain_user_id
     OR v_captain.status <> 'active' OR v_player.status <> 'active'
     OR v_captain.merged_into_id IS NOT NULL OR v_player.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'league_player_identity_invalid';
  END IF;

  WITH expired AS (
    UPDATE public.capacity_holds hold
    SET status = 'expired', released_at = COALESCE(released_at, now()),
        metadata = hold.metadata || jsonb_build_object('release_reason', 'league_hold_expired')
    WHERE hold.scope_type = 'league_season' AND hold.scope_id = v_season.id::TEXT
      AND hold.status = 'active' AND hold.expires_at <= now() AND hold.stripe_session_id IS NULL
    RETURNING hold.id
  ), retired AS (
    UPDATE public.league_team_entries entry
    SET status = 'cancelled', team_name_reserved = false,
        cancelled_at = COALESCE(cancelled_at, now()),
        purchase_provenance = purchase_provenance || jsonb_build_object(
          'abandoned_at', now(), 'abandonment_reason', 'league_hold_expired'
        )
    WHERE entry.status = 'pending' AND entry.capacity_hold_id IN (SELECT id FROM expired)
    RETURNING entry.id
  )
  UPDATE public.league_team_members member
  SET status = 'inactive', effective_until = COALESCE(effective_until, now())
  WHERE member.status = 'pending' AND member.team_entry_id IN (SELECT id FROM retired);

  SELECT * INTO v_existing FROM public.league_team_entries entry
  WHERE entry.league_season_id = v_season.id AND entry.registration_request_id = v_request_id;
  -- A browser refresh creates a new request id. The captain/team identity is
  -- therefore the secondary idempotency key; reuse the canonical pending or
  -- active team instead of creating a second team or stranding the first Cart.
  IF v_existing.id IS NULL THEN
    SELECT entry.* INTO v_existing
    FROM public.league_team_entries entry
    WHERE entry.league_season_id = v_season.id
      AND entry.captain_customer_id = p_captain_customer_id
      AND entry.status IN ('pending', 'active')
    ORDER BY CASE WHEN entry.status = 'active' THEN 0 ELSE 1 END, entry.created_at
    LIMIT 1;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.captain_customer_id <> p_captain_customer_id
       OR v_existing.team_name_key <> lower(v_team_name)
       OR NOT EXISTS (
         SELECT 1 FROM public.league_team_members member
         WHERE member.team_entry_id = v_existing.id AND member.role = 'player'
           AND member.customer_id = p_player_customer_id AND member.status IN ('pending', 'active', 'inactive')
       ) THEN
      RAISE EXCEPTION 'league_registration_request_payload_mismatch';
    END IF;
    IF v_existing.status = 'cancelled' AND v_existing.team_name_reserved = false THEN
      RAISE EXCEPTION 'league_registration_expired_start_again';
    END IF;
    SELECT * INTO v_existing_hold FROM public.capacity_holds hold
    WHERE hold.id = v_existing.capacity_hold_id;
    IF v_existing.status = 'active' OR (
      v_existing.status = 'pending' AND v_existing_hold.status = 'active'
      AND (v_existing_hold.expires_at > now() OR v_existing_hold.stripe_session_id IS NOT NULL)
    ) THEN
      ok := true; team_entry_id := v_existing.id; hold_id := v_existing_hold.id;
      SELECT fill.available_count, fill.early_bird_remaining
      INTO available_count, early_bird_remaining FROM public.league_team_capacity_fill(v_season.id) fill;
      reason := CASE WHEN v_existing.status = 'active' THEN 'already_active' ELSE 'existing_hold' END;
      applied_price_type := v_existing.pricing_reason;
      base_price_minor := v_existing.base_price_minor;
      final_price_minor := v_existing.final_price_minor;
      quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> final_price_minor;
      team_capacity := v_season.team_capacity;
      team_fill_before := COALESCE((v_existing_hold.metadata->>'team_fill_before')::INTEGER, 0);
      allocation_position := COALESCE((v_existing_hold.metadata->>'allocation_position')::INTEGER, 0);
      early_bird_allocation_position := NULLIF(
        COALESCE((v_existing_hold.metadata->>'early_bird_allocation_position')::INTEGER, 0), 0
      );
      RETURN NEXT; RETURN;
    END IF;
    IF v_existing.status <> 'pending' THEN RAISE EXCEPTION 'league_registration_not_reusable'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.league_team_members member
    JOIN public.league_team_entries entry ON entry.id = member.team_entry_id
    LEFT JOIN public.capacity_holds hold ON hold.id = entry.capacity_hold_id
    WHERE member.league_season_id = v_season.id
      AND member.customer_id IN (p_captain_customer_id, p_player_customer_id)
      AND (
        (member.status = 'active' AND entry.status = 'active')
        OR (member.status = 'pending' AND entry.status = 'pending' AND hold.status = 'active'
          AND (hold.expires_at > now() OR hold.stripe_session_id IS NOT NULL))
      )
      AND (v_existing.id IS NULL OR entry.id <> v_existing.id)
  ) THEN RAISE EXCEPTION 'league_player_already_registered'; END IF;

  SELECT COUNT(*)::INTEGER INTO v_active_teams FROM public.league_team_entries
    WHERE league_season_id = v_season.id AND status = 'active';
  SELECT COUNT(*)::INTEGER INTO v_active_holds FROM public.capacity_holds
    WHERE scope_type = 'league_season' AND scope_id = v_season.id::TEXT
      AND status = 'active' AND (expires_at > now() OR stripe_session_id IS NOT NULL)
      AND (v_existing_hold.id IS NULL OR id <> v_existing_hold.id);
  IF v_active_teams + v_active_holds >= v_season.team_capacity THEN
    ok := false; team_entry_id := NULL; hold_id := NULL; available_count := 0;
    reason := 'capacity_full'; applied_price_type := 'league_team_base_price';
    base_price_minor := ROUND(v_product.base_price_sek * 100)::INTEGER;
    final_price_minor := base_price_minor; early_bird_remaining := NULL; quote_changed := false;
    team_capacity := v_season.team_capacity; team_fill_before := v_active_teams + v_active_holds;
    allocation_position := NULL; early_bird_allocation_position := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_base_price := ROUND(v_product.base_price_sek * 100)::INTEGER;
  IF v_base_price <= 0 THEN RAISE EXCEPTION 'league_team_price_invalid'; END IF;
  v_final_price := v_base_price;
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.league_team_entries entry
      WHERE entry.league_season_id = v_season.id AND entry.status = 'active' AND entry.pricing_reason = 'early_bird')
    +
    (SELECT COUNT(*)::INTEGER FROM public.capacity_holds hold
      WHERE hold.scope_type = 'league_season' AND hold.scope_id = v_season.id::TEXT
        AND hold.status = 'active' AND (hold.expires_at > now() OR hold.stripe_session_id IS NOT NULL)
        AND hold.metadata->>'applied_price_type' = 'early_bird'
        AND (v_existing_hold.id IS NULL OR hold.id <> v_existing_hold.id))
  INTO v_early_bird_allocated;
  IF v_product.scarcity_mode = 'early_bird' THEN
    IF COALESCE(v_product.early_bird_price_minor, 0) <= 0
       OR COALESCE(v_product.early_bird_slots, 0) NOT BETWEEN 1 AND v_season.team_capacity
       OR v_product.early_bird_price_minor >= v_base_price THEN
      RAISE EXCEPTION 'league_early_bird_configuration_invalid';
    END IF;
    IF v_early_bird_allocated < v_product.early_bird_slots THEN
      v_price_type := 'early_bird'; v_final_price := v_product.early_bird_price_minor;
    END IF;
    early_bird_remaining := GREATEST(v_product.early_bird_slots - v_early_bird_allocated
      - CASE WHEN v_price_type = 'early_bird' THEN 1 ELSE 0 END, 0);
  ELSE
    early_bird_remaining := NULL;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.league_team_entries (
      league_season_id, team_name, team_name_key, captain_customer_id, payer_customer_id,
      registration_request_id, status, pricing_reason, base_price_minor, final_price_minor,
      purchase_provenance
    ) VALUES (
      v_season.id, v_team_name, lower(v_team_name), p_captain_customer_id, p_captain_customer_id,
      v_request_id, 'pending', v_price_type, v_base_price, v_final_price,
      jsonb_build_object('scope', 'league_team_entry', 'age_confirmed_18_plus', true)
    ) RETURNING * INTO v_existing;
    INSERT INTO public.league_team_members (league_season_id, team_entry_id, customer_id, role, status, metadata)
    VALUES
      (v_season.id, v_existing.id, p_captain_customer_id, 'captain', 'pending', jsonb_build_object('age_confirmed_18_plus', true)),
      (v_season.id, v_existing.id, p_player_customer_id, 'player', 'pending', jsonb_build_object('age_confirmed_18_plus', true));
  ELSE
    UPDATE public.league_team_entries SET pricing_reason = v_price_type,
      base_price_minor = v_base_price, final_price_minor = v_final_price
    WHERE id = v_existing.id RETURNING * INTO v_existing;
  END IF;

  INSERT INTO public.capacity_holds (
    venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, expires_at, metadata
  ) VALUES (
    v_season.venue_id, 'league_season', v_season.id::TEXT, v_series.start_date,
    p_captain_user_id, p_captain_customer_id, 'league_team_entry', p_source_id,
    'league:' || v_season.id::TEXT || ':' || v_request_id,
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 1920), 1)),
    jsonb_build_object(
      'league_team_entry_id', v_existing.id, 'applied_price_type', v_price_type,
      'base_price_minor', v_base_price, 'final_price_minor', v_final_price,
      'early_bird_remaining', COALESCE(early_bird_remaining, -1),
      'team_capacity', v_season.team_capacity,
      'team_fill_before', v_active_teams + v_active_holds,
      'team_fill_at_reservation', v_active_teams + v_active_holds + 1,
      'allocation_position', v_active_teams + v_active_holds + 1,
      'early_bird_allocation_position', CASE WHEN v_price_type = 'early_bird'
        THEN v_early_bird_allocated + 1 ELSE NULL END
    )
  ) RETURNING id INTO hold_id;
  UPDATE public.league_team_entries SET capacity_hold_id = hold_id WHERE id = v_existing.id;

  ok := true; team_entry_id := v_existing.id;
  available_count := GREATEST(v_season.team_capacity - v_active_teams - v_active_holds - 1, 0);
  reason := 'held'; applied_price_type := v_price_type;
  base_price_minor := v_base_price; final_price_minor := v_final_price;
  quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> v_final_price;
  team_capacity := v_season.team_capacity;
  team_fill_before := v_active_teams + v_active_holds;
  allocation_position := v_active_teams + v_active_holds + 1;
  early_bird_allocation_position := CASE WHEN v_price_type = 'early_bird'
    THEN v_early_bird_allocated + 1 ELSE NULL END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.attach_league_team_commerce(
  p_team_entry_id UUID,
  p_hold_id UUID,
  p_commerce_order_id UUID,
  p_commerce_order_line_id UUID
) RETURNS public.league_team_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_entry public.league_team_entries%ROWTYPE; v_line RECORD; v_hold public.capacity_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM public.league_team_entries WHERE id = p_team_entry_id FOR UPDATE;
  SELECT line.id, line.commerce_order_id, line.quantity, line.commerce_kind, line.activity_series_id,
         line.league_team_entry_id, line.capacity_hold_id
  INTO v_line FROM public.commerce_order_lines line WHERE line.id = p_commerce_order_line_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.capacity_holds WHERE id = p_hold_id FOR UPDATE;
  IF v_entry.id IS NULL OR v_entry.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'league_team_entry_not_attachable'; END IF;
  IF v_entry.capacity_hold_id <> p_hold_id OR v_line.id IS NULL OR v_line.commerce_order_id <> p_commerce_order_id
     OR v_line.quantity <> 1 OR v_line.commerce_kind <> 'participation' THEN
    RAISE EXCEPTION 'league_commerce_link_invalid';
  END IF;
  IF (v_entry.commerce_order_line_id IS NOT NULL AND v_entry.commerce_order_line_id <> p_commerce_order_line_id)
     OR (v_line.league_team_entry_id IS NOT NULL AND v_line.league_team_entry_id <> p_team_entry_id) THEN
    RAISE EXCEPTION 'league_commerce_line_already_fulfills_team';
  END IF;
  UPDATE public.league_team_entries
  SET commerce_order_id = p_commerce_order_id, commerce_order_line_id = p_commerce_order_line_id,
      purchase_provenance = purchase_provenance || jsonb_build_object(
        'commerce_order_id', p_commerce_order_id, 'commerce_order_line_id', p_commerce_order_line_id
      )
  WHERE id = p_team_entry_id RETURNING * INTO v_entry;
  UPDATE public.commerce_order_lines
  SET league_team_entry_id = p_team_entry_id, capacity_hold_id = p_hold_id,
      resolver_snapshot = resolver_snapshot || jsonb_build_object(
        'scope', 'league_team_entry', 'scope_type', 'league_season',
        'league_team_entry_id', p_team_entry_id,
        'league_season_id', v_entry.league_season_id,
        'purchase_kind', 'league_team', 'pricing_reason', v_entry.pricing_reason,
        'base_team_price_minor', v_entry.base_price_minor,
        'final_price_minor', v_entry.final_price_minor,
        'team_capacity', (v_hold.metadata->>'team_capacity')::INTEGER,
        'team_fill_before', (v_hold.metadata->>'team_fill_before')::INTEGER,
        'team_fill_at_reservation', (v_hold.metadata->>'team_fill_at_reservation')::INTEGER,
        'allocation_position', (v_hold.metadata->>'allocation_position')::INTEGER,
        'early_bird_allocation_position', NULLIF(
          COALESCE((v_hold.metadata->>'early_bird_allocation_position')::INTEGER, 0), 0
        )
      )
  WHERE id = p_commerce_order_line_id;
  UPDATE public.capacity_holds SET source_type = 'commerce_order', source_id = p_commerce_order_line_id,
      metadata = metadata || jsonb_build_object(
        'commerce_order_id', p_commerce_order_id, 'commerce_order_line_id', p_commerce_order_line_id
      )
  WHERE id = p_hold_id;
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_league_team_commerce(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_league_team_commerce(UUID, UUID, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_league_team_registrations(p_league_season_id UUID)
RETURNS TABLE(inserted_count INTEGER, updated_count INTEGER, cancelled_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  inserted_count := 0; updated_count := 0; cancelled_count := 0;
  WITH projected AS (
    SELECT session.venue_id, session.id AS activity_session_id, session.session_date,
           customer.auth_user_id AS user_id, member.customer_id, member.id AS league_team_member_id,
           member.team_entry_id
    FROM public.league_team_members member
    JOIN public.league_team_entries entry ON entry.id = member.team_entry_id AND entry.status = 'active'
    JOIN public.league_seasons season ON season.id = member.league_season_id
    JOIN public.activity_sessions session ON session.series_id = season.activity_series_id
      AND session.session_type = 'league' AND session.closed_to_public = true
      AND session.is_active = true AND session.session_date IS NOT NULL
    JOIN public.customers customer ON customer.id = member.customer_id
    WHERE member.league_season_id = p_league_season_id AND member.status = 'active'
      AND ((session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm') >= member.effective_from
      AND (member.effective_until IS NULL
        OR ((session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm') < member.effective_until)
  ), inserted AS (
    INSERT INTO public.session_registrations (
      venue_id, activity_session_id, session_date, user_id, customer_id,
      league_team_member_id, status, price_paid_sek, source_type, source_id, metadata
    )
    SELECT venue_id, activity_session_id, session_date, user_id, customer_id,
      league_team_member_id, 'confirmed', 0, 'league_team_member', league_team_member_id,
      jsonb_build_object('league_team_member_id', league_team_member_id, 'league_team_entry_id', team_entry_id,
        'league_season_id', p_league_season_id, 'access_reason', 'Seriespel')
    FROM projected
    ON CONFLICT (activity_session_id, league_team_member_id) WHERE league_team_member_id IS NOT NULL
    DO NOTHING RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO inserted_count FROM inserted;

  WITH updated AS (
    UPDATE public.session_registrations registration
    SET session_date = session.session_date, venue_id = session.venue_id,
        user_id = customer.auth_user_id, customer_id = member.customer_id,
        status = CASE WHEN registration.status IN ('checked_in', 'no_show') THEN registration.status ELSE 'confirmed' END,
        metadata = registration.metadata || jsonb_build_object(
          'league_team_member_id', member.id, 'league_team_entry_id', member.team_entry_id,
          'league_season_id', member.league_season_id, 'access_reason', 'Seriespel'
        ), updated_at = now()
    FROM public.league_team_members member
    JOIN public.league_team_entries entry ON entry.id = member.team_entry_id AND entry.status = 'active'
    JOIN public.league_seasons season ON season.id = member.league_season_id
    JOIN public.activity_sessions session ON session.series_id = season.activity_series_id
      AND session.session_type = 'league' AND session.is_active = true
    JOIN public.customers customer ON customer.id = member.customer_id
    WHERE registration.league_team_member_id = member.id
      AND registration.activity_session_id = session.id
      AND member.league_season_id = p_league_season_id AND member.status = 'active'
    RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO updated_count FROM updated;

  WITH cancelled AS (
    UPDATE public.session_registrations registration
    SET status = 'cancelled', updated_at = now()
    FROM public.league_team_members member
    JOIN public.league_team_entries entry ON entry.id = member.team_entry_id
    WHERE registration.league_team_member_id = member.id
      AND member.league_season_id = p_league_season_id
      AND registration.status = 'confirmed'
      AND registration.session_date >= (now() AT TIME ZONE 'Europe/Stockholm')::DATE
      AND (member.status <> 'active' OR entry.status <> 'active')
    RETURNING 1
  ) SELECT COUNT(*)::INTEGER INTO cancelled_count FROM cancelled;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_league_team_registrations(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_league_team_registrations(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.fulfill_league_team_entry(
  p_team_entry_id UUID,
  p_commerce_order_id UUID,
  p_commerce_order_line_id UUID,
  p_hold_id UUID,
  p_stripe_session_id TEXT,
  p_payment_intent_id TEXT
) RETURNS TABLE(ok BOOLEAN, team_entry_id UUID, available_count INTEGER, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_entry public.league_team_entries%ROWTYPE; v_season public.league_seasons%ROWTYPE;
  v_order RECORD; v_line RECORD; v_hold public.capacity_holds%ROWTYPE; v_member_count INTEGER; v_active INTEGER;
BEGIN
  SELECT * INTO v_entry FROM public.league_team_entries WHERE id = p_team_entry_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'league_team_entry_not_found'; END IF;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_entry.league_season_id FOR UPDATE;
  PERFORM public.capacity_lock_scope(v_season.venue_id, 'league_season', v_season.id::TEXT,
    (SELECT start_date FROM public.activity_series WHERE id = v_season.activity_series_id));
  IF v_entry.status = 'active' THEN
    ok := true; team_entry_id := v_entry.id;
    SELECT fill.available_count INTO available_count FROM public.league_team_capacity_fill(v_season.id) fill;
    reason := 'already_fulfilled'; RETURN NEXT; RETURN;
  END IF;
  SELECT id, status, stripe_session_id, stripe_payment_intent_id INTO v_order
    FROM public.commerce_orders WHERE id = p_commerce_order_id FOR UPDATE;
  SELECT id, commerce_order_id, quantity, league_team_entry_id, capacity_hold_id INTO v_line
    FROM public.commerce_order_lines WHERE id = p_commerce_order_line_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.capacity_holds WHERE id = p_hold_id FOR UPDATE;
  IF v_entry.status <> 'pending' OR v_entry.commerce_order_id <> p_commerce_order_id
     OR v_entry.commerce_order_line_id <> p_commerce_order_line_id
     OR v_order.status NOT IN ('paid', 'attention') OR v_order.stripe_session_id IS DISTINCT FROM p_stripe_session_id
     OR v_line.commerce_order_id <> p_commerce_order_id OR v_line.quantity <> 1
     OR v_line.league_team_entry_id <> v_entry.id OR v_line.capacity_hold_id <> v_hold.id
     OR v_hold.scope_type <> 'league_season' OR v_hold.scope_id <> v_season.id::TEXT
     OR v_hold.status <> 'active' OR v_hold.stripe_session_id IS DISTINCT FROM p_stripe_session_id THEN
    RAISE EXCEPTION 'league_paid_fulfillment_invariant_failed';
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_member_count FROM public.league_team_members member
    WHERE member.team_entry_id = v_entry.id AND member.status = 'pending';
  IF v_member_count <> 2 OR (SELECT COUNT(*) FROM public.league_team_members
    WHERE league_team_members.team_entry_id = v_entry.id
      AND league_team_members.status = 'pending' AND league_team_members.role = 'captain') <> 1 THEN
    RAISE EXCEPTION 'league_team_roster_incomplete';
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_active FROM public.league_team_entries
    WHERE league_season_id = v_season.id AND status = 'active' AND id <> v_entry.id;
  IF v_active >= v_season.team_capacity THEN
    UPDATE public.capacity_holds SET status = 'conflict',
      metadata = metadata || jsonb_build_object('conflict_reason', 'league_capacity_full_after_payment')
    WHERE id = v_hold.id;
    ok := false; team_entry_id := NULL; available_count := 0; reason := 'capacity_full'; RETURN NEXT; RETURN;
  END IF;
  UPDATE public.league_team_entries SET status = 'active', activated_at = COALESCE(activated_at, now()),
      purchase_provenance = purchase_provenance || jsonb_build_object(
        'stripe_session_id', p_stripe_session_id, 'payment_intent_id', p_payment_intent_id
      ) WHERE id = v_entry.id;
  UPDATE public.league_team_members member SET status = 'active'
    WHERE member.team_entry_id = v_entry.id AND member.status = 'pending';
  UPDATE public.capacity_holds SET status = 'committed', committed_at = COALESCE(committed_at, now()) WHERE id = v_hold.id;
  UPDATE public.commerce_order_lines SET fulfillment_status = 'not_required', fulfilled_at = COALESCE(fulfilled_at, now())
    WHERE id = p_commerce_order_line_id;
  PERFORM public.reconcile_league_team_registrations(v_season.id);
  ok := true; team_entry_id := v_entry.id; available_count := GREATEST(v_season.team_capacity - v_active - 1, 0);
  reason := 'fulfilled'; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_league_team_entry(
  p_team_entry_id UUID,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_reason TEXT,
  p_refund_confirmed BOOLEAN DEFAULT false
) RETURNS public.league_team_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_entry public.league_team_entries%ROWTYPE; v_season public.league_seasons%ROWTYPE;
  v_before JSONB; v_results INTEGER; v_next_status TEXT;
BEGIN
  SELECT * INTO v_entry FROM public.league_team_entries WHERE id = p_team_entry_id FOR UPDATE;
  IF v_entry.id IS NULL THEN RAISE EXCEPTION 'league_team_entry_not_found'; END IF;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_entry.league_season_id FOR UPDATE;
  IF v_entry.status IN ('cancelled', 'withdrawn') THEN RETURN v_entry; END IF;
  SELECT COUNT(*)::INTEGER INTO v_results
  FROM public.league_fixture_results result JOIN public.league_fixtures fixture ON fixture.id = result.fixture_id
  WHERE fixture.league_season_id = v_season.id AND result.state = 'final'
    AND (fixture.team_a_entry_id = v_entry.id OR fixture.team_b_entry_id = v_entry.id);
  IF v_entry.status = 'active' AND v_entry.commerce_order_id IS NOT NULL AND p_refund_confirmed IS DISTINCT FROM true
     AND v_results = 0 AND v_season.fixtures_published_at IS NULL THEN
    RAISE EXCEPTION 'league_team_refund_confirmation_required';
  END IF;
  v_next_status := CASE WHEN v_results > 0 OR v_season.fixtures_published_at IS NOT NULL THEN 'withdrawn' ELSE 'cancelled' END;
  v_before := to_jsonb(v_entry);
  UPDATE public.league_team_entries SET status = v_next_status,
    cancelled_at = CASE WHEN v_next_status = 'cancelled' THEN now() ELSE cancelled_at END,
    withdrawn_at = CASE WHEN v_next_status = 'withdrawn' THEN now() ELSE withdrawn_at END
  WHERE id = v_entry.id RETURNING * INTO v_entry;
  UPDATE public.league_team_members SET status = 'inactive', effective_until = COALESCE(effective_until, now())
    WHERE team_entry_id = v_entry.id AND status IN ('pending', 'active');
  UPDATE public.capacity_holds SET status = 'released', released_at = COALESCE(released_at, now()),
    metadata = metadata || jsonb_build_object('release_reason', 'league_team_cancelled')
    WHERE id = v_entry.capacity_hold_id AND status = 'active';
  PERFORM public.reconcile_league_team_registrations(v_season.id);
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, before, after, metadata)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_team_cancelled',
    'league_team_entries', v_entry.id::TEXT, p_request_id, v_before, to_jsonb(v_entry),
    jsonb_build_object('reason', p_reason, 'next_status', v_next_status));
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_league_team_entry(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_league_team_entry(UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_league_player(
  p_team_entry_id UUID,
  p_new_customer_id UUID,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_reason TEXT,
  p_age_confirmed BOOLEAN
) RETURNS public.league_team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_entry public.league_team_entries%ROWTYPE; v_season public.league_seasons%ROWTYPE;
  v_old public.league_team_members%ROWTYPE; v_new public.league_team_members%ROWTYPE;
  v_customer RECORD; v_completed INTEGER; v_reason TEXT;
BEGIN
  IF p_age_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'league_18_plus_confirmation_required'; END IF;
  SELECT * INTO v_entry FROM public.league_team_entries WHERE id = p_team_entry_id FOR UPDATE;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_entry.league_season_id FOR UPDATE;
  IF NOT (public.is_venue_member(p_actor_user_id, v_season.venue_id) OR public.has_role(p_actor_user_id, 'super_admin')) THEN
    RAISE EXCEPTION 'league_staff_required';
  END IF;
  SELECT * INTO v_old FROM public.league_team_members
    WHERE team_entry_id = v_entry.id AND role = 'player' AND status = 'active' FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'league_current_player_not_found'; END IF;
  IF p_new_customer_id = v_entry.captain_customer_id THEN RAISE EXCEPTION 'league_players_must_be_distinct'; END IF;
  SELECT customer.id, customer.organization_id, customer.status, customer.merged_into_id
  INTO v_customer FROM public.customers customer WHERE customer.id = p_new_customer_id;
  IF v_customer.id IS NULL OR v_customer.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_customer.status <> 'active' OR v_customer.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'league_player_identity_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_team_members WHERE league_season_id = v_season.id
    AND customer_id = p_new_customer_id AND status = 'active') THEN RAISE EXCEPTION 'league_player_already_registered'; END IF;
  SELECT COUNT(*)::INTEGER INTO v_completed FROM public.league_fixture_results result
    JOIN public.league_fixtures fixture ON fixture.id = result.fixture_id
    WHERE fixture.league_season_id = v_season.id AND result.state = 'final'
      AND (fixture.team_a_entry_id = v_entry.id OR fixture.team_b_entry_id = v_entry.id);
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  IF v_completed > 0 AND (v_reason IS NULL OR char_length(v_reason) < 10) THEN
    RAISE EXCEPTION 'league_roster_change_meaningful_reason_required';
  END IF;
  IF v_reason IS NULL THEN v_reason := 'Korrigering före första slutförda match'; END IF;
  UPDATE public.league_team_members SET status = 'inactive', effective_until = now() WHERE id = v_old.id;
  INSERT INTO public.league_team_members (
    league_season_id, team_entry_id, customer_id, role, status, effective_from, metadata
  ) VALUES (
    v_season.id, v_entry.id, p_new_customer_id, 'player', 'active', now(),
    jsonb_build_object('replacement_reason', v_reason, 'age_confirmed_18_plus', true,
      'after_completed_fixture', v_completed > 0)
  ) RETURNING * INTO v_new;
  PERFORM public.reconcile_league_team_registrations(v_season.id);
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, before, after, metadata)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_roster_replaced',
    'league_team_members', v_new.id::TEXT, p_request_id, to_jsonb(v_old), to_jsonb(v_new),
    jsonb_build_object('reason', v_reason, 'completed_fixture_count', v_completed));
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_league_player(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_league_player(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.rename_league_team(
  p_team_entry_id UUID,
  p_team_name TEXT,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_reason TEXT
) RETURNS public.league_team_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_entry public.league_team_entries%ROWTYPE; v_season public.league_seasons%ROWTYPE; v_before JSONB;
BEGIN
  SELECT * INTO v_entry FROM public.league_team_entries WHERE id = p_team_entry_id FOR UPDATE;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_entry.league_season_id;
  IF v_entry.id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'league_team_rename_reason_required'; END IF;
  v_before := to_jsonb(v_entry);
  UPDATE public.league_team_entries SET team_name = public.normalize_league_team_name(p_team_name)
    WHERE id = v_entry.id RETURNING * INTO v_entry;
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table,
    entity_id, request_id, before, after, metadata)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_team_renamed',
    'league_team_entries', v_entry.id::TEXT, p_request_id, v_before, to_jsonb(v_entry),
    jsonb_build_object('reason', p_reason));
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_league_team(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_league_team(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.reserve_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, BOOLEAN, INTEGER, INTEGER) IS
  'Atomically reserves one team slot and, only when it wins, one team-scoped Early Bird slot. Membership pricing is intentionally absent.';
COMMENT ON FUNCTION public.fulfill_league_team_entry(UUID, UUID, UUID, UUID, TEXT, TEXT) IS
  'Idempotently turns one paid Commerce line and its hold into one active team, two active members and ten person registrations.';
