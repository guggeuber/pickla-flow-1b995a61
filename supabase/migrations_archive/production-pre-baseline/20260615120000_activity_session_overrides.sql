-- Phase 1: per-occurrence activity overrides for venue operations.
-- These rows do not modify recurring activity_sessions or existing registrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.activity_session_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'hidden', 'cancelled')),
  reason TEXT,
  venue_operation_override_id UUID REFERENCES public.venue_operation_overrides(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, activity_session_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_activity_session_overrides_venue_date
  ON public.activity_session_overrides (venue_id, session_date, status);

CREATE INDEX IF NOT EXISTS idx_activity_session_overrides_operation
  ON public.activity_session_overrides (venue_operation_override_id)
  WHERE venue_operation_override_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_activity_session_overrides_updated_at ON public.activity_session_overrides;
CREATE TRIGGER trg_activity_session_overrides_updated_at
  BEFORE UPDATE ON public.activity_session_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.activity_session_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_session_overrides_public_read" ON public.activity_session_overrides;
CREATE POLICY "activity_session_overrides_public_read"
  ON public.activity_session_overrides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.venues v
      WHERE v.id = activity_session_overrides.venue_id
        AND v.is_public = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = activity_session_overrides.venue_id
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

DROP POLICY IF EXISTS "activity_session_overrides_staff_write" ON public.activity_session_overrides;
CREATE POLICY "activity_session_overrides_staff_write"
  ON public.activity_session_overrides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.venue_id = activity_session_overrides.venue_id
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
      WHERE vs.venue_id = activity_session_overrides.venue_id
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
