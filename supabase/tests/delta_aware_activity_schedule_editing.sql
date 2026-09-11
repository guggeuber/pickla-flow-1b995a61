\set ON_ERROR_STOP on
BEGIN;
SELECT plan(23);

CREATE TEMP TABLE delta_dates AS
WITH anchor AS (
  SELECT (now() AT TIME ZONE 'Europe/Stockholm')::DATE AS today
), effective AS (
  SELECT today, today + 1 AS effective_from FROM anchor
)
SELECT
  today,
  effective_from,
  effective_from - CASE
    WHEN (EXTRACT(DOW FROM effective_from)::INTEGER - 6 + 7) % 7 = 0 THEN 7
    ELSE (EXTRACT(DOW FROM effective_from)::INTEGER - 6 + 7) % 7
  END AS historical_saturday,
  effective_from + ((6 - EXTRACT(DOW FROM effective_from)::INTEGER + 7) % 7) AS future_saturday,
  effective_from + ((1 - EXTRACT(DOW FROM effective_from)::INTEGER + 7) % 7) AS future_monday,
  effective_from + ((2 - EXTRACT(DOW FROM effective_from)::INTEGER + 7) % 7) AS future_tuesday,
  effective_from + ((3 - EXTRACT(DOW FROM effective_from)::INTEGER + 7) % 7) AS future_wednesday
FROM effective;

INSERT INTO public.organizations (id, name, slug)
VALUES ('da110000-0000-4000-8000-000000000001', 'Delta Activity Test', 'delta-activity-test');

INSERT INTO public.venues (id, organization_id, name, slug, timezone, is_public)
VALUES (
  'da110000-0000-4000-8000-000000000002',
  'da110000-0000-4000-8000-000000000001',
  'Delta Venue', 'delta-venue', 'Europe/Stockholm', true
);

INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('da110000-0000-4000-8000-000000000011', 'da110000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('da110000-0000-4000-8000-000000000012', 'da110000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true);

INSERT INTO public.opening_hours (venue_id, day_of_week, open_time, close_time, is_closed)
SELECT 'da110000-0000-4000-8000-000000000002', day, '06:00', '23:00', false
FROM generate_series(0, 6) day;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'da110000-0000-4000-8000-000000000021', 'authenticated', 'authenticated',
  'delta-activity@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- Permanent Open Play Eftermiddag-shaped regression fixture.
INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, recurrence_days, start_time, end_time,
  court_ids, is_active, publish_status, created_at
) VALUES (
  'da110000-0000-4000-8000-000000000031',
  'da110000-0000-4000-8000-000000000002',
  'Open Play Eftermiddag fixture', 'open_play', ARRAY[0,1,2,4,5,6], '14:00', '16:00',
  ARRAY['da110000-0000-4000-8000-000000000011'::UUID, 'da110000-0000-4000-8000-000000000012'::UUID],
  true, 'published', '2026-05-11 10:00:00Z'
);

INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, status, price_paid_sek, source_type
)
SELECT
  'da110000-0000-4000-8000-000000000002',
  'da110000-0000-4000-8000-000000000031',
  historical_saturday,
  'da110000-0000-4000-8000-000000000021',
  'confirmed', 165, 'membership'
FROM delta_dates;

-- The unchanged Monday claim is now outside current hours, reproducing the
-- production failure that the old full-PATCH validator rejected.
UPDATE public.opening_hours
SET open_time = '16:00', close_time = '22:00'
WHERE venue_id = 'da110000-0000-4000-8000-000000000002' AND day_of_week = 1;

UPDATE public.activity_sessions
SET recurrence_days = ARRAY[0,1,2,4,5],
    schedule_effective_from = (SELECT effective_from FROM delta_dates)
WHERE id = 'da110000-0000-4000-8000-000000000031';

