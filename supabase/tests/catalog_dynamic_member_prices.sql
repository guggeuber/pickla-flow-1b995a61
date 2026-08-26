\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE catalog_price_people (
  n INTEGER PRIMARY KEY,
  user_id UUID NOT NULL,
  customer_id UUID,
  email TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO public.organizations (id, name, slug)
VALUES ('3ea90000-0000-4000-8000-000000000001', 'Catalog Price Test', 'catalog-price-test');
INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES (
  '3ea90000-0000-4000-8000-000000000002',
  '3ea90000-0000-4000-8000-000000000001',
  'Catalog Price Venue', 'catalog-price-venue', 'Europe/Stockholm', true
);
INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('3ea90000-0000-4000-8000-000000000011', '3ea90000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('3ea90000-0000-4000-8000-000000000012', '3ea90000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true),
  ('3ea90000-0000-4000-8000-000000000013', '3ea90000-0000-4000-8000-000000000002', 'Bana 3', 3, 'pickleball', 350, true);

INSERT INTO catalog_price_people
SELECT n, gen_random_uuid(), NULL, 'catalog-price-' || n || '@example.test'
FROM generate_series(1, 12) n;
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT user_id, 'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
FROM catalog_price_people;
UPDATE catalog_price_people person SET customer_id = customer.id
FROM public.customers customer WHERE customer.auth_user_id = person.user_id;
UPDATE public.customers customer
SET organization_id = '3ea90000-0000-4000-8000-000000000001',
    display_name = 'Catalog Price Person ' || person.n
FROM catalog_price_people person WHERE person.customer_id = customer.id;
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
SELECT user_id, '3ea90000-0000-4000-8000-000000000002', 'venue_admin', true
FROM catalog_price_people WHERE n = 12;

CREATE TEMP TABLE catalog_price_state (
  season_id UUID,
  series_id UUID,
  product_id UUID,
  product_key TEXT,
  frozen_team_id UUID,
  frozen_hold_id UUID,
  frozen_order_id UUID,
  frozen_line_id UUID,
  frozen_request_id TEXT,
  frozen_source_id UUID
) ON COMMIT DROP;

DO $$
DECLARE v_season public.league_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_season FROM public.create_league_season_v1(
    '3ea90000-0000-4000-8000-000000000002',
    'Dynamic Member Price League', 'Catalog member-price contract', '{}',
    ARRAY['2028-09-07','2028-09-14','2028-09-21','2028-09-28','2028-10-05']::DATE[],
    ARRAY[
      '3ea90000-0000-4000-8000-000000000011',
      '3ea90000-0000-4000-8000-000000000012',
      '3ea90000-0000-4000-8000-000000000013'
    ]::UUID[],
    now() - interval '1 day', now() + interval '700 days', now() + interval '701 days',
    149500, 6, 99500, 1, true,
    (SELECT user_id FROM catalog_price_people WHERE n = 12)
  );
  INSERT INTO catalog_price_state (season_id, series_id, product_id, product_key)
  SELECT v_season.id, series.id, product.id, product.product_key
  FROM public.activity_series series
  JOIN public.access_products product ON product.id = series.access_product_id
  WHERE series.id = v_season.activity_series_id;
END $$;

INSERT INTO public.membership_tiers (
  id, venue_id, name, sort_order, is_active, is_assignable
) VALUES
  ('3ea90000-0000-4000-8000-000000000020', '3ea90000-0000-4000-8000-000000000002', 'Founder', 1, false, true),
  ('3ea90000-0000-4000-8000-000000000021', '3ea90000-0000-4000-8000-000000000002', 'Play+', 2, true, true),
  ('3ea90000-0000-4000-8000-000000000022', '3ea90000-0000-4000-8000-000000000002', 'Archived', 3, false, false),
  ('3ea90000-0000-4000-8000-000000000023', '3ea90000-0000-4000-8000-000000000002', 'Synthetic eligible tier', 4, false, true);
INSERT INTO public.membership_tier_pricing (
  tier_id, product_type, fixed_price, discount_percent, label
)
SELECT tier_id, state.product_key, price, NULL, label
FROM catalog_price_state state
CROSS JOIN (VALUES
  ('3ea90000-0000-4000-8000-000000000020'::UUID, 1195::NUMERIC, 'Founder team price'),
  ('3ea90000-0000-4000-8000-000000000021'::UUID, 1295::NUMERIC, 'Play+ team price'),
  ('3ea90000-0000-4000-8000-000000000022'::UUID, 895::NUMERIC, 'Archived team price')
) rule(tier_id, price, label);

-- Captain memberships are canonical pricing identity. Player 2 memberships
-- deliberately differ so roster-best pricing cannot accidentally pass.
INSERT INTO public.memberships (
  user_id, customer_id, venue_id, tier_id, status, starts_at
)
SELECT user_id, customer_id, '3ea90000-0000-4000-8000-000000000002', tier_id, 'active', CURRENT_DATE
FROM catalog_price_people person
JOIN (VALUES
  (1, '3ea90000-0000-4000-8000-000000000020'::UUID),
  (4, '3ea90000-0000-4000-8000-000000000020'::UUID),
  (5, '3ea90000-0000-4000-8000-000000000021'::UUID),
  (6, '3ea90000-0000-4000-8000-000000000020'::UUID),
  (7, '3ea90000-0000-4000-8000-000000000020'::UUID)
) assignment(n, tier_id) ON assignment.n = person.n;

-- A: Founder captain + non-member Player 2. Available Early Bird wins but the
-- verified regular candidate remains Founder 1195 in provenance.
DO $$
DECLARE v_reserved RECORD;
BEGIN
  SELECT * INTO v_reserved FROM public.reserve_league_team_entry_v2(
    (SELECT season_id FROM catalog_price_state),
    (SELECT user_id FROM catalog_price_people WHERE n = 1),
    (SELECT customer_id FROM catalog_price_people WHERE n = 1),
    (SELECT customer_id FROM catalog_price_people WHERE n = 2),
    'Founder Early Team', 'catalog-founder-early-request-0001', gen_random_uuid(), true, 149500, 1920
  );
  IF NOT v_reserved.ok OR v_reserved.final_price_minor <> 99500
     OR v_reserved.applied_price_type <> 'early_bird'
     OR v_reserved.regular_price_minor <> 119500
     OR v_reserved.regular_price_type <> 'membership_tier_pricing'
     OR v_reserved.membership_tier_id <> '3ea90000-0000-4000-8000-000000000020' THEN
    RAISE EXCEPTION 'Founder captain/Early Bird winner was incorrect: %', row_to_json(v_reserved);
  END IF;
END $$;

-- B: non-member captain + Founder Player 2. The only supplied price is an
-- intentionally malicious 1 öre quote. It is comparison-only and cannot
-- become pricing truth; base wins after Early Bird is exhausted.
DO $$
DECLARE v_reserved RECORD;
BEGIN
  SELECT * INTO v_reserved FROM public.reserve_league_team_entry_v2(
    (SELECT season_id FROM catalog_price_state),
    (SELECT user_id FROM catalog_price_people WHERE n = 3),
    (SELECT customer_id FROM catalog_price_people WHERE n = 3),
    (SELECT customer_id FROM catalog_price_people WHERE n = 4),
    'Player Two Founder', 'catalog-player-founder-request-0001', gen_random_uuid(), true, 1, 1920
  );
  IF NOT v_reserved.ok OR v_reserved.final_price_minor <> 149500
     OR v_reserved.applied_price_type <> 'league_team_base_price'
     OR v_reserved.membership_id IS NOT NULL
     OR v_reserved.quote_changed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Player 2 membership or arbitrary quote influenced price: %', row_to_json(v_reserved);
  END IF;
END $$;

-- C: Play+ captain + Founder Player 2. The purchaser's Play+ price controls.
DO $$
DECLARE v_reserved RECORD;
BEGIN
  SELECT * INTO v_reserved FROM public.reserve_league_team_entry_v2(
    (SELECT season_id FROM catalog_price_state),
    (SELECT user_id FROM catalog_price_people WHERE n = 5),
    (SELECT customer_id FROM catalog_price_people WHERE n = 5),
    (SELECT customer_id FROM catalog_price_people WHERE n = 6),
    'Play Plus Captain', 'catalog-play-plus-request-0001', gen_random_uuid(), true, 119500, 1920
  );
  IF NOT v_reserved.ok OR v_reserved.final_price_minor <> 129500
     OR v_reserved.applied_price_type <> 'membership_tier_pricing'
     OR v_reserved.membership_tier_id <> '3ea90000-0000-4000-8000-000000000021'
     OR v_reserved.membership_tier_name <> 'Play+' THEN
    RAISE EXCEPTION 'captain Play+ did not control team member price: %', row_to_json(v_reserved);
  END IF;
END $$;

-- D: create one complete non-Stripe financial chain at the verified Founder
-- amount. This is local transactional contract data and rolls back below.
DO $$
DECLARE
  v_reserved RECORD;
  v_financial RECORD;
  v_fulfilled RECORD;
  v_order_id UUID := gen_random_uuid();
  v_line_id UUID := gen_random_uuid();
  v_source_id UUID := gen_random_uuid();
  v_request_id TEXT := 'catalog-frozen-founder-request-0001';
  v_captain_user UUID := (SELECT user_id FROM catalog_price_people WHERE n = 7);
  v_captain UUID := (SELECT customer_id FROM catalog_price_people WHERE n = 7);
BEGIN
  SELECT * INTO v_reserved FROM public.reserve_league_team_entry_v2(
    (SELECT season_id FROM catalog_price_state), v_captain_user, v_captain,
    (SELECT customer_id FROM catalog_price_people WHERE n = 8),
    'Frozen Founder Team', v_request_id, v_source_id, true, 119500, 1920
  );
  IF NOT v_reserved.ok OR v_reserved.final_price_minor <> 119500
     OR v_reserved.applied_price_type <> 'membership_tier_pricing' THEN
    RAISE EXCEPTION 'Founder member-price reservation failed: %', row_to_json(v_reserved);
  END IF;

  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, customer_id, user_id, status, version, currency,
    subtotal_minor, total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor,
    stripe_session_id, guest_token_hash, guest_name, guest_email, checkout_frozen_at
  ) VALUES (
    v_order_id, '3ea90000-0000-4000-8000-000000000001',
    '3ea90000-0000-4000-8000-000000000002', v_captain, v_captain_user,
    'draft', 1, 'SEK', 119500, 119500, 112736, 6764,
    NULL, 'catalog-frozen-founder-token', 'Catalog Price Person 7',
    'catalog-price-7@example.test', NULL
  );
  INSERT INTO public.commerce_order_lines (
    id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
    quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
    vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
    fulfillment_type, activity_series_id, league_team_entry_id, capacity_hold_id,
    resolver_snapshot, product_snapshot
  ) VALUES (
    v_line_id, v_order_id, (SELECT product_id FROM catalog_price_state),
    (SELECT product_key FROM catalog_price_state), 'Dynamic Member Price League · Lagplats',
    'participation', 1, 119500, 0, 119500, 6, 6764, 112736,
    'league_team_entry', v_reserved.team_entry_id, 'participation',
    (SELECT series_id FROM catalog_price_state), v_reserved.team_entry_id, v_reserved.hold_id,
    jsonb_build_object(
      'scope', 'league_team_entry', 'scope_type', 'league_season',
      'purchase_kind', 'league_team', 'pricing_reason', 'membership_tier_pricing',
      'membership_pricing_applied', true,
      'membership_id', v_reserved.membership_id,
      'membership_tier_id', v_reserved.membership_tier_id,
      'membership_tier_name', v_reserved.membership_tier_name,
      'regular_price_minor', v_reserved.regular_price_minor,
      'final_price_minor', v_reserved.final_price_minor
    ), jsonb_build_object('team_place', true)
  );
  PERFORM public.attach_league_team_commerce(
    v_reserved.team_entry_id, v_reserved.hold_id, v_order_id, v_line_id
  );
  UPDATE public.commerce_orders
  SET status = 'checkout_pending', stripe_session_id = 'cs_test_catalog_frozen', checkout_frozen_at = now()
  WHERE id = v_order_id;
  UPDATE public.capacity_holds SET stripe_session_id = 'cs_test_catalog_frozen'
  WHERE id = v_reserved.hold_id;
  SELECT * INTO v_financial FROM public.finalize_commerce_payment(
    v_order_id, 1, 'cs_test_catalog_frozen', 'pi_test_catalog_frozen',
    v_captain, v_captain_user, 'Catalog Price Person 7', 'catalog-price-7@example.test',
    NULL, 'card'
  );
  SELECT * INTO v_fulfilled FROM public.fulfill_league_team_entry(
    v_reserved.team_entry_id, v_order_id, v_line_id, v_reserved.hold_id,
    'cs_test_catalog_frozen', 'pi_test_catalog_frozen'
  );
  IF v_financial.order_id IS NULL OR v_financial.receipt_id IS NULL
     OR v_financial.ledger_entry_id IS NULL OR NOT v_fulfilled.ok THEN
    RAISE EXCEPTION 'local financial freeze fixture did not finalize';
  END IF;
  UPDATE catalog_price_state SET
    frozen_team_id = v_reserved.team_entry_id,
    frozen_hold_id = v_reserved.hold_id,
    frozen_order_id = v_order_id,
    frozen_line_id = v_line_id,
    frozen_request_id = v_request_id,
    frozen_source_id = v_source_id;
