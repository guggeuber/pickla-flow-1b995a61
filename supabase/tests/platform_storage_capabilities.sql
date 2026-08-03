\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'event-logos'
      AND public
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']::text[]
  ) THEN
    RAISE EXCEPTION 'event-logos bucket configuration is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'event-offers'
      AND NOT public
      AND file_size_limit = 10485760
      AND allowed_mime_types = ARRAY['application/pdf']::text[]
  ) THEN
    RAISE EXCEPTION 'event-offers bucket configuration is incorrect';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Public can read event logos',
        'Venue admins can upload event logos',
        'Venue admins can update event logos',
        'Venue admins can delete event logos'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'event-logo policies are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (qual ILIKE '%event-offers%' OR with_check ILIKE '%event-offers%')
  ) THEN
    RAISE EXCEPTION 'event-offers must not have client storage policies';
  END IF;
END $$;

-- The baseline auth-user trigger intentionally refuses to infer an identity
-- scope unless the canonical Pickla organization exists. Seed only that
-- prerequisite so this policy test also runs on a no-seed baseline clone.
INSERT INTO public.organizations (id, name, slug)
VALUES ('90000000-0000-4000-8000-000000000000', 'Pickla Test', 'pickla')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organizations (id, name, slug)
VALUES ('90000000-0000-4000-8000-000000000001', 'Storage Test Org', 'storage-test-org');

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES
  ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'Storage Venue A', 'storage-venue-a'),
  ('90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'Storage Venue B', 'storage-venue-b');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('90000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'storage-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('90000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'storage-other@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('90000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'storage-super@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('90000000-0000-4000-8000-000000000009', '90000000-0000-4000-8000-000000000002', 'venue_admin', true);

INSERT INTO public.user_roles (user_id, role)
VALUES ('90000000-0000-4000-8000-000000000011', 'super_admin');

INSERT INTO public.events (id, venue_id, name, event_type, format)
VALUES
  ('90000000-0000-4000-8000-000000000020', '90000000-0000-4000-8000-000000000002', 'Venue A Event', 'tournament', 'round_robin'),
  ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000003', 'Venue B Event', 'tournament', 'round_robin');

INSERT INTO public.event_templates (id, name, event_type, format)
VALUES ('90000000-0000-4000-8000-000000000030', 'Global Template', 'tournament', 'round_robin');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000009', true);

DO $$
BEGIN
  IF NOT public.can_manage_event_logo_object('categories/90000000-0000-4000-8000-000000000002/social.svg')
     OR NOT public.can_manage_event_logo_object('venue-home/90000000-0000-4000-8000-000000000002/hero.webp')
     OR NOT public.can_manage_event_logo_object('90000000-0000-4000-8000-000000000020/logo.png') THEN
    RAISE EXCEPTION 'venue admin was denied an owned canonical logo path';
  END IF;

  IF public.can_manage_event_logo_object('categories/90000000-0000-4000-8000-000000000003/social.svg')
     OR public.can_manage_event_logo_object('90000000-0000-4000-8000-000000000021/logo.png')
     OR public.can_manage_event_logo_object('templates/90000000-0000-4000-8000-000000000030/logo.svg')
     OR public.can_manage_event_logo_object('../escape.svg') THEN
    RAISE EXCEPTION 'venue admin crossed a venue/template/path boundary';
  END IF;

  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('event-logos', '90000000-0000-4000-8000-000000000020/logo.png', auth.uid()::text);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('event-logos', '90000000-0000-4000-8000-000000000021/logo.png', auth.uid()::text);
    RAISE EXCEPTION 'cross-venue storage insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('event-offers', '90000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000002/90000000-0000-4000-8000-000000000003/90000000-0000-4000-8000-000000000004.pdf', auth.uid()::text);
    RAISE EXCEPTION 'authenticated user wrote a private offer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000011', true);
DO $$
BEGIN
  IF NOT public.can_manage_event_logo_object('templates/90000000-0000-4000-8000-000000000030/logo.svg') THEN
    RAISE EXCEPTION 'super-admin was denied a canonical template logo';
  END IF;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF NOT public.is_canonical_event_offer_object_name(
    '90000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000002/90000000-0000-4000-8000-000000000003/90000000-0000-4000-8000-000000000004.pdf'
  ) OR public.is_canonical_event_offer_object_name(
    '90000000-0000-4000-8000-000000000002/90000000-0000-4000-8000-000000000003/90000000-0000-4000-8000-000000000004.pdf'
  ) THEN
    RAISE EXCEPTION 'event-offer path validator accepted an invalid hierarchy';
  END IF;
END $$;

ROLLBACK;
SELECT 'platform storage capability tests passed' AS result;
