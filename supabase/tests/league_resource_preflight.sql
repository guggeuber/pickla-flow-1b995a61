\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('1ea60000-0000-4000-8000-000000000001', 'League Preflight Test', 'league-preflight-test');

INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES (
  '1ea60000-0000-4000-8000-000000000002',
  '1ea60000-0000-4000-8000-000000000001',
  'League Preflight Venue', 'league-preflight-venue', 'Europe/Stockholm', true
);

INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('1ea60000-0000-4000-8000-000000000003', '1ea60000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('1ea60000-0000-4000-8000-000000000004', '1ea60000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true),
  ('1ea60000-0000-4000-8000-000000000005', '1ea60000-0000-4000-8000-000000000002', 'Bana 3', 3, 'pickleball', 350, true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '1ea60000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
  'league-preflight@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

-- Night 1: generic published activity.
INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, sport_type, session_date, start_time, end_time,
  price_sek, capacity, court_ids, publish_status, is_active, closed_to_public
) VALUES (
  '1ea60000-0000-4000-8000-000000000020',
  '1ea60000-0000-4000-8000-000000000002',
  'Open Play Kväll', 'open_play', 'pickleball', '2026-09-10', '18:00', '20:00',
  0, 20, ARRAY['1ea60000-0000-4000-8000-000000000003'::UUID], 'published', true, false
);

-- Night 2: private court booking.
INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  '1ea60000-0000-4000-8000-000000000021',
  '1ea60000-0000-4000-8000-000000000002',
  '1ea60000-0000-4000-8000-000000000004',
  '1ea60000-0000-4000-8000-000000000010',
  '1ea60000-0000-4000-8000-000000000010',
  '2026-09-17T16:00:00Z', '2026-09-17T18:00:00Z',
  'confirmed', 350, 'LEAGUE-PREFLIGHT-BOOKING'
);

-- Night 3: event-owned court block.
INSERT INTO public.event_resource_catalog (
  id, venue_id, resource_type, name, venue_court_id, default_unit_price, is_bookable, is_active
) VALUES (
  '1ea60000-0000-4000-8000-000000000030',
  '1ea60000-0000-4000-8000-000000000002',
  'court', 'Bana 3', '1ea60000-0000-4000-8000-000000000005', 0, true, true
);
INSERT INTO public.event_resource_blocks (
  id, venue_id, resource_catalog_id, title, reason, status,
  starts_at, ends_at, blocks_public_booking, metadata
) VALUES (
  '1ea60000-0000-4000-8000-000000000031',
  '1ea60000-0000-4000-8000-000000000002',
  '1ea60000-0000-4000-8000-000000000030',
  'Företagsevent', 'event', 'confirmed',
  '2026-09-24T16:00:00Z', '2026-09-24T18:00:00Z', true, '{}'
);

-- Nights 4 and 5: existing Course and League sessions.
INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, sport_type, session_date, start_time, end_time,
  price_sek, capacity, court_ids, publish_status, is_active, closed_to_public
) VALUES
  (
    '1ea60000-0000-4000-8000-000000000040',
    '1ea60000-0000-4000-8000-000000000002',
    'Pickla Start', 'course', 'pickleball', '2026-10-01', '18:00', '20:00',
    0, 12, ARRAY['1ea60000-0000-4000-8000-000000000003'::UUID], 'published', true, true
  ),
  (
    '1ea60000-0000-4000-8000-000000000041',
    '1ea60000-0000-4000-8000-000000000002',
    'Seriespel Season 00', 'league', 'pickleball', '2026-10-08', '18:00', '20:00',
    0, 12, ARRAY['1ea60000-0000-4000-8000-000000000004'::UUID], 'published', true, true
  );

-- Touching [17:00,18:00) is not a conflict with the 18:00 League start.
INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  '1ea60000-0000-4000-8000-000000000050',
  '1ea60000-0000-4000-8000-000000000002',
  '1ea60000-0000-4000-8000-000000000005',
  '1ea60000-0000-4000-8000-000000000010',
  '1ea60000-0000-4000-8000-000000000010',
  '2026-10-08T15:00:00Z', '2026-10-08T16:00:00Z',
  'confirmed', 350, 'LEAGUE-PREFLIGHT-BOUNDARY'
);

DO $$
DECLARE
  v_conflicts JSONB;
  v_count INTEGER;
BEGIN
  SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.occurrence_index, preview.court_name), COUNT(*)
  INTO v_conflicts, v_count
  FROM public.preview_course_resource_schedule(
    '1ea60000-0000-4000-8000-000000000002',
    '2026-09-10', '2026-10-08', ARRAY[4], '18:00', '20:00', 5,
    ARRAY[
      '1ea60000-0000-4000-8000-000000000003'::UUID,
      '1ea60000-0000-4000-8000-000000000004'::UUID,
      '1ea60000-0000-4000-8000-000000000005'::UUID
    ], NULL, NULL
  ) preview
  WHERE preview.is_available = false;

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'Expected five complete League preflight conflicts, got %: %', v_count, v_conflicts;
  END IF;
  IF NOT (v_conflicts @> '[{"occurrence_index":1,"conflicts":[{"source_type":"activity_session"}]}]')
     OR NOT (v_conflicts @> '[{"occurrence_index":2,"conflicts":[{"source_type":"booking"}]}]')
     OR NOT (v_conflicts @> '[{"occurrence_index":3,"conflicts":[{"source_type":"event_reservation"}]}]')
     OR NOT (v_conflicts @> '[{"occurrence_index":4,"conflicts":[{"source_type":"activity_session"}]}]')
     OR NOT (v_conflicts @> '[{"occurrence_index":5,"conflicts":[{"source_type":"activity_session"}]}]') THEN
    RAISE EXCEPTION 'League preflight resource universe mismatch: %', v_conflicts;
  END IF;
  IF v_conflicts::TEXT LIKE '%1ea60000-0000-4000-8000-000000000050%' THEN
    RAISE EXCEPTION 'Touching half-open booking was incorrectly reported as a conflict';
  END IF;
END;
$$;

ROLLBACK;
