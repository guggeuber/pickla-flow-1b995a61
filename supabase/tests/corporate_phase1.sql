\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('c0910000-0000-4000-8000-000000000001', 'Corporate Phase 1 Test', 'corporate-phase-1-test'),
  ('c0910000-0000-4000-8000-000000000005', 'Corporate Phase 1 Other', 'corporate-phase-1-other');

INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES
  (
    'c0910000-0000-4000-8000-000000000002',
    'c0910000-0000-4000-8000-000000000001',
    'Corporate Test Venue', 'corporate-phase-1-venue', 'Europe/Stockholm', true
  ),
  (
    'c0910000-0000-4000-8000-000000000006',
    'c0910000-0000-4000-8000-000000000005',
    'Corporate Other Venue', 'corporate-phase-1-other-venue', 'Europe/Stockholm', true
  );

INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('c0910000-0000-4000-8000-000000000003', 'c0910000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('c0910000-0000-4000-8000-000000000004', 'c0910000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true),
  ('c0910000-0000-4000-8000-000000000007', 'c0910000-0000-4000-8000-000000000006', 'Annan bana', 1, 'pickleball', 350, true);

INSERT INTO public.opening_hours (venue_id, day_of_week, open_time, close_time, is_closed)
SELECT venue_id, day, '06:00', '04:00', false
FROM unnest(ARRAY[
  'c0910000-0000-4000-8000-000000000002'::UUID,
  'c0910000-0000-4000-8000-000000000006'::UUID
]) venue_id
CROSS JOIN generate_series(0, 6) day;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'c0910000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
  'corporate-phase-1@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.corporate_accounts (
  id, venue_id, company_name, slug, public_visibility, public_intro
) VALUES (
  'c0910000-0000-4000-8000-000000000020',
  'c0910000-0000-4000-8000-000000000002',
  'Ericsson', 'ericsson', 'unlisted', 'Corporate test page'
);

INSERT INTO public.corporate_orders (
  id, corporate_account_id, venue_id, order_number, order_type, status,
  total_hours, total_price, currency, purchaser_name, price_includes_vat,
  included_items, created_by
) VALUES (
  'c0910000-0000-4000-8000-000000000021',
  'c0910000-0000-4000-8000-000000000020',
  'c0910000-0000-4000-8000-000000000002',
  'CO-CORP-PHASE1', 'recurring', 'paid', 30, 10770, 'SEK', 'ESIK', true,
  ARRAY['Rack', 'Bollar'], 'c0910000-0000-4000-8000-000000000010'
);

INSERT INTO public.activity_series (
  id, venue_id, name, series_type, status, start_date, end_date,
  total_sessions, recurrence_days, start_time, end_time, court_ids,
  corporate_order_id, participation_management_mode
) VALUES (
  'c0910000-0000-4000-8000-000000000022',
  'c0910000-0000-4000-8000-000000000002',
  'Ericsson höst 2026', 'program', 'active', '2026-09-21', '2026-12-30',
  30, ARRAY[1, 3], '17:00', '18:00', '{}'::UUID[],
  'c0910000-0000-4000-8000-000000000021', 'external'
);

WITH dates AS (
  SELECT day::DATE AS session_date,
         row_number() OVER (ORDER BY day)::INTEGER AS occurrence_index
  FROM generate_series('2026-09-21'::DATE, '2026-12-30'::DATE, interval '1 day') day
  WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(ARRAY[1, 3])
  ORDER BY day
  LIMIT 30
)
INSERT INTO public.activity_sessions (
  venue_id, series_id, name, session_type, sport_type, session_date,
  start_time, end_time, price_sek, capacity, court_ids, publish_status,
  is_active, closed_to_public, series_occurrence_index
)
SELECT
  'c0910000-0000-4000-8000-000000000002',
  'c0910000-0000-4000-8000-000000000022',
  'Ericsson höst 2026', 'program', 'pickleball', dates.session_date,
  '17:00', '18:00', 0, 4, '{}'::UUID[], 'published', true, false,
  dates.occurrence_index
FROM dates;

DO $$
DECLARE
  v_apply JSONB;
  v_dates DATE[];
