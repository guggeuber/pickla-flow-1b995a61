\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('fa110000-0000-4000-8000-000000000001', 'Physical Foundation A', 'physical-foundation-a'),
  ('fa110000-0000-4000-8000-000000000002', 'Physical Foundation B', 'physical-foundation-b');

INSERT INTO public.venues (id, organization_id, name, slug, timezone)
VALUES
  ('fa110000-0000-4000-8000-000000000011', 'fa110000-0000-4000-8000-000000000001', 'Physical A', 'physical-a', 'Europe/Stockholm'),
  ('fa110000-0000-4000-8000-000000000012', 'fa110000-0000-4000-8000-000000000002', 'Physical B', 'physical-b', 'Europe/Stockholm');

INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('fa110000-0000-4000-8000-000000000021', 'fa110000-0000-4000-8000-000000000011', 'A1', 1, 'pickleball', 350, true),
  ('fa110000-0000-4000-8000-000000000022', 'fa110000-0000-4000-8000-000000000011', 'A2', 2, 'pickleball', 350, true),
  ('fa110000-0000-4000-8000-000000000023', 'fa110000-0000-4000-8000-000000000011', 'A3', 3, 'pickleball', 350, false),
  ('fa110000-0000-4000-8000-000000000024', 'fa110000-0000-4000-8000-000000000012', 'B1', 1, 'pickleball', 350, true);

INSERT INTO public.opening_hours (venue_id, day_of_week, open_time, close_time, is_closed)
SELECT 'fa110000-0000-4000-8000-000000000011', day, '06:00', '04:00', day = 2
FROM generate_series(0, 6) day;
INSERT INTO public.opening_hours (venue_id, day_of_week, open_time, close_time, is_closed)
SELECT 'fa110000-0000-4000-8000-000000000012', day, '06:00', '04:00', false
FROM generate_series(0, 6) day;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'fa110000-0000-4000-8000-000000000031', 'authenticated', 'authenticated',
  'physical-foundation@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011',
    ARRAY['fa110000-0000-4000-8000-000000000021'::UUID],
    '2030-04-01 08:00:00Z', '2030-04-01 09:00:00Z'
  );
  IF NOT (v_result->>'available')::BOOLEAN OR v_result->>'interval_semantics' <> '[start,end)' THEN
    RAISE EXCEPTION 'empty canonical decision was not available: %', v_result;
  END IF;

  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011',
    ARRAY['fa110000-0000-4000-8000-000000000023'::UUID],
    '2030-04-01 08:00:00Z', '2030-04-01 09:00:00Z'
  );
  IF v_result->'conflicts'->0->>'type' <> 'court_unavailable' THEN
    RAISE EXCEPTION 'inactive court was not denied: %', v_result;
  END IF;

  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011',
    ARRAY['fa110000-0000-4000-8000-000000000024'::UUID],
    '2030-04-01 08:00:00Z', '2030-04-01 09:00:00Z'
  );
  IF v_result->'conflicts'->0->>'type' <> 'court_unavailable' THEN
    RAISE EXCEPTION 'cross-venue court was not denied: %', v_result;
  END IF;

  -- Tuesday is explicitly closed.
  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011',
    ARRAY['fa110000-0000-4000-8000-000000000021'::UUID],
    '2030-04-02 08:00:00Z', '2030-04-02 09:00:00Z'
  );
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'conflicts') c WHERE c->>'type' = 'venue_closed') THEN
    RAISE EXCEPTION 'closed operating day was not denied: %', v_result;
  END IF;
END $$;

SELECT * FROM public.claim_physical_bookings(
  'fa110000-0000-4000-8000-000000000011',
  jsonb_build_array(jsonb_build_object(
    'venue_id', 'fa110000-0000-4000-8000-000000000011',
    'venue_court_id', 'fa110000-0000-4000-8000-000000000021',
    'user_id', 'fa110000-0000-4000-8000-000000000031',
    'booked_by', 'fa110000-0000-4000-8000-000000000031',
    'start_time', '2030-04-01 08:00:00Z',
    'end_time', '2030-04-01 09:00:00Z',
    'status', 'confirmed',
    'total_price', 350,
    'notes', 'Sensitive Person | +46700000000 | private@example.test',
    'stripe_session_id', 'cs_private_test'
  ))
);

DO $$
DECLARE v_adjacent JSONB; v_overlap JSONB;
BEGIN
  v_adjacent := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000021'::UUID],
    '2030-04-01 09:00:00Z', '2030-04-01 10:00:00Z'
  );
  IF NOT (v_adjacent->>'available')::BOOLEAN THEN RAISE EXCEPTION 'adjacent half-open interval conflicted: %', v_adjacent; END IF;

  v_overlap := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000021'::UUID],
    '2030-04-01 08:59:00Z', '2030-04-01 10:00:00Z'
  );
  IF v_overlap->'conflicts'->0->>'type' <> 'booking' THEN RAISE EXCEPTION 'overlap did not conflict: %', v_overlap; END IF;
  IF v_overlap::TEXT LIKE '%Sensitive Person%' OR v_overlap::TEXT LIKE '%private@example.test%'
     OR v_overlap::TEXT LIKE '%+46700000000%' OR v_overlap::TEXT LIKE '%cs_private_test%' THEN
    RAISE EXCEPTION 'canonical conflict payload leaked customer/payment detail: %', v_overlap;
  END IF;

  UPDATE public.bookings SET start_time = '2030-04-01 08:15:00Z', end_time = '2030-04-01 09:00:00Z'
  WHERE stripe_session_id = 'cs_private_test';
