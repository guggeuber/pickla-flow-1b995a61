-- Investor leads table for Investor Access MVP
CREATE TABLE public.investor_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','opened','interested')),
  access_token_hash text,
  token_expires_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  opened_at timestamptz,
  submitted_interest_at timestamptz,
  requested_shares integer,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX investor_leads_email_idx ON public.investor_leads (lower(email));
CREATE INDEX investor_leads_status_idx ON public.investor_leads (status);
CREATE INDEX investor_leads_token_hash_idx ON public.investor_leads (access_token_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investor_leads TO authenticated;
GRANT ALL ON public.investor_leads TO service_role;

ALTER TABLE public.investor_leads ENABLE ROW LEVEL SECURITY;

-- Only super_admin can view/manage via PostgREST; all writes from public are via edge function (service role).
CREATE POLICY "Super admin can read investor leads"
  ON public.investor_leads FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admin can update investor leads"
  ON public.investor_leads FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admin can delete investor leads"
  ON public.investor_leads FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

CREATE TRIGGER trg_investor_leads_updated_at
  BEFORE UPDATE ON public.investor_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
