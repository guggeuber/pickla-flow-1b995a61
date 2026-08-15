\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('dd100000-0000-4000-8000-000000000001', 'Discovery Test', 'discovery-test');
INSERT INTO public.venues (id, organization_id, name, slug)
VALUES ('dd100000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000001', 'Discovery Venue', 'discovery-venue');
INSERT INTO public.activity_formats (id, organization_id, name, image_urls)
VALUES (
  'dd100000-0000-4000-8000-000000000003', 'dd100000-0000-4000-8000-000000000001', 'Brunch & Pickle',
  ARRAY['https://example.test/one.webp', 'https://example.test/two.webp']
);
INSERT INTO public.activity_series (id, venue_id, format_id, name, series_type, image_urls)
VALUES (
  'dd100000-0000-4000-8000-000000000004', 'dd100000-0000-4000-8000-000000000002',
  'dd100000-0000-4000-8000-000000000003', 'Brunch & Pickle · Höst', 'program',
  ARRAY['https://example.test/series.webp']
);
INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, recurrence_days, start_time, end_time,
  price_sek, capacity, publish_status, first_visit_offer_enabled, first_visit_price_minor, first_visit_only
) VALUES (
  'dd100000-0000-4000-8000-000000000005', 'dd100000-0000-4000-8000-000000000002',
  'dd100000-0000-4000-8000-000000000004', 'Open Play Ny Tid', 'open_play', ARRAY[1], '10:00', '12:00',
  165, 8, 'published', true, 9900, true
);

DO $$
DECLARE v_hold RECORD;
BEGIN
  IF NOT public.valid_named_event_image_urls(ARRAY['https://example.test/one.webp']) THEN RAISE EXCEPTION 'Valid image rejected'; END IF;
  IF public.valid_named_event_image_urls(ARRAY['http://example.test/one.webp']) THEN RAISE EXCEPTION 'Insecure image accepted'; END IF;
  IF public.valid_named_event_image_urls(ARRAY['https://a', 'https://b', 'https://c', 'https://d']) THEN RAISE EXCEPTION 'More than three images accepted'; END IF;
  IF position('activity-formats' in pg_get_functiondef('public.can_manage_event_logo_object(text)'::regprocedure)) = 0 THEN RAISE EXCEPTION 'Format Storage scope missing'; END IF;
  IF position('activity-series' in pg_get_functiondef('public.can_manage_event_logo_object(text)'::regprocedure)) = 0 THEN RAISE EXCEPTION 'Series Storage scope missing'; END IF;

  SELECT * INTO v_hold FROM public.acquire_activity_pricing_hold(
    'dd100000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000005', '2026-08-17',
    NULL, NULL, 'commerce_order', NULL, 'first-visit-test', 9900, 'first_visit_offer', 9900, '{}', 600
  );
  IF NOT v_hold.ok OR v_hold.final_price_minor <> 9900 OR v_hold.applied_price_type <> 'first_visit_offer' THEN
    RAISE EXCEPTION 'Existing canonical activity hold did not preserve first-visit quote: %', row_to_json(v_hold);
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE public.activity_sessions SET first_visit_price_minor = 7900 WHERE id = 'dd100000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'Wrong first-visit price was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

ROLLBACK;