END $$;

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, sport_type, session_date, start_time, end_time,
  court_ids, is_active, publish_status
) VALUES (
  'fa110000-0000-4000-8000-000000000041', 'fa110000-0000-4000-8000-000000000011',
  'Private activity title', 'open_play', 'pickleball', '2030-04-01', '12:00', '13:00',
  ARRAY['fa110000-0000-4000-8000-000000000021'::UUID], true, 'published'
);

DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000021'::UUID],
    '2030-04-01 10:30:00Z', '2030-04-01 11:30:00Z'
  );
  IF v_result->'conflicts'->0->>'type' <> 'activity_occurrence' OR v_result::TEXT LIKE '%Private activity title%' THEN
    RAISE EXCEPTION 'activity decision was wrong or unsafe: %', v_result;
  END IF;

  BEGIN
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, session_date, start_time, end_time,
      court_ids, is_active, publish_status
    ) VALUES (
      'fa110000-0000-4000-8000-000000000011', 'Activity collision', 'open_play', 'pickleball',
      '2030-04-01', '12:30', '13:30', ARRAY['fa110000-0000-4000-8000-000000000021'::UUID], true, 'published'
    );
    RAISE EXCEPTION 'activity-vs-activity collision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'activity-vs-activity collision was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, sport_type, recurrence_days, start_time, end_time,
  court_ids, is_active, publish_status
) VALUES (
  'fa110000-0000-4000-8000-000000000042', 'fa110000-0000-4000-8000-000000000011',
  'Recurring DST', 'open_play', 'pickleball', ARRAY[0], '01:30', '03:30',
  ARRAY['fa110000-0000-4000-8000-000000000022'::UUID], true, 'published'
);

DO $$
DECLARE v_before JSONB; v_after JSONB;
BEGIN
  -- 2030-03-31 is the Stockholm spring DST transition and a Sunday.
  v_before := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID],
    '2030-03-31 00:45:00Z', '2030-03-31 01:15:00Z'
  );
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_before->'conflicts') c WHERE c->>'type' = 'activity_occurrence') THEN
    RAISE EXCEPTION 'DST recurring occurrence was not expanded: %', v_before;
  END IF;

  INSERT INTO public.activity_session_overrides (
    venue_id, activity_session_id, session_date, status
  ) VALUES (
    'fa110000-0000-4000-8000-000000000011', 'fa110000-0000-4000-8000-000000000042', '2030-03-31', 'hidden'
  );
  v_after := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID],
    '2030-03-31 00:45:00Z', '2030-03-31 01:15:00Z'
  );
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'conflicts') c WHERE c->>'type' = 'activity_occurrence') THEN
    RAISE EXCEPTION 'hidden occurrence still occupied the court: %', v_after;
  END IF;
END $$;

INSERT INTO public.activity_series (
  id, venue_id, name, series_type, status, start_date, end_date,
  total_sessions, recurrence_days, start_time, end_time, court_ids
) VALUES
  (
    'fa110000-0000-4000-8000-000000000061', 'fa110000-0000-4000-8000-000000000011',
    'Late recurring owner', 'program', 'active', '2031-06-01', '2031-12-29',
    31, ARRAY[1], '18:00', '19:00', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID]
  ),
  (
    'fa110000-0000-4000-8000-000000000062', 'fa110000-0000-4000-8000-000000000011',
    'Long candidate series', 'program', 'draft', '2031-01-06', '2031-12-29',
    52, ARRAY[1], '18:30', '19:30', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID]
  );

INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, sport_type, recurrence_days,
  start_time, end_time, court_ids, is_active, publish_status
) VALUES (
  'fa110000-0000-4000-8000-000000000063', 'fa110000-0000-4000-8000-000000000011',
  'fa110000-0000-4000-8000-000000000061', 'Late recurring owner', 'program', 'pickleball', ARRAY[1],
  '18:00', '19:00', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID], true, 'published'
);

DO $$
DECLARE v_schedule JSONB;
BEGIN
  v_schedule := public.check_physical_activity_schedule(
    'fa110000-0000-4000-8000-000000000011',
    ARRAY['fa110000-0000-4000-8000-000000000022'::UUID],
    NULL, ARRAY[1], '18:30', '19:30',
    'fa110000-0000-4000-8000-000000000062', NULL
  );
  IF (v_schedule->>'available')::BOOLEAN
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_schedule->'occurrences') occurrence
       CROSS JOIN LATERAL jsonb_array_elements(occurrence->'conflicts') conflict
       WHERE conflict->>'type' = 'activity_occurrence'
         AND (occurrence->>'occurrence_date')::DATE >= '2031-06-01'
     ) THEN
    RAISE EXCEPTION 'late bounded recurring Activity conflict was missed: %', v_schedule;
  END IF;
