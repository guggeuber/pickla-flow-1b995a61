\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE league_test_people (
  n INTEGER PRIMARY KEY,
  user_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  email TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO league_test_people
SELECT n, gen_random_uuid(), gen_random_uuid(), 'league-player-' || n || '@example.test'
FROM generate_series(1, 18) n;

INSERT INTO public.organizations (id, name, slug)
VALUES ('1ea90000-0000-4000-8000-000000000001', 'League V1 Test', 'league-v1-test-org');
INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES (
  '1ea90000-0000-4000-8000-000000000002',
  '1ea90000-0000-4000-8000-000000000001',
  'League Test Venue', 'league-v1-test-venue', 'Europe/Stockholm', true
);
INSERT INTO public.organizations (id, name, slug)
VALUES ('1ea90000-0000-4000-8000-000000000003', 'Other League Org', 'other-league-org');
INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('1ea90000-0000-4000-8000-000000000011', '1ea90000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('1ea90000-0000-4000-8000-000000000012', '1ea90000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true),
  ('1ea90000-0000-4000-8000-000000000013', '1ea90000-0000-4000-8000-000000000002', 'Bana 3', 3, 'pickleball', 350, true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT user_id, 'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
FROM league_test_people;
UPDATE league_test_people person SET customer_id = customer.id
FROM public.customers customer WHERE customer.auth_user_id = person.user_id;
UPDATE public.customers customer SET display_name = 'League Player ' || person.n
FROM league_test_people person WHERE person.customer_id = customer.id;
UPDATE public.customers customer SET organization_id = '1ea90000-0000-4000-8000-000000000001'
FROM league_test_people person WHERE person.customer_id = customer.id;
UPDATE public.customers SET organization_id = '1ea90000-0000-4000-8000-000000000003'
WHERE id = (SELECT customer_id FROM league_test_people WHERE n = 18);
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
SELECT user_id, '1ea90000-0000-4000-8000-000000000002', 'venue_admin', true
FROM league_test_people WHERE n = 14;

CREATE TEMP TABLE league_test_state (
  season_id UUID,
  series_id UUID,
  product_id UUID,
  team_alpha UUID,
  team_bravo UUID,
  team_foxtrot UUID
) ON COMMIT DROP;

DO $$
DECLARE v_season public.league_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_season FROM public.create_league_season_v1(
    '1ea90000-0000-4000-8000-000000000002',
    'Pickla Seriespel · Season 01', 'League V1 test', '{}',
    ARRAY['2027-09-02','2027-09-09','2027-09-16','2027-09-23','2027-09-30']::DATE[],
    ARRAY[
      '1ea90000-0000-4000-8000-000000000011',
      '1ea90000-0000-4000-8000-000000000012',
      '1ea90000-0000-4000-8000-000000000013'
    ]::UUID[],
    now() - interval '1 day', now() + interval '30 days', now() + interval '31 days',
    199500, 6, 179500, 2, true,
    (SELECT user_id FROM league_test_people WHERE n = 14)
  );
  INSERT INTO league_test_state (season_id, series_id, product_id)
  SELECT v_season.id, v_season.activity_series_id, series.access_product_id
  FROM public.activity_series series WHERE series.id = v_season.activity_series_id;
END $$;

-- A second pre-sale League cannot reserve the same three courts in the same
-- five windows; canonical managed-Series conflict validation is authoritative.
DO $$
BEGIN
  BEGIN
    PERFORM public.create_league_season_v1(
      '1ea90000-0000-4000-8000-000000000002', 'Conflicting League', NULL, '{}',
      ARRAY['2027-09-02','2027-09-09','2027-09-16','2027-09-23','2027-09-30']::DATE[],
      ARRAY['1ea90000-0000-4000-8000-000000000011','1ea90000-0000-4000-8000-000000000012','1ea90000-0000-4000-8000-000000000013']::UUID[],
      now() - interval '1 day', now() + interval '30 days', now() + interval '31 days',
      199500, 6, NULL, NULL, false, (SELECT user_id FROM league_test_people WHERE n = 14)
    );
    RAISE EXCEPTION 'overlapping League resources were accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'overlapping League resources were accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_resource_conflict%' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.activity_sessions session
      JOIN league_test_state state ON state.series_id = session.series_id
      WHERE session.session_type = 'league') <> 5 THEN
    RAISE EXCEPTION 'League creation did not create exactly five League-night Sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions session
    JOIN league_test_state state ON state.series_id = session.series_id
    WHERE session.session_type = 'league' AND (
      session.start_time <> TIME '18:00' OR session.end_time <> TIME '20:00'
      OR session.capacity <> 12 OR cardinality(session.court_ids) <> 3
      OR session.closed_to_public IS DISTINCT FROM true
    )
  ) THEN RAISE EXCEPTION 'League-night Session contract is invalid'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_series series
    JOIN league_test_state state ON state.series_id = series.id
    WHERE series.capacity IS NOT NULL
  ) THEN RAISE EXCEPTION 'activity_series.capacity became fake League team/person capacity'; END IF;
END $$;

-- First purchase: one team-scoped Early Bird hold, one order, one order line,
-- one receipt/ledger chain, one active team and ten person registrations.
DO $$
DECLARE
  v_reserved RECORD;
  v_order_id UUID := gen_random_uuid();
  v_line_id UUID := gen_random_uuid();
  v_financial RECORD;
  v_fulfilled RECORD;
  v_season_id UUID := (SELECT season_id FROM league_test_state);
  v_series_id UUID := (SELECT series_id FROM league_test_state);
  v_product_id UUID := (SELECT product_id FROM league_test_state);
  v_captain_user UUID := (SELECT user_id FROM league_test_people WHERE n = 1);
  v_captain UUID := (SELECT customer_id FROM league_test_people WHERE n = 1);
  v_player UUID := (SELECT customer_id FROM league_test_people WHERE n = 2);
