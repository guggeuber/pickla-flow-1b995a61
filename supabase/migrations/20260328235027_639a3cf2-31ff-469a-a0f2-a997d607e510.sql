
-- Create tables first (no policies yet)
CREATE TABLE public.corporate_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  invite_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(invite_token)
);

CREATE TABLE public.corporate_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  package_type TEXT NOT NULL DEFAULT 'hours',
  total_hours NUMERIC NOT NULL DEFAULT 0,
  used_hours NUMERIC NOT NULL DEFAULT 0,
  price_total NUMERIC,
  currency TEXT DEFAULT 'SEK',
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.corporate_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(corporate_account_id, user_id)
);

ALTER TABLE public.bookings ADD COLUMN corporate_package_id UUID REFERENCES public.corporate_packages(id);

-- Enable RLS
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_members ENABLE ROW LEVEL SECURITY;

-- Policies for corporate_accounts
CREATE POLICY "Admin manages corporate accounts" ON public.corporate_accounts
  FOR ALL TO authenticated
  USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE POLICY "Corporate admins read own account" ON public.corporate_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_members cm
    WHERE cm.corporate_account_id = corporate_accounts.id AND cm.user_id = auth.uid() AND cm.role = 'admin'
  ));

CREATE POLICY "Anon read by invite token" ON public.corporate_accounts
  FOR SELECT TO anon
  USING (true);

-- Policies for corporate_packages
CREATE POLICY "Admin manages corporate packages" ON public.corporate_packages
  FOR ALL TO authenticated
  USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE POLICY "Corporate members read own packages" ON public.corporate_packages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_members cm
    WHERE cm.corporate_account_id = corporate_packages.corporate_account_id AND cm.user_id = auth.uid()
  ));

-- Policies for corporate_members
CREATE POLICY "Admin manages corporate members" ON public.corporate_members
  FOR ALL TO authenticated
  USING (is_super_admin() OR EXISTS (
    SELECT 1 FROM public.corporate_accounts ca
    WHERE ca.id = corporate_members.corporate_account_id AND is_venue_admin(auth.uid(), ca.venue_id)
  ))
  WITH CHECK (is_super_admin() OR EXISTS (
    SELECT 1 FROM public.corporate_accounts ca
    WHERE ca.id = corporate_members.corporate_account_id AND is_venue_admin(auth.uid(), ca.venue_id)
  ));

CREATE POLICY "Corporate admins manage members" ON public.corporate_members
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.corporate_members cm2
    WHERE cm2.corporate_account_id = corporate_members.corporate_account_id AND cm2.user_id = auth.uid() AND cm2.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.corporate_members cm2
    WHERE cm2.corporate_account_id = corporate_members.corporate_account_id AND cm2.user_id = auth.uid() AND cm2.role = 'admin'
  ));

CREATE POLICY "Members read own membership" ON public.corporate_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Members can join via invite" ON public.corporate_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Triggers
CREATE TRIGGER update_corporate_accounts_updated_at BEFORE UPDATE ON public.corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_corporate_packages_updated_at BEFORE UPDATE ON public.corporate_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
