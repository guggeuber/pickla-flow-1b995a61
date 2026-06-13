-- Phase 1: canonical manual/event resource blocks for availability.
-- Blocks are additive and non-destructive: existing bookings/events are untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.event_resource_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_catalog_id UUID REFERENCES public.event_resource_catalog(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  event_lead_id UUID REFERENCES public.event_leads(id) ON DELETE SET NULL,
  event_offer_id UUID REFERENCES public.event_offers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual'
    CHECK (reason IN ('manual', 'event', 'maintenance', 'private', 'internal')),
  status TEXT NOT NULL DEFAULT 'hold'
    CHECK (status IN ('hold', 'confirmed', 'released', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  blocks_public_booking BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_resource_blocks_valid_range CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_event_resource_blocks_venue_time
  ON public.event_resource_blocks (venue_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_event_resource_blocks_active_time
  ON public.event_resource_blocks (venue_id, status, starts_at, ends_at)
  WHERE blocks_public_booking = true AND status IN ('hold', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_event_resource_blocks_resource_time
  ON public.event_resource_blocks (resource_catalog_id, starts_at, ends_at)
  WHERE resource_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_resource_blocks_event
  ON public.event_resource_blocks (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_resource_blocks_lead
  ON public.event_resource_blocks (event_lead_id)
  WHERE event_lead_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_event_resource_blocks_updated_at ON public.event_resource_blocks;
CREATE TRIGGER trg_event_resource_blocks_updated_at
  BEFORE UPDATE ON public.event_resource_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.event_resource_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_resource_blocks_staff_read" ON public.event_resource_blocks;
CREATE POLICY "event_resource_blocks_staff_read"
  ON public.event_resource_blocks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = event_resource_blocks.venue_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "event_resource_blocks_staff_write" ON public.event_resource_blocks;
CREATE POLICY "event_resource_blocks_staff_write"
  ON public.event_resource_blocks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = event_resource_blocks.venue_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = event_resource_blocks.venue_id
        AND vs.user_id = auth.uid()
        AND vs.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

NOTIFY pgrst, 'reload schema';
