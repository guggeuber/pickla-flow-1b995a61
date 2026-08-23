\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('eb240000-0000-4000-8000-000000000001', 'Series Early Bird Test', 'series-early-bird-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'eb240000-0000-4000-8000-000000000002',
  'eb240000-0000-4000-8000-000000000001',
  'Series Early Bird Venue', 'series-early-bird-venue', true
);

INSERT INTO public.customers (id, organization_id, display_name, primary_email, email_normalized)
VALUES
  ('eb240000-0000-4000-8000-000000000011', 'eb240000-0000-4000-8000-000000000001', 'Early One', 'early-one@example.test', 'early-one@example.test'),
  ('eb240000-0000-4000-8000-000000000012', 'eb240000-0000-4000-8000-000000000001', 'Early Two', 'early-two@example.test', 'early-two@example.test'),
  ('eb240000-0000-4000-8000-000000000013', 'eb240000-0000-4000-8000-000000000001', 'House Comp', 'house-comp@example.test', 'house-comp@example.test');

INSERT INTO public.activity_formats (
  id, organization_id, name, description, age_group, level,
  requires_instructor, presentation_type
) VALUES
  ('eb240000-0000-4000-8000-000000000021', 'eb240000-0000-4000-8000-000000000001', 'Series Early Bird Event', 'One occurrence', 'adult', 'intro', false, 'social_event'),
  ('eb240000-0000-4000-8000-000000000022', 'eb240000-0000-4000-8000-000000000001', 'Series Early Bird Course', 'Four occurrences', 'adult', 'beginner', true, 'course');

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek,
  commerce_kind, fulfillment_type, fulfillment_presentation,
  commerce_enabled, status, is_active, scarcity_mode,
  early_bird_price_minor, early_bird_slots
) VALUES
  ('eb240000-0000-4000-8000-000000000031', 'eb240000-0000-4000-8000-000000000002', 'eb_event', 'Early Event', 'series_access', 199, 'participation', 'participation', 'participation', true, 'active', true, 'early_bird', 14900, 1),
  ('eb240000-0000-4000-8000-000000000032', 'eb240000-0000-4000-8000-000000000002', 'eb_member', 'Member Competition', 'series_access', 199, 'participation', 'participation', 'participation', true, 'active', true, 'early_bird', 14900, 2),
  ('eb240000-0000-4000-8000-000000000033', 'eb240000-0000-4000-8000-000000000002', 'eb_comp', 'House Comp Competition', 'series_access', 199, 'participation', 'participation', 'participation', true, 'active', true, 'early_bird', 14900, 1),
  ('eb240000-0000-4000-8000-000000000034', 'eb240000-0000-4000-8000-000000000002', 'eb_committed', 'Committed Early Bird', 'series_access', 199, 'participation', 'participation', 'participation', true, 'active', true, 'early_bird', 14900, 1),
  ('eb240000-0000-4000-8000-000000000035', 'eb240000-0000-4000-8000-000000000002', 'eb_disabled', 'Disabled Early Bird', 'series_access', 1495, 'participation', 'participation', 'participation', true, 'active', true, 'none', null, null);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id,
  product_key, start_date, end_date, total_sessions, capacity,
  recurrence_days, start_time, end_time, court_ids
) VALUES
  ('eb240000-0000-4000-8000-000000000041', 'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000021', 'Early Event Run', 'course', 'active', 'eb240000-0000-4000-8000-000000000031', 'eb_event', '2028-01-10', '2028-01-10', 1, 4, ARRAY[1], '13:00', '18:00', '{}'::UUID[]),
  ('eb240000-0000-4000-8000-000000000042', 'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000021', 'Member Competition Run', 'course', 'active', 'eb240000-0000-4000-8000-000000000032', 'eb_member', '2028-01-11', '2028-01-11', 1, 4, ARRAY[2], '13:00', '18:00', '{}'::UUID[]),
  ('eb240000-0000-4000-8000-000000000043', 'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000021', 'House Comp Run', 'course', 'active', 'eb240000-0000-4000-8000-000000000033', 'eb_comp', '2028-01-12', '2028-01-12', 1, 4, ARRAY[3], '13:00', '18:00', '{}'::UUID[]),
  ('eb240000-0000-4000-8000-000000000044', 'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000021', 'Committed Run', 'course', 'active', 'eb240000-0000-4000-8000-000000000034', 'eb_committed', '2028-01-13', '2028-01-13', 1, 4, ARRAY[4], '13:00', '18:00', '{}'::UUID[]),
  ('eb240000-0000-4000-8000-000000000045', 'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000022', 'Disabled Course Run', 'course', 'active', 'eb240000-0000-4000-8000-000000000035', 'eb_disabled', '2028-02-01', '2028-02-22', 4, 8, ARRAY[2], '18:00', '19:00', '{}'::UUID[]);

