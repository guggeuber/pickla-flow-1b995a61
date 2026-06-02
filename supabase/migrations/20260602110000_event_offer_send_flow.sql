-- Pickla Event Agent OS: approve-first send flow + lead timeline

ALTER TABLE public.event_offers
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE TABLE IF NOT EXISTS public.event_lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_lead_id UUID NOT NULL REFERENCES public.event_leads(id) ON DELETE CASCADE,
  event_offer_id UUID REFERENCES public.event_offers(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_lead_activities_lead_created
  ON public.event_lead_activities(event_lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_lead_activities_venue_created
  ON public.event_lead_activities(venue_id, created_at DESC);

ALTER TABLE public.event_lead_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_lead_activities_staff_read" ON public.event_lead_activities;
CREATE POLICY "event_lead_activities_staff_read" ON public.event_lead_activities
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.venue_staff vs
    WHERE vs.venue_id = event_lead_activities.venue_id
      AND vs.user_id = auth.uid()
      AND vs.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  )
);