BEGIN
  IF (SELECT COUNT(*) FROM public.activity_sessions WHERE series_id = 'c0910000-0000-4000-8000-000000000022') <> 30 THEN
    RAISE EXCEPTION 'Corporate schedule did not contain 30 concrete Sessions';
  END IF;
  SELECT array_agg(session_date ORDER BY session_date) INTO v_dates
  FROM public.activity_sessions
  WHERE series_id = 'c0910000-0000-4000-8000-000000000022';
  IF v_dates IS DISTINCT FROM ARRAY[
    '2026-09-21'::DATE, '2026-09-23'::DATE, '2026-09-28'::DATE, '2026-09-30'::DATE,
    '2026-10-05'::DATE, '2026-10-07'::DATE, '2026-10-12'::DATE, '2026-10-14'::DATE,
    '2026-10-19'::DATE, '2026-10-21'::DATE, '2026-10-26'::DATE, '2026-10-28'::DATE,
    '2026-11-02'::DATE, '2026-11-04'::DATE, '2026-11-09'::DATE, '2026-11-11'::DATE,
    '2026-11-16'::DATE, '2026-11-18'::DATE, '2026-11-23'::DATE, '2026-11-25'::DATE,
    '2026-11-30'::DATE, '2026-12-02'::DATE, '2026-12-07'::DATE, '2026-12-09'::DATE,
    '2026-12-14'::DATE, '2026-12-16'::DATE, '2026-12-21'::DATE, '2026-12-23'::DATE,
    '2026-12-28'::DATE, '2026-12-30'::DATE
  ] THEN
    RAISE EXCEPTION 'Corporate Sessions did not match the exact approved 30 dates: %', v_dates;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
      AND closed_to_public = false
  ) THEN RAISE EXCEPTION 'Corporate Session boundary did not close every occurrence'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
      AND capacity IS NOT NULL
  ) THEN RAISE EXCEPTION 'Corporate Session boundary retained participant capacity'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
      AND (
        publish_status <> 'published'
        OR price_sek <> 0
        OR start_time <> '17:00'::TIME
        OR end_time <> '18:00'::TIME
      )
  ) THEN RAISE EXCEPTION 'Corporate Session publication, price, or local time doctrine changed'; END IF;
  IF (SELECT MIN(session_date) FROM public.activity_sessions WHERE series_id = 'c0910000-0000-4000-8000-000000000022') <> '2026-09-21'
     OR (SELECT MAX(session_date) FROM public.activity_sessions WHERE series_id = 'c0910000-0000-4000-8000-000000000022') <> '2026-12-30' THEN
    RAISE EXCEPTION 'Corporate Session dates do not match the canonical range';
  END IF;

  v_apply := public.apply_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000003'
  );
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM true OR (v_apply->>'session_count')::INTEGER <> 30 THEN
    RAISE EXCEPTION 'Initial 30/30 court materialization failed: %', v_apply;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
      AND court_ids <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
  ) THEN RAISE EXCEPTION 'Initial court did not materialize on all 30 Sessions'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE venue_id = 'c0910000-0000-4000-8000-000000000002'
  ) THEN RAISE EXCEPTION 'Corporate court materialization created duplicate booking rows'; END IF;
END;
$$;

DO $$
DECLARE
  v_target_session UUID;
  v_before UUID[];
BEGIN
  SELECT court_ids INTO v_before
  FROM public.activity_series
  WHERE id = 'c0910000-0000-4000-8000-000000000022';
  SELECT id INTO v_target_session
  FROM public.activity_sessions
  WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
  ORDER BY session_date
  LIMIT 1;

  BEGIN
    PERFORM public.apply_corporate_series_default_court(
      'c0910000-0000-4000-8000-000000000022',
      'c0910000-0000-4000-8000-000000000007'
    );
    RAISE EXCEPTION 'Cross-venue series assignment was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-venue series assignment was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'corporate_series_court_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.apply_corporate_session_court(
      v_target_session,
      'c0910000-0000-4000-8000-000000000007'
    );
    RAISE EXCEPTION 'Cross-venue occurrence assignment was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-venue occurrence assignment was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'corporate_session_court_invalid' THEN RAISE; END IF;
  END;

  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022') IS DISTINCT FROM v_before
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions
       WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
         AND court_ids IS DISTINCT FROM v_before
     ) THEN
    RAISE EXCEPTION 'Fail-closed invalid lookup left a partial resource write';
  END IF;
END;
$$;

