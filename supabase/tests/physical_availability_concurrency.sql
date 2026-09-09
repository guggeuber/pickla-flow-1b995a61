\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

DROP TABLE IF EXISTS public.physical_claim_test_results;
CREATE TABLE public.physical_claim_test_results (
  case_name TEXT NOT NULL,
  contender TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  error_message TEXT,
  PRIMARY KEY (case_name, contender)
);

DELETE FROM public.bookings WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.activity_sessions WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.event_resource_blocks WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.event_resource_catalog WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.opening_hours WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.venue_courts WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.venues WHERE id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.organizations WHERE id = 'fa120000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'fa120000-0000-4000-8000-000000000031';

INSERT INTO public.organizations (id, name, slug)
VALUES ('fa120000-0000-4000-8000-000000000001', 'Physical Concurrency', 'physical-concurrency');
INSERT INTO public.venues (id, organization_id, name, slug, timezone)
VALUES ('fa120000-0000-4000-8000-000000000011', 'fa120000-0000-4000-8000-000000000001', 'Physical Concurrency', 'physical-concurrency', 'Europe/Stockholm');
INSERT INTO public.venue_courts (id, venue_id, name, court_number, sport_type, hourly_rate, is_available)
VALUES
  ('fa120000-0000-4000-8000-000000000021', 'fa120000-0000-4000-8000-000000000011', 'C1', 1, 'pickleball', 350, true),
  ('fa120000-0000-4000-8000-000000000022', 'fa120000-0000-4000-8000-000000000011', 'C2', 2, 'pickleball', 350, true),
  ('fa120000-0000-4000-8000-000000000023', 'fa120000-0000-4000-8000-000000000011', 'C3', 3, 'pickleball', 350, true);
INSERT INTO public.event_resource_catalog (id, venue_id, resource_type, name, venue_court_id, is_bookable, is_active)
VALUES ('fa120000-0000-4000-8000-000000000041', 'fa120000-0000-4000-8000-000000000011', 'court', 'C3', 'fa120000-0000-4000-8000-000000000023', true, true);
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'fa120000-0000-4000-8000-000000000031', 'authenticated', 'authenticated',
  'physical-concurrency@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

CREATE OR REPLACE FUNCTION public.run_physical_booking_claim(p_case TEXT, p_contender TEXT, p_court UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.claim_physical_bookings(
      'fa120000-0000-4000-8000-000000000011',
      jsonb_build_array(jsonb_build_object(
        'venue_id', 'fa120000-0000-4000-8000-000000000011',
        'venue_court_id', p_court,
        'user_id', 'fa120000-0000-4000-8000-000000000031',
        'start_time', p_start, 'end_time', p_end,
        'booking_ref', p_case || '-' || p_contender
      ))
    );
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
  PERFORM pg_sleep(0.4);
END $$;

CREATE OR REPLACE FUNCTION public.run_physical_activity_claim(p_case TEXT, p_contender TEXT, p_court UUID, p_date DATE, p_start TIME, p_end TIME)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, session_date, start_time, end_time,
      court_ids, is_active, publish_status
    ) VALUES (
      'fa120000-0000-4000-8000-000000000011', p_case || '-' || p_contender,
      'open_play', 'pickleball', p_date, p_start, p_end, ARRAY[p_court], true, 'published'
    );
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
  PERFORM pg_sleep(0.4);
END $$;