-- The final Early Bird slot is serialized with Series capacity. The second
-- request keeps its capacity place but is explicitly repriced.
DO $$
DECLARE
  v_first RECORD;
  v_second RECORD;
  v_released RECORD;
BEGIN
  SELECT * INTO v_first FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000041',
    NULL, 'eb240000-0000-4000-8000-000000000011', 'commerce_order', gen_random_uuid(), 'event-first',
    19900, 'series_product_base_price', 14900, '{}', 600
  );
  SELECT * INTO v_second FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000041',
    NULL, 'eb240000-0000-4000-8000-000000000012', 'commerce_order', gen_random_uuid(), 'event-second',
    19900, 'series_product_base_price', 14900, '{}', 600
  );
  IF v_first.applied_price_type <> 'early_bird' OR v_first.final_price_minor <> 14900 OR v_first.early_bird_remaining <> 0 THEN
    RAISE EXCEPTION 'first Series Early Bird allocation incorrect: %', row_to_json(v_first);
  END IF;
  IF v_second.applied_price_type <> 'series_product_base_price' OR v_second.final_price_minor <> 19900 OR NOT v_second.quote_changed THEN
    RAISE EXCEPTION 'final Series Early Bird slot was allocated twice: %', row_to_json(v_second);
  END IF;

  PERFORM public.release_capacity_hold(v_first.hold_id, 'checkout_expired');
  PERFORM public.release_capacity_hold(v_second.hold_id, 'reprice');
  SELECT * INTO v_released FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000041',
    NULL, 'eb240000-0000-4000-8000-000000000012', 'commerce_order', gen_random_uuid(), 'event-after-expiry',
    19900, 'series_product_base_price', 14900, '{}', 600
  );
  IF v_released.applied_price_type <> 'early_bird' OR v_released.final_price_minor <> 14900 THEN
    RAISE EXCEPTION 'released Series Early Bird allocation was not available again: %', row_to_json(v_released);
  END IF;
  PERFORM public.release_capacity_hold(v_released.hold_id, 'test_cleanup');
END $$;

-- Lowest positive candidate wins. A lower member price does not consume an
-- Early Bird allocation; a higher member price loses to Early Bird.
DO $$
DECLARE
  v_lower_member RECORD;
  v_early RECORD;
  v_fill RECORD;
BEGIN
  SELECT * INTO v_lower_member FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000042',
    NULL, 'eb240000-0000-4000-8000-000000000011', 'commerce_order', gen_random_uuid(), 'member-129',
    12900, 'membership_tier_pricing', 12900, '{}', 600
  );
  SELECT * INTO v_fill FROM public.series_early_bird_fill(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000042'
  );
  IF v_lower_member.final_price_minor <> 12900 OR v_lower_member.applied_price_type <> 'membership_tier_pricing' OR v_fill.fill_count <> 0 THEN
    RAISE EXCEPTION 'lower member price consumed Early Bird: %, %', row_to_json(v_lower_member), row_to_json(v_fill);
  END IF;
  SELECT * INTO v_early FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000042',
    NULL, 'eb240000-0000-4000-8000-000000000012', 'commerce_order', gen_random_uuid(), 'member-169',
    16900, 'membership_tier_pricing', 14900, '{}', 600
  );
  IF v_early.final_price_minor <> 14900 OR v_early.applied_price_type <> 'early_bird' THEN
    RAISE EXCEPTION 'Early Bird did not beat higher member price: %', row_to_json(v_early);
  END IF;
END $$;

-- A House Comp Commitment consumes Series capacity but is not a paid Early
-- Bird allocation.
INSERT INTO public.series_commitments (
  id, organization_id, venue_id, activity_series_id, commitment_type,
  participant_customer_id, status, activated_at, metadata
) VALUES (
  'eb240000-0000-4000-8000-000000000071',
  'eb240000-0000-4000-8000-000000000001',
  'eb240000-0000-4000-8000-000000000002',
  'eb240000-0000-4000-8000-000000000043',
  'participant', 'eb240000-0000-4000-8000-000000000013', 'active', now(),
  '{"funding_type":"house_granted","funder":"house_comped"}'::JSONB
);