END $$;

CREATE TEMP TABLE catalog_price_frozen_snapshot AS
SELECT
  to_jsonb(entry) AS team_entry,
  to_jsonb(commerce_order) AS order_row,
  to_jsonb(line) AS order_line,
  (SELECT COALESCE(jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id), '[]'::JSONB)
   FROM public.booking_receipts receipt WHERE receipt.commerce_order_id = state.frozen_order_id) AS receipts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(receipt_line) ORDER BY receipt_line.id), '[]'::JSONB)
   FROM public.commerce_receipt_lines receipt_line
   WHERE receipt_line.commerce_order_id = state.frozen_order_id) AS receipt_lines,
  (SELECT COALESCE(jsonb_agg(to_jsonb(ledger) ORDER BY ledger.id), '[]'::JSONB)
   FROM public.ledger_entries ledger WHERE ledger.commerce_order_id = state.frozen_order_id) AS ledger
FROM catalog_price_state state
JOIN public.league_team_entries entry ON entry.id = state.frozen_team_id
JOIN public.commerce_orders commerce_order ON commerce_order.id = state.frozen_order_id
JOIN public.commerce_order_lines line ON line.id = state.frozen_line_id;

-- Future configuration, captain membership and Player 2 membership all change.
-- Existing team/financial truth must remain byte-for-byte frozen.
UPDATE public.membership_tier_pricing SET fixed_price = 1095
WHERE tier_id = '3ea90000-0000-4000-8000-000000000020'
  AND product_type = (SELECT product_key FROM catalog_price_state);
