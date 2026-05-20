CREATE TABLE IF NOT EXISTS public.event_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  provider_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_communications_event_created
  ON public.event_communications(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_communications_room_created
  ON public.event_communications(room_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_communications_provider_event
  ON public.event_communications(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_communications_provider_message_direction
  ON public.event_communications(provider, provider_message_id, direction)
  WHERE provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_event_communications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_communications_updated_at ON public.event_communications;
CREATE TRIGGER trg_event_communications_updated_at
  BEFORE UPDATE ON public.event_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_event_communications_updated_at();

ALTER TABLE public.event_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages event communications" ON public.event_communications;
CREATE POLICY "Service role manages event communications"
  ON public.event_communications
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Venue staff read event communications" ON public.event_communications;
CREATE POLICY "Venue staff read event communications"
  ON public.event_communications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      JOIN public.venue_staff vs ON vs.venue_id = e.venue_id
      WHERE e.id = event_communications.event_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
  );