BEGIN
  SELECT * INTO v_reserved FROM public.reserve_league_team_entry(
    v_season_id, v_captain_user, v_captain, v_player, 'Team Alpha',
    'league-alpha-request-0001', v_line_id, true, 199500, 1920
  );
  IF NOT v_reserved.ok OR v_reserved.final_price_minor <> 179500
     OR v_reserved.applied_price_type <> 'early_bird' THEN
    RAISE EXCEPTION 'first team Early Bird reservation failed: %', row_to_json(v_reserved);
  END IF;

  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, customer_id, user_id, status, version, currency,
    subtotal_minor, total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor,
    stripe_session_id, guest_token_hash, guest_name, guest_email, checkout_frozen_at
  ) VALUES (
    v_order_id, '1ea90000-0000-4000-8000-000000000001',
    '1ea90000-0000-4000-8000-000000000002', v_captain, v_captain_user,
    'draft', 1, 'SEK', 179500, 179500, 169340, 10160,
    NULL, 'league-alpha-guest-token', 'League Player 1',
    'league-player-1@example.test', NULL
  );
  INSERT INTO public.commerce_order_lines (
    id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
    quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
    vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
    fulfillment_type, activity_series_id, league_team_entry_id, capacity_hold_id,
    resolver_snapshot, product_snapshot
  ) VALUES (
    v_line_id, v_order_id, v_product_id, 'league_test',
    'Pickla Seriespel · Season 01 · Lagplats', 'participation', 1, 179500, 0,
    179500, 6, 10160, 169340, 'league_team_entry', v_reserved.team_entry_id,
    'participation', v_series_id, v_reserved.team_entry_id, v_reserved.hold_id,
    jsonb_build_object(
      'scope', 'league_team_entry', 'scope_type', 'league_season',
      'purchase_kind', 'league_team', 'league_season_id', v_season_id,
      'pricing_reason', 'early_bird', 'membership_pricing_applied', false
    ), jsonb_build_object('team_place', true)
  );
  PERFORM public.attach_league_team_commerce(
    v_reserved.team_entry_id, v_reserved.hold_id, v_order_id, v_line_id
  );
  UPDATE public.commerce_orders SET status = 'checkout_pending',
    stripe_session_id = 'cs_test_league_alpha', checkout_frozen_at = now()
  WHERE id = v_order_id;
  UPDATE public.capacity_holds SET stripe_session_id = 'cs_test_league_alpha'
  WHERE id = v_reserved.hold_id;
  SELECT * INTO v_financial FROM public.finalize_commerce_payment(
    v_order_id, 1, 'cs_test_league_alpha', 'pi_test_league_alpha',
    v_captain, v_captain_user, 'League Player 1', 'league-player-1@example.test',
    NULL, 'card'
  );
  -- Financial truth must survive a fulfillment failure. The webhook owns the
  -- attention/incident projection; the SQL contract must keep the same pending
  -- team recoverable without duplicating financial records.
  UPDATE public.capacity_holds SET status = 'conflict' WHERE id = v_reserved.hold_id;
  BEGIN
    PERFORM public.fulfill_league_team_entry(
      v_reserved.team_entry_id, v_order_id, v_line_id, v_reserved.hold_id,
      'cs_test_league_alpha', 'pi_test_league_alpha'
    );
    RAISE EXCEPTION 'paid League fulfillment unexpectedly succeeded with invalid hold';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'paid League fulfillment unexpectedly succeeded with invalid hold' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_paid_fulfillment_invariant_failed%' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.commerce_orders WHERE id = v_order_id) <> 'paid'
     OR (SELECT status FROM public.league_team_entries WHERE id = v_reserved.team_entry_id) <> 'pending'
     OR (SELECT COUNT(*) FROM public.booking_receipts WHERE commerce_order_id = v_order_id) <> 1
     OR (SELECT COUNT(*) FROM public.ledger_entries WHERE commerce_order_id = v_order_id) <> 1 THEN
    RAISE EXCEPTION 'financial truth was lost after League fulfillment failure';
  END IF;
  UPDATE public.commerce_orders SET status = 'attention' WHERE id = v_order_id;
  UPDATE public.commerce_order_lines SET fulfillment_status = 'attention' WHERE id = v_line_id;
  UPDATE public.capacity_holds SET status = 'active' WHERE id = v_reserved.hold_id;
  SELECT * INTO v_fulfilled FROM public.fulfill_league_team_entry(
    v_reserved.team_entry_id, v_order_id, v_line_id, v_reserved.hold_id,
    'cs_test_league_alpha', 'pi_test_league_alpha'
  );
  IF NOT v_fulfilled.ok THEN RAISE EXCEPTION 'paid League team did not fulfill'; END IF;
  UPDATE public.commerce_orders SET status = 'paid' WHERE id = v_order_id AND status = 'attention';
  UPDATE league_test_state SET team_alpha = v_reserved.team_entry_id;

  IF (SELECT COUNT(*) FROM public.commerce_order_lines WHERE commerce_order_id = v_order_id) <> 1
     OR (SELECT COUNT(*) FROM public.booking_receipts WHERE commerce_order_id = v_order_id) <> 1
     OR (SELECT COUNT(*) FROM public.commerce_receipt_lines WHERE commerce_order_id = v_order_id) <> 1
     OR (SELECT COUNT(*) FROM public.ledger_entries WHERE commerce_order_id = v_order_id) <> 1
     OR (SELECT COUNT(*) FROM public.league_team_members WHERE team_entry_id = v_reserved.team_entry_id AND status = 'active') <> 2
     OR (SELECT COUNT(*) FROM public.session_registrations registration
         JOIN public.league_team_members member ON member.id = registration.league_team_member_id
         WHERE member.team_entry_id = v_reserved.team_entry_id AND registration.status = 'confirmed') <> 10
     OR EXISTS (SELECT 1 FROM public.series_commitments WHERE commerce_order_id = v_order_id) THEN
    RAISE EXCEPTION 'League Commerce cardinality/projection doctrine failed';
  END IF;
  SELECT * INTO v_fulfilled FROM public.fulfill_league_team_entry(
    v_reserved.team_entry_id, v_order_id, v_line_id, v_reserved.hold_id,
    'cs_test_league_alpha', 'pi_test_league_alpha'
  );
  IF v_fulfilled.reason <> 'already_fulfilled' THEN RAISE EXCEPTION 'webhook replay was not idempotent'; END IF;
