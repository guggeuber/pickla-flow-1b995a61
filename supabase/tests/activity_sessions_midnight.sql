\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Activity Midnight Test', 'activity-midnight-test');

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Activity Midnight Test Venue', 'activity-midnight-test-venue');

INSERT INTO public.activity_sessions (
  venue_id, name, recurrence_days, start_time, end_time
)
SELECT
  'a1000000-0000-4000-8000-000000000002',
  'Midnight ' || start_time,
  ARRAY[5],
  start_time::time,
  '00:00'::time
FROM unnest(ARRAY['16:00', '16:30', '18:00', '23:00', '23:30']) AS start_time;

INSERT INTO public.activity_sessions (venue_id, name, recurrence_days, start_time, end_time)
VALUES
  ('a1000000-0000-4000-8000-000000000002', 'Normal 23:59', ARRAY[5], '16:00', '23:59'),
  ('a1000000-0000-4000-8000-000000000002', 'Normal 22:00', ARRAY[5], '16:00', '22:00');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.activity_sessions (venue_id, name, recurrence_days, start_time, end_time)
    VALUES ('a1000000-0000-4000-8000-000000000002', 'Invalid equal', ARRAY[5], '16:00', '16:00');
    RAISE EXCEPTION 'equal activity time was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.activity_sessions (venue_id, name, recurrence_days, start_time, end_time)
    VALUES ('a1000000-0000-4000-8000-000000000002', 'Invalid overnight', ARRAY[5], '18:00', '17:00');
    RAISE EXCEPTION 'unrestricted overnight activity was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  v_midnight_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_midnight_count
  FROM public.activity_sessions
  WHERE venue_id = 'a1000000-0000-4000-8000-000000000002'
    AND end_time = '00:00'::time;
  IF v_midnight_count <> 5 THEN
    RAISE EXCEPTION 'expected five valid midnight sessions, got %', v_midnight_count;
  END IF;
END $$;

ROLLBACK;
