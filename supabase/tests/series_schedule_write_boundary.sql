\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('b2100000-0000-4000-8000-000000000001', 'Boundary Test', 'boundary-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES ('b2100000-0000-4000-8000-000000000002', 'b2100000-0000-4000-8000-000000000001', 'Boundary Venue', 'boundary-venue', true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'b2100000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'boundary-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('b2100000-0000-4000-8000-000000000003', 'b2100000-0000-4000-8000-000000000002', 'venue_admin', true);

INSERT INTO public.activity_formats (
  id, organization_id, name, description, age_group, level, requires_instructor
) VALUES (
  'b2100000-0000-4000-8000-000000000010', 'b2100000-0000-4000-8000-000000000001',
  'Managed Event', 'Identity-led fixture', 'adult', 'intro', false
);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek, commerce_kind,
  fulfillment_type, fulfillment_presentation, commerce_enabled, status
) VALUES (
  'b2100000-0000-4000-8000-000000000011', 'b2100000-0000-4000-8000-000000000002',
  'managed_event_fixture', 'Managed Event', 'series_access', 199,
  'participation', 'participation', 'participation', true, 'active'
);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id,
  product_key, start_date, end_date, total_sessions, capacity,
  recurrence_days, start_time, end_time, court_ids
) VALUES
  (
    'b2100000-0000-4000-8000-000000000012', 'b2100000-0000-4000-8000-000000000002',
    'b2100000-0000-4000-8000-000000000010', 'Managed Event Run', 'course', 'active',
    'b2100000-0000-4000-8000-000000000011', 'managed_event_fixture',
    '2026-12-01', '2026-12-01', 1, 12, ARRAY[2], '18:00', '19:00', '{}'::UUID[]
  ),
  (
    'b2100000-0000-4000-8000-000000000013', 'b2100000-0000-4000-8000-000000000002',
    NULL, 'Open Play Schedule Group', 'program', 'active', NULL, 'open_play_slot',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::UUID[]
  );

INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, sport_type, session_date,
  start_time, end_time, price_sek, capacity, access_policy, is_active,
  publish_status, closed_to_public, series_occurrence_index
) VALUES
  (
    'b2100000-0000-4000-8000-000000000014', 'b2100000-0000-4000-8000-000000000002',
    'b2100000-0000-4000-8000-000000000012', 'Managed Event Run', 'course', 'pickleball',
    '2026-12-01', '18:00', '19:00', 0, 12, '{"series_commitment_required":true}',
    true, 'published', true, 1
  ),
  (
    'b2100000-0000-4000-8000-000000000015', 'b2100000-0000-4000-8000-000000000002',
    'b2100000-0000-4000-8000-000000000013', 'Open Play', 'open_play', 'pickleball',
    '2026-12-01', '20:00', '22:00', 165, 16, '{}', true, 'published', false, NULL
  );

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.activity_series', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.activity_sessions', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.access_products', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated browser role retained a direct schedule/product write grant';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.activity_series', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.activity_sessions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.access_products', 'SELECT') THEN
    RAISE EXCEPTION 'read projections lost required table access';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.activity_series', 'INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role', 'public.activity_sessions', 'INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role', 'public.access_products', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'canonical server role lost write capability';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2100000-0000-4000-8000-000000000003', true);

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.activity_series WHERE venue_id = 'b2100000-0000-4000-8000-000000000002') <> 2 THEN
    RAISE EXCEPTION 'one-schedule read projection no longer exposes both ownership modes';
  END IF;

  BEGIN
    UPDATE public.activity_series SET capacity = 99
    WHERE id = 'b2100000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'managed Series was directly mutable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.activity_sessions SET closed_to_public = false, series_occurrence_index = 99
    WHERE id = 'b2100000-0000-4000-8000-000000000014';
    RAISE EXCEPTION 'generated Session truth was directly mutable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.access_products SET base_price_sek = 1
    WHERE id = 'b2100000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'managed Series product was directly mutable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.activity_series SET name = 'Bypass'
    WHERE id = 'b2100000-0000-4000-8000-000000000013';
    RAISE EXCEPTION 'generic schedule group bypassed its API boundary';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('activity_series', 'activity_sessions', 'access_products')
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles && ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'a direct authenticated write policy survived the boundary migration';
  END IF;

  IF (SELECT capacity FROM public.activity_series WHERE id = 'b2100000-0000-4000-8000-000000000012') <> 12
     OR (SELECT closed_to_public FROM public.activity_sessions WHERE id = 'b2100000-0000-4000-8000-000000000014') <> true
     OR (SELECT base_price_sek FROM public.access_products WHERE id = 'b2100000-0000-4000-8000-000000000011') <> 199 THEN
    RAISE EXCEPTION 'a rejected direct write changed canonical managed-Series truth';
  END IF;
END $$;

ROLLBACK;