END $$;

-- Team-scoped Early Bird is released with an abandoned hold and then reused.
DO $$
DECLARE v_second RECORD; v_third RECORD; v_retry RECORD;
  v_season UUID := (SELECT season_id FROM league_test_state);
BEGIN
  SELECT * INTO v_second FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 3),
    (SELECT customer_id FROM league_test_people WHERE n = 3),
    (SELECT customer_id FROM league_test_people WHERE n = 4),
    'Team Bravo', 'league-bravo-request-0002', gen_random_uuid(), true, 199500, 600
  );
  SELECT * INTO v_third FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 5),
    (SELECT customer_id FROM league_test_people WHERE n = 5),
    (SELECT customer_id FROM league_test_people WHERE n = 6),
    'Abandoned Base Team', 'league-base-request-0003', gen_random_uuid(), true, 179500, 600
  );
  IF v_second.applied_price_type <> 'early_bird' OR v_second.final_price_minor <> 179500
     OR v_third.applied_price_type <> 'league_team_base_price' OR v_third.final_price_minor <> 199500 THEN
    RAISE EXCEPTION 'team Early Bird first-N semantics failed';
  END IF;
  PERFORM public.release_capacity_hold(v_second.hold_id, 'test_abandoned');
  PERFORM public.release_capacity_hold(v_third.hold_id, 'test_abandoned');
  BEGIN
    PERFORM public.reserve_league_team_entry(
      v_season,
      (SELECT user_id FROM league_test_people WHERE n = 3),
      (SELECT customer_id FROM league_test_people WHERE n = 3),
      (SELECT customer_id FROM league_test_people WHERE n = 4),
      'Team Bravo', 'league-bravo-request-0002', gen_random_uuid(), true, 199500, 600
    );
    RAISE EXCEPTION 'expired registration request was reused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'expired registration request was reused' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_registration_expired_start_again%' THEN RAISE; END IF;
  END;
  SELECT * INTO v_retry FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 3),
    (SELECT customer_id FROM league_test_people WHERE n = 3),
    (SELECT customer_id FROM league_test_people WHERE n = 4),
    'Team Bravo', 'league-bravo-request-restarted-0002', gen_random_uuid(), true, 199500, 600
  );
  IF v_retry.team_entry_id = v_second.team_entry_id OR v_retry.hold_id = v_second.hold_id
     OR v_retry.applied_price_type <> 'early_bird' THEN
    RAISE EXCEPTION 'expired hold did not retire pending team/name and reallocate Early Bird';
  END IF;
  UPDATE public.league_team_entries SET status = 'active', activated_at = now()
  WHERE id = v_retry.team_entry_id;
  UPDATE public.league_team_members SET status = 'active' WHERE team_entry_id = v_retry.team_entry_id;
  UPDATE public.capacity_holds SET status = 'committed', committed_at = now() WHERE id = v_retry.hold_id;
  UPDATE league_test_state SET team_bravo = v_retry.team_entry_id;
END $$;

-- Add three paid-equivalent active test teams. The sixth place is then held
-- atomically; a competing seventh request loses and retry is stable.
DO $$
DECLARE v_team UUID; v_n INTEGER; v_final RECORD; v_loser RECORD; v_retry RECORD;
  v_season UUID := (SELECT season_id FROM league_test_state);
BEGIN
  FOR v_n IN 0..2 LOOP
    INSERT INTO public.league_team_entries (
      league_season_id, team_name, captain_customer_id, payer_customer_id,
      status, registration_request_id, activated_at
    ) VALUES (
      v_season, 'Team ' || chr(67 + v_n),
      (SELECT customer_id FROM league_test_people WHERE n = 5 + v_n * 2),
      (SELECT customer_id FROM league_test_people WHERE n = 5 + v_n * 2),
      'active', 'league-direct-request-000' || (4 + v_n), now()
    ) RETURNING id INTO v_team;
    INSERT INTO public.league_team_members (league_season_id, team_entry_id, customer_id, role, status)
    VALUES
      (v_season, v_team, (SELECT customer_id FROM league_test_people WHERE n = 5 + v_n * 2), 'captain', 'active'),
      (v_season, v_team, (SELECT customer_id FROM league_test_people WHERE n = 6 + v_n * 2), 'player', 'active');
  END LOOP;

  SELECT * INTO v_final FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 12),
    'Team Foxtrot', 'league-final-request-restarted-0007', gen_random_uuid(), true, 199500, 600
  );
  SELECT * INTO v_loser FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 13),
    (SELECT customer_id FROM league_test_people WHERE n = 13),
    (SELECT customer_id FROM league_test_people WHERE n = 14),
    'Team Seven', 'league-loser-request-0008', gen_random_uuid(), true, 199500, 600
  );
  SELECT * INTO v_retry FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 12),
    'Team Foxtrot', 'league-refresh-request-0007', gen_random_uuid(), true, 199500, 600
  );
  IF NOT v_final.ok OR v_final.available_count <> 0 OR v_loser.ok
     OR v_loser.reason <> 'capacity_full' OR v_retry.team_entry_id <> v_final.team_entry_id
     OR v_retry.hold_id <> v_final.hold_id THEN
    RAISE EXCEPTION 'final team capacity/idempotency invariant failed';
  END IF;
  PERFORM public.release_capacity_hold(v_final.hold_id, 'test_checkout_expired');
  IF (SELECT available_count FROM public.league_team_capacity_fill(v_season)) <> 1 THEN
    RAISE EXCEPTION 'released final team hold did not reopen capacity';
  END IF;
  SELECT * INTO v_final FROM public.reserve_league_team_entry(
    v_season,
    (SELECT user_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 11),
    (SELECT customer_id FROM league_test_people WHERE n = 12),
    'Team Foxtrot', 'league-final-request-0007', gen_random_uuid(), true, 199500, 600
  );
  UPDATE public.league_team_entries SET status = 'active', activated_at = now() WHERE id = v_final.team_entry_id;
  UPDATE public.league_team_members SET status = 'active' WHERE team_entry_id = v_final.team_entry_id;
  UPDATE public.capacity_holds SET status = 'committed', committed_at = now() WHERE id = v_final.hold_id;
  UPDATE league_test_state SET team_foxtrot = v_final.team_entry_id;
  PERFORM public.reconcile_league_team_registrations(v_season);
