-- Foundation Phase 1A: organization/franchise spine above venues.
-- This migration intentionally does not change membership, booking, check-in,
-- ledger, Stripe, event, or agent runtime behavior.

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  legal_name TEXT,
  org_number TEXT,
  default_currency TEXT NOT NULL DEFAULT 'SEK',
  default_country TEXT NOT NULL DEFAULT 'SE',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organizations_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE TABLE IF NOT EXISTS public.franchisees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  slug TEXT,
  org_number TEXT,
  stripe_account_id TEXT,
  payout_currency TEXT NOT NULL DEFAULT 'SEK',
  vat_rate NUMERIC NOT NULL DEFAULT 6,
  revenue_share_pct NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT franchisees_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT franchisees_revenue_share_check CHECK (revenue_share_pct >= 0 AND revenue_share_pct <= 100),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_role_check CHECK (role IN ('owner', 'admin', 'ops', 'finance', 'support')),
  UNIQUE (organization_id, user_id, role)
);

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS franchisee_id UUID REFERENCES public.franchisees(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_franchisees_organization
  ON public.franchisees (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_organization_members_org_user
  ON public.organization_members (organization_id, user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_venues_organization
  ON public.venues (organization_id);

CREATE INDEX IF NOT EXISTS idx_venues_franchisee
  ON public.venues (franchisee_id);

DROP TRIGGER IF EXISTS update_organizations_updated_at ON public.organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_franchisees_updated_at ON public.franchisees;
CREATE TRIGGER update_franchisees_updated_at
  BEFORE UPDATE ON public.franchisees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchisees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_organization_member(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = _user_id
      AND om.organization_id = _organization_id
      AND om.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_organization_admin(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = _user_id
      AND om.organization_id = _organization_id
      AND om.is_active = true
      AND om.role IN ('owner', 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_franchisee_member(_user_id UUID, _franchisee_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.franchisees f
    WHERE f.id = _franchisee_id
      AND public.is_organization_member(_user_id, f.organization_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_franchisee_admin(_user_id UUID, _franchisee_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.franchisees f
    WHERE f.id = _franchisee_id
      AND public.is_organization_admin(_user_id, f.organization_id)
  )
$$;

DO $$
DECLARE
  pickla_org_id UUID;
  first_party_franchisee_id UUID;
BEGIN
  INSERT INTO public.organizations (name, slug, legal_name, org_number, settings)
  VALUES (
    'Pickla',
    'pickla',
    'Pickla Solna AB',
    '556977-4481',
    '{"foundation_phase":"1a"}'::jsonb
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        legal_name = COALESCE(public.organizations.legal_name, EXCLUDED.legal_name),
        org_number = COALESCE(public.organizations.org_number, EXCLUDED.org_number),
        updated_at = now()
  RETURNING id INTO pickla_org_id;

  INSERT INTO public.franchisees (organization_id, legal_name, slug, org_number, metadata)
  VALUES (
    pickla_org_id,
    'Pickla Solna AB',
    'pickla-solna-ab',
    '556977-4481',
    '{"first_party":true,"foundation_phase":"1a"}'::jsonb
  )
  ON CONFLICT (organization_id, slug) DO UPDATE
    SET legal_name = EXCLUDED.legal_name,
        org_number = COALESCE(public.franchisees.org_number, EXCLUDED.org_number),
        updated_at = now()
  RETURNING id INTO first_party_franchisee_id;

  UPDATE public.venues
  SET organization_id = COALESCE(organization_id, pickla_org_id),
      franchisee_id = COALESCE(franchisee_id, first_party_franchisee_id),
      updated_at = now()
  WHERE organization_id IS NULL
     OR franchisee_id IS NULL;

  INSERT INTO public.organization_members (organization_id, user_id, role, metadata)
  SELECT DISTINCT pickla_org_id, ur.user_id, 'owner', '{"source":"user_roles.super_admin"}'::jsonb
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'
  ON CONFLICT (organization_id, user_id, role) DO NOTHING;

  INSERT INTO public.organization_members (organization_id, user_id, role, metadata)
  SELECT DISTINCT
    pickla_org_id,
    vs.user_id,
    CASE WHEN vs.role = 'venue_admin' THEN 'admin' ELSE 'ops' END,
    jsonb_build_object('source', 'venue_staff', 'venue_id', vs.venue_id, 'venue_role', vs.role::text)
  FROM public.venue_staff vs
  WHERE vs.is_active = true
  ON CONFLICT (organization_id, user_id, role) DO NOTHING;
END $$;

DROP POLICY IF EXISTS "organizations_staff_read" ON public.organizations;
CREATE POLICY "organizations_staff_read"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_organization_member(auth.uid(), id)
  );

DROP POLICY IF EXISTS "organizations_super_admin_write" ON public.organizations;
CREATE POLICY "organizations_super_admin_write"
  ON public.organizations
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "franchisees_staff_read" ON public.franchisees;
CREATE POLICY "franchisees_staff_read"
  ON public.franchisees
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_organization_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "franchisees_org_admin_write" ON public.franchisees;
CREATE POLICY "franchisees_org_admin_write"
  ON public.franchisees
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_organization_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_organization_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "organization_members_self_and_admin_read" ON public.organization_members;
CREATE POLICY "organization_members_self_and_admin_read"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR public.is_organization_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "organization_members_org_admin_write" ON public.organization_members;
CREATE POLICY "organization_members_org_admin_write"
  ON public.organization_members
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_organization_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_organization_admin(auth.uid(), organization_id)
  );
