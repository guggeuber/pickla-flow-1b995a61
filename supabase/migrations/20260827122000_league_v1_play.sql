-- Pickla League V1 managed offer, deterministic fixtures, results and derived
-- standings. This deliberately implements only the locked six-team contract.

CREATE OR REPLACE FUNCTION public.create_league_season_v1(
  p_venue_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_image_urls TEXT[],
  p_night_dates DATE[],
  p_court_ids UUID[],
  p_registration_opens_at TIMESTAMPTZ,
  p_registration_deadline TIMESTAMPTZ,
  p_fixture_publication_deadline TIMESTAMPTZ,
  p_base_price_minor INTEGER,
  p_vat_rate NUMERIC,
  p_early_bird_price_minor INTEGER DEFAULT NULL,
  p_early_bird_slots INTEGER DEFAULT NULL,
  p_publish BOOLEAN DEFAULT false,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS public.league_seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue RECORD;
  v_format_id UUID;
  v_product_id UUID := gen_random_uuid();
  v_series_id UUID := gen_random_uuid();
  v_season public.league_seasons%ROWTYPE;
  v_date DATE;
  v_index INTEGER := 0;
  v_conflicts JSONB;
  v_courts INTEGER;
  v_product_key TEXT := 'league_' || replace(v_series_id::TEXT, '-', '');
BEGIN
  SELECT id, organization_id INTO v_venue FROM public.venues WHERE id = p_venue_id;
  IF v_venue.id IS NULL THEN RAISE EXCEPTION 'league_venue_not_found'; END IF;
  IF p_actor_user_id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, p_venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'league_name_required'; END IF;
  IF cardinality(COALESCE(p_night_dates, '{}'::DATE[])) <> 5
     OR (SELECT COUNT(DISTINCT day) FROM unnest(p_night_dates) day) <> 5
     OR EXISTS (SELECT 1 FROM unnest(p_night_dates) day WHERE EXTRACT(DOW FROM day)::INTEGER <> 4) THEN
    RAISE EXCEPTION 'league_requires_five_unique_thursdays';
  END IF;
  IF p_night_dates <> ARRAY(SELECT day FROM unnest(p_night_dates) day ORDER BY day) THEN
    RAISE EXCEPTION 'league_night_dates_must_be_sorted';
  END IF;
  IF cardinality(COALESCE(p_court_ids, '{}'::UUID[])) <> 3
     OR (SELECT COUNT(DISTINCT court_id) FROM unnest(p_court_ids) court_id) <> 3 THEN
    RAISE EXCEPTION 'league_requires_three_courts';
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_courts FROM public.venue_courts court
  WHERE court.venue_id = p_venue_id AND court.is_available = true
    AND court.sport_type = 'pickleball' AND court.id = ANY(p_court_ids);
  IF v_courts <> 3 THEN RAISE EXCEPTION 'league_courts_invalid'; END IF;
  IF p_registration_opens_at >= p_registration_deadline
     OR p_registration_deadline > p_fixture_publication_deadline
     OR p_fixture_publication_deadline >= ((p_night_dates[1] + TIME '18:00') AT TIME ZONE 'Europe/Stockholm') THEN
    RAISE EXCEPTION 'league_deadlines_invalid';
  END IF;
  IF p_base_price_minor <= 0 OR mod(p_base_price_minor, 100) <> 0
     OR p_vat_rate < 0 OR p_vat_rate > 100 THEN RAISE EXCEPTION 'league_price_invalid'; END IF;
  IF (p_early_bird_price_minor IS NULL) <> (p_early_bird_slots IS NULL) THEN
    RAISE EXCEPTION 'league_early_bird_pair_required';
  END IF;
  IF p_early_bird_price_minor IS NOT NULL AND (
    p_early_bird_price_minor <= 0 OR p_early_bird_price_minor >= p_base_price_minor
    OR p_early_bird_slots NOT BETWEEN 1 AND 6
  ) THEN RAISE EXCEPTION 'league_early_bird_invalid'; END IF;

  PERFORM public.lock_course_resources(p_venue_id, p_court_ids);
  FOR v_date IN SELECT day FROM unnest(p_night_dates) day ORDER BY day LOOP
    SELECT jsonb_agg(to_jsonb(preview)) INTO v_conflicts
    FROM public.preview_course_resource_schedule(
      p_venue_id, v_date, v_date, ARRAY[4], TIME '18:00', TIME '20:00', 1, p_court_ids, NULL, NULL
    ) preview WHERE preview.is_available = false;
    IF v_conflicts IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'managed_series_resource_conflict', DETAIL = v_conflicts::TEXT;
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext(v_venue.organization_id::TEXT), hashtext('league_format'));
  SELECT id INTO v_format_id FROM public.activity_formats
  WHERE organization_id = v_venue.organization_id AND presentation_type = 'league' AND is_active = true
  ORDER BY created_at LIMIT 1;
  IF v_format_id IS NULL THEN
    INSERT INTO public.activity_formats (
      organization_id, name, description, age_group, level, requires_instructor,
      is_active, presentation_type, image_urls
    ) VALUES (
      v_venue.organization_id, 'Seriespel', 'Pickla Seriespel', 'adult', 'intro', false,
      true, 'league', '{}'
    ) RETURNING id INTO v_format_id;
  END IF;

  INSERT INTO public.access_products (
    id, venue_id, product_key, name, description, product_kind, base_price_sek,
    vat_rate, grants, is_active, early_bird_price_minor, early_bird_slots,
    scarcity_mode, commerce_kind, fulfillment_type, resolver_rules,
    commerce_enabled, status, standalone_enabled, activity_addon_enabled,
    fulfillment_presentation, category, sport
  ) VALUES (
    v_product_id, p_venue_id, v_product_key, BTRIM(p_name) || ' · Lagplats', p_description,
    'league_team', p_base_price_minor / 100, p_vat_rate,
    jsonb_build_object('league_team_entry', true), true,
    p_early_bird_price_minor, p_early_bird_slots,
    CASE WHEN p_early_bird_price_minor IS NULL THEN 'none' ELSE 'early_bird' END,
    'participation', 'participation', jsonb_build_object('max_quantity', 1, 'membership_pricing', false),
    true, CASE WHEN p_publish THEN 'active' ELSE 'draft' END,
    false, false, 'participation', 'seriespel', 'pickleball'
  );

  INSERT INTO public.activity_series (
    id, venue_id, name, description, series_type, sport_type, status, product_key,
    start_date, end_date, total_sessions, metadata, format_id,
    registration_opens_at, registration_closes_at, capacity, access_product_id,
    recurrence_days, start_time, end_time, court_ids, image_urls
  ) VALUES (
    v_series_id, p_venue_id, BTRIM(p_name), NULLIF(BTRIM(COALESCE(p_description, '')), ''),
    'league', 'pickleball', CASE WHEN p_publish THEN 'active' ELSE 'draft' END, v_product_key,
    p_night_dates[1], p_night_dates[5], 5,
    jsonb_build_object(
      'managed_offer', true, 'customer_concept', 'Seriespel', 'adults_only', true,
      'six_team_failure_policy', 'cancel_and_full_refund',
      'rules_version', 'pickla_league_v1'
    ), v_format_id, p_registration_opens_at, p_registration_deadline, NULL,
    v_product_id, ARRAY[4], TIME '18:00', TIME '20:00', p_court_ids,
    COALESCE(p_image_urls, '{}'::TEXT[])
  );

  INSERT INTO public.league_seasons (
    organization_id, venue_id, activity_series_id, fixture_publication_deadline
  ) VALUES (
    v_venue.organization_id, p_venue_id, v_series_id,
    p_fixture_publication_deadline
  ) RETURNING * INTO v_season;

  FOR v_date IN SELECT day FROM unnest(p_night_dates) day ORDER BY day LOOP
    v_index := v_index + 1;
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, recurrence_days, session_date,
      start_time, end_time, price_sek, capacity, court_ids, access_policy,
      is_active, metadata, series_id, product_key, publish_status, sort_order,
      requires_staffing, closed_to_public, series_occurrence_index
    ) VALUES (
      p_venue_id, BTRIM(p_name), 'league', 'pickleball', NULL, v_date,
      TIME '18:00', TIME '20:00', 0, 12, p_court_ids,
      jsonb_build_object('league_team_membership_required', true), true,
      jsonb_build_object('generated_by', 'league_season_v1', 'league_season_id', v_season.id),
      v_series_id, NULL, 'published', v_index * 10, true, true, v_index
    );
  END LOOP;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, action, entity_table, entity_id, after, metadata
  ) VALUES (
    v_venue.organization_id, p_venue_id, p_actor_user_id, 'league_season_created',
    'league_seasons', v_season.id::TEXT, to_jsonb(v_season),
    jsonb_build_object('activity_series_id', v_series_id, 'five_sessions_created', true)
  );
  RETURN v_season;
