-- Phase 1: venue-level operational overrides.
-- Overrides create linked event_resource_blocks but do not mutate activities,
-- bookings, products, memberships, or payment flows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.venue_operation_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  reason TEXT,
  override_type TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  affects_entire_venue BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_operation_overrides_valid_range CHECK (ends_at > starts_at),
  CONSTRAINT venue_operation_overrides_status_check CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT venue_operation_overrides_type_check CHECK (
    override_type IN ('closed', 'maintenance', 'private_event', 'staffing', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_venue_operation_overrides_venue_time
  ON public.venue_operation_overrides (venue_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_venue_operation_overrides_active
  ON public.venue_operation_overrides (venue_id, status, starts_at, ends_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_venue_operation_overrides_updated_at ON public.venue_operation_overrides;
CREATE TRIGGER trg_venue_operation_overrides_updated_at
  BEFORE UPDATE ON public.venue_operation_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.venue_operation_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_operation_overrides_staff_read" ON public.venue_operation_overrides;
CREATE POLICY "venue_operation_overrides_staff_read"
  ON public.venue_operation_overrides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = venue_operation_overrides.venue_id
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

DROP POLICY IF EXISTS "venue_operation_overrides_staff_write" ON public.venue_operation_overrides;
CREATE POLICY "venue_operation_overrides_staff_write"
  ON public.venue_operation_overrides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = venue_operation_overrides.venue_id
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
      WHERE vs.venue_id = venue_operation_overrides.venue_id
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
