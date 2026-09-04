\set ON_ERROR_STOP on
BEGIN;
SELECT plan(1);

INSERT INTO public.organizations (id, name, slug)
VALUES ('5cc00000-0000-4000-8000-000000000001', 'Social Context Test', 'social-context-test');

INSERT INTO public.venues (id, organization_id, name, slug, is_public)
VALUES ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000001', 'Social Venue', 'social-venue', true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('5cc00000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'caller@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'anna@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'hidden@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'first@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'outsider@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'guest-claim@social.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('5cc00000-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'unverified@social.test', '', NULL, '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- The production auth trigger creates canonical Person/profile rows. Replace
-- those test-only rows with stable fixture IDs before adding Participation.
DELETE FROM public.customer_identities
WHERE provider = 'auth'
  AND provider_id IN (
    '5cc00000-0000-4000-8000-000000000010',
    '5cc00000-0000-4000-8000-000000000011',
    '5cc00000-0000-4000-8000-000000000012',
    '5cc00000-0000-4000-8000-000000000013',
    '5cc00000-0000-4000-8000-000000000014',
    '5cc00000-0000-4000-8000-000000000015'
  );
DELETE FROM public.player_profiles
WHERE auth_user_id IN (
  '5cc00000-0000-4000-8000-000000000010',
  '5cc00000-0000-4000-8000-000000000011',
  '5cc00000-0000-4000-8000-000000000012',
  '5cc00000-0000-4000-8000-000000000013',
  '5cc00000-0000-4000-8000-000000000014',
  '5cc00000-0000-4000-8000-000000000015'
);
DELETE FROM public.customers
WHERE auth_user_id IN (
  '5cc00000-0000-4000-8000-000000000010',
  '5cc00000-0000-4000-8000-000000000011',
  '5cc00000-0000-4000-8000-000000000012',
  '5cc00000-0000-4000-8000-000000000013',
  '5cc00000-0000-4000-8000-000000000014',
  '5cc00000-0000-4000-8000-000000000015'
);

INSERT INTO public.customers (
  id, organization_id, auth_user_id, display_name, first_name, last_name,
  primary_email, email_normalized, social_visibility
) VALUES
  ('5cc00000-0000-4000-8000-000000000020', '5cc00000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000010', 'Carl Caller', 'Carl', 'Caller', 'caller@social.test', 'caller@social.test', 'visible'),
  ('5cc00000-0000-4000-8000-000000000021', '5cc00000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000011', 'Anna Svensson', 'Anna', 'Svensson', 'anna@social.test', 'anna@social.test', 'visible'),
  ('5cc00000-0000-4000-8000-000000000022', '5cc00000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000012', 'Henrik Hemlig', 'Henrik', 'Hemlig', 'hidden@social.test', 'hidden@social.test', 'hidden'),
  ('5cc00000-0000-4000-8000-000000000023', '5cc00000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000013', 'Fiona Första', 'Fiona', 'Första', 'first@social.test', 'first@social.test', 'visible'),
  ('5cc00000-0000-4000-8000-000000000024', '5cc00000-0000-4000-8000-000000000001', '5cc00000-0000-4000-8000-000000000014', 'Olle Outsider', 'Olle', 'Outsider', 'outsider@social.test', 'outsider@social.test', 'visible'),
  ('5cc00000-0000-4000-8000-000000000025', '5cc00000-0000-4000-8000-000000000001', NULL, 'Guest Before Claim', 'Guest', 'Before', 'guest-claim@social.test', 'guest-claim@social.test', 'visible');

INSERT INTO public.player_profiles (auth_user_id, customer_id, display_name, first_name, last_name, avatar_url)
VALUES
  ('5cc00000-0000-4000-8000-000000000010', '5cc00000-0000-4000-8000-000000000020', 'Carl Caller', 'Carl', 'Caller', 'https://images.example.test/carl.jpg'),
  ('5cc00000-0000-4000-8000-000000000011', '5cc00000-0000-4000-8000-000000000021', 'Anna Svensson', 'Anna', 'Svensson', 'https://images.example.test/anna.jpg'),
  ('5cc00000-0000-4000-8000-000000000012', '5cc00000-0000-4000-8000-000000000022', 'Henrik Hemlig', 'Henrik', 'Hemlig', 'https://images.example.test/hidden.jpg'),
  ('5cc00000-0000-4000-8000-000000000013', '5cc00000-0000-4000-8000-000000000023', 'Fiona Första', 'Fiona', 'Första', 'https://images.example.test/fiona.jpg');

INSERT INTO public.dependent_participants (
  id, organization_id, guardian_customer_id, first_name, birth_year
) VALUES (
  '5cc00000-0000-4000-8000-000000000026', '5cc00000-0000-4000-8000-000000000001',
  '5cc00000-0000-4000-8000-000000000020', 'Child Secret', 2017
);

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, session_date, start_time, end_time,
  price_sek, capacity, publish_status, closed_to_public, is_active
) VALUES
  ('5cc00000-0000-4000-8000-000000000030', '5cc00000-0000-4000-8000-000000000002', 'Earlier Shared', 'open_play', '2026-08-01', '18:00', '20:00', 165, 20, 'published', false, true),
  ('5cc00000-0000-4000-8000-000000000031', '5cc00000-0000-4000-8000-000000000002', 'Public Target', 'open_play', '2026-09-10', '18:00', '20:00', 165, 20, 'published', false, true),
  ('5cc00000-0000-4000-8000-000000000032', '5cc00000-0000-4000-8000-000000000002', 'Private Target', 'course', '2026-09-11', '18:00', '20:00', 0, 20, 'published', true, true),
  ('5cc00000-0000-4000-8000-000000000033', '5cc00000-0000-4000-8000-000000000002', 'Completed Target', 'open_play', '2026-08-20', '18:00', '20:00', 165, 20, 'published', false, true);

INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, customer_id,
  dependent_participant_id, status, price_paid_sek, source_type, role
) VALUES
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000030', '2026-08-01', '5cc00000-0000-4000-8000-000000000010', '5cc00000-0000-4000-8000-000000000020', NULL, 'attended', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000030', '2026-08-01', '5cc00000-0000-4000-8000-000000000011', '5cc00000-0000-4000-8000-000000000021', NULL, 'checked_in', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000031', '2026-09-10', '5cc00000-0000-4000-8000-000000000010', '5cc00000-0000-4000-8000-000000000020', NULL, 'confirmed', 165, 'commerce_order', 'participant'),
  -- The owner/payer auth UUID intentionally differs from the participant Person.
  -- Social identity must resolve Anna from customer_id, never Olle from user_id.
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000031', '2026-09-10', '5cc00000-0000-4000-8000-000000000014', '5cc00000-0000-4000-8000-000000000021', NULL, 'confirmed', 0, 'playing_host', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000031', '2026-09-10', '5cc00000-0000-4000-8000-000000000012', '5cc00000-0000-4000-8000-000000000022', NULL, 'confirmed', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000031', '2026-09-10', '5cc00000-0000-4000-8000-000000000013', '5cc00000-0000-4000-8000-000000000023', NULL, 'confirmed', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000031', '2026-09-10', NULL, NULL, '5cc00000-0000-4000-8000-000000000026', 'confirmed', 0, 'series_commitment', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000032', '2026-09-11', '5cc00000-0000-4000-8000-000000000010', '5cc00000-0000-4000-8000-000000000020', NULL, 'confirmed', 0, 'series_commitment', 'participant'),
  -- Paying for Anna must not make Olle a participant in this private Session.
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000032', '2026-09-11', '5cc00000-0000-4000-8000-000000000014', '5cc00000-0000-4000-8000-000000000021', NULL, 'confirmed', 0, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000033', '2026-08-20', '5cc00000-0000-4000-8000-000000000010', '5cc00000-0000-4000-8000-000000000020', NULL, 'checked_in', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000033', '2026-08-20', '5cc00000-0000-4000-8000-000000000011', '5cc00000-0000-4000-8000-000000000021', NULL, 'attended', 165, 'commerce_order', 'participant'),
  ('5cc00000-0000-4000-8000-000000000002', '5cc00000-0000-4000-8000-000000000033', '2026-08-20', '5cc00000-0000-4000-8000-000000000012', '5cc00000-0000-4000-8000-000000000022', NULL, 'attended', 165, 'commerce_order', 'participant');

