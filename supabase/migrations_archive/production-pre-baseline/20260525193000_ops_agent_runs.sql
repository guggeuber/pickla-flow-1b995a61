-- Pickla Ops Agent
-- Stores automatic scan runs and richer signal metadata.

ALTER TABLE public.ops_signals
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_auto_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ops_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ok',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_agent_runs_status_check CHECK (status IN ('ok', 'warning', 'critical', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_ops_agent_runs_venue_finished
  ON public.ops_agent_runs (venue_id, finished_at DESC);

ALTER TABLE public.ops_agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read ops agent runs" ON public.ops_agent_runs;
CREATE POLICY "Venue staff read ops agent runs"
  ON public.ops_agent_runs FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Service role manages ops agent runs" ON public.ops_agent_runs;
CREATE POLICY "Service role manages ops agent runs"
  ON public.ops_agent_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
