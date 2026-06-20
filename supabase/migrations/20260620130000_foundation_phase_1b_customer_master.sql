-- Foundation Phase 1B: customer master foundation.
-- This migration intentionally does not change runtime behavior. Existing
-- user_id-based booking, check-in, membership, ledger, and Customer 360 flows
-- remain valid while nullable customer_id links are backfilled.

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  email_normalized TEXT,
  phone_e164 TEXT,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  consent_at TIMESTAMPTZ,
  merged_into_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_status_check CHECK (status IN ('active', 'merged', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_auth_user
  ON public.customers (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_email
  ON public.customers (organization_id, email_normalized)
  WHERE email_normalized IS NOT NULL AND merged_into_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_org_phone
  ON public.customers (organization_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND merged_into_id IS NULL;

CREATE TABLE IF NOT EXISTS public.customer_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT,
  email TEXT,
  phone TEXT,
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_identities_provider_check CHECK (provider IN ('auth', 'email', 'phone', 'stripe', 'zettle', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_identities_provider_id
  ON public.customer_identities (organization_id, provider, provider_id)
  WHERE provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
  ON public.customer_identities (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_identities_email
  ON public.customer_identities (organization_id, lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_venue_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  is_home_venue BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  visit_count INTEGER NOT NULL DEFAULT 0,
  private_notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_venue_profiles_venue
  ON public.customer_venue_profiles (venue_id, customer_id);

ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.session_registrations
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.day_passes
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.booking_receipts
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.venue_checkins
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_player_profiles_customer_id
  ON public.player_profiles (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id
  ON public.bookings (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_registrations_customer_id
  ON public.session_registrations (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_day_passes_customer_id
  ON public.day_passes (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_customer_id
  ON public.memberships (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_receipts_customer_id
  ON public.booking_receipts (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_customer_id
  ON public.ledger_entries (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_checkins_customer_id
  ON public.venue_checkins (customer_id)
  WHERE customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_customers_updated_at ON public.customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_identities_updated_at ON public.customer_identities;
CREATE TRIGGER update_customer_identities_updated_at
  BEFORE UPDATE ON public.customer_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_venue_profiles_updated_at ON public.customer_venue_profiles;
CREATE TRIGGER update_customer_venue_profiles_updated_at
  BEFORE UPDATE ON public.customer_venue_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_venue_profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  default_org_id UUID;
BEGIN
  SELECT id INTO default_org_id
  FROM public.organizations
  WHERE slug = 'pickla'
  LIMIT 1;

  IF default_org_id IS NULL THEN
    INSERT INTO public.organizations (name, slug, legal_name, org_number, settings)
    VALUES ('Pickla', 'pickla', 'Pickla Solna AB', '556977-4481', '{"foundation_phase":"1b_fallback"}'::jsonb)
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id INTO default_org_id;
  END IF;

  INSERT INTO public.customers (
    organization_id,
    auth_user_id,
    display_name,
    first_name,
    last_name,
    primary_email,
    primary_phone,
    email_normalized,
    phone_e164,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    COALESCE(v.organization_id, default_org_id),
    p.auth_user_id,
    p.display_name,
    p.first_name,
    p.last_name,
    au.email,
    p.phone,
    lower(NULLIF(trim(au.email), '')),
    NULLIF(regexp_replace(COALESCE(p.phone, ''), '[^0-9+]', '', 'g'), ''),
    jsonb_build_object('source', 'player_profiles', 'player_profile_id', p.id),
    COALESCE(p.created_at, now()),
    now()
  FROM public.player_profiles p
  LEFT JOIN auth.users au ON au.id = p.auth_user_id
  LEFT JOIN public.venues v ON v.id = p.preferred_venue_id
  WHERE p.auth_user_id IS NOT NULL
  ON CONFLICT (auth_user_id) WHERE auth_user_id IS NOT NULL DO UPDATE
    SET display_name = COALESCE(public.customers.display_name, EXCLUDED.display_name),
        first_name = COALESCE(public.customers.first_name, EXCLUDED.first_name),
        last_name = COALESCE(public.customers.last_name, EXCLUDED.last_name),
        primary_email = COALESCE(public.customers.primary_email, EXCLUDED.primary_email),
        primary_phone = COALESCE(public.customers.primary_phone, EXCLUDED.primary_phone),
        email_normalized = COALESCE(public.customers.email_normalized, EXCLUDED.email_normalized),
        phone_e164 = COALESCE(public.customers.phone_e164, EXCLUDED.phone_e164),
        updated_at = now();

  UPDATE public.player_profiles p
  SET customer_id = c.id,
      updated_at = now()
  FROM public.customers c
  WHERE p.customer_id IS NULL
    AND p.auth_user_id = c.auth_user_id;

  INSERT INTO public.customer_identities (customer_id, organization_id, provider, provider_id, verified_at, metadata)
  SELECT c.id, c.organization_id, 'auth', c.auth_user_id::text, now(), '{"source":"auth_user_id"}'::jsonb
  FROM public.customers c
  WHERE c.auth_user_id IS NOT NULL
  ON CONFLICT (organization_id, provider, provider_id) WHERE provider_id IS NOT NULL DO NOTHING;

  INSERT INTO public.customer_identities (customer_id, organization_id, provider, provider_id, email, verified_at, metadata)
  SELECT c.id, c.organization_id, 'email', lower(trim(au.email)), au.email, au.email_confirmed_at, '{"source":"auth.users.email"}'::jsonb
  FROM public.customers c
  JOIN auth.users au ON au.id = c.auth_user_id
  WHERE NULLIF(trim(au.email), '') IS NOT NULL
  ON CONFLICT (organization_id, provider, provider_id) WHERE provider_id IS NOT NULL DO NOTHING;

  INSERT INTO public.customer_identities (customer_id, organization_id, provider, provider_id, phone, metadata)
  SELECT c.id, c.organization_id, 'phone', regexp_replace(p.phone, '[^0-9+]', '', 'g'), p.phone, '{"source":"player_profiles.phone"}'::jsonb
  FROM public.player_profiles p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE NULLIF(regexp_replace(COALESCE(p.phone, ''), '[^0-9+]', '', 'g'), '') IS NOT NULL
  ON CONFLICT (organization_id, provider, provider_id) WHERE provider_id IS NOT NULL DO NOTHING;

  INSERT INTO public.customer_identities (customer_id, organization_id, provider, provider_id, metadata)
  SELECT c.id, c.organization_id, 'stripe', p.stripe_customer_id, '{"source":"player_profiles.stripe_customer_id"}'::jsonb
  FROM public.player_profiles p
  JOIN public.customers c ON c.id = p.customer_id
  WHERE NULLIF(trim(p.stripe_customer_id), '') IS NOT NULL
  ON CONFLICT (organization_id, provider, provider_id) WHERE provider_id IS NOT NULL DO NOTHING;

  UPDATE public.bookings b
  SET customer_id = c.id
  FROM public.customers c
  WHERE b.customer_id IS NULL
    AND b.user_id = c.auth_user_id;

  UPDATE public.session_registrations sr
  SET customer_id = c.id
  FROM public.customers c
  WHERE sr.customer_id IS NULL
    AND sr.user_id = c.auth_user_id;

  UPDATE public.day_passes dp
  SET customer_id = c.id
  FROM public.customers c
  WHERE dp.customer_id IS NULL
    AND dp.user_id = c.auth_user_id;

  UPDATE public.memberships m
  SET customer_id = c.id
  FROM public.customers c
  WHERE m.customer_id IS NULL
    AND m.user_id = c.auth_user_id;

  UPDATE public.booking_receipts br
  SET customer_id = c.id
  FROM public.customers c
  WHERE br.customer_id IS NULL
    AND br.user_id = c.auth_user_id;

  UPDATE public.venue_checkins vc
  SET customer_id = c.id
  FROM public.customers c
  WHERE vc.customer_id IS NULL
    AND vc.user_id = c.auth_user_id;

  UPDATE public.ledger_entries le
  SET customer_id = br.customer_id
  FROM public.booking_receipts br
  WHERE le.customer_id IS NULL
    AND le.booking_receipt_id = br.id
    AND br.customer_id IS NOT NULL;

  INSERT INTO public.customer_venue_profiles (
    customer_id,
    venue_id,
    is_home_venue,
    first_seen_at,
    last_seen_at,
    visit_count,
    metadata
  )
  SELECT
    customer_id,
    venue_id,
    bool_or(is_home_venue),
    min(seen_at),
    max(seen_at),
    count(*) FILTER (WHERE source = 'venue_checkins')::integer,
    jsonb_build_object('source', 'foundation_phase_1b_backfill')
  FROM (
    SELECT p.customer_id, p.preferred_venue_id AS venue_id, true AS is_home_venue, p.created_at AS seen_at, 'player_profiles' AS source
    FROM public.player_profiles p
    WHERE p.customer_id IS NOT NULL AND p.preferred_venue_id IS NOT NULL

    UNION ALL
    SELECT b.customer_id, b.venue_id, false, b.created_at, 'bookings'
    FROM public.bookings b
    WHERE b.customer_id IS NOT NULL

    UNION ALL
    SELECT sr.customer_id, sr.venue_id, false, sr.created_at, 'session_registrations'
    FROM public.session_registrations sr
    WHERE sr.customer_id IS NOT NULL

    UNION ALL
    SELECT dp.customer_id, dp.venue_id, false, dp.created_at, 'day_passes'
    FROM public.day_passes dp
    WHERE dp.customer_id IS NOT NULL

    UNION ALL
    SELECT m.customer_id, m.venue_id, false, m.created_at, 'memberships'
    FROM public.memberships m
    WHERE m.customer_id IS NOT NULL

    UNION ALL
    SELECT br.customer_id, br.venue_id, false, br.issued_at, 'booking_receipts'
    FROM public.booking_receipts br
    WHERE br.customer_id IS NOT NULL AND br.venue_id IS NOT NULL

    UNION ALL
    SELECT vc.customer_id, vc.venue_id, false, vc.checked_in_at, 'venue_checkins'
    FROM public.venue_checkins vc
    WHERE vc.customer_id IS NOT NULL
  ) seen
  WHERE customer_id IS NOT NULL AND venue_id IS NOT NULL
  GROUP BY customer_id, venue_id
  ON CONFLICT (customer_id, venue_id) DO UPDATE
    SET is_home_venue = public.customer_venue_profiles.is_home_venue OR EXCLUDED.is_home_venue,
        first_seen_at = LEAST(
          COALESCE(public.customer_venue_profiles.first_seen_at, EXCLUDED.first_seen_at),
          COALESCE(EXCLUDED.first_seen_at, public.customer_venue_profiles.first_seen_at)
        ),
        last_seen_at = GREATEST(
          COALESCE(public.customer_venue_profiles.last_seen_at, EXCLUDED.last_seen_at),
          COALESCE(EXCLUDED.last_seen_at, public.customer_venue_profiles.last_seen_at)
        ),
        visit_count = GREATEST(public.customer_venue_profiles.visit_count, EXCLUDED.visit_count),
        updated_at = now();
END $$;

DROP POLICY IF EXISTS "customers_self_and_staff_read" ON public.customers;
CREATE POLICY "customers_self_and_staff_read"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.is_super_admin()
    OR public.is_organization_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "customers_self_update" ON public.customers;
CREATE POLICY "customers_self_update"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "customers_org_admin_write" ON public.customers;
CREATE POLICY "customers_org_admin_write"
  ON public.customers
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

DROP POLICY IF EXISTS "customer_identities_self_and_staff_read" ON public.customer_identities;
CREATE POLICY "customer_identities_self_and_staff_read"
  ON public.customer_identities
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_organization_member(auth.uid(), organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customer_identities_org_admin_write" ON public.customer_identities;
CREATE POLICY "customer_identities_org_admin_write"
  ON public.customer_identities
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

DROP POLICY IF EXISTS "customer_venue_profiles_staff_read" ON public.customer_venue_profiles;
CREATE POLICY "customer_venue_profiles_staff_read"
  ON public.customer_venue_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_venue_member(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1
      FROM public.venues v
      WHERE v.id = customer_venue_profiles.venue_id
        AND public.is_organization_member(auth.uid(), v.organization_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = customer_id
        AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customer_venue_profiles_staff_write" ON public.customer_venue_profiles;
CREATE POLICY "customer_venue_profiles_staff_write"
  ON public.customer_venue_profiles
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_venue_admin(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1
      FROM public.venues v
      WHERE v.id = customer_venue_profiles.venue_id
        AND public.is_organization_admin(auth.uid(), v.organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_venue_admin(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1
      FROM public.venues v
      WHERE v.id = customer_venue_profiles.venue_id
        AND public.is_organization_admin(auth.uid(), v.organization_id)
    )
  );
