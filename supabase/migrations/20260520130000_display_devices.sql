CREATE TABLE IF NOT EXISTS public.display_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  device_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  mode TEXT NOT NULL DEFAULT 'resource_home'
    CHECK (mode IN ('resource_home', 'resource_checkin', 'venue_home')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  external_links JSONB NOT NULL DEFAULT '[]',
  instructions TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_display_devices_venue
  ON public.display_devices(venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_display_devices_court
  ON public.display_devices(venue_court_id)
  WHERE venue_court_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_display_devices_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_display_devices_updated_at ON public.display_devices;
CREATE TRIGGER trg_display_devices_updated_at
  BEFORE UPDATE ON public.display_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_display_devices_updated_at();

ALTER TABLE public.display_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read display devices" ON public.display_devices;
CREATE POLICY "Venue staff read display devices"
  ON public.display_devices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = display_devices.venue_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
  );

DROP POLICY IF EXISTS "Service role manages display devices" ON public.display_devices;
CREATE POLICY "Service role manages display devices"
  ON public.display_devices
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
