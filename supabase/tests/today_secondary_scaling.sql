\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('b2300000-0000-4000-8000-000000000001', 'Today B2 Scaling', 'today-b2-scaling');
INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled, is_public)
VALUES (
  'b2300000-0000-4000-8000-000000000002',
  'b2300000-0000-4000-8000-000000000001',
  'Today B2 Scaling Venue', 'today-b2-scaling-venue', 'Europe/Stockholm', true, true
);
INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek,
  status, is_active, scarcity_mode
) VALUES (
  'b2300000-0000-4000-8000-000000000003',
  'b2300000-0000-4000-8000-000000000002',
  'today_b2_scaling_ticket', 'Scaling Ticket', 'session_ticket', 165,
  'active', true, 'none'
);
INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, session_date, start_time, end_time,
  price_sek, capacity, product_key, is_active, publish_status,
  closed_to_public, sort_order
)
SELECT
  ('b2300000-0000-4000-8000-' || LPAD(n::TEXT, 12, '0'))::UUID,
  'b2300000-0000-4000-8000-000000000002',
  'Scaling Session ' || n,
  'open_play', CURRENT_DATE,
  (TIME '08:00' + (n * INTERVAL '20 minutes'))::TIME,
  (TIME '08:20' + (n * INTERVAL '20 minutes'))::TIME,
  165, 20, 'today_b2_scaling_ticket', true, 'published', false, n
FROM generate_series(1, 20) n;

CREATE TEMP TABLE today_b2_scaling_result (
  occurrence_count INTEGER,
  samples INTEGER,
  total_ms NUMERIC,
  average_ms NUMERIC,
  result_bytes INTEGER
) ON COMMIT DROP;

DO $$
DECLARE
  v_target INTEGER;
  v_sample INTEGER;
  v_started TIMESTAMPTZ;
  v_elapsed NUMERIC;
  v_result JSONB;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[1, 5, 20] LOOP
    UPDATE public.activity_sessions
    SET is_active = sort_order <= v_target
    WHERE venue_id = 'b2300000-0000-4000-8000-000000000002';

    -- Warm once, then report twenty bounded local DB samples.
    PERFORM public.public_customer_today_secondary_facts(
      'today-b2-scaling-venue', CURRENT_DATE, CURRENT_DATE, now()
    );
    v_started := clock_timestamp();
    FOR v_sample IN 1..20 LOOP
      v_result := public.public_customer_today_secondary_facts(
        'today-b2-scaling-venue', CURRENT_DATE, CURRENT_DATE, now()
      );
    END LOOP;
    v_elapsed := EXTRACT(EPOCH FROM clock_timestamp() - v_started) * 1000;
    INSERT INTO today_b2_scaling_result
    VALUES (v_target, 20, v_elapsed, v_elapsed / 20, OCTET_LENGTH(v_result::TEXT));
  END LOOP;
END;
$$;

TABLE today_b2_scaling_result;
ROLLBACK;
