\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

DROP TABLE IF EXISTS public.league_concurrency_results;
DROP TABLE IF EXISTS public.league_concurrency_people;
CREATE TABLE public.league_concurrency_results (
  case_name TEXT NOT NULL,
  competitor INTEGER NOT NULL,
  ok BOOLEAN NOT NULL,
  reason TEXT,
  applied_price_type TEXT,
  final_price_minor INTEGER,
  team_entry_id UUID,
  hold_id UUID,
  PRIMARY KEY (case_name, competitor)
);
CREATE TABLE public.league_concurrency_people (
  n INTEGER PRIMARY KEY,
  user_id UUID NOT NULL,
  customer_id UUID,
  email TEXT NOT NULL
);

INSERT INTO public.organizations (id, name, slug)
VALUES ('2ea90000-0000-4000-8000-000000000001', 'League Concurrency Test', 'league-concurrency-test');
INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES ('2ea90000-0000-4000-8000-000000000002', '2ea90000-0000-4000-8000-000000000001',
  'League Concurrency Venue', 'league-concurrency-venue', 'Europe/Stockholm', true);
INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('2ea90000-0000-4000-8000-000000000011', '2ea90000-0000-4000-8000-000000000002', 'C1', 1, 'pickleball', 350, true),
  ('2ea90000-0000-4000-8000-000000000012', '2ea90000-0000-4000-8000-000000000002', 'C2', 2, 'pickleball', 350, true),
  ('2ea90000-0000-4000-8000-000000000013', '2ea90000-0000-4000-8000-000000000002', 'C3', 3, 'pickleball', 350, true);

INSERT INTO public.league_concurrency_people
SELECT n, gen_random_uuid(), NULL, 'league-concurrency-' || n || '@example.test'
FROM generate_series(1, 30) n;
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT user_id, 'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
FROM public.league_concurrency_people;
UPDATE public.league_concurrency_people person SET customer_id = customer.id
FROM public.customers customer WHERE customer.auth_user_id = person.user_id;
UPDATE public.customers customer
SET organization_id = '2ea90000-0000-4000-8000-000000000001'
FROM public.league_concurrency_people person WHERE person.customer_id = customer.id;
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
SELECT user_id, '2ea90000-0000-4000-8000-000000000002', 'venue_admin', true
FROM public.league_concurrency_people WHERE n = 30;

CREATE TEMP TABLE league_concurrency_seasons (case_name TEXT PRIMARY KEY, season_id UUID) ON COMMIT PRESERVE ROWS;
DO $$
DECLARE v_capacity public.league_seasons%ROWTYPE; v_early public.league_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_capacity FROM public.create_league_season_v1(
    '2ea90000-0000-4000-8000-000000000002', 'Capacity Race', NULL, '{}',
    ARRAY['2028-01-06','2028-01-13','2028-01-20','2028-01-27','2028-02-03']::DATE[],
    ARRAY['2ea90000-0000-4000-8000-000000000011','2ea90000-0000-4000-8000-000000000012','2ea90000-0000-4000-8000-000000000013']::UUID[],
    now() - interval '1 day', now() + interval '300 days', now() + interval '301 days',
    199500, 6, NULL, NULL, true,
    (SELECT user_id FROM public.league_concurrency_people WHERE n = 30)
  );
  SELECT * INTO v_early FROM public.create_league_season_v1(
    '2ea90000-0000-4000-8000-000000000002', 'Early Bird Race', NULL, '{}',
    ARRAY['2028-03-02','2028-03-09','2028-03-16','2028-03-23','2028-03-30']::DATE[],
    ARRAY['2ea90000-0000-4000-8000-000000000011','2ea90000-0000-4000-8000-000000000012','2ea90000-0000-4000-8000-000000000013']::UUID[],
    now() - interval '1 day', now() + interval '300 days', now() + interval '301 days',
    199500, 6, 179500, 2, true,
    (SELECT user_id FROM public.league_concurrency_people WHERE n = 30)
  );
  INSERT INTO league_concurrency_seasons VALUES ('capacity', v_capacity.id), ('early_bird', v_early.id);
