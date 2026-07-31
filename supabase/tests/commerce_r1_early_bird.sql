\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('eb100000-0000-4000-8000-000000000001', 'Early Bird Test', 'commerce-early-bird-test');

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES ('eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000001', 'Early Bird Venue', 'commerce-early-bird-venue');

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, recurrence_days, start_time, end_time,
  price_sek, capacity, publish_status, scarcity_mode, early_bird_price_minor, early_bird_slots
) VALUES (
  'eb100000-0000-4000-8000-000000000010', 'eb100000-0000-4000-8000-000000000002',
  'Midnight Early Bird', 'open_play', ARRAY[5], '23:00', '00:00',
  165, 8, 'published', 'early_bird', 7900, 2
);

DO $$
DECLARE
  v_first RECORD;
  v_second RECORD;
  v_third RECORD;
  v_fourth RECORD;
BEGIN
  SELECT * INTO v_first FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-07',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000101', 'eb-first',
    16500, 'regular_price', 7900, '{}', 600
  );
  SELECT * INTO v_second FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-07',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000102', 'eb-second',
    16500, 'regular_price', 7900, '{}', 600
  );
  SELECT * INTO v_third FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-07',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000103', 'eb-third',
    16500, 'regular_price', 7900, '{}', 600
  );

  IF v_first.applied_price_type <> 'early_bird' OR v_first.final_price_minor <> 7900 OR v_first.early_bird_remaining <> 1 THEN
    RAISE EXCEPTION 'first discounted allocation incorrect: %', row_to_json(v_first);
  END IF;
  IF v_second.applied_price_type <> 'early_bird' OR v_second.final_price_minor <> 7900 OR v_second.early_bird_remaining <> 0 THEN
    RAISE EXCEPTION 'second discounted allocation incorrect: %', row_to_json(v_second);
  END IF;
  IF v_third.applied_price_type <> 'regular_price' OR v_third.final_price_minor <> 16500 OR NOT v_third.quote_changed THEN
    RAISE EXCEPTION 'ordinary-price transition incorrect: %', row_to_json(v_third);
  END IF;

  UPDATE public.capacity_holds SET expires_at = now() - interval '1 second' WHERE id = v_second.hold_id;
  SELECT * INTO v_fourth FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-07',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000104', 'eb-fourth',
    16500, 'membership_tier_pricing', 7900, '{}', 600
  );
  IF v_fourth.applied_price_type <> 'early_bird' OR v_fourth.final_price_minor <> 7900 THEN
    RAISE EXCEPTION 'expired allocation was not released: %', row_to_json(v_fourth);
  END IF;

  PERFORM public.release_capacity_hold(v_first.hold_id, 'failed_checkout');
  PERFORM public.release_capacity_hold(v_fourth.hold_id, 'test_cleanup');
END $$;

-- Included membership and a lower member price keep precedence over scarcity.
DO $$
DECLARE
  v_included RECORD;
  v_member RECORD;
BEGIN
  SELECT * INTO v_included FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-14',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000105', 'eb-included',
    0, 'membership_open_play_unlimited', 0, '{}', 600
  );
  SELECT * INTO v_member FROM public.acquire_activity_pricing_hold(
    'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000010', '2026-08-14',
    NULL, NULL, 'commerce_order', 'eb100000-0000-4000-8000-000000000106', 'eb-member',
    6900, 'membership_tier_pricing', 6900, '{}', 600
  );
  IF v_included.final_price_minor <> 0 OR v_included.applied_price_type <> 'membership_open_play_unlimited' THEN
    RAISE EXCEPTION 'included membership lost precedence';
  END IF;
  IF v_member.final_price_minor <> 6900 OR v_member.applied_price_type <> 'membership_tier_pricing' THEN
    RAISE EXCEPTION 'lower member price lost precedence';
  END IF;
END $$;

ROLLBACK;