CREATE OR REPLACE FUNCTION public.run_physical_block_claim(p_case TEXT, p_contender TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.claim_physical_resource_blocks(
      'fa120000-0000-4000-8000-000000000011',
      jsonb_build_array(jsonb_build_object(
        'venue_id', 'fa120000-0000-4000-8000-000000000011',
        'resource_catalog_id', 'fa120000-0000-4000-8000-000000000041',
        'title', p_case || '-' || p_contender, 'reason', 'event', 'status', 'confirmed',
        'starts_at', p_start, 'ends_at', p_end, 'blocks_public_booking', true,
        'metadata', jsonb_build_object('venue_court_id', 'fa120000-0000-4000-8000-000000000023')
      ))
    );
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.physical_claim_test_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
  PERFORM pg_sleep(0.4);
END $$;

SELECT dblink_connect('physical_booking_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('physical_booking_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('physical_booking_1', $$SELECT public.run_physical_booking_claim('booking-v-booking','a','fa120000-0000-4000-8000-000000000021','2031-01-06 09:00Z','2031-01-06 10:00Z')$$);
SELECT dblink_send_query('physical_booking_2', $$SELECT public.run_physical_booking_claim('booking-v-booking','b','fa120000-0000-4000-8000-000000000021','2031-01-06 09:00Z','2031-01-06 10:00Z')$$);
SELECT * FROM dblink_get_result('physical_booking_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('physical_booking_2') AS result(done TEXT);
SELECT dblink_disconnect('physical_booking_1');
SELECT dblink_disconnect('physical_booking_2');

SELECT dblink_connect('physical_mixed_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('physical_mixed_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('physical_mixed_1', $$SELECT public.run_physical_booking_claim('booking-v-activity','booking','fa120000-0000-4000-8000-000000000022','2031-01-06 11:00Z','2031-01-06 12:00Z')$$);
SELECT dblink_send_query('physical_mixed_2', $$SELECT public.run_physical_activity_claim('booking-v-activity','activity','fa120000-0000-4000-8000-000000000022','2031-01-06','12:00','13:00')$$);
SELECT * FROM dblink_get_result('physical_mixed_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('physical_mixed_2') AS result(done TEXT);
SELECT dblink_disconnect('physical_mixed_1');
SELECT dblink_disconnect('physical_mixed_2');

SELECT dblink_connect('physical_block_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('physical_block_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('physical_block_1', $$SELECT public.run_physical_booking_claim('booking-v-block','booking','fa120000-0000-4000-8000-000000000023','2031-01-06 13:00Z','2031-01-06 14:00Z')$$);
SELECT dblink_send_query('physical_block_2', $$SELECT public.run_physical_block_claim('booking-v-block','block','2031-01-06 13:00Z','2031-01-06 14:00Z')$$);
SELECT * FROM dblink_get_result('physical_block_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('physical_block_2') AS result(done TEXT);
SELECT dblink_disconnect('physical_block_1');
SELECT dblink_disconnect('physical_block_2');

SELECT dblink_connect('physical_adjacent_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('physical_adjacent_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('physical_adjacent_1', $$SELECT public.run_physical_booking_claim('adjacent','a','fa120000-0000-4000-8000-000000000021','2031-01-06 15:00Z','2031-01-06 16:00Z')$$);
SELECT dblink_send_query('physical_adjacent_2', $$SELECT public.run_physical_booking_claim('adjacent','b','fa120000-0000-4000-8000-000000000021','2031-01-06 16:00Z','2031-01-06 17:00Z')$$);
SELECT * FROM dblink_get_result('physical_adjacent_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('physical_adjacent_2') AS result(done TEXT);
SELECT dblink_disconnect('physical_adjacent_1');
SELECT dblink_disconnect('physical_adjacent_2');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.physical_claim_test_results WHERE case_name = 'booking-v-booking' AND ok) <> 1
     OR (SELECT count(*) FROM public.physical_claim_test_results WHERE case_name = 'booking-v-activity' AND ok) <> 1
     OR (SELECT count(*) FROM public.physical_claim_test_results WHERE case_name = 'booking-v-block' AND ok) <> 1
     OR (SELECT count(*) FROM public.physical_claim_test_results WHERE case_name = 'adjacent' AND ok) <> 2 THEN
    RAISE EXCEPTION 'physical concurrency invariant failed: %',
      (SELECT jsonb_agg(to_jsonb(result) ORDER BY case_name, contender) FROM public.physical_claim_test_results result);
  END IF;
END $$;

SELECT * FROM public.physical_claim_test_results ORDER BY case_name, contender;

DROP FUNCTION public.run_physical_booking_claim(TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION public.run_physical_activity_claim(TEXT, TEXT, UUID, DATE, TIME, TIME);
DROP FUNCTION public.run_physical_block_claim(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP TABLE public.physical_claim_test_results;
DELETE FROM public.bookings WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.activity_sessions WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.event_resource_blocks WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.event_resource_catalog WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.venue_courts WHERE venue_id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.venues WHERE id = 'fa120000-0000-4000-8000-000000000011';
DELETE FROM public.organizations WHERE id = 'fa120000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'fa120000-0000-4000-8000-000000000031';