END $$;

INSERT INTO public.event_resource_catalog (
  id, venue_id, resource_type, name, venue_court_id, is_bookable, is_active
) VALUES (
  'fa110000-0000-4000-8000-000000000051', 'fa110000-0000-4000-8000-000000000011',
  'court', 'A2 resource', 'fa110000-0000-4000-8000-000000000022', true, true
);

SELECT * FROM public.claim_physical_resource_blocks(
  'fa110000-0000-4000-8000-000000000011',
  jsonb_build_array(jsonb_build_object(
    'venue_id', 'fa110000-0000-4000-8000-000000000011',
    'resource_catalog_id', 'fa110000-0000-4000-8000-000000000051',
    'title', 'Private B2B title', 'reason', 'event', 'status', 'confirmed',
    'starts_at', '2030-04-01 13:00:00Z', 'ends_at', '2030-04-01 14:00:00Z',
    'blocks_public_booking', true,
    'metadata', jsonb_build_object('venue_court_id', 'fa110000-0000-4000-8000-000000000022')
  ))
);

DO $$
DECLARE v_result JSONB; v_before INTEGER;
BEGIN
  v_result := public.check_physical_availability(
    'fa110000-0000-4000-8000-000000000011', ARRAY['fa110000-0000-4000-8000-000000000022'::UUID],
    '2030-04-01 13:30:00Z', '2030-04-01 14:30:00Z'
  );
  IF v_result->'conflicts'->0->>'type' <> 'resource_block' OR v_result::TEXT LIKE '%Private B2B title%' THEN
    RAISE EXCEPTION 'resource block decision was wrong or unsafe: %', v_result;
  END IF;

  SELECT count(*) INTO v_before FROM public.bookings
  WHERE venue_id = 'fa110000-0000-4000-8000-000000000011'
    AND venue_court_id = 'fa110000-0000-4000-8000-000000000022'
    AND start_time = '2030-04-01 15:00:00Z';
  BEGIN
    PERFORM public.claim_physical_bookings(
      'fa110000-0000-4000-8000-000000000011',
      jsonb_build_array(
        jsonb_build_object(
          'venue_id', 'fa110000-0000-4000-8000-000000000011',
          'venue_court_id', 'fa110000-0000-4000-8000-000000000022',
          'user_id', 'fa110000-0000-4000-8000-000000000031',
          'start_time', '2030-04-01 15:00:00Z', 'end_time', '2030-04-01 16:00:00Z'
        ),
        jsonb_build_object(
          'venue_id', 'fa110000-0000-4000-8000-000000000011',
          'venue_court_id', 'fa110000-0000-4000-8000-000000000021',
          'user_id', 'fa110000-0000-4000-8000-000000000031',
          'start_time', '2030-04-01 08:30:00Z', 'end_time', '2030-04-01 09:30:00Z'
        )
      )
    );
    RAISE EXCEPTION 'conflicting multi-court claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting multi-court claim was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.bookings
      WHERE venue_id = 'fa110000-0000-4000-8000-000000000011'
        AND venue_court_id = 'fa110000-0000-4000-8000-000000000022'
        AND start_time = '2030-04-01 15:00:00Z') <> v_before THEN
    RAISE EXCEPTION 'multi-court loser left a partial booking';
  END IF;

  BEGIN
    PERFORM public.claim_physical_bookings(
      'fa110000-0000-4000-8000-000000000011',
      jsonb_build_array(jsonb_build_object(
        'venue_id', 'fa110000-0000-4000-8000-000000000011',
        'venue_court_id', 'fa110000-0000-4000-8000-000000000024',
        'user_id', 'fa110000-0000-4000-8000-000000000031',
        'start_time', '2030-04-01 15:00:00Z', 'end_time', '2030-04-01 16:00:00Z'
      ))
    );
    RAISE EXCEPTION 'cross-venue final claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-venue final claim was accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'physical_availability_conflict' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE v_preview RECORD;
BEGIN
  SELECT * INTO v_preview
  FROM public.preview_course_resource_schedule(
    'fa110000-0000-4000-8000-000000000011',
    '2030-04-01', '2030-04-01', ARRAY[1], '12:30', '13:30', 1,
    ARRAY['fa110000-0000-4000-8000-000000000021'::UUID]
  );
  IF v_preview.is_available OR v_preview.conflicts->0->>'type' <> 'activity_occurrence' THEN
    RAISE EXCEPTION 'Corporate/Course compatibility preview diverged: %', row_to_json(v_preview);
  END IF;
END $$;

ROLLBACK;
