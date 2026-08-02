-- Synthetic local bootstrap configuration.
--
-- This row is not copied from production and is never applied by `db push`.
-- public.handle_new_user() resolves the canonical organization by slug, so a
-- fresh local environment needs this configuration before testing real signup.
INSERT INTO public.organizations (id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Pickla Local',
  'pickla'
)
ON CONFLICT (slug) DO NOTHING;