END $$;

DO $$
DECLARE v_validation JSONB; v_season UUID := (SELECT season_id FROM league_test_state);
  v_old_team UUID := (SELECT team_foxtrot FROM league_test_state); v_new_team UUID;
BEGIN
  PERFORM public.generate_league_fixtures_v1(
    v_season, (SELECT user_id FROM league_test_people WHERE n = 14)
  );
  v_validation := public.validate_league_fixtures_v1(v_season);
  IF COALESCE((v_validation->>'valid')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'generated K6 schedule invalid: %', v_validation;
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT team_id, round_number, block_number, COUNT(*) count
      FROM (
        SELECT team_a_entry_id team_id, round_number, block_number FROM public.league_fixtures WHERE league_season_id = v_season
        UNION ALL
        SELECT team_b_entry_id, round_number, block_number FROM public.league_fixtures WHERE league_season_id = v_season
      ) appearances GROUP BY team_id, round_number, block_number
    ) counted WHERE count <> 1
  ) THEN RAISE EXCEPTION 'a team does not play exactly once per block'; END IF;
  IF (SELECT COUNT(*) FROM public.session_registrations registration
      JOIN public.activity_sessions session ON session.id = registration.activity_session_id
      WHERE session.series_id = (SELECT series_id FROM league_test_state)
        AND session.session_type = 'league' AND registration.status = 'confirmed') <> 60 THEN
    RAISE EXCEPTION 'six teams did not project exactly 12 registrations per night';
  END IF;
  PERFORM public.generate_league_fixtures_v1(
    v_season, (SELECT user_id FROM league_test_people WHERE n = 14)
  );
  IF (SELECT COUNT(*) FROM public.league_fixtures WHERE league_season_id = v_season) <> 30 THEN
    RAISE EXCEPTION 'fixture generator retry duplicated fixtures';
  END IF;
  -- P0 stale-fixture regression: replace one active team after generation.
  PERFORM public.cancel_league_team_entry(v_old_team,
    (SELECT user_id FROM league_test_people WHERE n = 14),
    'pre-publication-team-cancel', 'Full återbetalning bekräftad före publicering', true);
  INSERT INTO public.league_team_entries (
    league_season_id, team_name, captain_customer_id, payer_customer_id,
    status, registration_request_id, activated_at
  ) VALUES (
    v_season, 'Team Golf',
    (SELECT customer_id FROM league_test_people WHERE n = 13),
    (SELECT customer_id FROM league_test_people WHERE n = 13),
    'active', 'league-golf-request-0008', now()
  ) RETURNING id INTO v_new_team;
  INSERT INTO public.league_team_members (league_season_id, team_entry_id, customer_id, role, status)
  VALUES
    (v_season, v_new_team, (SELECT customer_id FROM league_test_people WHERE n = 13), 'captain', 'active'),
    (v_season, v_new_team, (SELECT customer_id FROM league_test_people WHERE n = 14), 'player', 'active');
  PERFORM public.reconcile_league_team_registrations(v_season);
  BEGIN
    PERFORM public.publish_league_fixtures_v1(v_season, (SELECT user_id FROM league_test_people WHERE n = 14));
    RAISE EXCEPTION 'stale fixture set was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale fixture set was published' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Lagen har ändrats sedan spelschemat genererades. Generera om spelschemat.%' THEN RAISE; END IF;
  END;
  IF (public.validate_league_fixtures_v1(v_season)->>'valid')::BOOLEAN THEN
    RAISE EXCEPTION 'stale fixture validator blessed changed participant set';
  END IF;
  PERFORM public.generate_league_fixtures_v1(v_season, (SELECT user_id FROM league_test_people WHERE n = 14));
  IF EXISTS (SELECT 1 FROM public.league_fixtures WHERE league_season_id = v_season
    AND (team_a_entry_id = v_old_team OR team_b_entry_id = v_old_team))
    OR (SELECT COUNT(*) FROM public.league_fixtures WHERE league_season_id = v_season
      AND (team_a_entry_id = v_new_team OR team_b_entry_id = v_new_team)) <> 10 THEN
    RAISE EXCEPTION 'safe pre-publication regeneration did not replace stale team set';
  END IF;
  UPDATE league_test_state SET team_foxtrot = v_new_team;
  PERFORM public.publish_league_fixtures_v1(
    v_season, (SELECT user_id FROM league_test_people WHERE n = 14)
  );
END $$;

DO $$
DECLARE score RECORD;
BEGIN
  FOR score IN SELECT * FROM (VALUES
    (10,10,false),(11,9,true),(11,10,false),(11,11,false),(12,10,true),(12,11,false),
    (12,12,false),(13,11,true),(13,12,true),(13,13,false),(14,12,false)
  ) boundary(a,b,expected) LOOP
    IF public.valid_league_set_score(score.a, score.b) IS DISTINCT FROM score.expected
       OR public.valid_league_set_score(score.b, score.a) IS DISTINCT FROM score.expected THEN
      RAISE EXCEPTION 'League set boundary mismatch for %-%', score.a, score.b;
    END IF;
  END LOOP;
END $$;

-- Controlled final results prove set-point standings, walkover semantics,
-- incomplete exclusion, exact-two-team head-to-head and correction/versioning.
DO $$
DECLARE
  v_a UUID := (SELECT team_alpha FROM league_test_state);
  v_b UUID := (SELECT team_bravo FROM league_test_state);
  v_c UUID := (SELECT id FROM public.league_team_entries WHERE team_name = 'Team C');
  v_d UUID := (SELECT id FROM public.league_team_entries WHERE team_name = 'Team D');
  v_e UUID := (SELECT id FROM public.league_team_entries WHERE team_name = 'Team E');
  v_f UUID := (SELECT team_foxtrot FROM league_test_state);
  v_fixture public.league_fixtures%ROWTYPE;
  v_sets JSONB;
  v_result public.league_fixture_results%ROWTYPE;
  v_a_standing RECORD;
  v_b_standing RECORD;
  v_e_standing RECORD;
