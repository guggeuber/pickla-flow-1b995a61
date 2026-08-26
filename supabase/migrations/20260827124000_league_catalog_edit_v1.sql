-- Focused League V1 Catalog edit boundary.
--
-- League Catalog content, registration deadlines and future team pricing span
-- three canonical rows. Keep the write atomic and server-only; never reconcile
-- the five activity_sessions or rewrite historical commerce facts here.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.update_league_catalog_v1(
  p_league_season_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_registration_opens_at TIMESTAMPTZ,
  p_registration_deadline TIMESTAMPTZ,
  p_fixture_publication_deadline TIMESTAMPTZ,
  p_base_price_minor INTEGER,
  p_early_bird_price_minor INTEGER,
  p_early_bird_slots INTEGER,
  p_actor_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.league_seasons%ROWTYPE;
  v_series public.activity_series%ROWTYPE;
  v_product public.access_products%ROWTYPE;
  v_first_night_at TIMESTAMPTZ;
  v_before JSONB;
  v_after JSONB;
  v_has_order_history BOOLEAN := false;
  v_has_team_history BOOLEAN := false;
BEGIN
  SELECT * INTO v_season
  FROM public.league_seasons
  WHERE id = p_league_season_id
  FOR UPDATE;

  IF v_season.id IS NULL THEN
    RAISE EXCEPTION 'league_catalog_not_found';
  END IF;
  IF p_actor_user_id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'league_staff_required';
  END IF;

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = v_season.activity_series_id
    AND venue_id = v_season.venue_id
    AND series_type = 'league'
  FOR UPDATE;

  IF v_series.id IS NULL OR v_series.status NOT IN ('draft', 'active', 'paused')
     OR v_series.access_product_id IS NULL THEN
    RAISE EXCEPTION 'league_catalog_lifecycle_locked';
  END IF;

  SELECT * INTO v_product
  FROM public.access_products
  WHERE id = v_series.access_product_id
    AND venue_id = v_season.venue_id
    AND product_kind = 'league_team'
    AND status IN ('draft', 'active')
    AND is_active = true
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'league_catalog_product_invalid';
  END IF;

  SELECT MIN((session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm')
  INTO v_first_night_at
  FROM public.activity_sessions session
  WHERE session.series_id = v_series.id
    AND session.session_type IN ('league', 'league_reschedule')
    AND session.is_active = true;

  IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL
     OR char_length(BTRIM(p_name)) > 120
     OR char_length(COALESCE(p_description, '')) > 1000 THEN
    RAISE EXCEPTION 'league_catalog_content_invalid';
  END IF;
  IF p_registration_opens_at IS NULL
     OR p_registration_deadline IS NULL
     OR p_fixture_publication_deadline IS NULL
     OR p_registration_opens_at >= p_registration_deadline
     OR p_registration_deadline > p_fixture_publication_deadline
     OR v_first_night_at IS NULL
     OR p_fixture_publication_deadline >= v_first_night_at THEN
    RAISE EXCEPTION 'league_deadlines_invalid';
  END IF;
  IF p_base_price_minor IS NULL OR p_base_price_minor <= 0
     OR mod(p_base_price_minor, 100) <> 0 THEN
    RAISE EXCEPTION 'league_price_invalid';
  END IF;
  IF (p_early_bird_price_minor IS NULL) <> (p_early_bird_slots IS NULL) THEN
    RAISE EXCEPTION 'league_early_bird_pair_required';
  END IF;
  IF p_early_bird_price_minor IS NOT NULL AND (
    p_early_bird_price_minor <= 0
    OR p_early_bird_price_minor >= p_base_price_minor
    OR p_early_bird_slots NOT BETWEEN 1 AND v_season.team_capacity
  ) THEN
    RAISE EXCEPTION 'league_early_bird_invalid';
  END IF;

  -- A deadline becomes historical at the instant it passes. The exact current
  -- value may still be submitted so one Save can update other safe fields.
  IF v_series.registration_opens_at <= now()
     AND p_registration_opens_at IS DISTINCT FROM v_series.registration_opens_at THEN
    RAISE EXCEPTION 'league_registration_open_historical';
  END IF;
  IF v_series.registration_opens_at > now() AND p_registration_opens_at <= now() THEN
    RAISE EXCEPTION 'league_registration_open_must_be_future';
  END IF;
  IF v_series.registration_closes_at <= now()
     AND p_registration_deadline IS DISTINCT FROM v_series.registration_closes_at THEN
    RAISE EXCEPTION 'league_registration_deadline_historical';
  END IF;
  IF v_series.registration_closes_at > now() AND p_registration_deadline <= now() THEN
    RAISE EXCEPTION 'league_registration_deadline_must_be_future';
  END IF;
  IF (v_season.fixture_publication_deadline <= now() OR v_season.fixtures_published_at IS NOT NULL)
     AND p_fixture_publication_deadline IS DISTINCT FROM v_season.fixture_publication_deadline THEN
    RAISE EXCEPTION 'league_fixture_deadline_historical';
  END IF;
  IF v_season.fixture_publication_deadline > now()
     AND v_season.fixtures_published_at IS NULL
     AND p_fixture_publication_deadline <= now() THEN
    RAISE EXCEPTION 'league_fixture_deadline_must_be_future';
  END IF;

  -- Team pricing is only future-facing while registration remains open.
  IF v_series.registration_closes_at <= now() AND (
    p_base_price_minor IS DISTINCT FROM v_product.base_price_sek * 100
    OR p_early_bird_price_minor IS DISTINCT FROM v_product.early_bird_price_minor
    OR p_early_bird_slots IS DISTINCT FROM v_product.early_bird_slots
  ) THEN
    RAISE EXCEPTION 'league_pricing_historical';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.league_team_entries entry
    WHERE entry.league_season_id = v_season.id
  ) INTO v_has_team_history;
  SELECT EXISTS (
    SELECT 1
    FROM public.commerce_order_lines line
    JOIN public.commerce_orders order_row ON order_row.id = line.commerce_order_id
    WHERE line.activity_series_id = v_series.id
       OR line.league_team_entry_id IN (
         SELECT entry.id FROM public.league_team_entries entry
         WHERE entry.league_season_id = v_season.id
       )
  ) INTO v_has_order_history;

  v_before := jsonb_build_object(
    'series', to_jsonb(v_series),
    'product', to_jsonb(v_product),
    'season', to_jsonb(v_season)
  );

  UPDATE public.activity_series
  SET name = BTRIM(p_name),
      description = NULLIF(BTRIM(COALESCE(p_description, '')), ''),
      registration_opens_at = p_registration_opens_at,
      registration_closes_at = p_registration_deadline,
      updated_at = now()
  WHERE id = v_series.id
  RETURNING * INTO v_series;

  UPDATE public.access_products
  SET name = BTRIM(p_name) || ' · Lagplats',
      description = NULLIF(BTRIM(COALESCE(p_description, '')), ''),
      base_price_sek = p_base_price_minor / 100,
      early_bird_price_minor = p_early_bird_price_minor,
      early_bird_slots = p_early_bird_slots,
      scarcity_mode = CASE WHEN p_early_bird_price_minor IS NULL THEN 'none' ELSE 'early_bird' END,
      updated_at = now()
  WHERE id = v_product.id
  RETURNING * INTO v_product;

  UPDATE public.league_seasons
  SET fixture_publication_deadline = p_fixture_publication_deadline,
      updated_at = now()
  WHERE id = v_season.id
  RETURNING * INTO v_season;

  v_after := jsonb_build_object(
    'series', to_jsonb(v_series),
    'product', to_jsonb(v_product),
    'season', to_jsonb(v_season)
  );

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    before, after, metadata
  ) VALUES (
    v_season.organization_id, v_season.venue_id, p_actor_user_id,
    'league_catalog_updated', 'league_seasons', v_season.id::TEXT,
    v_before, v_after,
    jsonb_build_object(
      'historical_orders_frozen', v_has_order_history,
      'historical_teams_frozen', v_has_team_history,
      'schedule_reconciled', false,
      'member_pricing_applied', false
    )
  );

  RETURN jsonb_build_object(
    'league_season_id', v_season.id,
    'activity_series_id', v_series.id,
    'access_product_id', v_product.id,
    'historical_orders_frozen', v_has_order_history,
    'historical_teams_frozen', v_has_team_history,
    'schedule_reconciled', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_league_catalog_v1(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  INTEGER, INTEGER, INTEGER, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_league_catalog_v1(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  INTEGER, INTEGER, INTEGER, UUID
) TO service_role;

COMMENT ON FUNCTION public.update_league_catalog_v1(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  INTEGER, INTEGER, INTEGER, UUID
) IS 'Atomically edits safe League Catalog content, future deadlines and future team pricing. It never reconciles the five sessions or rewrites historical teams, Orders, receipts or ledger facts.';