-- The requested Session begins at 15:00Z (17:00 Europe/Stockholm). A booking
-- ending exactly at that instant must remain adjacent under [start,end).
INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  'c0910000-0000-4000-8000-000000000031',
  'c0910000-0000-4000-8000-000000000002',
  'c0910000-0000-4000-8000-000000000004',
  'c0910000-0000-4000-8000-000000000010',
  'c0910000-0000-4000-8000-000000000010',
  '2026-09-21T14:30:00Z', '2026-09-21T15:00:00Z',
  'confirmed', 350, 'CORPORATE-PHASE1-ADJACENT'
);

DO $$
DECLARE
  v_count INTEGER;
  v_available INTEGER;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE is_available)
  INTO v_count, v_available
  FROM public.preview_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000004'
  );
  IF v_count <> 30 OR v_available <> 30 THEN
    RAISE EXCEPTION 'Adjacent booking blocked Corporate preview: %/% available', v_available, v_count;
  END IF;
END;
$$;

UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'c0910000-0000-4000-8000-000000000031';

INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  'c0910000-0000-4000-8000-000000000030',
  'c0910000-0000-4000-8000-000000000002',
  'c0910000-0000-4000-8000-000000000004',
  'c0910000-0000-4000-8000-000000000010',
  'c0910000-0000-4000-8000-000000000010',
  '2026-11-04T16:30:00Z', '2026-11-04T16:45:00Z',
  'confirmed', 350, 'CORPORATE-PHASE1-CONFLICT'
);

DO $$
DECLARE v_apply JSONB; v_target_session UUID;
BEGIN
  v_apply := public.apply_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000004'
  );
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM false
     OR jsonb_array_length(v_apply->'conflicts') <> 1
     OR v_apply->'conflicts'->0->>'session_date' <> '2026-11-04'
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_apply->'conflicts'->0->'conflicts') conflict
       WHERE conflict->>'type' = 'booking'
     ) THEN
    RAISE EXCEPTION 'Apply-all did not return the expected conflict: %', v_apply;
  END IF;
  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022')
       <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions
       WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
         AND court_ids <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     ) THEN RAISE EXCEPTION 'Conflicting apply-all left partial writes'; END IF;

  SELECT id INTO v_target_session FROM public.activity_sessions
  WHERE series_id = 'c0910000-0000-4000-8000-000000000022' AND session_date = '2026-11-04';
  v_apply := public.apply_corporate_session_court(v_target_session, 'c0910000-0000-4000-8000-000000000004');
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Conflicting occurrence override was accepted';
  END IF;
END;
$$;

UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'c0910000-0000-4000-8000-000000000030';

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, sport_type, session_date,
  start_time, end_time, price_sek, court_ids, publish_status, is_active
) VALUES (
  'c0910000-0000-4000-8000-000000000040',
  'c0910000-0000-4000-8000-000000000002',
  'Ordinary Activity conflict', 'open_play', 'pickleball', '2026-10-05',
  '17:15', '17:45', 0,
  ARRAY['c0910000-0000-4000-8000-000000000004'::UUID],
  'published', true
);

DO $$
DECLARE v_apply JSONB;
BEGIN
  v_apply := public.apply_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000004'
  );
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM false
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_apply->'conflicts') affected
       CROSS JOIN LATERAL jsonb_array_elements(affected->'conflicts') conflict
       WHERE conflict->>'type' = 'activity_occurrence'
     ) THEN
    RAISE EXCEPTION 'Activity conflict did not fail the atomic Corporate apply: %', v_apply;
  END IF;
  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022')
       <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions
       WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
         AND court_ids <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     ) THEN RAISE EXCEPTION 'Activity conflict left a partial Corporate assignment'; END IF;
END;
$$;

UPDATE public.activity_sessions SET is_active = false
WHERE id = 'c0910000-0000-4000-8000-000000000040';

INSERT INTO public.event_resource_catalog (
  id, venue_id, resource_type, name, venue_court_id, is_bookable, is_active
) VALUES (
  'c0910000-0000-4000-8000-000000000050',
  'c0910000-0000-4000-8000-000000000002',
  'court', 'Bana 2 resource', 'c0910000-0000-4000-8000-000000000004', true, true
);

SELECT * FROM public.claim_physical_resource_blocks(
  'c0910000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object(
    'venue_id', 'c0910000-0000-4000-8000-000000000002',
    'resource_catalog_id', 'c0910000-0000-4000-8000-000000000050',
    'title', 'Private Corporate resource block',
    'reason', 'event',
    'status', 'confirmed',
    'starts_at', '2026-10-07T15:15:00Z',
    'ends_at', '2026-10-07T15:45:00Z',
    'blocks_public_booking', true
  ))
);

