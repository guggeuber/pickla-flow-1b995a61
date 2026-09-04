-- Local-only benchmark fixture for get_session_social_context.
-- Creates 80 current Participations and 500 completed caller-history Sessions,
-- measures the verified RPC, then rolls everything back.
\set ON_ERROR_STOP on
\timing on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('6dd00000-0000-4000-8000-000000000001', 'Social Benchmark', 'social-benchmark');
INSERT INTO public.venues (id, organization_id, name, slug, is_public)
VALUES ('6dd00000-0000-4000-8000-000000000002', '6dd00000-0000-4000-8000-000000000001', 'Benchmark Venue', 'benchmark-venue', true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  md5('social-benchmark-user-' || n)::UUID,
  'authenticated', 'authenticated', 'social-benchmark-' || n || '@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::JSONB, '{}'::JSONB, now(), now()
FROM generate_series(1, 80) AS fixture(n);

DELETE FROM public.customer_identities
WHERE provider = 'auth'
  AND provider_id IN (SELECT md5('social-benchmark-user-' || n)::UUID::TEXT FROM generate_series(1, 80) AS fixture(n));
DELETE FROM public.player_profiles
WHERE auth_user_id IN (SELECT md5('social-benchmark-user-' || n)::UUID FROM generate_series(1, 80) AS fixture(n));
DELETE FROM public.customers
WHERE auth_user_id IN (SELECT md5('social-benchmark-user-' || n)::UUID FROM generate_series(1, 80) AS fixture(n));

INSERT INTO public.customers (
  id, organization_id, auth_user_id, display_name, first_name, last_name,
  primary_email, email_normalized, social_visibility
)
SELECT
  md5('social-benchmark-person-' || n)::UUID,
  '6dd00000-0000-4000-8000-000000000001',
  md5('social-benchmark-user-' || n)::UUID,
  'Person ' || n,
  'Person' || n,
  'Benchmark',
  'social-benchmark-' || n || '@example.test',
  'social-benchmark-' || n || '@example.test',
  'visible'
FROM generate_series(1, 80) AS fixture(n);

INSERT INTO public.player_profiles (auth_user_id, customer_id, display_name, first_name, last_name, avatar_url)
SELECT
  md5('social-benchmark-user-' || n)::UUID,
  md5('social-benchmark-person-' || n)::UUID,
  'Person ' || n,
  'Person' || n,
  'Benchmark',
  'https://images.example.test/' || n || '.jpg'
FROM generate_series(1, 80) AS fixture(n);

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, session_date, start_time, end_time,
  price_sek, capacity, publish_status, closed_to_public, is_active
)
VALUES (
  '6dd00000-0000-4000-8000-000000000010', '6dd00000-0000-4000-8000-000000000002',
  'Benchmark Target', 'open_play', '2026-12-31', '18:00', '20:00',
  165, 100, 'published', false, true
);

INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, customer_id,
  status, price_paid_sek, source_type, role
)
SELECT
  '6dd00000-0000-4000-8000-000000000002',
  '6dd00000-0000-4000-8000-000000000010',
  '2026-12-31',
  md5('social-benchmark-user-' || n)::UUID,
  md5('social-benchmark-person-' || n)::UUID,
  'confirmed', 165, 'benchmark', CASE WHEN n = 2 THEN 'host' ELSE 'participant' END
FROM generate_series(1, 80) AS fixture(n);

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, session_date, start_time, end_time,
  price_sek, capacity, publish_status, closed_to_public, is_active
)
SELECT
  md5('social-benchmark-history-session-' || n)::UUID,
  '6dd00000-0000-4000-8000-000000000002',
  'History ' || n,
  'open_play',
  DATE '2025-01-01' + (n - 1),
  '10:00', '11:00', 165, 20, 'published', false, true
FROM generate_series(1, 500) AS fixture(n);

INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, customer_id,
  status, price_paid_sek, source_type, role
)
SELECT
  '6dd00000-0000-4000-8000-000000000002',
  md5('social-benchmark-history-session-' || n)::UUID,
  DATE '2025-01-01' + (n - 1),
  md5('social-benchmark-user-1')::UUID,
  md5('social-benchmark-person-1')::UUID,
  'attended', 165, 'benchmark', 'participant'
FROM generate_series(1, 500) AS fixture(n);

SELECT set_config('request.jwt.claim.sub', md5('social-benchmark-user-1')::UUID::TEXT, true);
SET LOCAL ROLE authenticated;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31');

SELECT jsonb_array_length(result->'attendees') AS visible_attendees,
       result->>'attendee_count' AS attendee_count
FROM (SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31') AS result) AS measured;
SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31') IS NOT NULL AS warm_2;
SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31') IS NOT NULL AS warm_3;
SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31') IS NOT NULL AS warm_4;
SELECT public.get_session_social_context('6dd00000-0000-4000-8000-000000000010', '2026-12-31') IS NOT NULL AS warm_5;

RESET ROLE;
ROLLBACK;
