-- Investor Content System: editable investor settings and assets.
-- Public pages read sanitized settings through api-investor; private memo content
-- is returned only after the existing token validation succeeds.

CREATE TABLE IF NOT EXISTS public.investor_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  round_name TEXT,
  round_label TEXT,
  company_name TEXT,
  company_org_number TEXT,
  headline TEXT,
  subheadline TEXT,
  public_thesis TEXT,
  memo_intro TEXT,
  round_size_sek INTEGER,
  valuation_sek INTEGER,
  share_price_sek INTEGER,
  shares_offered INTEGER,
  total_existing_shares INTEGER,
  minimum_shares INTEGER,
  minimum_investment_sek INTEGER,
  deadline_date DATE,
  allocation_date DATE,
  use_of_funds JSONB NOT NULL DEFAULT '[]'::jsonb,
  traction_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  team JSONB NOT NULL DEFAULT '[]'::jsonb,
  memo_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.investor_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT investor_assets_asset_type_check CHECK (
    asset_type IN ('logo', 'hero', 'venue_photo', 'dart_photo', 'product_screenshot', 'deck', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_investor_settings_active
  ON public.investor_settings (is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_investor_assets_active_type
  ON public.investor_assets (is_active, asset_type, sort_order);

DROP TRIGGER IF EXISTS trg_investor_settings_updated_at ON public.investor_settings;
CREATE TRIGGER trg_investor_settings_updated_at
  BEFORE UPDATE ON public.investor_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_investor_assets_updated_at ON public.investor_assets;
CREATE TRIGGER trg_investor_assets_updated_at
  BEFORE UPDATE ON public.investor_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.investor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investor_settings_super_admin_read" ON public.investor_settings;
CREATE POLICY "investor_settings_super_admin_read"
  ON public.investor_settings
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "investor_settings_super_admin_write" ON public.investor_settings;
CREATE POLICY "investor_settings_super_admin_write"
  ON public.investor_settings
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "investor_assets_public_active_read" ON public.investor_assets;
CREATE POLICY "investor_assets_public_active_read"
  ON public.investor_assets
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "investor_assets_super_admin_write" ON public.investor_assets;
CREATE POLICY "investor_assets_super_admin_write"
  ON public.investor_assets
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT SELECT ON public.investor_settings TO authenticated;
GRANT SELECT ON public.investor_assets TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.investor_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.investor_assets TO authenticated;
GRANT ALL ON public.investor_settings TO service_role;
GRANT ALL ON public.investor_assets TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'investor-assets',
  'investor-assets',
  true,
  20971520,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can read investor assets" ON storage.objects;
CREATE POLICY "Public can read investor assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'investor-assets');

DROP POLICY IF EXISTS "Super admin can upload investor assets" ON storage.objects;
CREATE POLICY "Super admin can upload investor assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'investor-assets'
  AND public.is_super_admin()
);

DROP POLICY IF EXISTS "Super admin can update investor assets" ON storage.objects;
CREATE POLICY "Super admin can update investor assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'investor-assets'
  AND public.is_super_admin()
)
WITH CHECK (
  bucket_id = 'investor-assets'
  AND public.is_super_admin()
);

DROP POLICY IF EXISTS "Super admin can delete investor assets" ON storage.objects;
CREATE POLICY "Super admin can delete investor assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'investor-assets'
  AND public.is_super_admin()
);

DO $$
DECLARE
  pickla_org_id UUID;
BEGIN
  SELECT id INTO pickla_org_id
  FROM public.organizations
  WHERE slug = 'pickla'
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.investor_settings WHERE is_active = true) THEN
    INSERT INTO public.investor_settings (
      organization_id,
      round_name,
      round_label,
      company_name,
      company_org_number,
      headline,
      subheadline,
      public_thesis,
      memo_intro,
      round_size_sek,
      valuation_sek,
      share_price_sek,
      shares_offered,
      total_existing_shares,
      minimum_shares,
      minimum_investment_sek,
      deadline_date,
      allocation_date,
      use_of_funds,
      traction_metrics,
      risks,
      team,
      memo_sections,
      is_active
    ) VALUES (
      pickla_org_id,
      'Pickla Solna 2026',
      'Seed · 2026',
      'Pickla Solna AB',
      '556977-4481',
      'The operating system for social sports communities.',
      'Pickla is building the operating layer for community-first racket sports, darts, events, F&B and AI-assisted venue operations.',
      'Pickla is building the operating system for social sports communities. Today that means Pickleball, Stockholm Dart Arena, events, F&B and community in one live venue. Tomorrow it expands through hosts, ambassadors, affiliates, playable resources and venues running on Pickla OS.',
      'This memo is shared privately with approved investors. It covers the company, round terms, traction, risks, use of funds and the operating system behind Pickla.',
      1250000,
      5000000,
      10000,
      125,
      500,
      5,
      50000,
      DATE '2026-07-01',
      DATE '2026-07-03',
      '[
        {"label":"Product and Pickla OS", "value":"Admin OS, Desk OS, Operations Truth, Customer 360, Revenue Ledger, Self Check-in and Event OS."},
        {"label":"Venue growth", "value":"Stockholm Dart Arena, events, F&B and community programming."},
        {"label":"Network model", "value":"Hosts, ambassadors, affiliates and partner venues."}
      ]'::jsonb,
      '[
        {"label":"Live venue", "value":"Pickleball, Stockholm Dart Arena, events and F&B under one roof."},
        {"label":"Pickla OS", "value":"Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS visibility and Event OS."},
        {"label":"Expansion surface", "value":"Hosts, ambassadors, affiliates, playable resources and AI-assisted operations."}
      ]'::jsonb,
      '[
        {"label":"Execution", "value":"Scaling venue operations and software in parallel requires discipline."},
        {"label":"Category timing", "value":"Social sports demand is strong but formats can shift quickly."},
        {"label":"Venue economics", "value":"Events, F&B, memberships and utilization must keep improving."}
      ]'::jsonb,
      '[
        {"name":"Gunnar Svalander", "role":"Founder / operator", "bio":"Runs the venue, customer relationships and Pickla OS direction."}
      ]'::jsonb,
      '[
        {"kicker":"01 · Vision", "title":"The operating system for social sports", "body":"Pickla is building the software and operating model for the next generation of social sports communities."},
        {"kicker":"02 · Today", "title":"Pickla Arena and Stockholm Dart Arena", "body":"The live venue combines pickleball, Stockholm Dart Arena, events, F&B and community into one operating system."},
        {"kicker":"03 · Product", "title":"Pickla OS", "body":"Admin OS, Desk OS, Customer 360, Operations Truth, Revenue Ledger, Self Check-in, Zettle/POS revenue visibility and Event OS are already visible in the product."},
        {"kicker":"04 · Future", "title":"Hosts, ambassadors, affiliates and venues", "body":"The future architecture is resource-first and AI-assisted, designed for distributed hosts, ambassadors, affiliates and venue partners."},
        {"kicker":"05 · Offer", "title":"Round terms", "body":"Pickla Solna AB offers up to 125 shares at 10,000 SEK per share, with a maximum round size of 1,250,000 SEK."}
      ]'::jsonb,
      true
    );
  END IF;
END $$;