END;
$$;

REVOKE ALL ON FUNCTION public.create_league_season_v1(UUID, TEXT, TEXT, TEXT[], DATE[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, NUMERIC, INTEGER, INTEGER, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_league_season_v1(UUID, TEXT, TEXT, TEXT[], DATE[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, NUMERIC, INTEGER, INTEGER, BOOLEAN, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.publish_league_offer_v1(p_league_season_id UUID, p_actor_user_id UUID)
RETURNS public.league_seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_season public.league_seasons%ROWTYPE; v_series public.activity_series%ROWTYPE; v_count INTEGER;
BEGIN
  SELECT * INTO v_season FROM public.league_seasons WHERE id = p_league_season_id FOR UPDATE;
  SELECT * INTO v_series FROM public.activity_series WHERE id = v_season.activity_series_id FOR UPDATE;
  IF v_season.id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  SELECT COUNT(*)::INTEGER INTO v_count FROM public.activity_sessions session
  WHERE session.series_id = v_series.id AND session.session_type = 'league'
    AND session.closed_to_public = true AND session.is_active = true
    AND session.publish_status = 'published' AND session.capacity = 12
    AND session.start_time = TIME '18:00' AND session.end_time = TIME '20:00'
    AND cardinality(session.court_ids) = 3;
  IF v_count <> 5 THEN RAISE EXCEPTION 'league_night_sessions_invalid'; END IF;
  UPDATE public.activity_series SET status = 'active' WHERE id = v_series.id;
  UPDATE public.access_products SET status = 'active', is_active = true, commerce_enabled = true
    WHERE id = v_series.access_product_id;
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id, metadata)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_offer_published',
    'league_seasons', v_season.id::TEXT, jsonb_build_object('sessions_validated', 5));
  RETURN v_season;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_league_offer_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_league_offer_v1(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_league_contract_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_season_id UUID; v_locked BOOLEAN;
BEGIN
  IF current_setting('app.league_contract_mutation', true) = 'allowed' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'activity_series' THEN
    SELECT id INTO v_season_id FROM public.league_seasons WHERE activity_series_id = OLD.id;
    IF v_season_id IS NULL THEN RETURN NEW; END IF;
    IF ROW(OLD.venue_id, OLD.start_date, OLD.end_date, OLD.total_sessions, OLD.start_time, OLD.end_time, OLD.court_ids)
       IS NOT DISTINCT FROM ROW(NEW.venue_id, NEW.start_date, NEW.end_date, NEW.total_sessions, NEW.start_time, NEW.end_time, NEW.court_ids) THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT season.id INTO v_season_id FROM public.league_seasons season WHERE season.activity_series_id = OLD.series_id;
    IF v_season_id IS NULL THEN RETURN NEW; END IF;
    IF ROW(OLD.session_date, OLD.start_time, OLD.end_time, OLD.court_ids, OLD.is_active)
       IS NOT DISTINCT FROM ROW(NEW.session_date, NEW.start_time, NEW.end_time, NEW.court_ids, NEW.is_active) THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.league_team_entries entry WHERE entry.league_season_id = v_season_id
      AND (entry.status = 'active' OR entry.commerce_order_id IS NOT NULL)
    UNION ALL
    SELECT 1 FROM public.capacity_holds hold WHERE hold.scope_type = 'league_season'
      AND hold.scope_id = v_season_id::TEXT AND hold.status = 'active'
  ) INTO v_locked;
  IF v_locked THEN RAISE EXCEPTION 'league_customer_contract_locked_after_first_hold'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_league_series_contract
BEFORE UPDATE OF venue_id, start_date, end_date, total_sessions, start_time, end_time, court_ids
ON public.activity_series FOR EACH ROW EXECUTE FUNCTION public.guard_league_contract_mutation();
CREATE TRIGGER trg_guard_league_session_contract
BEFORE UPDATE OF session_date, start_time, end_time, court_ids, is_active
ON public.activity_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_league_contract_mutation();

CREATE OR REPLACE FUNCTION public.guard_league_session_membership_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_series_id UUID; v_season_id UUID; v_locked BOOLEAN;
BEGIN
  IF current_setting('app.league_contract_mutation', true) = 'allowed' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_series_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.series_id ELSE NEW.series_id END;
  IF v_series_id IS NULL OR (CASE WHEN TG_OP = 'DELETE' THEN OLD.session_type ELSE NEW.session_type END) <> 'league' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT id INTO v_season_id FROM public.league_seasons WHERE activity_series_id = v_series_id;
  IF v_season_id IS NULL THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.league_team_entries entry
      WHERE entry.league_season_id = v_season_id
        AND (entry.status = 'active' OR entry.commerce_order_id IS NOT NULL)
    UNION ALL
    SELECT 1 FROM public.capacity_holds hold
      WHERE hold.scope_type = 'league_season' AND hold.scope_id = v_season_id::TEXT
        AND hold.status IN ('active', 'committed')
  ) INTO v_locked;
  IF v_locked THEN RAISE EXCEPTION 'league_customer_contract_locked_after_first_hold'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_guard_league_session_membership
BEFORE INSERT OR DELETE ON public.activity_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_league_session_membership_mutation();

CREATE OR REPLACE FUNCTION public.generate_league_fixtures_v1(
  p_league_season_id UUID,
  p_actor_user_id UUID
) RETURNS SETOF public.league_fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season public.league_seasons%ROWTYPE;
  v_teams UUID[];
  v_sessions UUID[];
  v_session_dates DATE[];
  v_courts UUID[];
  v_factors INTEGER[][] := ARRAY[
    ARRAY[1,6, 2,5, 3,4],
    ARRAY[1,5, 6,4, 2,3],
    ARRAY[1,4, 5,3, 6,2],
    ARRAY[1,3, 4,2, 5,6],
    ARRAY[1,2, 3,6, 4,5]
  ];
  v_week_factors INTEGER[][] := ARRAY[
    ARRAY[1,5], ARRAY[2,3], ARRAY[4,5], ARRAY[1,2], ARRAY[3,4]
  ];
  v_factor INTEGER;
  v_team_a UUID; v_team_b UUID; v_court UUID; v_leg INTEGER;
  v_fingerprint TEXT; v_generation_key TEXT; v_existing_count INTEGER;
  v_start_at TIMESTAMPTZ; v_end_at TIMESTAMPTZ;
  v_validation JSONB;
BEGIN
  SELECT * INTO v_season FROM public.league_seasons WHERE id = p_league_season_id FOR UPDATE;
  IF v_season.id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF v_season.fixtures_published_at IS NOT NULL THEN RAISE EXCEPTION 'league_fixtures_already_published'; END IF;
  SELECT array_agg(id ORDER BY created_at, id), md5(string_agg(id::TEXT, ',' ORDER BY created_at, id))
  INTO v_teams, v_fingerprint FROM public.league_team_entries
  WHERE league_season_id = v_season.id AND status = 'active';
  IF cardinality(COALESCE(v_teams, '{}'::UUID[])) <> 6 THEN RAISE EXCEPTION 'league_requires_six_active_teams'; END IF;
  SELECT array_agg(id ORDER BY series_occurrence_index), array_agg(session_date ORDER BY series_occurrence_index)
  INTO v_sessions, v_session_dates FROM public.activity_sessions
  WHERE series_id = v_season.activity_series_id AND session_type = 'league'
    AND is_active = true AND closed_to_public = true;
  IF cardinality(COALESCE(v_sessions, '{}'::UUID[])) <> 5 THEN RAISE EXCEPTION 'league_requires_five_sessions'; END IF;
  SELECT court_ids INTO v_courts FROM public.activity_sessions WHERE id = v_sessions[1];
  v_courts := ARRAY(SELECT court FROM unnest(v_courts) court
    JOIN public.venue_courts vc ON vc.id = court ORDER BY vc.court_number, vc.id);
  IF cardinality(v_courts) <> 3 THEN RAISE EXCEPTION 'league_requires_three_courts'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_sessions) session_id
    JOIN public.activity_sessions session ON session.id = session_id
    WHERE (session.court_ids @> v_courts) IS DISTINCT FROM true OR cardinality(session.court_ids) <> 3) THEN
    RAISE EXCEPTION 'league_session_courts_mismatch';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_existing_count FROM public.league_fixtures WHERE league_season_id = v_season.id;
  IF v_existing_count > 0 AND v_season.generated_team_fingerprint = v_fingerprint THEN
    v_validation := public.validate_league_fixtures_v1(v_season.id);
    IF COALESCE((v_validation->>'valid')::BOOLEAN, false) THEN
      RETURN QUERY SELECT * FROM public.league_fixtures WHERE league_season_id = v_season.id
        ORDER BY round_number, block_number, venue_court_id;
      RETURN;
    END IF;
  END IF;
  DELETE FROM public.league_fixtures WHERE league_season_id = v_season.id;

  FOR v_round IN 1..5 LOOP
    FOR v_block IN 1..2 LOOP
      v_factor := v_week_factors[v_round][v_block];
      FOR v_pair IN 1..3 LOOP
        v_team_a := v_teams[v_factors[v_factor][(v_pair - 1) * 2 + 1]];
        v_team_b := v_teams[v_factors[v_factor][(v_pair - 1) * 2 + 2]];
        v_court := v_courts[((v_pair + v_round + v_block - 3) % 3) + 1];
        SELECT 1 + COUNT(*)::INTEGER INTO v_leg FROM public.league_fixtures fixture
        WHERE fixture.league_season_id = v_season.id
          AND LEAST(fixture.team_a_entry_id, fixture.team_b_entry_id) = LEAST(v_team_a, v_team_b)
          AND GREATEST(fixture.team_a_entry_id, fixture.team_b_entry_id) = GREATEST(v_team_a, v_team_b);
        v_start_at := ((v_session_dates[v_round] + TIME '18:00') AT TIME ZONE 'Europe/Stockholm')
          + make_interval(mins => v_season.block_start_offsets_minutes[v_block]);
        v_end_at := v_start_at + make_interval(mins => v_season.match_duration_minutes);
        v_generation_key := 'v1:' || v_fingerprint || ':r' || v_round || ':b' || v_block || ':p' || v_pair;
        INSERT INTO public.league_fixtures (
          league_season_id, league_night_session_id, round_number, block_number,
          venue_court_id, team_a_entry_id, team_b_entry_id, leg_number,
          scheduled_start_at, scheduled_end_at, status, generation_key
        ) VALUES (
          v_season.id, v_sessions[v_round], v_round, v_block,
          v_court, v_team_a, v_team_b, v_leg, v_start_at, v_end_at, 'scheduled', v_generation_key
        );
      END LOOP;
    END LOOP;
  END LOOP;
  -- The function transaction is the publication boundary: validate the whole
  -- 30-row candidate before making the generation visible. Any failed check
  -- raises and rolls every fixture insert back, so no partial schedule exists.
  UPDATE public.league_seasons SET generated_team_fingerprint = v_fingerprint WHERE id = v_season.id;
  v_validation := public.validate_league_fixtures_v1(v_season.id);
  IF COALESCE((v_validation->>'valid')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'league_fixture_generation_validation_failed: %', v_validation;
  END IF;
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id, metadata)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_fixtures_generated',
    'league_seasons', v_season.id::TEXT, jsonb_build_object('fixture_count', 30, 'fingerprint', v_fingerprint));
  RETURN QUERY SELECT * FROM public.league_fixtures WHERE league_season_id = v_season.id
    ORDER BY round_number, block_number, venue_court_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_league_fixtures_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_league_fixtures_v1(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_league_fixtures_v1(p_league_season_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_fixture_count INTEGER; v_team_bad INTEGER; v_pair_bad INTEGER; v_night_bad INTEGER;
  v_block_bad INTEGER; v_same_night_pair INTEGER; v_outside INTEGER;
  v_team_block_bad INTEGER; v_active_count INTEGER; v_inactive_fixture_teams INTEGER;
  v_missing_active_teams INTEGER; v_generation_bad INTEGER := 0;
  v_season public.league_seasons%ROWTYPE; v_teams UUID[]; v_sessions UUID[];
  v_session_dates DATE[]; v_courts UUID[]; v_current_fingerprint TEXT;
  v_factors INTEGER[][] := ARRAY[
    ARRAY[1,6, 2,5, 3,4], ARRAY[1,5, 6,4, 2,3], ARRAY[1,4, 5,3, 6,2],
    ARRAY[1,3, 4,2, 5,6], ARRAY[1,2, 3,6, 4,5]
  ];
  v_week_factors INTEGER[][] := ARRAY[
    ARRAY[1,5], ARRAY[2,3], ARRAY[4,5], ARRAY[1,2], ARRAY[3,4]
  ];
  v_factor INTEGER; v_expected_key TEXT; v_expected_start TIMESTAMPTZ;
  v_expected_court UUID; v_expected_a UUID; v_expected_b UUID; v_match_count INTEGER;
BEGIN
  SELECT * INTO v_season FROM public.league_seasons WHERE id = p_league_season_id;
  SELECT array_agg(id ORDER BY created_at, id),
         md5(string_agg(id::TEXT, ',' ORDER BY created_at, id)), COUNT(*)::INTEGER
  INTO v_teams, v_current_fingerprint, v_active_count
  FROM public.league_team_entries
  WHERE league_season_id = p_league_season_id AND status = 'active';
  SELECT array_agg(id ORDER BY series_occurrence_index), array_agg(session_date ORDER BY series_occurrence_index)
  INTO v_sessions, v_session_dates FROM public.activity_sessions
  WHERE series_id = v_season.activity_series_id AND session_type = 'league'
    AND is_active = true AND closed_to_public = true;
  IF cardinality(COALESCE(v_sessions, '{}'::UUID[])) = 5 THEN
    SELECT court_ids INTO v_courts FROM public.activity_sessions WHERE id = v_sessions[1];
    v_courts := ARRAY(SELECT court FROM unnest(COALESCE(v_courts, '{}'::UUID[])) court
      JOIN public.venue_courts vc ON vc.id = court ORDER BY vc.court_number, vc.id);
  ELSE
    v_courts := '{}'::UUID[];
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_fixture_count FROM public.league_fixtures WHERE league_season_id = p_league_season_id;
  SELECT COUNT(*)::INTEGER INTO v_team_bad FROM (
    SELECT team_id FROM (
      SELECT team_a_entry_id team_id FROM public.league_fixtures WHERE league_season_id = p_league_season_id
      UNION ALL SELECT team_b_entry_id FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    ) x GROUP BY team_id HAVING COUNT(*) <> 10
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_pair_bad FROM (
    SELECT LEAST(team_a_entry_id, team_b_entry_id), GREATEST(team_a_entry_id, team_b_entry_id)
    FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    GROUP BY 1,2 HAVING COUNT(*) <> 2
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_night_bad FROM (
    SELECT league_night_session_id FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    GROUP BY league_night_session_id HAVING COUNT(*) <> 6
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_block_bad FROM (
    SELECT league_night_session_id, block_number FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    GROUP BY league_night_session_id, block_number HAVING COUNT(*) <> 3
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_same_night_pair FROM (
    SELECT league_night_session_id, LEAST(team_a_entry_id, team_b_entry_id), GREATEST(team_a_entry_id, team_b_entry_id)
    FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    GROUP BY 1,2,3 HAVING COUNT(*) > 1
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_team_block_bad FROM (
    SELECT league_night_session_id, block_number, team_id FROM (
      SELECT league_night_session_id, block_number, team_a_entry_id AS team_id
      FROM public.league_fixtures WHERE league_season_id = p_league_season_id
      UNION ALL
      SELECT league_night_session_id, block_number, team_b_entry_id
      FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    ) appearances GROUP BY 1,2,3 HAVING COUNT(*) <> 1
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_inactive_fixture_teams FROM (
    SELECT DISTINCT team_id FROM (
      SELECT team_a_entry_id AS team_id FROM public.league_fixtures WHERE league_season_id = p_league_season_id
      UNION ALL
      SELECT team_b_entry_id FROM public.league_fixtures WHERE league_season_id = p_league_season_id
    ) fixture_teams
    JOIN public.league_team_entries entry ON entry.id = fixture_teams.team_id
    WHERE entry.league_season_id <> p_league_season_id OR entry.status <> 'active'
  ) bad;
  SELECT COUNT(*)::INTEGER INTO v_missing_active_teams
  FROM public.league_team_entries entry
  WHERE entry.league_season_id = p_league_season_id AND entry.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.league_fixtures fixture
      WHERE fixture.league_season_id = p_league_season_id
        AND entry.id IN (fixture.team_a_entry_id, fixture.team_b_entry_id)
    );
  SELECT COUNT(*)::INTEGER INTO v_outside FROM public.league_fixtures fixture
  JOIN public.activity_sessions session ON session.id = fixture.league_night_session_id
  WHERE fixture.league_season_id = p_league_season_id
    AND (fixture.scheduled_start_at < ((session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm')
      OR fixture.scheduled_end_at > ((session.session_date + session.end_time) AT TIME ZONE 'Europe/Stockholm')
      OR fixture.venue_court_id <> ALL(session.court_ids));

  -- Verify the persisted rows are the exact deterministic V1 output, not just
  -- any structurally plausible 30-row double round robin.
  IF v_active_count = 6 AND cardinality(v_sessions) = 5 AND cardinality(v_courts) = 3 THEN
    FOR v_round IN 1..5 LOOP
      FOR v_block IN 1..2 LOOP
        v_factor := v_week_factors[v_round][v_block];
        FOR v_pair IN 1..3 LOOP
          v_expected_a := v_teams[v_factors[v_factor][(v_pair - 1) * 2 + 1]];
          v_expected_b := v_teams[v_factors[v_factor][(v_pair - 1) * 2 + 2]];
          v_expected_court := v_courts[((v_pair + v_round + v_block - 3) % 3) + 1];
          v_expected_start := ((v_session_dates[v_round] + TIME '18:00') AT TIME ZONE 'Europe/Stockholm')
            + make_interval(mins => v_season.block_start_offsets_minutes[v_block]);
          v_expected_key := format('v1:%s:r%s:b%s:p%s', v_current_fingerprint, v_round, v_block, v_pair);
          SELECT COUNT(*)::INTEGER INTO v_match_count FROM public.league_fixtures fixture
          WHERE fixture.league_season_id = p_league_season_id
            AND fixture.generation_key = v_expected_key
            AND fixture.league_night_session_id = v_sessions[v_round]
            AND fixture.round_number = v_round AND fixture.block_number = v_block
            AND fixture.venue_court_id = v_expected_court
            AND fixture.team_a_entry_id = v_expected_a AND fixture.team_b_entry_id = v_expected_b
            AND fixture.scheduled_start_at = v_expected_start
            AND fixture.scheduled_end_at = v_expected_start + make_interval(mins => v_season.match_duration_minutes);
          IF v_match_count <> 1 THEN v_generation_bad := v_generation_bad + 1; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_generation_bad := 30;
  END IF;
  RETURN jsonb_build_object(
    'valid', v_fixture_count = 30 AND v_team_bad = 0 AND v_pair_bad = 0 AND v_night_bad = 0
      AND v_block_bad = 0 AND v_same_night_pair = 0 AND v_outside = 0
      AND v_team_block_bad = 0 AND v_active_count = 6 AND v_inactive_fixture_teams = 0
      AND v_missing_active_teams = 0 AND v_generation_bad = 0
      AND v_season.generated_team_fingerprint = v_current_fingerprint,
    'fixture_count', v_fixture_count, 'invalid_team_counts', v_team_bad,
    'invalid_pair_counts', v_pair_bad, 'invalid_night_counts', v_night_bad,
    'invalid_block_counts', v_block_bad, 'same_night_rematches', v_same_night_pair,
    'outside_session', v_outside, 'invalid_team_blocks', v_team_block_bad,
    'active_team_count', v_active_count, 'inactive_fixture_teams', v_inactive_fixture_teams,
    'missing_active_teams', v_missing_active_teams,
    'generated_team_fingerprint', v_season.generated_team_fingerprint,
    'current_team_fingerprint', v_current_fingerprint,
    'fingerprint_matches', v_season.generated_team_fingerprint = v_current_fingerprint,
    'generation_equivalence_failures', v_generation_bad
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_league_fixtures_v1(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_league_fixtures_v1(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_league_fixtures_v1(p_league_season_id UUID, p_actor_user_id UUID)
RETURNS public.league_seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_season public.league_seasons%ROWTYPE; v_validation JSONB;
  v_active INTEGER; v_current_fingerprint TEXT;
BEGIN
  SELECT * INTO v_season FROM public.league_seasons WHERE id = p_league_season_id FOR UPDATE;
  IF v_season.id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF v_season.fixtures_published_at IS NOT NULL THEN RETURN v_season; END IF;
  PERFORM public.capacity_lock_scope(v_season.venue_id, 'league_season', v_season.id::TEXT,
    (SELECT start_date FROM public.activity_series WHERE id = v_season.activity_series_id));
  SELECT COUNT(*)::INTEGER, md5(string_agg(id::TEXT, ',' ORDER BY created_at, id))
  INTO v_active, v_current_fingerprint FROM public.league_team_entries
    WHERE league_season_id = v_season.id AND status = 'active';
  IF v_active <> 6 OR v_season.generated_team_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
    RAISE EXCEPTION 'Lagen har ändrats sedan spelschemat genererades. Generera om spelschemat.';
  END IF;
  v_validation := public.validate_league_fixtures_v1(v_season.id);
  IF COALESCE((v_validation->>'valid')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'league_fixture_publication_validation_failed: %', v_validation;
  END IF;
  UPDATE public.league_seasons SET fixtures_published_at = now() WHERE id = v_season.id RETURNING * INTO v_season;
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id, after)
  VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id, 'league_fixtures_published',
    'league_seasons', v_season.id::TEXT, to_jsonb(v_season));
  RETURN v_season;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_league_fixtures_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_league_fixtures_v1(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.valid_league_set_score(p_a INTEGER, p_b INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p_a >= 0 AND p_b >= 0 AND p_a <> p_b AND GREATEST(p_a, p_b) BETWEEN 11 AND 13
    AND (
      (GREATEST(p_a, p_b) = 11 AND LEAST(p_a, p_b) <= 9)
      OR (GREATEST(p_a, p_b) = 12 AND LEAST(p_a, p_b) = 10)
      OR (GREATEST(p_a, p_b) = 13 AND LEAST(p_a, p_b) IN (11, 12))
    );
$$;

CREATE OR REPLACE FUNCTION public.save_league_fixture_result_v1(
  p_fixture_id UUID,
  p_state TEXT,
  p_outcome_type TEXT,
  p_sets JSONB,
  p_walkover_winner_team_id UUID,
  p_expected_version INTEGER,
  p_request_id TEXT,
  p_actor_user_id UUID
) RETURNS public.league_fixture_results
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_fixture public.league_fixtures%ROWTYPE; v_season public.league_seasons%ROWTYPE;
  v_existing public.league_fixture_results%ROWTYPE; v_result public.league_fixture_results%ROWTYPE;
  v_set JSONB; v_before JSONB; v_is_correction BOOLEAN := false;
BEGIN
  SELECT * INTO v_fixture FROM public.league_fixtures WHERE id = p_fixture_id FOR UPDATE;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_fixture.league_season_id;
  IF v_fixture.id IS NULL OR NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF v_season.fixtures_published_at IS NULL OR v_fixture.status = 'cancelled' THEN
    RAISE EXCEPTION 'league_fixture_not_resultable';
  END IF;
  IF p_state NOT IN ('incomplete', 'final') OR p_outcome_type NOT IN ('played', 'walkover')
     OR NULLIF(BTRIM(COALESCE(p_request_id, '')), '') IS NULL THEN RAISE EXCEPTION 'league_result_request_invalid'; END IF;
  IF p_outcome_type = 'played' THEN
    IF p_walkover_winner_team_id IS NOT NULL OR jsonb_typeof(p_sets) <> 'array'
       OR (p_state = 'final' AND jsonb_array_length(p_sets) <> 3)
       OR (p_state = 'incomplete' AND jsonb_array_length(p_sets) > 3) THEN
      RAISE EXCEPTION 'league_result_sets_invalid';
    END IF;
    FOR v_set IN SELECT value FROM jsonb_array_elements(p_sets) LOOP
      IF NOT (v_set ? 'team_a' AND v_set ? 'team_b')
         OR COALESCE(jsonb_typeof(v_set->'team_a'), 'null') <> 'number'
         OR COALESCE(jsonb_typeof(v_set->'team_b'), 'null') <> 'number'
         OR (v_set->>'team_a') !~ '^\d+$' OR (v_set->>'team_b') !~ '^\d+$'
         OR NOT public.valid_league_set_score((v_set->>'team_a')::INTEGER, (v_set->>'team_b')::INTEGER) THEN
        RAISE EXCEPTION 'league_set_score_invalid';
      END IF;
    END LOOP;
  ELSE
    IF p_state <> 'final' OR COALESCE(p_sets, '[]'::JSONB) <> '[]'::JSONB
       OR p_walkover_winner_team_id NOT IN (v_fixture.team_a_entry_id, v_fixture.team_b_entry_id) THEN
      RAISE EXCEPTION 'league_walkover_invalid';
    END IF;
  END IF;
  SELECT * INTO v_existing FROM public.league_fixture_results WHERE fixture_id = p_fixture_id FOR UPDATE;
  IF v_existing.id IS NOT NULL AND v_existing.last_request_id = p_request_id THEN
    IF v_existing.state = p_state AND v_existing.outcome_type = p_outcome_type
       AND v_existing.sets = COALESCE(p_sets, '[]'::JSONB)
       AND v_existing.walkover_winner_team_id IS NOT DISTINCT FROM p_walkover_winner_team_id THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'league_result_request_payload_mismatch';
  END IF;
  IF v_existing.id IS NULL THEN
    IF p_expected_version <> 0 THEN RAISE EXCEPTION 'league_result_version_conflict'; END IF;
    INSERT INTO public.league_fixture_results (
      fixture_id, state, outcome_type, sets, walkover_winner_team_id, version,
      last_request_id, entered_by_user_id, completed_at
    ) VALUES (
      p_fixture_id, p_state, p_outcome_type, COALESCE(p_sets, '[]'::JSONB), p_walkover_winner_team_id,
      1, p_request_id, p_actor_user_id, CASE WHEN p_state = 'final' THEN now() END
    ) RETURNING * INTO v_result;
  ELSE
    IF p_expected_version <> v_existing.version THEN RAISE EXCEPTION 'league_result_version_conflict'; END IF;
    v_before := to_jsonb(v_existing); v_is_correction := true;
    UPDATE public.league_fixture_results SET
      state = p_state, outcome_type = p_outcome_type, sets = COALESCE(p_sets, '[]'::JSONB),
      walkover_winner_team_id = p_walkover_winner_team_id, version = version + 1,
      last_request_id = p_request_id, corrected_by_user_id = p_actor_user_id,
      corrected_at = now(), completed_at = CASE WHEN p_state = 'final' THEN COALESCE(completed_at, now()) ELSE NULL END
    WHERE id = v_existing.id RETURNING * INTO v_result;
  END IF;
  UPDATE public.league_fixtures SET status = CASE WHEN p_state = 'final' THEN 'completed' ELSE 'scheduled' END
    WHERE id = p_fixture_id;
  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, before, after, metadata
  ) VALUES (
    v_season.organization_id, v_season.venue_id, p_actor_user_id,
    CASE WHEN v_is_correction THEN 'league_result_corrected' ELSE 'league_result_entered' END,
    'league_fixture_results', v_result.id::TEXT, p_request_id, v_before, to_jsonb(v_result),
    jsonb_build_object('fixture_id', p_fixture_id)
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_league_fixture_result_v1(UUID, TEXT, TEXT, JSONB, UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_league_fixture_result_v1(UUID, TEXT, TEXT, JSONB, UUID, INTEGER, TEXT, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_league_standings(p_league_season_id UUID)
RETURNS TABLE (
  "position" BIGINT, team_entry_id UUID, team_name TEXT, matches_played BIGINT,
  wins BIGINT, losses BIGINT, sets_won BIGINT, sets_lost BIGINT,
  set_difference BIGINT, points_scored BIGINT, points_conceded BIGINT,
  point_difference BIGINT, league_points BIGINT, walkovers BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH teams AS (
  SELECT id, team_name FROM public.league_team_entries
  WHERE league_season_id = p_league_season_id AND status IN ('active', 'withdrawn')
), final_results AS (
  SELECT fixture.id fixture_id, fixture.team_a_entry_id team_a, fixture.team_b_entry_id team_b,
    result.outcome_type, result.sets, result.walkover_winner_team_id
  FROM public.league_fixtures fixture
  JOIN public.league_fixture_results result ON result.fixture_id = fixture.id AND result.state = 'final'
  WHERE fixture.league_season_id = p_league_season_id AND fixture.status = 'completed'
), played_metrics AS (
  SELECT result.fixture_id,
    COUNT(*) FILTER (WHERE (score.value->>'team_a')::INTEGER > (score.value->>'team_b')::INTEGER)::BIGINT a_sets,
    COUNT(*) FILTER (WHERE (score.value->>'team_b')::INTEGER > (score.value->>'team_a')::INTEGER)::BIGINT b_sets,
    COALESCE(SUM((score.value->>'team_a')::INTEGER), 0)::BIGINT a_points,
    COALESCE(SUM((score.value->>'team_b')::INTEGER), 0)::BIGINT b_points
  FROM final_results result
  CROSS JOIN LATERAL jsonb_array_elements(result.sets) score(value)
  WHERE result.outcome_type = 'played'
  GROUP BY result.fixture_id
), fixture_team AS (
  SELECT result.fixture_id, result.team_a team_id, result.team_b opponent_id,
    CASE WHEN result.outcome_type = 'walkover' THEN
      CASE WHEN result.walkover_winner_team_id = result.team_a THEN 3 ELSE 0 END
      ELSE metrics.a_sets END::BIGINT league_points,
    CASE WHEN result.outcome_type = 'played' THEN metrics.a_sets ELSE 0 END::BIGINT sets_won,
    CASE WHEN result.outcome_type = 'played' THEN metrics.b_sets ELSE 0 END::BIGINT sets_lost,
    CASE WHEN result.outcome_type = 'played' THEN metrics.a_points ELSE 0 END::BIGINT points_scored,
    CASE WHEN result.outcome_type = 'played' THEN metrics.b_points ELSE 0 END::BIGINT points_conceded,
    CASE WHEN (result.outcome_type = 'walkover' AND result.walkover_winner_team_id = result.team_a)
      OR (result.outcome_type = 'played' AND metrics.a_sets > metrics.b_sets) THEN 1 ELSE 0 END::BIGINT won,
    CASE WHEN result.outcome_type = 'walkover' AND result.walkover_winner_team_id = result.team_a THEN 1 ELSE 0 END::BIGINT walkover
  FROM final_results result LEFT JOIN played_metrics metrics ON metrics.fixture_id = result.fixture_id
  UNION ALL
  SELECT result.fixture_id, result.team_b, result.team_a,
    CASE WHEN result.outcome_type = 'walkover' THEN
      CASE WHEN result.walkover_winner_team_id = result.team_b THEN 3 ELSE 0 END
      ELSE metrics.b_sets END::BIGINT,
    CASE WHEN result.outcome_type = 'played' THEN metrics.b_sets ELSE 0 END::BIGINT,
    CASE WHEN result.outcome_type = 'played' THEN metrics.a_sets ELSE 0 END::BIGINT,
    CASE WHEN result.outcome_type = 'played' THEN metrics.b_points ELSE 0 END::BIGINT,
    CASE WHEN result.outcome_type = 'played' THEN metrics.a_points ELSE 0 END::BIGINT,
    CASE WHEN (result.outcome_type = 'walkover' AND result.walkover_winner_team_id = result.team_b)
      OR (result.outcome_type = 'played' AND metrics.b_sets > metrics.a_sets) THEN 1 ELSE 0 END::BIGINT,
    CASE WHEN result.outcome_type = 'walkover' AND result.walkover_winner_team_id = result.team_b THEN 1 ELSE 0 END::BIGINT
  FROM final_results result LEFT JOIN played_metrics metrics ON metrics.fixture_id = result.fixture_id
), normalized AS (
  SELECT team.id team_id, team.team_name,
    COUNT(contribution.fixture_id)::BIGINT matches_played,
    COALESCE(SUM(contribution.won), 0)::BIGINT wins,
    (COUNT(contribution.fixture_id) - COALESCE(SUM(contribution.won), 0))::BIGINT losses,
    COALESCE(SUM(contribution.sets_won), 0)::BIGINT sets_won,
    COALESCE(SUM(contribution.sets_lost), 0)::BIGINT sets_lost,
    COALESCE(SUM(contribution.points_scored), 0)::BIGINT points_scored,
    COALESCE(SUM(contribution.points_conceded), 0)::BIGINT points_conceded,
    COALESCE(SUM(contribution.league_points), 0)::BIGINT league_points,
    COALESCE(SUM(contribution.walkover), 0)::BIGINT walkovers
  FROM teams team LEFT JOIN fixture_team contribution ON contribution.team_id = team.id
  GROUP BY team.id, team.team_name
), tied AS (
  SELECT normalized.*, COUNT(*) OVER (PARTITION BY league_points) tie_count
  FROM normalized
), head_to_head AS (
  SELECT tied.team_id,
    CASE WHEN tied.tie_count = 2 AND COUNT(contribution.fixture_id) = 2
      THEN COALESCE(SUM(contribution.league_points), 0) ELSE 0 END::BIGINT h2h_points
  FROM tied
  LEFT JOIN tied opponent ON opponent.league_points = tied.league_points AND opponent.team_id <> tied.team_id
  LEFT JOIN fixture_team contribution ON contribution.team_id = tied.team_id
    AND contribution.opponent_id = opponent.team_id
  GROUP BY tied.team_id, tied.tie_count
), ranked AS (
  SELECT tied.*, head_to_head.h2h_points,
    RANK() OVER (ORDER BY tied.league_points DESC,
      CASE WHEN tied.tie_count = 2 THEN head_to_head.h2h_points ELSE 0 END DESC,
      (tied.points_scored - tied.points_conceded) DESC,
      tied.points_scored DESC) standing_position
  FROM tied JOIN head_to_head ON head_to_head.team_id = tied.team_id
)
SELECT standing_position, team_id, team_name, matches_played, wins, losses, sets_won, sets_lost,
  sets_won - sets_lost, points_scored, points_conceded,
  points_scored - points_conceded, league_points, walkovers
FROM ranked
ORDER BY standing_position, lower(team_name), team_id;
$$;

REVOKE ALL ON FUNCTION public.get_league_standings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_league_standings(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_league_fixture_postponed_v1(
  p_fixture_id UUID, p_actor_user_id UUID, p_request_id TEXT, p_reason TEXT
) RETURNS public.league_fixtures
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_fixture public.league_fixtures%ROWTYPE; v_season public.league_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_fixture FROM public.league_fixtures WHERE id = p_fixture_id FOR UPDATE;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_fixture.league_season_id;
  IF NOT (public.is_venue_member(p_actor_user_id, v_season.venue_id) OR public.has_role(p_actor_user_id, 'super_admin'))
     OR NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'league_postpone_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM public.league_fixture_results WHERE fixture_id = v_fixture.id AND state = 'final') THEN
    RAISE EXCEPTION 'league_completed_fixture_cannot_be_postponed';
  END IF;
  UPDATE public.league_fixtures SET status = 'postponed' WHERE id = v_fixture.id RETURNING * INTO v_fixture;
  INSERT INTO public.audit_log (organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, after, metadata) VALUES (v_season.organization_id, v_season.venue_id, p_actor_user_id,
    'league_fixture_postponed', 'league_fixtures', v_fixture.id::TEXT, p_request_id, to_jsonb(v_fixture),
    jsonb_build_object('reason', p_reason));
  RETURN v_fixture;
END;
$$;

REVOKE ALL ON FUNCTION public.set_league_fixture_postponed_v1(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_league_fixture_postponed_v1(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_league_fixture_v1(
  p_fixture_id UUID,
  p_scheduled_start_at TIMESTAMPTZ,
  p_venue_court_id UUID,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_reason TEXT
) RETURNS public.league_fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.league_fixtures%ROWTYPE;
  v_season public.league_seasons%ROWTYPE;
  v_series public.activity_series%ROWTYPE;
  v_session public.activity_sessions%ROWTYPE;
  v_before JSONB;
  v_local_date DATE;
  v_local_start TIME;
  v_local_end TIME;
BEGIN
  SELECT * INTO v_fixture FROM public.league_fixtures WHERE id = p_fixture_id FOR UPDATE;
  IF v_fixture.id IS NULL THEN RAISE EXCEPTION 'league_fixture_not_found'; END IF;
  SELECT * INTO v_season FROM public.league_seasons WHERE id = v_fixture.league_season_id FOR UPDATE;
  SELECT * INTO v_series FROM public.activity_series WHERE id = v_season.activity_series_id FOR UPDATE;
  IF NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_request_id, '')), '') IS NULL
     OR p_scheduled_start_at IS NULL THEN
    RAISE EXCEPTION 'league_reschedule_reason_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_fixture_results
    WHERE fixture_id = v_fixture.id AND state = 'final'
  ) THEN RAISE EXCEPTION 'league_completed_fixture_cannot_be_rescheduled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_courts court
    WHERE court.id = p_venue_court_id AND court.venue_id = v_season.venue_id
      AND court.sport_type = 'pickleball' AND court.is_available = true
  ) THEN RAISE EXCEPTION 'league_reschedule_court_invalid'; END IF;

  v_local_date := (p_scheduled_start_at AT TIME ZONE 'Europe/Stockholm')::DATE;
  v_local_start := (p_scheduled_start_at AT TIME ZONE 'Europe/Stockholm')::TIME;
  v_local_end := ((p_scheduled_start_at + make_interval(mins => v_season.match_duration_minutes))
    AT TIME ZONE 'Europe/Stockholm')::TIME;
  IF v_local_end <= v_local_start THEN RAISE EXCEPTION 'league_reschedule_must_be_same_day'; END IF;

  SELECT * INTO v_session FROM public.activity_sessions session
  WHERE session.series_id = v_season.activity_series_id
    AND session.session_type = 'league_reschedule'
    AND session.metadata->>'league_fixture_id' = v_fixture.id::TEXT
  FOR UPDATE;
  PERFORM set_config('app.league_contract_mutation', 'allowed', true);
  IF v_session.id IS NULL THEN
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, recurrence_days, session_date,
      start_time, end_time, price_sek, capacity, court_ids, access_policy,
      is_active, metadata, series_id, product_key, publish_status, sort_order,
      requires_staffing, closed_to_public, series_occurrence_index
    ) VALUES (
      v_season.venue_id, v_series.name || ' · uppskjuten match', 'league_reschedule',
      'pickleball', NULL, v_local_date, v_local_start, v_local_end, 0, 4,
      ARRAY[p_venue_court_id], jsonb_build_object('league_team_membership_required', true),
      true, jsonb_build_object(
        'generated_by', 'league_fixture_reschedule_v1',
        'league_season_id', v_season.id,
        'league_fixture_id', v_fixture.id,
        'last_request_id', p_request_id,
        'reason', p_reason
      ), v_series.id, NULL, 'published', 900 + v_fixture.round_number,
      true, true, NULL
    ) RETURNING * INTO v_session;
  ELSE
    IF v_session.metadata->>'last_request_id' = p_request_id
       AND v_session.session_date = v_local_date
       AND v_session.start_time = v_local_start
       AND v_session.court_ids = ARRAY[p_venue_court_id] THEN
      RETURN v_fixture;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.session_registrations registration
      WHERE registration.activity_session_id = v_session.id
        AND registration.status IN ('checked_in', 'no_show')
    ) THEN
      RAISE EXCEPTION 'league_reschedule_has_historical_attendance';
    END IF;
    UPDATE public.activity_sessions SET
      session_date = v_local_date,
      start_time = v_local_start,
      end_time = v_local_end,
      court_ids = ARRAY[p_venue_court_id],
      metadata = metadata || jsonb_build_object(
        'last_request_id', p_request_id,
        'reason', p_reason
      )
    WHERE id = v_session.id RETURNING * INTO v_session;
  END IF;

  v_before := to_jsonb(v_fixture);
  UPDATE public.league_fixtures SET
    league_night_session_id = v_session.id,
    venue_court_id = p_venue_court_id,
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_start_at + make_interval(mins => v_season.match_duration_minutes),
    status = 'scheduled'
  WHERE id = v_fixture.id RETURNING * INTO v_fixture;

  INSERT INTO public.session_registrations (
    venue_id, activity_session_id, session_date, user_id, customer_id,
    league_team_member_id, status, price_paid_sek, source_type, source_id, metadata
  )
  SELECT v_season.venue_id, v_session.id, v_local_date, customer.auth_user_id,
    member.customer_id, member.id, 'confirmed', 0, 'league_team_member', member.id,
    jsonb_build_object(
      'league_team_member_id', member.id,
      'league_team_entry_id', member.team_entry_id,
      'league_season_id', v_season.id,
      'league_fixture_id', v_fixture.id,
      'access_reason', 'Ombokad Seriespel-match'
    )
  FROM public.league_team_members member
  JOIN public.customers customer ON customer.id = member.customer_id
  WHERE member.status = 'active'
    AND member.team_entry_id IN (v_fixture.team_a_entry_id, v_fixture.team_b_entry_id)
  ON CONFLICT (activity_session_id, league_team_member_id) WHERE league_team_member_id IS NOT NULL
  DO UPDATE SET session_date = EXCLUDED.session_date, user_id = EXCLUDED.user_id,
    customer_id = EXCLUDED.customer_id,
    status = CASE
      WHEN session_registrations.status IN ('checked_in', 'no_show') THEN session_registrations.status
      ELSE 'confirmed'
    END,
    metadata = EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, before, after, metadata
  ) VALUES (
    v_season.organization_id, v_season.venue_id, p_actor_user_id,
    'league_fixture_rescheduled', 'league_fixtures', v_fixture.id::TEXT,
    p_request_id, v_before, to_jsonb(v_fixture),
    jsonb_build_object('reason', p_reason, 'activity_session_id', v_session.id)
  );
  RETURN v_fixture;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_league_fixture_v1(UUID, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_league_fixture_v1(UUID, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_league_night_v1(
  p_league_night_session_id UUID,
  p_new_date DATE,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_reason TEXT
) RETURNS public.activity_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_season public.league_seasons%ROWTYPE;
  v_before JSONB;
  v_min_date DATE;
  v_max_date DATE;
BEGIN
  SELECT * INTO v_session FROM public.activity_sessions
  WHERE id = p_league_night_session_id FOR UPDATE;
  SELECT * INTO v_season FROM public.league_seasons
  WHERE activity_series_id = v_session.series_id FOR UPDATE;
  IF v_session.id IS NULL OR v_session.session_type <> 'league' OR v_season.id IS NULL THEN
    RAISE EXCEPTION 'league_night_not_found';
  END IF;
  IF NOT (
    public.is_venue_member(p_actor_user_id, v_season.venue_id)
    OR public.has_role(p_actor_user_id, 'super_admin')
  ) THEN RAISE EXCEPTION 'league_staff_required'; END IF;
  IF p_new_date IS NULL OR EXTRACT(DOW FROM p_new_date)::INTEGER <> 4
     OR NULLIF(BTRIM(COALESCE(p_reason, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'league_night_reschedule_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_fixtures fixture
    JOIN public.league_fixture_results result ON result.fixture_id = fixture.id
    WHERE fixture.league_night_session_id = v_session.id AND result.state = 'final'
  ) OR EXISTS (
    SELECT 1 FROM public.session_registrations registration
    WHERE registration.activity_session_id = v_session.id
      AND registration.status IN ('checked_in', 'no_show')
  ) THEN
    RAISE EXCEPTION 'league_night_with_history_requires_manual_fixture_handling';
  END IF;
  IF v_session.metadata->>'last_reschedule_request_id' = p_request_id
     AND v_session.session_date = p_new_date THEN RETURN v_session; END IF;

  v_before := to_jsonb(v_session);
  PERFORM set_config('app.league_contract_mutation', 'allowed', true);
  UPDATE public.activity_sessions SET
    session_date = p_new_date,
    metadata = metadata || jsonb_build_object(
      'last_reschedule_request_id', p_request_id,
      'reschedule_reason', p_reason
    )
  WHERE id = v_session.id RETURNING * INTO v_session;

  UPDATE public.league_fixtures fixture SET
    scheduled_start_at = ((p_new_date + TIME '18:00') AT TIME ZONE 'Europe/Stockholm')
      + make_interval(mins => v_season.block_start_offsets_minutes[fixture.block_number]),
    scheduled_end_at = ((p_new_date + TIME '18:00') AT TIME ZONE 'Europe/Stockholm')
      + make_interval(mins => v_season.block_start_offsets_minutes[fixture.block_number] + v_season.match_duration_minutes),
    status = CASE WHEN fixture.status = 'cancelled' THEN 'cancelled' ELSE 'scheduled' END
  WHERE fixture.league_night_session_id = v_session.id;

  UPDATE public.session_registrations SET session_date = p_new_date, updated_at = now()
  WHERE activity_session_id = v_session.id AND status = 'confirmed';
  PERFORM public.reconcile_league_team_registrations(v_season.id);
  SELECT MIN(session_date), MAX(session_date) INTO v_min_date, v_max_date
  FROM public.activity_sessions
  WHERE series_id = v_season.activity_series_id AND session_type = 'league' AND is_active = true;
  UPDATE public.activity_series SET start_date = v_min_date, end_date = v_max_date
  WHERE id = v_season.activity_series_id;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, action, entity_table, entity_id,
    request_id, before, after, metadata
  ) VALUES (
    v_season.organization_id, v_season.venue_id, p_actor_user_id,
    'league_night_rescheduled', 'activity_sessions', v_session.id::TEXT,
    p_request_id, v_before, to_jsonb(v_session), jsonb_build_object('reason', p_reason)
  );
  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_league_night_v1(UUID, DATE, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_league_night_v1(UUID, DATE, UUID, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.generate_league_fixtures_v1(UUID, UUID) IS
  'Deterministic K6 one-factorization for the locked five-night League V1. It validates six active teams before one transactional 30-row write.';
COMMENT ON FUNCTION public.get_league_standings(UUID) IS
  'Read-time six-team standings. League points equal sets won; walkovers give 3/0 without synthetic set or ball scores.';
