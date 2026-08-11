\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('0f510000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'operations-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('0f510000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'operations-staff@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('0f510000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-venue-staff@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

DO $$
DECLARE
  v_org uuid;
  v_venue uuid := '0f510000-0000-4000-8000-000000000010';
  v_other_venue uuid := '0f510000-0000-4000-8000-000000000011';
  v_staff uuid := '0f510000-0000-4000-8000-000000000020';
  v_other_staff uuid := '0f510000-0000-4000-8000-000000000021';
  v_session uuid := '0f510000-0000-4000-8000-000000000030';
  v_assignment uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;

  INSERT INTO public.venues (id, organization_id, name, slug, timezone)
  VALUES
    (v_venue, v_org, 'Operations Week Fixture', 'operations-week-fixture', 'Europe/Stockholm'),
    (v_other_venue, v_org, 'Operations Other Venue', 'operations-other-venue', 'Europe/Stockholm');

  INSERT INTO public.venue_staff (id, venue_id, user_id, role, is_active)
  VALUES
    (v_staff, v_venue, '0f510000-0000-4000-8000-000000000002', 'venue_admin', true),
    (v_other_staff, v_other_venue, '0f510000-0000-4000-8000-000000000003', 'venue_admin', true);

  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, session_date, start_time, end_time,
    price_sek, capacity, publish_status
  ) VALUES (
    v_session, v_venue, 'Staffed Open Play', 'open_play', current_date,
    '18:00', '20:00', 165, 8, 'published'
  );

  IF (SELECT requires_staffing FROM public.activity_sessions WHERE id = v_session) THEN
    RAISE EXCEPTION 'Activity staffing default must remain false';
  END IF;

  UPDATE public.activity_sessions SET requires_staffing = true WHERE id = v_session;
  IF NOT (SELECT requires_staffing FROM public.activity_sessions WHERE id = v_session) THEN
    RAISE EXCEPTION 'Explicit staffing requirement did not persist';
  END IF;

  INSERT INTO public.operational_staff_assignments (
    venue_id, source_type, source_id, occurrence_date, venue_staff_id, role, created_by
  ) VALUES (
    v_venue, 'activity_session', v_session, current_date, v_staff, 'host',
    '0f510000-0000-4000-8000-000000000001'
  ) RETURNING id INTO v_assignment;

  BEGIN
    INSERT INTO public.operational_staff_assignments (
      venue_id, source_type, source_id, occurrence_date, venue_staff_id, role
    ) VALUES (v_venue, 'activity_session', v_session, current_date, v_staff, 'host');
    RAISE EXCEPTION 'Duplicate active assignment accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.operational_staff_assignments (
      venue_id, source_type, source_id, occurrence_date, venue_staff_id, role
    ) VALUES (v_venue, 'activity_session', v_session, current_date, v_other_staff, 'service');
    RAISE EXCEPTION 'Cross-venue staff assignment accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-venue staff assignment accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%operational_staff_must_belong_to_venue%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.operational_staff_assignments (
      venue_id, source_type, source_id, occurrence_date, venue_staff_id, role
    ) VALUES (v_venue, 'activity_session', gen_random_uuid(), current_date, v_staff, 'service');
    RAISE EXCEPTION 'Non-canonical staffing source accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Non-canonical staffing source accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%operational_staff_source_occurrence_not_found%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.operational_staff_assignments (
      venue_id, source_type, source_id, occurrence_date, venue_staff_id, role
    ) VALUES (v_venue, 'activity_session', v_session, current_date + 1, v_staff, 'service');
    RAISE EXCEPTION 'Wrong occurrence date accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Wrong occurrence date accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%operational_staff_source_occurrence_not_found%' THEN RAISE; END IF;
  END;

  UPDATE public.operational_staff_assignments SET status = 'cancelled' WHERE id = v_assignment;
  INSERT INTO public.operational_staff_assignments (
    venue_id, source_type, source_id, occurrence_date, venue_staff_id, role
  ) VALUES (v_venue, 'activity_session', v_session, current_date, v_staff, 'host');

  IF (
    SELECT count(*)
    FROM public.operational_staff_assignments
    WHERE venue_id = v_venue
      AND source_type = 'activity_session'
      AND source_id = v_session
      AND occurrence_date = current_date
      AND status = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'Active staffing identity is not idempotent';
  END IF;
END $$;

ROLLBACK;