BEGIN
  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE LEAST(team_a_entry_id, team_b_entry_id) = LEAST(v_a, v_b)
    AND GREATEST(team_a_entry_id, team_b_entry_id) = GREATEST(v_a, v_b)
    AND leg_number = 1;
  v_sets := CASE WHEN v_fixture.team_a_entry_id = v_a
    THEN '[{"team_a":11,"team_b":9},{"team_a":11,"team_b":9},{"team_a":11,"team_b":9}]'::JSONB
    ELSE '[{"team_a":9,"team_b":11},{"team_a":9,"team_b":11},{"team_a":9,"team_b":11}]'::JSONB END;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 0, 'result-ab-leg-1',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE LEAST(team_a_entry_id, team_b_entry_id) = LEAST(v_a, v_b)
    AND GREATEST(team_a_entry_id, team_b_entry_id) = GREATEST(v_a, v_b)
    AND leg_number = 2;
  v_sets := CASE WHEN v_fixture.team_a_entry_id = v_b
    THEN '[{"team_a":11,"team_b":0},{"team_a":11,"team_b":0},{"team_a":9,"team_b":11}]'::JSONB
    ELSE '[{"team_a":0,"team_b":11},{"team_a":0,"team_b":11},{"team_a":11,"team_b":9}]'::JSONB END;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 0, 'result-ab-leg-2',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE (team_a_entry_id = v_b AND team_b_entry_id = v_c) OR (team_a_entry_id = v_c AND team_b_entry_id = v_b)
  ORDER BY leg_number LIMIT 1;
  v_sets := CASE WHEN v_fixture.team_a_entry_id = v_b
    THEN '[{"team_a":11,"team_b":0},{"team_a":11,"team_b":0},{"team_a":11,"team_b":0}]'::JSONB
    ELSE '[{"team_a":0,"team_b":11},{"team_a":0,"team_b":11},{"team_a":0,"team_b":11}]'::JSONB END;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 0, 'result-bc',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE (team_a_entry_id = v_a AND team_b_entry_id = v_d) OR (team_a_entry_id = v_d AND team_b_entry_id = v_a)
  ORDER BY leg_number LIMIT 1;
  v_sets := CASE WHEN v_fixture.team_a_entry_id = v_a
    THEN '[{"team_a":11,"team_b":9},{"team_a":0,"team_b":11},{"team_a":0,"team_b":11}]'::JSONB
    ELSE '[{"team_a":9,"team_b":11},{"team_a":11,"team_b":0},{"team_a":11,"team_b":0}]'::JSONB END;
  SELECT * INTO v_result FROM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 0, 'result-ad-v1',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE (team_a_entry_id = v_e AND team_b_entry_id = v_f) OR (team_a_entry_id = v_f AND team_b_entry_id = v_e)
  ORDER BY leg_number LIMIT 1;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'walkover', '[]', v_e, 0, 'result-ef-wo',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_fixture FROM public.league_fixtures
  WHERE (team_a_entry_id = v_c AND team_b_entry_id = v_f) OR (team_a_entry_id = v_f AND team_b_entry_id = v_c)
  ORDER BY leg_number LIMIT 1;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'incomplete', 'played', '[]', NULL, 0, 'result-cf-incomplete',
    (SELECT user_id FROM league_test_people WHERE n = 14));

  SELECT * INTO v_a_standing FROM public.get_league_standings((SELECT season_id FROM league_test_state)) WHERE team_entry_id = v_a;
  SELECT * INTO v_b_standing FROM public.get_league_standings((SELECT season_id FROM league_test_state)) WHERE team_entry_id = v_b;
  SELECT * INTO v_e_standing FROM public.get_league_standings((SELECT season_id FROM league_test_state)) WHERE team_entry_id = v_e;
  IF v_a_standing.league_points <> 5 OR v_b_standing.league_points <> 5
     OR v_a_standing.position >= v_b_standing.position
     OR v_b_standing.point_difference <= v_a_standing.point_difference THEN
    RAISE EXCEPTION 'exact-two-team head-to-head did not beat point difference';
  END IF;
  IF v_e_standing.league_points <> 3 OR v_e_standing.matches_played <> 1
     OR v_e_standing.sets_won <> 0 OR v_e_standing.points_scored <> 0
     OR v_e_standing.walkovers <> 1 THEN
    RAISE EXCEPTION 'walkover standings semantics are wrong';
  END IF;

  -- Correct A-D in place to a 2-1 A win. Same request replay is a no-op.
  SELECT * INTO v_fixture FROM public.league_fixtures WHERE id = v_result.fixture_id;
  v_sets := CASE WHEN v_fixture.team_a_entry_id = v_a
    THEN '[{"team_a":11,"team_b":9},{"team_a":11,"team_b":9},{"team_a":9,"team_b":11}]'::JSONB
    ELSE '[{"team_a":9,"team_b":11},{"team_a":9,"team_b":11},{"team_a":11,"team_b":9}]'::JSONB END;
  SELECT * INTO v_result FROM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 1, 'result-ad-v2',
    (SELECT user_id FROM league_test_people WHERE n = 14));
  IF v_result.version <> 2 THEN RAISE EXCEPTION 'result correction did not increment version'; END IF;
  SELECT * INTO v_result FROM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played', v_sets, NULL, 2, 'result-ad-v2',
    (SELECT user_id FROM league_test_people WHERE n = 14));
  IF v_result.version <> 2 OR NOT EXISTS (
    SELECT 1 FROM public.audit_log WHERE action = 'league_result_corrected' AND request_id = 'result-ad-v2'
  ) THEN RAISE EXCEPTION 'result correction idempotency/audit failed'; END IF;

  SELECT * INTO v_fixture FROM public.league_fixtures fixture
  WHERE fixture.league_season_id = (SELECT season_id FROM league_test_state)
    AND fixture.status = 'scheduled'
    AND (SELECT team_alpha FROM league_test_state) NOT IN (fixture.team_a_entry_id, fixture.team_b_entry_id)
    AND NOT EXISTS (SELECT 1 FROM public.league_fixture_results result WHERE result.fixture_id = fixture.id)
  ORDER BY fixture.round_number, fixture.block_number LIMIT 1;
  SELECT * INTO v_result FROM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played',
    '[{"team_a":13,"team_b":11},{"team_a":11,"team_b":9},{"team_a":13,"team_b":12}]',
    NULL, 0, 'valid-13-11', (SELECT user_id FROM league_test_people WHERE n = 14));
  IF v_result.version <> 1 THEN RAISE EXCEPTION 'valid 13-11 result was not created'; END IF;

  SELECT * INTO v_fixture FROM public.league_fixtures fixture
  WHERE fixture.league_season_id = (SELECT season_id FROM league_test_state)
    AND fixture.status = 'scheduled'
    AND NOT EXISTS (SELECT 1 FROM public.league_fixture_results result WHERE result.fixture_id = fixture.id)
  ORDER BY fixture.round_number, fixture.block_number LIMIT 1;
  BEGIN
    PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played',
      '[{"team_a":11,"team_b":9},{"team_a":11,"team_b":9},{"team_a":11,"team_b":9}]',
      NULL, 1, 'invalid-initial-version-one', (SELECT user_id FROM league_test_people WHERE n = 14));
    RAISE EXCEPTION 'initial result accepted expected_version 1';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'initial result accepted expected_version 1' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_result_version_conflict%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'played',
      '[{"a":13,"b":11},{"a":11,"b":9},{"a":11,"b":8}]',
      NULL, 0, 'invalid-missing-score-keys', (SELECT user_id FROM league_test_people WHERE n = 14));
    RAISE EXCEPTION 'result accepted non-canonical score keys';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'result accepted non-canonical score keys' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_set_score_invalid%' THEN RAISE; END IF;
  END;