DO $$
DECLARE v_apply JSONB;
BEGIN
  v_apply := public.apply_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000004'
  );
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM false
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_apply->'conflicts') affected
       CROSS JOIN LATERAL jsonb_array_elements(affected->'conflicts') conflict
       WHERE conflict->>'type' = 'resource_block'
     ) THEN
    RAISE EXCEPTION 'Resource-block conflict did not fail the atomic Corporate apply: %', v_apply;
  END IF;
  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022')
       <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions
       WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
         AND court_ids <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     ) THEN RAISE EXCEPTION 'Resource-block conflict left a partial Corporate assignment'; END IF;
END;
$$;

UPDATE public.event_resource_blocks
SET status = 'released', blocks_public_booking = false
WHERE resource_catalog_id = 'c0910000-0000-4000-8000-000000000050';

DO $$
BEGIN
  UPDATE public.venues
  SET timezone = 'Invalid/Corporate_Test_Zone'
  WHERE id = 'c0910000-0000-4000-8000-000000000002';

  BEGIN
    PERFORM public.apply_corporate_series_default_court(
      'c0910000-0000-4000-8000-000000000022',
      'c0910000-0000-4000-8000-000000000004'
    );
    RAISE EXCEPTION 'Availability lookup failure was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Availability lookup failure was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'time zone % not recognized' THEN RAISE; END IF;
  END;

  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022')
       <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions
       WHERE series_id = 'c0910000-0000-4000-8000-000000000022'
         AND court_ids <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID]
     ) THEN RAISE EXCEPTION 'Availability lookup failure left a partial Corporate assignment'; END IF;

  UPDATE public.venues
  SET timezone = 'Europe/Stockholm'
  WHERE id = 'c0910000-0000-4000-8000-000000000002';
END;
$$;

DO $$
DECLARE v_apply JSONB; v_target_session UUID; v_block RECORD;
BEGIN
  SELECT id INTO v_target_session FROM public.activity_sessions
  WHERE series_id = 'c0910000-0000-4000-8000-000000000022' AND session_date = '2026-11-04';
  v_apply := public.apply_corporate_session_court(v_target_session, 'c0910000-0000-4000-8000-000000000004');
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM true
     OR (v_apply->>'is_exception')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Occurrence override failed: %', v_apply;
  END IF;
  IF (SELECT court_ids FROM public.activity_series WHERE id = 'c0910000-0000-4000-8000-000000000022')
       <> ARRAY['c0910000-0000-4000-8000-000000000003'::UUID] THEN
    RAISE EXCEPTION 'Occurrence override changed the Series default';
  END IF;

  v_apply := public.apply_corporate_series_default_court(
    'c0910000-0000-4000-8000-000000000022',
    'c0910000-0000-4000-8000-000000000004'
  );
  IF (v_apply->>'applied')::BOOLEAN IS DISTINCT FROM true
     OR (v_apply->>'session_count')::INTEGER <> 30 THEN
    RAISE EXCEPTION 'Explicit later apply-all failed: %', v_apply;
  END IF;

  SELECT * INTO v_block
  FROM public.preview_course_resource_schedule(
    'c0910000-0000-4000-8000-000000000002',
    '2026-09-21', '2026-09-21', ARRAY[1], '17:15', '17:45', 1,
    ARRAY['c0910000-0000-4000-8000-000000000004'::UUID]
  ) preview
  WHERE preview.is_available = false;
  IF v_block.conflicts->0->>'source_type' <> 'activity_session' THEN
    RAISE EXCEPTION 'Corporate Session did not block canonical court availability: %', row_to_json(v_block);
  END IF;

  IF (SELECT COUNT(*) FROM public.bookings
      WHERE venue_id = 'c0910000-0000-4000-8000-000000000002') <> 2 THEN
    RAISE EXCEPTION 'Court materialization created duplicate booking rows';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE public.activity_series
    SET external_booking_url = 'javascript:alert(1)'
    WHERE id = 'c0910000-0000-4000-8000-000000000022';
    RAISE EXCEPTION 'Invalid external URL was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.corporate_accounts (venue_id, company_name, slug)
    VALUES ('c0910000-0000-4000-8000-000000000002', 'Duplicate Ericsson', 'ericsson');
    RAISE EXCEPTION 'Duplicate corporate slug was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