SELECT is(
  (SELECT recurrence_days FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031'),
  ARRAY[0,1,2,4,5],
  'A/D: removing a weekday succeeds while unchanged out-of-hours Monday claims are grandfathered'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM public.activity_session_schedule_versions WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031'),
  2,
  'J: the first prospective edit writes one historical and one open schedule version'
);

SELECT ok(
  (SELECT (public.activity_session_schedule_at('da110000-0000-4000-8000-000000000031', historical_saturday)->>'occurs')::BOOLEAN FROM delta_dates),
  'J: a historical Saturday remains reconstructable'
);

SELECT ok(
  NOT (SELECT (public.activity_session_schedule_at('da110000-0000-4000-8000-000000000031', future_saturday)->>'occurs')::BOOLEAN FROM delta_dates),
  'L: a future removed Saturday disappears'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_registrations WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031'),
  1,
  'K: historical registrations are preserved'
);

SELECT is(
  (SELECT (public.get_session_public_context(
    'da110000-0000-4000-8000-000000000031', historical_saturday
  )->>'attendee_count')::INTEGER FROM delta_dates),
  1,
  'historical social/count projection still resolves the registered occurrence'
);

UPDATE public.activity_sessions
SET court_ids = ARRAY['da110000-0000-4000-8000-000000000011'::UUID]
WHERE id = 'da110000-0000-4000-8000-000000000031';
SELECT is(
  cardinality((SELECT court_ids FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031')),
  1,
  'B: removing a court succeeds'
);

UPDATE public.activity_sessions
SET end_time = '15:00'
WHERE id = 'da110000-0000-4000-8000-000000000031';
SELECT is(
  (SELECT end_time::TEXT FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031'),
  '15:00:00',
  'C: shortening a time succeeds'
);

-- A future booking blocks only the newly added Wednesday.
INSERT INTO public.bookings (
  venue_id, venue_court_id, user_id, start_time, end_time, status, total_price
)
SELECT
  'da110000-0000-4000-8000-000000000002',
  'da110000-0000-4000-8000-000000000011',
  'da110000-0000-4000-8000-000000000021',
  ((future_wednesday + TIME '14:00') AT TIME ZONE 'Europe/Stockholm'),
  ((future_wednesday + TIME '15:00') AT TIME ZONE 'Europe/Stockholm'),
  'confirmed', 350
FROM delta_dates;

CREATE TEMP TABLE failed_edit_state AS
SELECT recurrence_days, end_time,
  (SELECT count(*) FROM public.activity_session_schedule_versions version WHERE version.activity_session_id = session.id) AS version_count
FROM public.activity_sessions session
WHERE id = 'da110000-0000-4000-8000-000000000031';

DO $$
BEGIN
  BEGIN
    UPDATE public.activity_sessions
    SET recurrence_days = ARRAY[0,1,2,3,4,5]
    WHERE id = 'da110000-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'conflicting weekday was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting weekday was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
END $$;

SELECT is(
  (SELECT recurrence_days FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031'),
  (SELECT recurrence_days FROM failed_edit_state),
  'F/M: a booking conflict denies the new weekday and leaves the template unchanged'
);
SELECT is(
  (SELECT count(*) FROM public.activity_session_schedule_versions WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031'),
  (SELECT version_count FROM failed_edit_state),
  'M: a failed edit writes no schedule versions'
);

UPDATE public.bookings SET status = 'cancelled'
WHERE venue_id = 'da110000-0000-4000-8000-000000000002';
UPDATE public.activity_sessions
SET recurrence_days = ARRAY[0,1,2,3,4,5]
WHERE id = 'da110000-0000-4000-8000-000000000031';
SELECT ok(
  array_position((SELECT recurrence_days FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031'), 3) IS NOT NULL,
  'E: adding a weekday succeeds when its new claims are free'
);

-- Another activity on Bana 2 must remain visible despite self-exclusion.
INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, recurrence_days, start_time, end_time,
  court_ids, is_active, publish_status
) VALUES (
  'da110000-0000-4000-8000-000000000032',
  'da110000-0000-4000-8000-000000000002',
  'Other owner', 'open_play', ARRAY[0], '14:00', '15:00',
  ARRAY['da110000-0000-4000-8000-000000000012'::UUID], true, 'published'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.activity_sessions
    SET court_ids = ARRAY[
      'da110000-0000-4000-8000-000000000011'::UUID,
      'da110000-0000-4000-8000-000000000012'::UUID
    ]
    WHERE id = 'da110000-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'conflicting court was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting court was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
END $$;

SELECT is(
  cardinality((SELECT court_ids FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031')),
  1,
  'G: adding a court claimed by another activity fails'
);

-- Exact session/date self-exclusion must not broaden into a Series exclusion.
INSERT INTO public.activity_series (
  id, venue_id, name, series_type, status, start_date, end_date,
  recurrence_days, start_time, end_time, court_ids
)
SELECT
  'da110000-0000-4000-8000-000000000051',
  'da110000-0000-4000-8000-000000000002',
  'Shared Series fixture', 'program', 'active', effective_from, effective_from + 30,
  ARRAY[3,4], '18:00', '19:00', ARRAY['da110000-0000-4000-8000-000000000012'::UUID]
FROM delta_dates;

INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, recurrence_days, start_time, end_time,
  court_ids, is_active, publish_status
) VALUES
  (
    'da110000-0000-4000-8000-000000000052',
    'da110000-0000-4000-8000-000000000002',
    'da110000-0000-4000-8000-000000000051',
    'Shared Series owner', 'program', ARRAY[3], '18:00', '19:00',
    ARRAY['da110000-0000-4000-8000-000000000012'::UUID], true, 'published'
  ),
  (
    'da110000-0000-4000-8000-000000000053',
    'da110000-0000-4000-8000-000000000002',
    'da110000-0000-4000-8000-000000000051',
    'Shared Series candidate', 'program', ARRAY[4], '18:00', '19:00',
    ARRAY['da110000-0000-4000-8000-000000000012'::UUID], true, 'published'
  );

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.check_physical_activity_schedule_delta(
        'da110000-0000-4000-8000-000000000002',
        'da110000-0000-4000-8000-000000000053',
        (SELECT effective_from FROM delta_dates),
        'da110000-0000-4000-8000-000000000051', NULL, ARRAY[4], '18:00', '19:00', ARRAY['da110000-0000-4000-8000-000000000012'::UUID], true, 'published',
        'da110000-0000-4000-8000-000000000051', NULL, ARRAY[3,4], '18:00', '19:00', ARRAY['da110000-0000-4000-8000-000000000012'::UUID], true, 'published'
      )->'conflicts'
    ) conflict
    WHERE conflict->>'type' = 'activity_occurrence'
      AND conflict->>'source_id' = 'da110000-0000-4000-8000-000000000052'
  ),
  'I: exact self-exclusion does not hide another occurrence in the same Series'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.check_physical_activity_schedule_delta(
        'da110000-0000-4000-8000-000000000002',
        'da110000-0000-4000-8000-000000000031',
        (SELECT effective_from FROM delta_dates),
        NULL, NULL, ARRAY[0,1,2,3,4,5], '14:00', '15:00', ARRAY['da110000-0000-4000-8000-000000000011'::UUID], true, 'published',
        NULL, NULL, ARRAY[0,1,2,3,4,5], '14:00', '15:00', ARRAY['da110000-0000-4000-8000-000000000011'::UUID], true, 'published'
      )->'new_claims'
    ) claim
  ) IS FALSE,
  'I: an unchanged schedule produces no self-conflicting new claims'
);

INSERT INTO public.event_resource_catalog (
  id, venue_id, resource_type, name, venue_court_id, is_bookable, is_active
) VALUES (
  'da110000-0000-4000-8000-000000000041',
  'da110000-0000-4000-8000-000000000002', 'court', 'Bana 1 resource',
  'da110000-0000-4000-8000-000000000011', true, true
);

INSERT INTO public.event_resource_blocks (
  id, venue_id, resource_catalog_id, title, reason, status,
  starts_at, ends_at, blocks_public_booking, metadata
)
SELECT
  'da110000-0000-4000-8000-000000000042',
  'da110000-0000-4000-8000-000000000002',
  'da110000-0000-4000-8000-000000000041',
  'Extension blocker', 'maintenance', 'confirmed',
  ((future_tuesday + TIME '15:00') AT TIME ZONE 'Europe/Stockholm'),
  ((future_tuesday + TIME '17:00') AT TIME ZONE 'Europe/Stockholm'),
  true, '{}'::JSONB
FROM delta_dates;

SELECT ok(
  (SELECT (public.check_physical_availability(
    'da110000-0000-4000-8000-000000000002',
    ARRAY['da110000-0000-4000-8000-000000000011'::UUID],
    ((future_tuesday + TIME '14:00') AT TIME ZONE 'Europe/Stockholm'),
    ((future_tuesday + TIME '15:00') AT TIME ZONE 'Europe/Stockholm'),
    '{}'::UUID[], 'da110000-0000-4000-8000-000000000031', future_tuesday
  )->>'available')::BOOLEAN FROM delta_dates),
  'N: half-open adjacent intervals remain valid'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.activity_sessions
    SET end_time = '17:00'
    WHERE id = 'da110000-0000-4000-8000-000000000031';
    RAISE EXCEPTION 'blocked extension was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'blocked extension was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
END $$;

SELECT is(
  (SELECT end_time::TEXT FROM public.activity_sessions WHERE id = 'da110000-0000-4000-8000-000000000031'),
  '15:00:00',
  'H: extending only the new 15:00-17:00 slice into a resource block fails'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.check_physical_activity_schedule_delta(
        'da110000-0000-4000-8000-000000000002',
        'da110000-0000-4000-8000-000000000031',
        (SELECT effective_from FROM delta_dates),
        NULL, NULL, ARRAY[0,1,2,3,4,5], '14:00', '15:00', ARRAY['da110000-0000-4000-8000-000000000011'::UUID], true, 'published',
        NULL, NULL, ARRAY[0,1,2,3,4,5], '14:00', '17:00', ARRAY['da110000-0000-4000-8000-000000000011'::UUID], true, 'published'
      )->'conflicts'
    ) conflict
    WHERE conflict->>'type' = 'resource_block'
      AND conflict ? 'occurrence_date'
      AND conflict ? 'claim_starts_at'
      AND conflict ? 'claim_ends_at'
  ),
  'P: a denied edit returns structured date/time/resource conflict detail'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.activity_session_schedule_versions
    WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031'
      AND effective_until IS NOT NULL
      AND effective_until <= effective_from
  ),
  'version windows remain valid after same-boundary edits'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM public.activity_session_schedule_versions
    WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031' AND effective_until IS NULL),
  1,
  'there is exactly one open prospective version'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_registrations
    WHERE activity_session_id = 'da110000-0000-4000-8000-000000000031'
      AND session_date = (SELECT historical_saturday FROM delta_dates)),
  1,
  'historical Participation identity remains anchored to session plus local date'
);

SELECT ok(
  (SELECT public.activity_session_schedule_at(
    'da110000-0000-4000-8000-000000000031', historical_saturday
  )->>'start_time' FROM delta_dates) LIKE '14:00:%',
  'historical time remains the pre-edit time'
);

SELECT ok(
  (SELECT public.activity_session_schedule_at(
    'da110000-0000-4000-8000-000000000031', historical_saturday
  )->'court_ids' FROM delta_dates) ? 'da110000-0000-4000-8000-000000000012',
  'historical courts remain the pre-edit courts'
);

SELECT ok(
  (SELECT (public.activity_session_schedule_at(
    'da110000-0000-4000-8000-000000000031', future_monday
  )->>'occurs')::BOOLEAN FROM delta_dates),
  'Q/R/S: prospective readers can resolve an unchanged future weekday'
);

SELECT * FROM finish();
ROLLBACK;
