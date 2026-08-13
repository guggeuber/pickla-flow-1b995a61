\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('c0100000-0000-4000-8000-000000000001', 'Course Test', 'course-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES ('c0100000-0000-4000-8000-000000000002', 'c0100000-0000-4000-8000-000000000001', 'Course Venue', 'course-venue', true);

INSERT INTO public.venue_courts (id, venue_id, name, court_number, hourly_rate)
VALUES ('c0100000-0000-4000-8000-000000000003', 'c0100000-0000-4000-8000-000000000002', 'Bana 1', 1, 350);

INSERT INTO public.customers (id, organization_id, display_name, primary_email, email_normalized)
VALUES
  ('c0100000-0000-4000-8000-000000000021', 'c0100000-0000-4000-8000-000000000001', 'Payer', 'payer@course.test', 'payer@course.test'),
  ('c0100000-0000-4000-8000-000000000022', 'c0100000-0000-4000-8000-000000000001', 'Player', 'player@course.test', 'player@course.test');

INSERT INTO public.activity_formats (id, organization_id, name, description, age_group, level, requires_instructor)
VALUES ('c0100000-0000-4000-8000-000000000031', 'c0100000-0000-4000-8000-000000000001', 'Pickla 101', 'Nybörjarkurs', 'adult', 'beginner', true);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek, commerce_kind,
  fulfillment_type, fulfillment_presentation, commerce_enabled, status
) VALUES (
  'c0100000-0000-4000-8000-000000000032', 'c0100000-0000-4000-8000-000000000002',
  'course_pickla_101', 'Pickla 101 · Höst 2026', 'series_access', 1495,
  'participation', 'participation', 'participation', true, 'active'
);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id, product_key,
  start_date, end_date, total_sessions, registration_opens_at, registration_closes_at,
  capacity, recurrence_days, start_time, end_time, court_ids
) VALUES (
  'c0100000-0000-4000-8000-000000000033', 'c0100000-0000-4000-8000-000000000002',
  'c0100000-0000-4000-8000-000000000031', 'Pickla 101 · Höst 2026', 'course', 'active',
  'c0100000-0000-4000-8000-000000000032', 'course_pickla_101',
  '2026-09-08', '2026-10-20', 6, '2026-08-01T00:00:00Z', '2026-09-08T16:00:00Z',
  1, ARRAY[2], '18:00', '19:00', ARRAY['c0100000-0000-4000-8000-000000000003'::UUID]
);

SELECT public.generate_course_series_sessions('c0100000-0000-4000-8000-000000000033');

DO $$
DECLARE
  v_first RECORD;
  v_second RECORD;
  v_commit RECORD;
  v_commitment_created_at TIMESTAMPTZ;
  v_occurrence_three UUID;
