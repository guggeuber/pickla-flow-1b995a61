-- Pickla Event Agent OS MVP

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.event_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  company_name TEXT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  participants_count INTEGER NOT NULL DEFAULT 1,
  preferred_date DATE,
  preferred_time TEXT,
  event_type TEXT,
  activities TEXT[] NOT NULL DEFAULT '{}',
  resources TEXT[] NOT NULL DEFAULT '{}',
  message TEXT,
  source TEXT NOT NULL DEFAULT 'group_inquiry',
  lead_score INTEGER NOT NULL DEFAULT 50 CHECK (lead_score BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'new_event_lead',
  package_type TEXT,
  estimated_value INTEGER NOT NULL DEFAULT 0,
  agent_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_lead_id UUID NOT NULL REFERENCES public.event_leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  package_type TEXT NOT NULL,
  price_per_person INTEGER NOT NULL DEFAULT 0,
  total_price INTEGER NOT NULL DEFAULT 0,
  pdf_url TEXT,
  html_snapshot TEXT,
  email_subject TEXT,
  email_body TEXT,
  sms_text TEXT,
  offer_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_lead_id UUID NOT NULL REFERENCES public.event_leads(id) ON DELETE CASCADE,
  event_offer_id UUID REFERENCES public.event_offers(id) ON DELETE SET NULL,
  followup_type TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS participants_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS preferred_date DATE,
  ADD COLUMN IF NOT EXISTS preferred_time TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS activities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resources TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'group_inquiry',
  ADD COLUMN IF NOT EXISTS lead_score INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new_event_lead',
  ADD COLUMN IF NOT EXISTS package_type TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.event_offers
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_lead_id UUID REFERENCES public.event_leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS package_type TEXT,
  ADD COLUMN IF NOT EXISTS price_per_person INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS html_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_body TEXT,
  ADD COLUMN IF NOT EXISTS sms_text TEXT,
  ADD COLUMN IF NOT EXISTS offer_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.event_offers
  ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE public.event_followups
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_lead_id UUID REFERENCES public.event_leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_offer_id UUID REFERENCES public.event_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS followup_type TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_event_leads_venue_status ON public.event_leads(venue_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_leads_event_id ON public.event_leads(event_id);
CREATE INDEX IF NOT EXISTS idx_event_offers_lead ON public.event_offers(event_lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_followups_due ON public.event_followups(status, scheduled_at);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_leads_updated_at ON public.event_leads;
CREATE TRIGGER trg_event_leads_updated_at
BEFORE UPDATE ON public.event_leads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_offers_updated_at ON public.event_offers;
CREATE TRIGGER trg_event_offers_updated_at
BEFORE UPDATE ON public.event_offers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_followups_updated_at ON public.event_followups;
CREATE TRIGGER trg_event_followups_updated_at
BEFORE UPDATE ON public.event_followups
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.event_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read offers" ON public.event_offers;
DROP POLICY IF EXISTS "Admin can manage offers" ON public.event_offers;

DROP POLICY IF EXISTS "event_leads_staff_read" ON public.event_leads;
CREATE POLICY "event_leads_staff_read" ON public.event_leads
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.venue_staff vs
    WHERE vs.venue_id = event_leads.venue_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "event_offers_staff_read" ON public.event_offers;
CREATE POLICY "event_offers_staff_read" ON public.event_offers
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.venue_staff vs
    WHERE vs.venue_id = event_offers.venue_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "event_followups_staff_read" ON public.event_followups;
CREATE POLICY "event_followups_staff_read" ON public.event_followups
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.venue_staff vs
    WHERE vs.venue_id = event_followups.venue_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-offers', 'event-offers', false, 10485760, ARRAY['application/pdf', 'text/html'])
ON CONFLICT (id) DO NOTHING;
