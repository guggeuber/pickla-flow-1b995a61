\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('ca290000-0000-4000-8000-000000000001', 'Course Cards Test', 'course-cards-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled, is_public)
VALUES
  ('ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000001', 'Course Cards Venue', 'course-cards-venue', true, true),
  ('ca290000-0000-4000-8000-000000000003', 'ca290000-0000-4000-8000-000000000001', 'Empty Venue', 'course-cards-empty', true, true),
  ('ca290000-0000-4000-8000-000000000004', 'ca290000-0000-4000-8000-000000000001', 'Private Venue', 'course-cards-private', true, false);

INSERT INTO public.customers (id, organization_id, display_name, primary_email, email_normalized)
VALUES
  ('ca290000-0000-4000-8000-000000000011', 'ca290000-0000-4000-8000-000000000001', 'Participant One', 'one@cards.test', 'one@cards.test'),
  ('ca290000-0000-4000-8000-000000000012', 'ca290000-0000-4000-8000-000000000001', 'Participant Two', 'two@cards.test', 'two@cards.test'),
  ('ca290000-0000-4000-8000-000000000013', 'ca290000-0000-4000-8000-000000000001', 'Participant Three', 'three@cards.test', 'three@cards.test'),
  ('ca290000-0000-4000-8000-000000000014', 'ca290000-0000-4000-8000-000000000001', 'Participant Four', 'four@cards.test', 'four@cards.test');

INSERT INTO public.activity_formats (
  id, organization_id, name, description, image_urls, age_group, level,
  requires_instructor, presentation_type
) VALUES
  ('ca290000-0000-4000-8000-000000000021', 'ca290000-0000-4000-8000-000000000001', 'Course Format A', 'Reusable A', ARRAY['https://images.test/format-a.webp'], 'adult', 'beginner', true, 'course'),
  ('ca290000-0000-4000-8000-000000000022', 'ca290000-0000-4000-8000-000000000001', 'Course Format B', 'Reusable B', ARRAY['https://images.test/format-b.webp'], 'adult', 'intermediate', true, 'course'),
  ('ca290000-0000-4000-8000-000000000023', 'ca290000-0000-4000-8000-000000000001', 'Social Format', 'Not a course', '{}'::TEXT[], 'adult', 'intro', false, 'social_event');

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, description, image_urls, series_type, status,
  start_date, end_date, total_sessions, registration_opens_at,
  registration_closes_at, capacity, recurrence_days, start_time, end_time, court_ids
) VALUES
  ('ca290000-0000-4000-8000-000000000041', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000021', 'Alpha Course', 'Alpha run', ARRAY['https://images.test/alpha.webp'], 'course', 'active', '2026-10-01', '2026-11-01', 4, '2026-08-01T00:00:00Z', '2026-09-30T22:00:00Z', 5, ARRAY[4], '18:00', '19:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000042', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000022', 'Beta Course', 'Beta run', '{}'::TEXT[], 'course', 'active', '2026-10-01', '2026-10-29', 4, '2026-09-01T00:00:00Z', '2026-09-30T22:00:00Z', 2, ARRAY[4], '19:00', '20:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000043', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000021', 'Gamma Course', null, '{}'::TEXT[], 'course', 'active', '2026-10-02', '2026-10-30', 4, null, '2026-08-29T10:00:00Z', 1, ARRAY[5], '18:00', '19:00', '{}'::UUID[]);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, start_date, end_date,
  total_sessions, capacity, recurrence_days, start_time, end_time, court_ids
) VALUES
  ('ca290000-0000-4000-8000-000000000044', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000021', 'Archived Course', 'course', 'completed', '2026-10-03', '2026-11-01', 1, 5, ARRAY[6], '18:00', '19:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000045', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000021', 'Expired Course', 'course', 'active', '2026-07-01', '2026-08-28', 1, 5, ARRAY[3], '18:00', '19:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000046', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000023', 'Social Series', 'course', 'active', '2026-10-04', '2026-11-01', 1, 5, ARRAY[0], '18:00', '19:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000047', 'ca290000-0000-4000-8000-000000000004', 'ca290000-0000-4000-8000-000000000021', 'Private Course', 'course', 'active', '2026-10-05', '2026-11-01', 1, 5, ARRAY[1], '18:00', '19:00', '{}'::UUID[]),
  ('ca290000-0000-4000-8000-000000000048', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000021', 'Program Series', 'program', 'active', '2026-10-06', '2026-11-01', 1, 5, ARRAY[2], '18:00', '19:00', '{}'::UUID[]);

INSERT INTO public.series_commitments (
  id, organization_id, venue_id, activity_series_id, commitment_type,
  participant_customer_id, status, activated_at
) VALUES
  ('ca290000-0000-4000-8000-000000000051', 'ca290000-0000-4000-8000-000000000001', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000041', 'participant', 'ca290000-0000-4000-8000-000000000011', 'active', now()),
  ('ca290000-0000-4000-8000-000000000052', 'ca290000-0000-4000-8000-000000000001', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000041', 'participant', 'ca290000-0000-4000-8000-000000000012', 'active', now()),
  ('ca290000-0000-4000-8000-000000000053', 'ca290000-0000-4000-8000-000000000001', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000041', 'participant', 'ca290000-0000-4000-8000-000000000013', 'cancelled', now()),
  ('ca290000-0000-4000-8000-000000000054', 'ca290000-0000-4000-8000-000000000001', 'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000042', 'participant', 'ca290000-0000-4000-8000-000000000014', 'active', now());

INSERT INTO public.series_commitments (
  id, organization_id, venue_id, activity_series_id, commitment_type, status, activated_at
) VALUES (
  'ca290000-0000-4000-8000-000000000055', 'ca290000-0000-4000-8000-000000000001',
  'ca290000-0000-4000-8000-000000000002', 'ca290000-0000-4000-8000-000000000041',
  'resource', 'active', now()
);

INSERT INTO public.capacity_holds (
  id, venue_id, scope_type, scope_id, session_date, status, expires_at, idempotency_key
) VALUES
  ('ca290000-0000-4000-8000-000000000061', 'ca290000-0000-4000-8000-000000000002', 'activity_series', 'ca290000-0000-4000-8000-000000000041', '2026-10-01', 'active', '2099-01-01T00:00:00Z', 'cards-alpha-active'),
  ('ca290000-0000-4000-8000-000000000062', 'ca290000-0000-4000-8000-000000000002', 'activity_series', 'ca290000-0000-4000-8000-000000000041', '2026-10-01', 'active', '2000-01-01T00:00:00Z', 'cards-alpha-expired'),
  ('ca290000-0000-4000-8000-000000000063', 'ca290000-0000-4000-8000-000000000002', 'activity_series', 'ca290000-0000-4000-8000-000000000041', '2026-10-01', 'released', '2099-01-01T00:00:00Z', 'cards-alpha-released'),
  ('ca290000-0000-4000-8000-000000000064', 'ca290000-0000-4000-8000-000000000002', 'activity_series', 'ca290000-0000-4000-8000-000000000041', '2026-10-02', 'active', '2099-01-01T00:00:00Z', 'cards-alpha-wrong-date'),
  ('ca290000-0000-4000-8000-000000000065', 'ca290000-0000-4000-8000-000000000002', 'activity_series', 'ca290000-0000-4000-8000-000000000042', '2026-10-01', 'active', '2099-01-01T00:00:00Z', 'cards-beta-active');

DO $$
DECLARE
  v_result JSONB;
  v_items JSONB;
  v_alpha JSONB;
  v_beta JSONB;
  v_gamma JSONB;
  v_fill RECORD;
  v_keys TEXT[];
BEGIN
  v_result := public.public_customer_course_cards('course-cards-venue', '2026-08-29T10:00:00Z');
  v_items := v_result->'items';

  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'public venue was not resolved';
  END IF;
  IF jsonb_array_length(v_items) <> 3 THEN
    RAISE EXCEPTION 'expected exactly three eligible cards: %', v_items;
  END IF;
  IF ARRAY(SELECT value->>'id' FROM jsonb_array_elements(v_items)) <> ARRAY[
    'ca290000-0000-4000-8000-000000000041',
    'ca290000-0000-4000-8000-000000000042',
    'ca290000-0000-4000-8000-000000000043'
  ] THEN
    RAISE EXCEPTION 'card ordering or inclusion changed: %', v_items;
  END IF;

  v_alpha := v_items->0;
  v_beta := v_items->1;
  v_gamma := v_items->2;

  IF v_alpha->>'name' <> 'Alpha Course'
     OR v_alpha->>'description' <> 'Alpha run'
     OR v_alpha#>>'{format,description}' <> 'Reusable A'
     OR v_alpha#>>'{format,presentation_type}' <> 'course'
     OR v_alpha->'image_urls' <> '["https://images.test/alpha.webp"]'::JSONB
     OR v_alpha->>'start_date' <> '2026-10-01'
     OR v_alpha->>'registration_state' <> 'open' THEN
    RAISE EXCEPTION 'Alpha card contract mismatch: %', v_alpha;
  END IF;
  IF v_beta->'image_urls' <> '["https://images.test/format-b.webp"]'::JSONB
     OR v_beta->>'registration_state' <> 'upcoming' THEN
    RAISE EXCEPTION 'fallback artwork or upcoming state mismatch: %', v_beta;
  END IF;
  IF v_gamma->>'registration_state' <> 'closed' THEN
    RAISE EXCEPTION 'closed registration state mismatch: %', v_gamma;
  END IF;

  IF (v_alpha#>>'{capacity,available_count}')::INTEGER <> 2
     OR (v_beta#>>'{capacity,available_count}')::INTEGER <> 0
     OR (v_gamma#>>'{capacity,available_count}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'set-based capacity mismatch: %', v_items;
  END IF;

  SELECT * INTO v_fill FROM public.capacity_fill(
    'ca290000-0000-4000-8000-000000000002', 'activity_series',
    'ca290000-0000-4000-8000-000000000041', '2026-10-01'
  );
  IF (v_alpha#>>'{capacity,available_count}')::INTEGER IS DISTINCT FROM v_fill.available_count THEN
    RAISE EXCEPTION 'catalog capacity diverged from canonical capacity_fill: %, %', v_alpha, row_to_json(v_fill);
  END IF;

  SELECT ARRAY_AGG(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_alpha) key;
  IF v_keys <> ARRAY['capacity', 'description', 'format', 'id', 'image_urls', 'name', 'registration_state', 'start_date'] THEN
    RAISE EXCEPTION 'private or unnecessary top-level field escaped: %', v_keys;
  END IF;
  SELECT ARRAY_AGG(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_alpha->'capacity') key;
  IF v_keys <> ARRAY['available_count'] THEN
    RAISE EXCEPTION 'capacity internals escaped: %', v_keys;
  END IF;
  SELECT ARRAY_AGG(key ORDER BY key) INTO v_keys FROM jsonb_object_keys(v_alpha->'format') key;
  IF v_keys <> ARRAY['description', 'presentation_type'] THEN
    RAISE EXCEPTION 'format internals escaped: %', v_keys;
  END IF;
  IF v_result::TEXT ~* '(email|phone|customer|participant|payer|membership|coach|staff|price)' THEN
    RAISE EXCEPTION 'private identity or pricing vocabulary escaped: %', v_result;
  END IF;

  v_result := public.public_customer_course_cards('course-cards-empty', '2026-08-29T10:00:00Z');
  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM true OR v_result->'items' <> '[]'::JSONB THEN
    RAISE EXCEPTION 'valid empty venue contract failed: %', v_result;
  END IF;
  v_result := public.public_customer_course_cards('missing-venue', '2026-08-29T10:00:00Z');
  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM false OR v_result->'items' <> '[]'::JSONB THEN
    RAISE EXCEPTION 'invalid venue contract failed: %', v_result;
  END IF;
  v_result := public.public_customer_course_cards('course-cards-private', '2026-08-29T10:00:00Z');
  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM false OR v_result->'items' <> '[]'::JSONB THEN
    RAISE EXCEPTION 'non-public venue leaked: %', v_result;
  END IF;
  v_result := public.public_customer_course_cards('   ', '2026-08-29T10:00:00Z');
  IF (v_result->>'venue_found')::BOOLEAN IS DISTINCT FROM false OR v_result->'items' <> '[]'::JSONB THEN
    RAISE EXCEPTION 'malformed venue input contract failed: %', v_result;
  END IF;

  IF has_function_privilege('anon', 'public.public_customer_course_cards(text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.public_customer_course_cards(text,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.public_customer_course_cards(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC grants are broader or narrower than the Edge-only service-role boundary';
  END IF;
END;
$$;

ROLLBACK;