END $$;

-- The commercial League contract is immutable after a hold/order/team exists.
DO $$
DECLARE v_series UUID := (SELECT series_id FROM league_test_state);
  v_session UUID := (SELECT id FROM public.activity_sessions WHERE series_id = (SELECT series_id FROM league_test_state)
    AND session_type = 'league' ORDER BY series_occurrence_index LIMIT 1);
BEGIN
  BEGIN
    UPDATE public.activity_series SET start_time = TIME '17:00' WHERE id = v_series;
    RAISE EXCEPTION 'post-sale League time changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'post-sale League time changed' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_customer_contract_locked_after_first_hold%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.activity_sessions SET court_ids = ARRAY['1ea90000-0000-4000-8000-000000000011']::UUID[] WHERE id = v_session;
    RAISE EXCEPTION 'post-sale League courts changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'post-sale League courts changed' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_customer_contract_locked_after_first_hold%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.activity_sessions WHERE id = v_session;
    RAISE EXCEPTION 'post-sale League-night count changed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'post-sale League-night count changed' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_customer_contract_locked_after_first_hold%' THEN RAISE; END IF;
  END;
END $$;

-- Postponement creates no standings contribution. A later reschedule creates
-- one conflict-checked Calendar Session and exactly four person registrations.
DO $$
DECLARE v_fixture public.league_fixtures%ROWTYPE; v_session public.activity_sessions%ROWTYPE;
  v_round_four UUID;
BEGIN
  SELECT * INTO v_fixture FROM public.league_fixtures fixture
  WHERE fixture.league_season_id = (SELECT season_id FROM league_test_state)
    AND fixture.status = 'scheduled'
    AND (SELECT team_alpha FROM league_test_state) NOT IN (fixture.team_a_entry_id, fixture.team_b_entry_id)
    AND NOT EXISTS (SELECT 1 FROM public.league_fixture_results result WHERE result.fixture_id = fixture.id)
  ORDER BY fixture.round_number DESC, fixture.block_number LIMIT 1;
  PERFORM public.set_league_fixture_postponed_v1(
    v_fixture.id, (SELECT user_id FROM league_test_people WHERE n = 14),
    'postpone-test', 'Spelarna kan inte närvara'
  );
  SELECT * INTO v_fixture FROM public.reschedule_league_fixture_v1(
    v_fixture.id, '2027-10-14T18:30:00+02',
    '1ea90000-0000-4000-8000-000000000011',
    (SELECT user_id FROM league_test_people WHERE n = 14),
    'reschedule-fixture-test', 'Ny tid överenskommen'
  );
  SELECT * INTO v_session FROM public.activity_sessions WHERE id = v_fixture.league_night_session_id;
  IF v_session.session_type <> 'league_reschedule' OR v_session.capacity <> 4
     OR cardinality(v_session.court_ids) <> 1
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE activity_session_id = v_session.id) <> 4 THEN
    RAISE EXCEPTION 'single fixture reschedule did not create canonical four-person Calendar truth';
  END IF;
  UPDATE public.session_registrations SET status = 'checked_in'
  WHERE id = (SELECT id FROM public.session_registrations WHERE activity_session_id = v_session.id ORDER BY id LIMIT 1);
  UPDATE public.session_registrations SET status = 'no_show'
  WHERE id = (SELECT id FROM public.session_registrations WHERE activity_session_id = v_session.id
    AND status = 'confirmed' ORDER BY id LIMIT 1);
  BEGIN
    PERFORM public.reschedule_league_fixture_v1(
      v_fixture.id, '2027-10-28T18:30:00+02',
      '1ea90000-0000-4000-8000-000000000012',
      (SELECT user_id FROM league_test_people WHERE n = 14),
      'reschedule-history-must-not-move', 'Ny ändring efter historisk närvaro'
    );
    RAISE EXCEPTION 'historical attendance moved with reschedule session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'historical attendance moved with reschedule session' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_reschedule_has_historical_attendance%' THEN RAISE; END IF;
  END;
  IF v_session.session_date <> (SELECT session_date FROM public.activity_sessions WHERE id = v_session.id)
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE activity_session_id = v_session.id
       AND status IN ('checked_in', 'no_show')) <> 2
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE activity_session_id = v_session.id
       AND status = 'confirmed') <> 2 THEN
    RAISE EXCEPTION 'historical/future reschedule registration truth changed after blocked move';
  END IF;

  SELECT session.id INTO v_round_four
  FROM public.activity_sessions session
  LEFT JOIN public.league_fixtures fixture ON fixture.league_night_session_id = session.id
  LEFT JOIN public.league_fixture_results result ON result.fixture_id = fixture.id AND result.state = 'final'
  WHERE session.series_id = (SELECT series_id FROM league_test_state)
    AND session.session_type = 'league'
  GROUP BY session.id
  HAVING COUNT(fixture.id) = 6
  ORDER BY COUNT(result.id), session.series_occurrence_index LIMIT 1;
  -- Result behavior was already asserted above. Clear this one test night's
  -- finalized history so the safe whole-night reschedule success path can run.
  DELETE FROM public.league_fixture_results result USING public.league_fixtures fixture
  WHERE result.fixture_id = fixture.id AND fixture.league_night_session_id = v_round_four;
  UPDATE public.league_fixtures SET status = 'scheduled'
  WHERE league_night_session_id = v_round_four AND status = 'completed';
  SELECT * INTO v_session FROM public.reschedule_league_night_v1(
    v_round_four, '2027-10-21',
    (SELECT user_id FROM league_test_people WHERE n = 14),
    'reschedule-night-test', 'Hela kvällen flyttad'
  );
  IF v_session.session_date <> DATE '2027-10-21'
     OR (SELECT COUNT(*) FROM public.league_fixtures
         WHERE league_night_session_id = v_session.id
           AND (scheduled_start_at AT TIME ZONE 'Europe/Stockholm')::DATE = DATE '2027-10-21') <> 6
     OR (SELECT COUNT(*) FROM public.session_registrations
         WHERE activity_session_id = v_session.id AND session_date = DATE '2027-10-21') <> 12 THEN
    RAISE EXCEPTION 'whole League-night atomic reschedule failed';
  END IF;