UPDATE public.memberships SET status = 'cancelled', expires_at = CURRENT_DATE
WHERE user_id = (SELECT user_id FROM catalog_price_people WHERE n = 7)
  AND venue_id = '3ea90000-0000-4000-8000-000000000002';
INSERT INTO public.memberships (user_id, customer_id, venue_id, tier_id, status, starts_at)
SELECT user_id, customer_id, '3ea90000-0000-4000-8000-000000000002',
  '3ea90000-0000-4000-8000-000000000021', 'active', CURRENT_DATE
FROM catalog_price_people WHERE n = 8;

DO $$
DECLARE v_retry RECORD; v_state catalog_price_state%ROWTYPE; v_snapshot catalog_price_frozen_snapshot%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM catalog_price_state;
  SELECT * INTO v_retry FROM public.reserve_league_team_entry_v2(
    v_state.season_id,
    (SELECT user_id FROM catalog_price_people WHERE n = 7),
    (SELECT customer_id FROM catalog_price_people WHERE n = 7),
    (SELECT customer_id FROM catalog_price_people WHERE n = 8),
    'Frozen Founder Team', v_state.frozen_request_id, v_state.frozen_source_id,
    true, 1, 1920
  );
  IF NOT v_retry.ok OR v_retry.reason <> 'already_active'
     OR v_retry.final_price_minor <> 119500
     OR v_retry.applied_price_type <> 'membership_tier_pricing'
     OR v_retry.membership_tier_id <> '3ea90000-0000-4000-8000-000000000020' THEN
    RAISE EXCEPTION 'frozen team was repriced after membership changes: %', row_to_json(v_retry);
  END IF;

  SELECT * INTO v_snapshot FROM catalog_price_frozen_snapshot;
  IF (SELECT to_jsonb(entry) FROM public.league_team_entries entry WHERE entry.id = v_state.frozen_team_id)
       IS DISTINCT FROM v_snapshot.team_entry
     OR (SELECT to_jsonb(commerce_order) FROM public.commerce_orders commerce_order WHERE commerce_order.id = v_state.frozen_order_id)
       IS DISTINCT FROM v_snapshot.order_row
     OR (SELECT to_jsonb(line) FROM public.commerce_order_lines line WHERE line.id = v_state.frozen_line_id)
       IS DISTINCT FROM v_snapshot.order_line
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id), '[]'::JSONB)
         FROM public.booking_receipts receipt WHERE receipt.commerce_order_id = v_state.frozen_order_id)
       IS DISTINCT FROM v_snapshot.receipts
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(receipt_line) ORDER BY receipt_line.id), '[]'::JSONB)
         FROM public.commerce_receipt_lines receipt_line
         WHERE receipt_line.commerce_order_id = v_state.frozen_order_id)
       IS DISTINCT FROM v_snapshot.receipt_lines
     OR (SELECT COALESCE(jsonb_agg(to_jsonb(ledger) ORDER BY ledger.id), '[]'::JSONB)
         FROM public.ledger_entries ledger WHERE ledger.commerce_order_id = v_state.frozen_order_id)
       IS DISTINCT FROM v_snapshot.ledger THEN
    RAISE EXCEPTION 'financial history changed after pricing/membership edits';
  END IF;
