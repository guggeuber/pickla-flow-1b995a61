\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('c0130000-0000-4000-8000-000000000001', 'Course Resource Test', 'course-resource-test');

INSERT INTO public.venues (id, organization_id, name, slug, timezone, commerce_enabled)
VALUES (
  'c0130000-0000-4000-8000-000000000002',
  'c0130000-0000-4000-8000-000000000001',
  'Course Resource Venue', 'course-resource-venue', 'Europe/Stockholm', true
);

INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('c0130000-0000-4000-8000-000000000003', 'c0130000-0000-4000-8000-000000000002', 'Bana 1', 1, 'pickleball', 350, true),
  ('c0130000-0000-4000-8000-000000000004', 'c0130000-0000-4000-8000-000000000002', 'Bana 2', 2, 'pickleball', 350, true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'c0130000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
  'course-resource@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.activity_formats (id, organization_id, name, age_group, level, requires_instructor)
VALUES (
  'c0130000-0000-4000-8000-000000000020',
  'c0130000-0000-4000-8000-000000000001',
  'Course Resource Format', 'adult', 'beginner', true
);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek,
  commerce_kind, fulfillment_type, fulfillment_presentation, commerce_enabled, status
) VALUES (
  'c0130000-0000-4000-8000-000000000021',
  'c0130000-0000-4000-8000-000000000002',
  'course_resource_guard', 'Course Resource Guard', 'series_access', 1495,
  'participation', 'participation', 'participation', true, 'active'
);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id, product_key,
  start_date, end_date, total_sessions, registration_opens_at, registration_closes_at,
  capacity, recurrence_days, start_time, end_time, court_ids
) VALUES (
  'c0130000-0000-4000-8000-000000000022',
  'c0130000-0000-4000-8000-000000000002',
  'c0130000-0000-4000-8000-000000000020',
  'Course Resource Guard', 'course', 'draft',
  'c0130000-0000-4000-8000-000000000021', 'course_resource_guard',
  '2026-09-08', '2026-10-13', 6,
  '2026-08-01T00:00:00Z', '2026-09-07T22:00:00Z',
  12, ARRAY[2], '18:00', '19:00',
  ARRAY['c0130000-0000-4000-8000-000000000003'::UUID]
);

INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  'c0130000-0000-4000-8000-000000000030',
  'c0130000-0000-4000-8000-000000000002',
  'c0130000-0000-4000-8000-000000000003',
  'c0130000-0000-4000-8000-000000000010',
  'c0130000-0000-4000-8000-000000000010',
  '2026-09-22T16:00:00Z', '2026-09-22T17:00:00Z',
  'confirmed', 350, 'COURSE-RESOURCE-CONFLICT'
);

DO $$
DECLARE
  v_conflict RECORD;
BEGIN
  SELECT * INTO v_conflict
  FROM public.preview_course_resource_schedule(
    'c0130000-0000-4000-8000-000000000002',
    '2026-09-08', '2026-10-13', ARRAY[2], '18:00', '19:00', 6,
    ARRAY['c0130000-0000-4000-8000-000000000003'::UUID]
  ) preview
  WHERE preview.is_available = false;

  IF v_conflict.occurrence_index <> 3
     OR v_conflict.court_id <> 'c0130000-0000-4000-8000-000000000003'
     OR v_conflict.conflicts->0->>'source_type' <> 'booking' THEN
    RAISE EXCEPTION 'Course preview did not identify the private booking conflict: %', row_to_json(v_conflict);
  END IF;

  BEGIN
    PERFORM public.generate_course_series_sessions('c0130000-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'Conflicting Course generation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Conflicting Course generation was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%course_resource_conflict%' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0130000-0000-4000-8000-000000000022'
  ) THEN
    RAISE EXCEPTION 'Conflicting Course generation left partial Sessions';
  END IF;
END;
$$;

UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'c0130000-0000-4000-8000-000000000030';

SELECT public.generate_course_series_sessions('c0130000-0000-4000-8000-000000000022');

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.activity_sessions
    WHERE series_id = 'c0130000-0000-4000-8000-000000000022'
  ) <> 6 THEN
    RAISE EXCEPTION 'Free Course schedule did not generate all six Sessions';
  END IF;

  BEGIN
    INSERT INTO public.activity_sessions (
      id, venue_id, name, session_type, sport_type, session_date, start_time, end_time,
      price_sek, capacity, court_ids, publish_status, is_active, closed_to_public
    ) VALUES (
      'c0130000-0000-4000-8000-000000000040',
      'c0130000-0000-4000-8000-000000000002',
      'Conflicting direct Course', 'course', 'pickleball', '2026-09-08', '18:30', '19:30',
      0, 12, ARRAY['c0130000-0000-4000-8000-000000000003'::UUID], 'published', true, true
    );
    RAISE EXCEPTION 'Direct conflicting Course Session was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Direct conflicting Course Session was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%course_resource_conflict%' THEN RAISE; END IF;
  END;

  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, sport_type, session_date, start_time, end_time,
    price_sek, capacity, court_ids, publish_status, is_active, closed_to_public
  ) VALUES (
    'c0130000-0000-4000-8000-000000000041',
    'c0130000-0000-4000-8000-000000000002',
    'Adjacent Course', 'course', 'pickleball', '2026-09-08', '19:00', '20:00',
    0, 12, ARRAY['c0130000-0000-4000-8000-000000000003'::UUID], 'published', true, true
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE id = 'c0130000-0000-4000-8000-000000000041'
  ) THEN
    RAISE EXCEPTION 'Adjacent half-open Course interval was rejected';
  END IF;
END;
$$;

ROLLBACK;