DO $$
BEGIN
  IF (SELECT social_visibility FROM public.customers WHERE id = '5cc00000-0000-4000-8000-000000000025') <> 'hidden' THEN
    RAISE EXCEPTION 'auth-less R1B guest was not forced hidden';
  END IF;
  UPDATE public.customers
  SET auth_user_id = '5cc00000-0000-4000-8000-000000000015'
  WHERE id = '5cc00000-0000-4000-8000-000000000025';
  IF (SELECT social_visibility FROM public.customers WHERE id = '5cc00000-0000-4000-8000-000000000025') <> 'visible' THEN
    RAISE EXCEPTION 'canonical guest claim did not default Person to visible';
  END IF;
  IF (SELECT role FROM public.session_registrations WHERE activity_session_id = '5cc00000-0000-4000-8000-000000000031' AND customer_id = '5cc00000-0000-4000-8000-000000000021') <> 'host' THEN
    RAISE EXCEPTION 'legacy playing-host participation was not normalized to host role';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE
  v_public JSONB;
BEGIN
  v_public := public.get_session_public_context('5cc00000-0000-4000-8000-000000000031');
  IF v_public->>'attendee_count' <> '5' OR v_public->>'host_present' <> 'true' THEN
    RAISE EXCEPTION 'anon public context incorrect: %', v_public;
  END IF;
  IF v_public ?| ARRAY['person_id', 'display_name', 'avatar_url', 'email', 'phone']
     OR v_public::TEXT ~* 'Anna|Henrik|images.example' THEN
    RAISE EXCEPTION 'public context leaked identity: %', v_public;
  END IF;
  IF public.get_session_public_context('5cc00000-0000-4000-8000-000000000032') IS NOT NULL THEN
    RAISE EXCEPTION 'non-public Session returned public context';
  END IF;
  IF has_function_privilege(current_user, 'public.get_session_social_context(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has social-context execute privilege';
  END IF;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '5cc00000-0000-4000-8000-000000000016', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_session_social_context('5cc00000-0000-4000-8000-000000000031');
    RAISE EXCEPTION 'unverified account unexpectedly received identity';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '5cc00000-0000-4000-8000-000000000010', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_social JSONB;
  v_private JSONB;
  v_history JSONB;
BEGIN
  v_social := public.get_session_social_context('5cc00000-0000-4000-8000-000000000031');
  IF v_social->>'attendee_count' <> '5'
     OR v_social->>'hidden_count' <> '2'
     OR v_social->>'shared_history_count' <> '1'
     OR v_social->>'first_visit_count' <> '1' THEN
    RAISE EXCEPTION 'authenticated social aggregates incorrect: %', v_social;
  END IF;
  IF jsonb_array_length(v_social->'attendees') <> 3
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_social->'attendees') AS attendee
       WHERE attendee->>'display_name' = 'Anna S.'
         AND attendee->>'is_host' = 'true'
         AND attendee->>'is_first_visit' = 'false'
         AND attendee->>'has_shared_session_history' = 'true'
     )
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_social->'attendees') AS attendee
       WHERE attendee->>'display_name' = 'Fiona F.'
         AND attendee->>'is_first_visit' = 'true'
         AND attendee->>'has_shared_session_history' = 'false'
     ) THEN
    RAISE EXCEPTION 'visible attendee projection incorrect: %', v_social;
  END IF;
  IF v_social::TEXT ~* 'Henrik|Hemlig|hidden.jpg|Child Secret|Olle|Outsider|5cc00000-0000-4000-8000-000000000022|5cc00000-0000-4000-8000-000000000024|5cc00000-0000-4000-8000-000000000026' THEN
    RAISE EXCEPTION 'payer/hidden/dependent identity leaked: %', v_social;
  END IF;

  v_private := public.get_session_social_context('5cc00000-0000-4000-8000-000000000032');
  IF v_private IS NULL THEN
    RAISE EXCEPTION 'participant could not read own non-public Session context';
  END IF;

  v_history := public.get_played_with('5cc00000-0000-4000-8000-000000000033');
  IF jsonb_array_length(v_history) <> 1
     OR v_history->0->>'display_name' <> 'Anna S.'
     OR v_history::TEXT ~* 'Henrik|hidden.jpg' THEN
    RAISE EXCEPTION 'played-with privacy/history projection incorrect: %', v_history;
  END IF;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '5cc00000-0000-4000-8000-000000000014', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.get_session_social_context('5cc00000-0000-4000-8000-000000000032') IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated non-participant read a non-public Session';
  END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_session_public_context(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_session_social_context(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_played_with(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_session_social_context_batch(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_public_activity_session_hosts(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_public_activity_session_hosts(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_session_social_context(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_played_with(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Session social-context grants are incorrect';
  END IF;
END $$;

SELECT pass('session social context security and derivation contract');
SELECT * FROM finish();
ROLLBACK;
