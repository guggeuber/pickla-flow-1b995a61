-- Pickla Ops Center
-- Shared operational status, checklist state, and incident log per venue.

CREATE TABLE IF NOT EXISTS public.ops_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'green',
  note TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_signals_key_check CHECK (
    signal_key IN ('payments', 'bookings', 'memberships', 'checkin', 'devices', 'score', 'mail', 'deploy')
  ),
  CONSTRAINT ops_signals_status_check CHECK (status IN ('green', 'yellow', 'red')),
  CONSTRAINT ops_signals_unique_key UNIQUE (venue_id, signal_key)
);

CREATE TABLE IF NOT EXISTS public.ops_check_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_check_state_mode_check CHECK (mode IN ('deploy', 'opening', 'closing', 'weekly')),
  CONSTRAINT ops_check_state_unique_item UNIQUE (venue_id, mode, item_index)
);

CREATE TABLE IF NOT EXISTS public.ops_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  severity TEXT NOT NULL DEFAULT 'P2',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner_name TEXT,
  affected_route TEXT,
  affected_ids TEXT,
  impact TEXT,
  containment TEXT,
  fix_reference TEXT,
  verification TEXT,
  follow_up TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_incidents_severity_check CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT ops_incidents_status_check CHECK (status IN ('open', 'contained', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_ops_signals_venue
  ON public.ops_signals (venue_id, signal_key);

CREATE INDEX IF NOT EXISTS idx_ops_check_state_venue_mode
  ON public.ops_check_state (venue_id, mode, item_index);

CREATE INDEX IF NOT EXISTS idx_ops_incidents_venue_status
  ON public.ops_incidents (venue_id, status, severity, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_ops_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ops_signals_updated_at ON public.ops_signals;
CREATE TRIGGER trg_ops_signals_updated_at
  BEFORE UPDATE ON public.ops_signals
  FOR EACH ROW EXECUTE FUNCTION public.fn_ops_updated_at();

DROP TRIGGER IF EXISTS trg_ops_check_state_updated_at ON public.ops_check_state;
CREATE TRIGGER trg_ops_check_state_updated_at
  BEFORE UPDATE ON public.ops_check_state
  FOR EACH ROW EXECUTE FUNCTION public.fn_ops_updated_at();

DROP TRIGGER IF EXISTS trg_ops_incidents_updated_at ON public.ops_incidents;
CREATE TRIGGER trg_ops_incidents_updated_at
  BEFORE UPDATE ON public.ops_incidents
  FOR EACH ROW EXECUTE FUNCTION public.fn_ops_updated_at();

ALTER TABLE public.ops_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_check_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read ops signals" ON public.ops_signals;
CREATE POLICY "Venue staff read ops signals"
  ON public.ops_signals FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff manage ops signals" ON public.ops_signals;
CREATE POLICY "Venue staff manage ops signals"
  ON public.ops_signals FOR ALL TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff read ops check state" ON public.ops_check_state;
CREATE POLICY "Venue staff read ops check state"
  ON public.ops_check_state FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff manage ops check state" ON public.ops_check_state;
CREATE POLICY "Venue staff manage ops check state"
  ON public.ops_check_state FOR ALL TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff read ops incidents" ON public.ops_incidents;
CREATE POLICY "Venue staff read ops incidents"
  ON public.ops_incidents FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff manage ops incidents" ON public.ops_incidents;
CREATE POLICY "Venue staff manage ops incidents"
  ON public.ops_incidents FOR ALL TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());