END $$;

-- Security contract: no hidden price arguments, old rollback signature kept,
-- browser roles denied, real venue staff still denied as authenticated, and
-- the canonical service role can execute an idempotent server reservation.
DO $$
DECLARE v_arguments TEXT;
BEGIN
  SELECT pg_get_function_arguments(proc.oid) INTO v_arguments
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public' AND proc.proname = 'reserve_league_team_entry_v2';
  IF v_arguments LIKE '%p_regular_price_minor%' OR v_arguments LIKE '%p_regular_price_type%' THEN
    RAISE EXCEPTION 'V2 accepts an unverified regular/member price';
  END IF;
  IF to_regprocedure('public.reserve_league_team_entry(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'old League reservation signature was removed';
  END IF;
  IF has_function_privilege('anon', 'public.reserve_league_team_entry_v2(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_league_team_entry_v2(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reserve_league_team_entry_v2(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'League V2 execution grants are incorrect';
  END IF;
  IF has_table_privilege('anon', 'public.membership_tier_pricing', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.membership_tier_pricing', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'member-price work expanded browser table DML';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', (SELECT user_id::TEXT FROM catalog_price_people WHERE n = 12), true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT public.is_venue_member(auth.uid(), '3ea90000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'staff execute test did not use a real venue staff identity';
  END IF;
  IF has_function_privilege(current_user, 'public.reserve_league_team_entry_v2(uuid,uuid,uuid,uuid,text,text,uuid,boolean,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated venue staff inherited League V2 execute';
  END IF;
END $$;
RESET ROLE;

GRANT SELECT ON catalog_price_state, catalog_price_people TO service_role;
SET LOCAL ROLE service_role;
DO $$
DECLARE v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.reserve_league_team_entry_v2(
    (SELECT season_id FROM catalog_price_state),
    (SELECT user_id FROM catalog_price_people WHERE n = 7),
    (SELECT customer_id FROM catalog_price_people WHERE n = 7),
    (SELECT customer_id FROM catalog_price_people WHERE n = 8),
    'Frozen Founder Team', (SELECT frozen_request_id FROM catalog_price_state),
    (SELECT frozen_source_id FROM catalog_price_state), true, 119500, 1920
  );
  IF NOT v_result.ok OR v_result.reason <> 'already_active' THEN
    RAISE EXCEPTION 'service-role canonical League path failed';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