END $$;

-- Three-way League-point tie uses the approved aggregate fallback and never
-- invokes the exactly-two-team head-to-head branch.
DO $$
DECLARE v_season public.league_seasons%ROWTYPE; v_session_ids UUID[]; v_courts UUID[];
  v_a UUID; v_b UUID; v_c UUID; v_fixture UUID; v_positions UUID[];
BEGIN
  SELECT * INTO v_season FROM public.create_league_season_v1(
    '1ea90000-0000-4000-8000-000000000002', 'Three Team Tie Projection', NULL, '{}',
    ARRAY['2029-01-04','2029-01-11','2029-01-18','2029-01-25','2029-02-01']::DATE[],
    ARRAY['1ea90000-0000-4000-8000-000000000011','1ea90000-0000-4000-8000-000000000012','1ea90000-0000-4000-8000-000000000013']::UUID[],
    now() - interval '1 day', now() + interval '300 days', now() + interval '301 days',
    199500, 6, NULL, NULL, true, (SELECT user_id FROM league_test_people WHERE n = 14)
  );
  SELECT array_agg(id ORDER BY series_occurrence_index), court_ids
  INTO v_session_ids, v_courts FROM public.activity_sessions
  WHERE series_id = v_season.activity_series_id AND session_type = 'league'
  GROUP BY court_ids;
  INSERT INTO public.league_team_entries (league_season_id, team_name, captain_customer_id, payer_customer_id,
    status, registration_request_id, activated_at)
  VALUES (v_season.id, 'Tie A', (SELECT customer_id FROM league_test_people WHERE n = 15),
    (SELECT customer_id FROM league_test_people WHERE n = 15), 'active', 'tie-a-request-00000001', now()) RETURNING id INTO v_a;
  INSERT INTO public.league_team_entries (league_season_id, team_name, captain_customer_id, payer_customer_id,
    status, registration_request_id, activated_at)
  VALUES (v_season.id, 'Tie B', (SELECT customer_id FROM league_test_people WHERE n = 16),
    (SELECT customer_id FROM league_test_people WHERE n = 16), 'active', 'tie-b-request-00000002', now()) RETURNING id INTO v_b;
  INSERT INTO public.league_team_entries (league_season_id, team_name, captain_customer_id, payer_customer_id,
    status, registration_request_id, activated_at)
  VALUES (v_season.id, 'Tie C', (SELECT customer_id FROM league_test_people WHERE n = 17),
    (SELECT customer_id FROM league_test_people WHERE n = 17), 'active', 'tie-c-request-00000003', now()) RETURNING id INTO v_c;
  UPDATE public.league_seasons SET fixtures_published_at = now() WHERE id = v_season.id;

  INSERT INTO public.league_fixtures (league_season_id, league_night_session_id, round_number, block_number,
    venue_court_id, team_a_entry_id, team_b_entry_id, leg_number, scheduled_start_at, scheduled_end_at, generation_key)
  VALUES (v_season.id, v_session_ids[1], 1, 1, v_courts[1], v_a, v_b, 1,
    '2029-01-04T18:00:00+01', '2029-01-04T18:50:00+01', 'tie:a-b') RETURNING id INTO v_fixture;
  PERFORM public.save_league_fixture_result_v1(v_fixture, 'final', 'played',
    '[{"team_a":11,"team_b":9},{"team_a":11,"team_b":9},{"team_a":11,"team_b":9}]', NULL, 0,
    'tie-a-beats-b', (SELECT user_id FROM league_test_people WHERE n = 14));
  INSERT INTO public.league_fixtures (league_season_id, league_night_session_id, round_number, block_number,
    venue_court_id, team_a_entry_id, team_b_entry_id, leg_number, scheduled_start_at, scheduled_end_at, generation_key)
  VALUES (v_season.id, v_session_ids[2], 2, 1, v_courts[1], v_b, v_c, 1,
    '2029-01-11T18:00:00+01', '2029-01-11T18:50:00+01', 'tie:b-c') RETURNING id INTO v_fixture;
  PERFORM public.save_league_fixture_result_v1(v_fixture, 'final', 'played',
    '[{"team_a":11,"team_b":8},{"team_a":11,"team_b":8},{"team_a":11,"team_b":8}]', NULL, 0,
    'tie-b-beats-c', (SELECT user_id FROM league_test_people WHERE n = 14));
  INSERT INTO public.league_fixtures (league_season_id, league_night_session_id, round_number, block_number,
    venue_court_id, team_a_entry_id, team_b_entry_id, leg_number, scheduled_start_at, scheduled_end_at, generation_key)
  VALUES (v_season.id, v_session_ids[3], 3, 1, v_courts[1], v_c, v_a, 1,
    '2029-01-18T18:00:00+01', '2029-01-18T18:50:00+01', 'tie:c-a') RETURNING id INTO v_fixture;
  PERFORM public.save_league_fixture_result_v1(v_fixture, 'final', 'played',
    '[{"team_a":11,"team_b":7},{"team_a":11,"team_b":7},{"team_a":11,"team_b":7}]', NULL, 0,
    'tie-c-beats-a', (SELECT user_id FROM league_test_people WHERE n = 14));
  SELECT array_agg(team_entry_id ORDER BY position) INTO v_positions
  FROM public.get_league_standings(v_season.id);
  IF v_positions <> ARRAY[v_b, v_c, v_a]::UUID[]
     OR EXISTS (SELECT 1 FROM public.get_league_standings(v_season.id) WHERE league_points <> 3) THEN
    RAISE EXCEPTION 'three-team tie fallback is wrong: %', v_positions;
  END IF;
