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

UPDATE public.activity_formats
SET description = 'Kort återanvändbar text',
    full_description = E'Introduktion\n\nTillfälle 1 · Grunder\n\nDetta ingår\nInstruktör'
WHERE id = 'c0130000-0000-4000-8000-000000000020';

SELECT public.update_course_draft_series(
  'c0130000-0000-4000-8000-000000000022',
  'Course Resource Guard · Redigerad',
  '2026-11-02', '2026-11-23',
  '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
  10, 1595, ARRAY[1], '18:30', '19:30', 4,
  ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
);

DO $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_ids
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';

  IF cardinality(v_ids) <> 4 THEN RAISE EXCEPTION 'Draft edit did not reconcile occurrence count'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0130000-0000-4000-8000-000000000022'
      AND (start_time <> '18:30' OR end_time <> '19:30'
        OR court_ids <> ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
        OR capacity <> 10 OR is_active = false)
  ) THEN RAISE EXCEPTION 'Draft edit did not reconcile canonical Session fields'; END IF;
  IF (SELECT base_price_sek FROM public.access_products WHERE id = 'c0130000-0000-4000-8000-000000000021') <> 1595 THEN
    RAISE EXCEPTION 'Draft edit did not update product atomically';
  END IF;
  IF (SELECT full_description FROM public.activity_formats WHERE id = 'c0130000-0000-4000-8000-000000000020') NOT LIKE '%Tillfälle 1%' THEN
    RAISE EXCEPTION 'Reusable Format full content was not stored';
  END IF;
END;
$$;

INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  'c0130000-0000-4000-8000-000000000050',
  'c0130000-0000-4000-8000-000000000002',
  'c0130000-0000-4000-8000-000000000004',
  'c0130000-0000-4000-8000-000000000010',
  'c0130000-0000-4000-8000-000000000010',
  '2026-11-16T17:30:00Z', '2026-11-16T18:30:00Z',
  'confirmed', 350, 'COURSE-DRAFT-EDIT-CONFLICT'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.update_course_draft_series(
      'c0130000-0000-4000-8000-000000000022',
      'Partial mutation forbidden',
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      11, 1695, ARRAY[1], '18:30', '19:30', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Conflicting draft edit was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Conflicting draft edit was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%course_resource_conflict%' THEN RAISE; END IF;
  END;

  IF (SELECT name FROM public.activity_series WHERE id = 'c0130000-0000-4000-8000-000000000022') <> 'Course Resource Guard · Redigerad'
     OR (SELECT capacity FROM public.activity_series WHERE id = 'c0130000-0000-4000-8000-000000000022') <> 10
     OR (SELECT base_price_sek FROM public.access_products WHERE id = 'c0130000-0000-4000-8000-000000000021') <> 1595 THEN
    RAISE EXCEPTION 'Blocked draft edit left partial commercial state';
  END IF;

  UPDATE public.activity_series SET status = 'active'
  WHERE id = 'c0130000-0000-4000-8000-000000000022';
  BEGIN
    PERFORM public.update_course_draft_series(
      'c0130000-0000-4000-8000-000000000022',
      'Published mutation forbidden',
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      10, 1595, ARRAY[1], '18:30', '19:30', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Published Course edit was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Published Course edit was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%course_series_not_draft%' THEN RAISE; END IF;
  END;
END;
$$;

-- The canonical managed-Series editor may reconcile a published run before
-- sales. Occurrence identity is stable, conflicts roll back atomically, and
-- adding/removing a trailing occurrence never duplicates the retained rows.
UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'c0130000-0000-4000-8000-000000000050';

DO $$
DECLARE
  v_before UUID[];
  v_after UUID[];
BEGIN
  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_before
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';

  PERFORM public.update_managed_series_run(
    'c0130000-0000-4000-8000-000000000022',
    'Course Resource Guard · Publicerad', '{}'::TEXT[],
    '2026-11-02', '2026-11-23',
    '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
    10, 1695, ARRAY[1], '20:00', '21:00', 4,
    ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
  );

  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_after
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';

  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'Published no-sales edit replaced occurrence identity: before %, after %', v_before, v_after;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE series_id = 'c0130000-0000-4000-8000-000000000022'
      AND (start_time <> '20:00' OR end_time <> '21:00' OR capacity <> 10)
  ) THEN
    RAISE EXCEPTION 'Published no-sales edit did not reconcile Session truth';
  END IF;
END;
$$;

INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref
) VALUES (
  'c0130000-0000-4000-8000-000000000051',
  'c0130000-0000-4000-8000-000000000002',
  'c0130000-0000-4000-8000-000000000004',
  'c0130000-0000-4000-8000-000000000010',
  'c0130000-0000-4000-8000-000000000010',
  '2026-11-16T20:00:00Z', '2026-11-16T21:00:00Z',
  'confirmed', 350, 'COURSE-MANAGED-EDIT-CONFLICT'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Partial published mutation forbidden', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      11, 1795, ARRAY[1], '21:00', '22:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Conflicting published edit was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Conflicting published edit was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%course_resource_conflict%' THEN RAISE; END IF;
  END;

  IF (SELECT name FROM public.activity_series WHERE id = 'c0130000-0000-4000-8000-000000000022') <> 'Course Resource Guard · Publicerad'
     OR (SELECT capacity FROM public.activity_series WHERE id = 'c0130000-0000-4000-8000-000000000022') <> 10
     OR (SELECT base_price_sek FROM public.access_products WHERE id = 'c0130000-0000-4000-8000-000000000021') <> 1695 THEN
    RAISE EXCEPTION 'Blocked published edit left partial Series/product state';
  END IF;
END;
$$;

UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'c0130000-0000-4000-8000-000000000051';

DO $$
DECLARE
  v_first_four UUID[];
  v_after_add UUID[];
  v_after_remove UUID[];
BEGIN
  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_first_four
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';

  PERFORM public.update_managed_series_run(
    'c0130000-0000-4000-8000-000000000022',
    'Course Resource Guard · Publicerad', '{}'::TEXT[],
    '2026-11-02', '2026-11-30',
    '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
    10, 1695, ARRAY[1], '20:00', '21:00', 5,
    ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
  );
  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_after_add
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';
  IF cardinality(v_after_add) <> 5 OR v_after_add[1:4] IS DISTINCT FROM v_first_four THEN
    RAISE EXCEPTION 'Adding an occurrence duplicated/replaced retained Sessions';
  END IF;

  PERFORM public.update_managed_series_run(
    'c0130000-0000-4000-8000-000000000022',
    'Course Resource Guard · Publicerad', '{}'::TEXT[],
    '2026-11-02', '2026-11-23',
    '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
    10, 1695, ARRAY[1], '20:00', '21:00', 4,
    ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
  );
  SELECT array_agg(id ORDER BY series_occurrence_index) INTO v_after_remove
  FROM public.activity_sessions
  WHERE series_id = 'c0130000-0000-4000-8000-000000000022';
  IF v_after_remove IS DISTINCT FROM v_first_four THEN
    RAISE EXCEPTION 'Removing a safe trailing occurrence changed retained Session identity';
  END IF;
END;
$$;

INSERT INTO public.customers (id, organization_id, display_name, primary_email, email_normalized)
VALUES
  ('c0130000-0000-4000-8000-000000000061', 'c0130000-0000-4000-8000-000000000001', 'Committed One', 'committed-one@example.test', 'committed-one@example.test'),
  ('c0130000-0000-4000-8000-000000000062', 'c0130000-0000-4000-8000-000000000001', 'Committed Two', 'committed-two@example.test', 'committed-two@example.test');

INSERT INTO public.series_commitments (
  id, organization_id, venue_id, activity_series_id, commitment_type,
  participant_customer_id, status, activated_at, metadata
) VALUES
  ('c0130000-0000-4000-8000-000000000071', 'c0130000-0000-4000-8000-000000000001', 'c0130000-0000-4000-8000-000000000002', 'c0130000-0000-4000-8000-000000000022', 'participant', 'c0130000-0000-4000-8000-000000000061', 'active', now(), '{"funding_source":"series_staff_grant"}'::JSONB),
  ('c0130000-0000-4000-8000-000000000072', 'c0130000-0000-4000-8000-000000000001', 'c0130000-0000-4000-8000-000000000002', 'c0130000-0000-4000-8000-000000000022', 'participant', 'c0130000-0000-4000-8000-000000000062', 'active', now(), '{"funding_source":"series_staff_grant"}'::JSONB);

INSERT INTO public.membership_tiers (id, venue_id, name, is_active)
VALUES ('c0130000-0000-4000-8000-000000000080', 'c0130000-0000-4000-8000-000000000002', 'Play', true);

INSERT INTO public.membership_tier_pricing (id, tier_id, product_type, fixed_price, label)
VALUES ('c0130000-0000-4000-8000-000000000081', 'c0130000-0000-4000-8000-000000000080', 'course_resource_guard', 1690, 'Play · Course Resource Guard');

UPDATE public.access_products
SET scarcity_mode = 'early_bird', early_bird_price_minor = 149500, early_bird_slots = 3
WHERE id = 'c0130000-0000-4000-8000-000000000021';

DO $$
BEGIN
  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Schedule side door forbidden', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      10, 1695, ARRAY[1], '21:00', '22:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Schedule edit with Commitments was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Schedule edit with Commitments was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_schedule_has_participants%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Capacity below fill forbidden', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      1, 1695, ARRAY[1], '20:00', '21:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Capacity below active Series fill was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Capacity below active Series fill was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_capacity_below_fill%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Early Bird capacity guard', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      2, 1795, ARRAY[1], '20:00', '21:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Capacity below active Early Bird allocation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Capacity below active Early Bird allocation was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_capacity_below_early_bird_slots%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Early Bird price guard', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      12, 1495, ARRAY[1], '20:00', '21:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Base price at Early Bird price was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Base price at Early Bird price was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_price_below_early_bird%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.update_managed_series_run(
      'c0130000-0000-4000-8000-000000000022',
      'Member price guard', '{}'::TEXT[],
      '2026-11-02', '2026-11-23',
      '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
      12, 1600, ARRAY[1], '20:00', '21:00', 4,
      ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
    );
    RAISE EXCEPTION 'Base price below active fixed member price was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Base price below active fixed member price was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed_series_price_below_member_price%' THEN RAISE; END IF;
  END;

  PERFORM public.update_managed_series_run(
    'c0130000-0000-4000-8000-000000000022',
    'Course Resource Guard · Framtida pris', '{}'::TEXT[],
    '2026-11-02', '2026-11-23',
    '2026-08-15T00:00:00Z', '2026-11-01T22:59:00Z',
    12, 1795, ARRAY[1], '20:00', '21:00', 4,
    ARRAY['c0130000-0000-4000-8000-000000000004'::UUID]
  );

  IF (SELECT capacity FROM public.activity_series WHERE id = 'c0130000-0000-4000-8000-000000000022') <> 12
     OR (SELECT base_price_sek FROM public.access_products WHERE id = 'c0130000-0000-4000-8000-000000000021') <> 1795
     OR (SELECT COUNT(*) FROM public.series_commitments WHERE activity_series_id = 'c0130000-0000-4000-8000-000000000022') <> 2 THEN
    RAISE EXCEPTION 'Safe future-facing edit changed Commitment truth';
  END IF;
END;
$$;

ROLLBACK;