END $$;

-- One competing captain has a verified hidden-but-assignable membership whose
-- team price is lower than Early Bird. The other captain is a non-member. The
-- transactional resolver must let the member price relinquish the remaining
-- Early Bird allocation so the non-member can win it, regardless of ordering.
INSERT INTO public.membership_tiers (
  id, venue_id, name, is_active, is_assignable, sort_order
) VALUES (
  '2ea90000-0000-4000-8000-000000000020',
  '2ea90000-0000-4000-8000-000000000002',
  'Concurrency Founder', false, true, 10
);
INSERT INTO public.membership_tier_pricing (
  tier_id, product_type, fixed_price, discount_percent, label
)
SELECT
  '2ea90000-0000-4000-8000-000000000020', product.product_key,
  1695, NULL, 'Concurrency member team price'
FROM league_concurrency_seasons state
JOIN public.league_seasons season ON season.id = state.season_id
JOIN public.activity_series series ON series.id = season.activity_series_id
JOIN public.access_products product ON product.id = series.access_product_id
WHERE state.case_name = 'early_bird';
INSERT INTO public.memberships (
  user_id, customer_id, venue_id, tier_id, status, starts_at
)
SELECT user_id, customer_id,
  '2ea90000-0000-4000-8000-000000000002',
  '2ea90000-0000-4000-8000-000000000020', 'active', CURRENT_DATE
FROM public.league_concurrency_people WHERE n = 15;

-- Five committed teams leave exactly one capacity slot.
DO $$
DECLARE v_season UUID := (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'capacity');
  v_team UUID; v_n INTEGER;
BEGIN
  FOR v_n IN 1..5 LOOP
    INSERT INTO public.league_team_entries (
      league_season_id, team_name, captain_customer_id, payer_customer_id,
      status, registration_request_id, activated_at
    ) VALUES (v_season, 'Capacity Team ' || v_n,
      (SELECT customer_id FROM public.league_concurrency_people WHERE n = v_n * 2 - 1),
      (SELECT customer_id FROM public.league_concurrency_people WHERE n = v_n * 2 - 1),
      'active', 'capacity-active-request-' || v_n || '-000000', now()) RETURNING id INTO v_team;
    INSERT INTO public.league_team_members (league_season_id, team_entry_id, customer_id, role, status)
    VALUES
      (v_season, v_team, (SELECT customer_id FROM public.league_concurrency_people WHERE n = v_n * 2 - 1), 'captain', 'active'),
      (v_season, v_team, (SELECT customer_id FROM public.league_concurrency_people WHERE n = v_n * 2), 'player', 'active');
  END LOOP;
END $$;

-- One committed Early Bird team leaves Early Bird allocation #2 available.
DO $$
DECLARE v_season UUID := (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'early_bird');
  v_team UUID;
BEGIN
  INSERT INTO public.league_team_entries (
    league_season_id, team_name, captain_customer_id, payer_customer_id,
    status, registration_request_id, activated_at, pricing_reason, base_price_minor, final_price_minor
  ) VALUES (v_season, 'Early Team 1',
    (SELECT customer_id FROM public.league_concurrency_people WHERE n = 1),
    (SELECT customer_id FROM public.league_concurrency_people WHERE n = 1),
    'active', 'early-active-request-000001', now(), 'early_bird', 199500, 179500)
  RETURNING id INTO v_team;
  INSERT INTO public.league_team_members (league_season_id, team_entry_id, customer_id, role, status)
  VALUES
    (v_season, v_team, (SELECT customer_id FROM public.league_concurrency_people WHERE n = 1), 'captain', 'active'),
    (v_season, v_team, (SELECT customer_id FROM public.league_concurrency_people WHERE n = 2), 'player', 'active');
END $$;

