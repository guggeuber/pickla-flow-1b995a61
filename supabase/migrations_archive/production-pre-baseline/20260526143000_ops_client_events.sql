-- Client-side observability events for production smoke tests and runtime errors.

CREATE TABLE IF NOT EXISTS public.ops_client_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  route TEXT,
  fingerprint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_client_events_severity_check CHECK (severity IN ('info', 'warning', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_ops_client_events_venue_created
  ON public.ops_client_events (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_client_events_fingerprint_created
  ON public.ops_client_events (fingerprint, created_at DESC);

ALTER TABLE public.ops_client_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read ops client events" ON public.ops_client_events;
CREATE POLICY "Venue staff read ops client events"
  ON public.ops_client_events FOR SELECT TO authenticated
  USING (
    venue_id IS NULL
    OR public.is_venue_member(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Service role manages ops client events" ON public.ops_client_events;
CREATE POLICY "Service role manages ops client events"
  ON public.ops_client_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