DO $$
DECLARE
  v_fill RECORD;
  v_paid RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.series_early_bird_fill(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000043'
  );
  IF v_fill.fill_count <> 0 THEN RAISE EXCEPTION 'House Comp consumed an Early Bird allocation'; END IF;
  SELECT * INTO v_paid FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000043',
    NULL, 'eb240000-0000-4000-8000-000000000011', 'commerce_order', gen_random_uuid(), 'comp-following-paid',
    19900, 'series_product_base_price', 14900, '{}', 600
  );
  IF v_paid.applied_price_type <> 'early_bird' OR v_paid.series_fill_count <> 2 THEN
    RAISE EXCEPTION 'House Comp capacity/Early Bird split is incorrect: %', row_to_json(v_paid);
  END IF;
END $$;

-- A paid Commitment retains the allocation permanently through the frozen
-- order-line snapshot, with no parallel redemption table.
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, customer_id, status, version, currency,
  subtotal_minor, total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor,
  guest_token_hash, paid_at
) VALUES (
  'eb240000-0000-4000-8000-000000000081',
  'eb240000-0000-4000-8000-000000000001',
  'eb240000-0000-4000-8000-000000000002',
  'eb240000-0000-4000-8000-000000000011',
  'draft', 1, 'SEK', 14900, 14900, 14057, 843, 'series-eb-paid-token', null
);
INSERT INTO public.commerce_order_lines (
  id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
  quantity, unit_price_minor, line_total_inc_vat_minor, vat_rate,
  vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
  fulfillment_type, beneficiary_customer_id, activity_series_id, resolver_snapshot
) VALUES (
  'eb240000-0000-4000-8000-000000000082',
  'eb240000-0000-4000-8000-000000000081',
  'eb240000-0000-4000-8000-000000000034',
  'eb_committed', 'Committed Early Bird', 'participation', 1, 14900, 14900, 6,
  843, 14057, 'series_access', 'eb240000-0000-4000-8000-000000000044',
  'participation', 'eb240000-0000-4000-8000-000000000011',
  'eb240000-0000-4000-8000-000000000044',
  '{"scope_type":"activity_series","pricing_reason":"early_bird","final_price_minor":14900}'::JSONB
);
UPDATE public.commerce_orders
SET status = 'paid', paid_at = now()
WHERE id = 'eb240000-0000-4000-8000-000000000081';
INSERT INTO public.series_commitments (
  id, organization_id, venue_id, activity_series_id, commitment_type,
  participant_customer_id, payer_customer_id, commerce_order_id,
  commerce_order_line_id, status, activated_at
) VALUES (
  'eb240000-0000-4000-8000-000000000083',
  'eb240000-0000-4000-8000-000000000001',
  'eb240000-0000-4000-8000-000000000002',
  'eb240000-0000-4000-8000-000000000044',
  'participant', 'eb240000-0000-4000-8000-000000000011',
  'eb240000-0000-4000-8000-000000000011',
  'eb240000-0000-4000-8000-000000000081',
  'eb240000-0000-4000-8000-000000000082', 'active', now()
);

DO $$
DECLARE
  v_fill RECORD;
  v_later RECORD;
  v_disabled RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.series_early_bird_fill(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000044'
  );
  IF v_fill.committed_count <> 1 OR v_fill.fill_count <> 1 THEN
    RAISE EXCEPTION 'paid Early Bird Commitment did not retain allocation: %', row_to_json(v_fill);
  END IF;
  SELECT * INTO v_later FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000044',
    NULL, 'eb240000-0000-4000-8000-000000000012', 'commerce_order', gen_random_uuid(), 'after-paid',
    19900, 'series_product_base_price', 14900, '{}', 600
  );
  IF v_later.final_price_minor <> 19900 OR v_later.applied_price_type <> 'series_product_base_price' OR NOT v_later.quote_changed THEN
    RAISE EXCEPTION 'paid allocation did not close Early Bird quota: %', row_to_json(v_later);
  END IF;

  SELECT * INTO v_disabled FROM public.acquire_series_pricing_hold(
    'eb240000-0000-4000-8000-000000000002', 'eb240000-0000-4000-8000-000000000045',
    NULL, 'eb240000-0000-4000-8000-000000000012', 'commerce_order', gen_random_uuid(), 'disabled',
    149500, 'series_product_base_price', 149500, '{}', 600
  );
  IF v_disabled.final_price_minor <> 149500 OR v_disabled.applied_price_type <> 'series_product_base_price' OR v_disabled.early_bird_remaining IS NOT NULL THEN
    RAISE EXCEPTION 'disabled Series Early Bird altered base pricing: %', row_to_json(v_disabled);
  END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.acquire_series_pricing_hold(uuid,uuid,uuid,uuid,text,uuid,text,integer,text,integer,jsonb,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.acquire_series_pricing_hold(uuid,uuid,uuid,uuid,text,uuid,text,integer,text,integer,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Series pricing hold RPC is callable outside the canonical service-role path';
  END IF;
END $$;

ROLLBACK;