CREATE OR REPLACE FUNCTION public.run_league_concurrency_reservation(
  p_case_name TEXT, p_competitor INTEGER, p_season UUID,
  p_captain_n INTEGER, p_player_n INTEGER, p_team_name TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.reserve_league_team_entry_v2(
    p_season,
    (SELECT user_id FROM public.league_concurrency_people WHERE n = p_captain_n),
    (SELECT customer_id FROM public.league_concurrency_people WHERE n = p_captain_n),
    (SELECT customer_id FROM public.league_concurrency_people WHERE n = p_player_n),
    p_team_name, p_case_name || '-concurrent-request-' || p_competitor || '-000000',
    gen_random_uuid(), true, 199500, 600
  );
  INSERT INTO public.league_concurrency_results
    (case_name, competitor, ok, reason, applied_price_type, final_price_minor, team_entry_id, hold_id)
  VALUES (p_case_name, p_competitor, v_result.ok, v_result.reason, v_result.applied_price_type,
    v_result.final_price_minor, v_result.team_entry_id, v_result.hold_id);
  PERFORM pg_sleep(0.75);
END;
$$;

SELECT dblink_connect('league_capacity_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('league_capacity_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('league_capacity_1', format(
  'SELECT public.run_league_concurrency_reservation(%L,1,%L,11,12,%L)',
  'capacity', (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'capacity'), 'Capacity Racer 1'));
SELECT dblink_send_query('league_capacity_2', format(
  'SELECT public.run_league_concurrency_reservation(%L,2,%L,13,14,%L)',
  'capacity', (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'capacity'), 'Capacity Racer 2'));
SELECT * FROM dblink_get_result('league_capacity_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('league_capacity_2') AS result(done TEXT);
SELECT dblink_disconnect('league_capacity_1');
SELECT dblink_disconnect('league_capacity_2');

DO $$
DECLARE v_season UUID := (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'capacity');
BEGIN
  IF (SELECT COUNT(*) FROM public.league_concurrency_results WHERE case_name = 'capacity' AND ok) <> 1
     OR (SELECT COUNT(*) FROM public.league_concurrency_results WHERE case_name = 'capacity'
       AND NOT ok AND reason = 'capacity_full') <> 1
     OR (SELECT active_teams + active_holds FROM public.league_team_capacity_fill(v_season)) <> 6 THEN
    RAISE EXCEPTION 'true final-team-slot concurrency invariant failed: %',
      (SELECT jsonb_agg(to_jsonb(result)) FROM public.league_concurrency_results result WHERE case_name = 'capacity');
  END IF;
END $$;

SELECT dblink_connect('league_early_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('league_early_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('league_early_1', format(
  'SELECT public.run_league_concurrency_reservation(%L,1,%L,15,16,%L)',
  'early_bird', (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'early_bird'), 'Early Racer 1'));
SELECT dblink_send_query('league_early_2', format(
  'SELECT public.run_league_concurrency_reservation(%L,2,%L,17,18,%L)',
  'early_bird', (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'early_bird'), 'Early Racer 2'));
SELECT * FROM dblink_get_result('league_early_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('league_early_2') AS result(done TEXT);
SELECT dblink_disconnect('league_early_1');
SELECT dblink_disconnect('league_early_2');

DO $$
DECLARE v_season UUID := (SELECT season_id FROM league_concurrency_seasons WHERE case_name = 'early_bird');
BEGIN
  IF (SELECT COUNT(*) FROM public.league_concurrency_results WHERE case_name = 'early_bird'
       AND ok AND final_price_minor = 169500 AND applied_price_type = 'membership_tier_pricing') <> 1
     OR (SELECT COUNT(*) FROM public.league_concurrency_results WHERE case_name = 'early_bird'
       AND ok AND final_price_minor = 179500 AND applied_price_type = 'early_bird') <> 1
     OR (SELECT early_bird_allocated FROM public.league_team_capacity_fill(v_season)) <> 2 THEN
    RAISE EXCEPTION 'member-price/Early-Bird concurrency invariant failed: %',
      (SELECT jsonb_agg(to_jsonb(result)) FROM public.league_concurrency_results result WHERE case_name = 'early_bird');
  END IF;
END $$;

SELECT case_name, competitor, ok, reason, applied_price_type, final_price_minor
FROM public.league_concurrency_results ORDER BY case_name, competitor;