END $$;

-- Roster boundaries: organization isolation, 18+ confirmation, meaningful
-- post-start reason, idempotent future registration reconciliation.
DO $$
DECLARE v_team UUID := (SELECT team_alpha FROM league_test_state);
  v_old_member UUID; v_new_member public.league_team_members%ROWTYPE;
BEGIN
  SELECT id INTO v_old_member FROM public.league_team_members
  WHERE team_entry_id = v_team AND role = 'player' AND status = 'active';
  BEGIN
    PERFORM public.replace_league_player(v_team,
      (SELECT customer_id FROM league_test_people WHERE n = 18),
      (SELECT user_id FROM league_test_people WHERE n = 14),
      'cross-org-roster-rejection', 'Cross organization must fail', true);
    RAISE EXCEPTION 'cross-organization roster injection succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-organization roster injection succeeded' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_player_identity_invalid%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.replace_league_player(v_team,
      (SELECT customer_id FROM league_test_people WHERE n = 15),
      (SELECT user_id FROM league_test_people WHERE n = 14),
      'missing-post-start-reason', '', true);
    RAISE EXCEPTION 'post-start roster replacement accepted empty reason';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'post-start roster replacement accepted empty reason' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%league_roster_change_meaningful_reason_required%' THEN RAISE; END IF;
  END;
  SELECT * INTO v_new_member FROM public.replace_league_player(v_team,
    (SELECT customer_id FROM league_test_people WHERE n = 15),
    (SELECT user_id FROM league_test_people WHERE n = 14),
    'valid-post-start-roster-change', 'Anna skadad, ersätts permanent från vecka 3.', true);
  IF (SELECT status FROM public.league_team_members WHERE id = v_old_member) <> 'inactive'
     OR v_new_member.status <> 'active'
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE league_team_member_id = v_new_member.id
       AND status = 'confirmed') <> 5
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE league_team_member_id = v_old_member
       AND status = 'confirmed') <> 0
     OR NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'league_roster_replaced'
       AND metadata->>'reason' = 'Anna skadad, ersätts permanent från vecka 3.') THEN
    RAISE EXCEPTION 'post-start roster reconciliation/audit failed';
  END IF;
END $$;

-- Withdrawal preserves completed history and leaves existing fixtures mutable.
DO $$
DECLARE v_team UUID := (SELECT team_alpha FROM league_test_state);
  v_fixture public.league_fixtures%ROWTYPE; v_winner UUID;
BEGIN
  PERFORM public.cancel_league_team_entry(v_team,
    (SELECT user_id FROM league_test_people WHERE n = 14),
    'withdraw-team-alpha', 'Laget kan inte fullfölja säsongen', true);
  IF (SELECT status FROM public.league_team_entries WHERE id = v_team) <> 'withdrawn'
     OR NOT EXISTS (SELECT 1 FROM public.get_league_standings((SELECT season_id FROM league_test_state))
       WHERE team_entry_id = v_team AND matches_played > 0) THEN
    RAISE EXCEPTION 'withdrawal removed historical standings truth';
  END IF;
  SELECT * INTO v_fixture FROM public.league_fixtures fixture
  WHERE fixture.league_season_id = (SELECT season_id FROM league_test_state)
    AND v_team IN (fixture.team_a_entry_id, fixture.team_b_entry_id)
    AND fixture.status = 'scheduled'
    AND NOT EXISTS (SELECT 1 FROM public.league_fixture_results result WHERE result.fixture_id = fixture.id)
  ORDER BY fixture.round_number, fixture.block_number LIMIT 1;
  v_winner := CASE WHEN v_fixture.team_a_entry_id = v_team THEN v_fixture.team_b_entry_id ELSE v_fixture.team_a_entry_id END;
  PERFORM public.save_league_fixture_result_v1(v_fixture.id, 'final', 'walkover', '[]', v_winner, 0,
    'withdrawn-team-walkover', (SELECT user_id FROM league_test_people WHERE n = 14));
  IF (SELECT status FROM public.league_fixtures WHERE id = v_fixture.id) <> 'completed'
     OR NOT EXISTS (SELECT 1 FROM public.league_fixture_results WHERE fixture_id = v_fixture.id
       AND outcome_type = 'walkover') THEN
    RAISE EXCEPTION 'withdrawn-team fixture became operationally orphaned';
  END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.reserve_league_team_entry(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_league_team_entry(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.save_league_fixture_result_v1(uuid,text,text,jsonb,uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_capacity_hold(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_capacity_hold(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'League mutation RPC escaped the service-role boundary';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('league_standings', 'league_rounds', 'league_checkins')
  ) THEN RAISE EXCEPTION 'deferred League table was created'; END IF;
END $$;

ROLLBACK;