BEGIN
  IF (SELECT COUNT(*) FROM public.activity_sessions WHERE series_id = 'c0100000-0000-4000-8000-000000000033') <> 6 THEN
    RAISE EXCEPTION 'Course did not generate exactly six Sessions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.activity_sessions WHERE series_id = 'c0100000-0000-4000-8000-000000000033' AND (closed_to_public = false OR requires_staffing = false)) THEN
    RAISE EXCEPTION 'Course Sessions are public or do not inherit staffing';
  END IF;

  SELECT * INTO v_first FROM public.acquire_capacity_hold(
    'c0100000-0000-4000-8000-000000000002', 'activity_series',
    'c0100000-0000-4000-8000-000000000033', '2026-09-08', 1,
    NULL, 'c0100000-0000-4000-8000-000000000022',
    'commerce_order', NULL, 'course-final-seat-one', '{}', 600
  );
  SELECT * INTO v_second FROM public.acquire_capacity_hold(
    'c0100000-0000-4000-8000-000000000002', 'activity_series',
    'c0100000-0000-4000-8000-000000000033', '2026-09-08', 1,
    NULL, NULL, 'commerce_order', NULL, 'course-final-seat-two', '{}', 600
  );
  IF NOT v_first.ok OR v_first.hold_id IS NULL THEN RAISE EXCEPTION 'First Course hold failed'; END IF;
  IF v_second.ok OR v_second.reason <> 'capacity_full' THEN RAISE EXCEPTION 'Final Course seat oversold'; END IF;

  SELECT * INTO v_commit FROM public.commit_series_participant_capacity(
    p_venue_id => 'c0100000-0000-4000-8000-000000000002',
    p_activity_series_id => 'c0100000-0000-4000-8000-000000000033',
    p_participant_customer_id => 'c0100000-0000-4000-8000-000000000022',
    p_payer_customer_id => 'c0100000-0000-4000-8000-000000000021',
    p_hold_id => v_first.hold_id
  );
  IF NOT v_commit.ok OR v_commit.commitment_id IS NULL OR v_commit.entitlement_id IS NULL THEN RAISE EXCEPTION 'Course commitment failed'; END IF;
  IF (SELECT COUNT(*) FROM public.series_commitments WHERE activity_series_id = 'c0100000-0000-4000-8000-000000000033' AND status = 'active') <> 1 THEN RAISE EXCEPTION 'Expected one Series Commitment'; END IF;
  IF (SELECT COUNT(*) FROM public.access_entitlements WHERE source_type = 'series_commitment' AND source_id = v_commit.commitment_id) <> 1 THEN RAISE EXCEPTION 'Expected one Series entitlement'; END IF;
  IF EXISTS (SELECT 1 FROM public.access_entitlements WHERE source_id = v_commit.commitment_id AND (scope_type <> 'activity_series' OR meter_type <> 'unlimited' OR requires_consumption)) THEN RAISE EXCEPTION 'Course entitlement doctrine invalid'; END IF;
  IF (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_commit.commitment_id AND status = 'confirmed') <> 6 THEN RAISE EXCEPTION 'Expected six operational projections'; END IF;

  SELECT created_at INTO v_commitment_created_at FROM public.series_commitments WHERE id = v_commit.commitment_id;
  SELECT id INTO v_occurrence_three FROM public.activity_sessions WHERE series_id = 'c0100000-0000-4000-8000-000000000033' AND series_occurrence_index = 3;
  UPDATE public.activity_sessions SET session_date = session_date + 1 WHERE id = v_occurrence_three;
  IF (SELECT created_at FROM public.series_commitments WHERE id = v_commit.commitment_id) IS DISTINCT FROM v_commitment_created_at THEN RAISE EXCEPTION 'Session move rewrote commitment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_registrations registration JOIN public.activity_sessions session ON session.id = registration.activity_session_id WHERE registration.series_commitment_id = v_commit.commitment_id AND session.id = v_occurrence_three AND registration.session_date = session.session_date) THEN RAISE EXCEPTION 'Moved Session projection did not reconcile'; END IF;

  INSERT INTO public.activity_sessions (
    venue_id, name, session_type, sport_type, session_date, start_time, end_time,
    price_sek, capacity, court_ids, access_policy, series_id, publish_status,
    requires_staffing, closed_to_public, series_occurrence_index
  ) VALUES (
    'c0100000-0000-4000-8000-000000000002', 'Pickla 101 · Extra', 'course', 'pickleball',
    '2026-10-27', '18:00', '19:00', 0, 1, ARRAY['c0100000-0000-4000-8000-000000000003'::UUID],
    '{"series_commitment_required":true}', 'c0100000-0000-4000-8000-000000000033', 'published', true, true, 7
  );
  IF (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_commit.commitment_id AND status = 'confirmed') <> 7 THEN RAISE EXCEPTION 'Added Session did not project participant'; END IF;

  UPDATE public.session_registrations SET status = 'no_show'
  WHERE series_commitment_id = v_commit.commitment_id AND activity_session_id = v_occurrence_three;
  IF NOT EXISTS (SELECT 1 FROM public.series_commitments WHERE id = v_commit.commitment_id AND status = 'active') THEN RAISE EXCEPTION 'Absence changed Series Commitment'; END IF;
END;
$$;

INSERT INTO public.dependent_participants (
  id, organization_id, guardian_customer_id, first_name, birth_year
) VALUES (
  'c0100000-0000-4000-8000-000000000041', 'c0100000-0000-4000-8000-000000000001',
  'c0100000-0000-4000-8000-000000000021', 'Elsa', 2016
);

DO $$
DECLARE
  v_commit RECORD;
BEGIN
  UPDATE public.activity_series SET capacity = 2 WHERE id = 'c0100000-0000-4000-8000-000000000033';
  SELECT * INTO v_commit FROM public.commit_series_participant_capacity(
    p_venue_id => 'c0100000-0000-4000-8000-000000000002',
    p_activity_series_id => 'c0100000-0000-4000-8000-000000000033',
    p_dependent_participant_id => 'c0100000-0000-4000-8000-000000000041',
    p_payer_customer_id => 'c0100000-0000-4000-8000-000000000021'
  );
  IF NOT v_commit.ok THEN RAISE EXCEPTION 'Dependent Course commitment failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.session_registrations WHERE series_commitment_id = v_commit.commitment_id AND (user_id IS NOT NULL OR customer_id IS NOT NULL)) THEN RAISE EXCEPTION 'Minor projection received public/social adult identity'; END IF;
  IF EXISTS (SELECT 1 FROM public.activity_sessions WHERE series_id = 'c0100000-0000-4000-8000-000000000033' AND closed_to_public = false) THEN RAISE EXCEPTION 'Minor Course Session breached public closure'; END IF;
END;
$$;

ROLLBACK;
