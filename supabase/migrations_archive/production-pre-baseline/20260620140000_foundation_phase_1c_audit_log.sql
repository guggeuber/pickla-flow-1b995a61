-- Foundation Phase 1C: audit log for mutation traceability.
-- This migration only creates the append-only audit surface. Runtime behavior is
-- wired gradually through Edge Functions.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  franchisee_id UUID REFERENCES public.franchisees(id) ON DELETE SET NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_actor_type_check CHECK (actor_type IN ('user', 'system', 'webhook', 'agent'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_venue_created
  ON public.audit_log (venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_organization_created
  ON public.audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON public.audit_log (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (entity_table, entity_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS prevent_audit_log_update ON public.audit_log;
CREATE TRIGGER prevent_audit_log_update
BEFORE UPDATE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS prevent_audit_log_delete ON public.audit_log;
CREATE TRIGGER prevent_audit_log_delete
BEFORE DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP POLICY IF EXISTS "audit_log_scoped_read" ON public.audit_log;
CREATE POLICY "audit_log_scoped_read"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (venue_id IS NOT NULL AND public.is_venue_admin(auth.uid(), venue_id))
    OR (organization_id IS NOT NULL AND public.is_organization_admin(auth.uid(), organization_id))
  );

DROP POLICY IF EXISTS "audit_log_service_insert" ON public.audit_log;
CREATE POLICY "audit_log_service_insert"
  ON public.audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);
