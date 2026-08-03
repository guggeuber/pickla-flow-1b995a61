\set ON_ERROR_STOP on

INSERT INTO public.organizations (id, name, slug)
VALUES ('a0000000-0000-4000-8000-000000000000', 'Pickla Test', 'pickla')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organizations (id, name, slug)
VALUES ('a0000000-0000-4000-8000-000000000001', 'Logo Rehearsal Org', 'logo-rehearsal-org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES (
  '7ff6e5dc-f27a-473b-af4e-2b358340ab81',
  'a0000000-0000-4000-8000-000000000001',
  'Logo Rehearsal Venue',
  'logo-rehearsal-venue'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '90000000-0000-4000-8000-000000000009',
  'authenticated', 'authenticated', 'logo-rehearsal@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, venue_id, name, event_type, format, logo_url)
VALUES
  ('71a4ed74-ff8d-4fac-bf2f-15606c8ce456', '7ff6e5dc-f27a-473b-af4e-2b358340ab81', 'Pickla Open rehearsal', 'tournament', 'round_robin', 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/b669a0ab-0fa7-4005-9db3-0b4b1f23b130/logo.svg?t=1776343588543'),
  ('9e8a09cc-70e7-4429-ae6a-addb5d06d404', '7ff6e5dc-f27a-473b-af4e-2b358340ab81', 'Fredagsklubben rehearsal', 'tournament', 'round_robin', 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/82197c90-dc30-480b-9bce-b630ce4f22e0/logo.svg?t=1776343332276')
ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url;
INSERT INTO public.event_templates (id, name, event_type, format, logo_url, is_active)
VALUES
  ('82197c90-dc30-480b-9bce-b630ce4f22e0', 'Fredagsklubben rehearsal', 'tournament', 'round_robin', 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/82197c90-dc30-480b-9bce-b630ce4f22e0/logo.svg?t=1776343332276', true),
  ('b669a0ab-0fa7-4005-9db3-0b4b1f23b130', 'Pickla Open rehearsal', 'tournament', 'round_robin', 'https://cqnjpudmsreubgviqptg.supabase.co/storage/v1/object/public/event-logos/templates/b669a0ab-0fa7-4005-9db3-0b4b1f23b130/logo.svg?t=1776343588543', true)
ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url;
