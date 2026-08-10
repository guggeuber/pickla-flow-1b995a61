-- Bruce V1 is a manual operating layer on the canonical entitlement model.
-- It deliberately adds no Bruce API, synchronization, settlement automation,
-- customer synchronization, webhook, or marketplace behavior.

ALTER TABLE public.partner_program_sessions
  ADD COLUMN IF NOT EXISTS allocated_capacity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'needs_publication',
  ADD COLUMN IF NOT EXISTS publication_reference TEXT,
  ADD COLUMN IF NOT EXISTS publication_error TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publication_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publication_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_published_snapshot JSONB;

ALTER TABLE public.partner_program_sessions
  ADD CONSTRAINT partner_program_sessions_allocated_capacity_check
    CHECK (allocated_capacity >= 0) NOT VALID,
  ADD CONSTRAINT partner_program_sessions_publication_status_check
    CHECK (publication_status IN ('needs_publication', 'published', 'changed', 'removed', 'error')) NOT VALID,
  ADD CONSTRAINT partner_program_sessions_publication_error_shape
    CHECK (publication_status <> 'error' OR NULLIF(BTRIM(publication_error), '') IS NOT NULL) NOT VALID;

UPDATE public.partner_program_sessions
SET publication_status = CASE WHEN status = 'eligible' THEN 'needs_publication' ELSE 'removed' END,
    publication_updated_at = now();

ALTER TABLE public.partner_program_sessions
  VALIDATE CONSTRAINT partner_program_sessions_allocated_capacity_check;
ALTER TABLE public.partner_program_sessions
  VALIDATE CONSTRAINT partner_program_sessions_publication_status_check;
ALTER TABLE public.partner_program_sessions
  VALIDATE CONSTRAINT partner_program_sessions_publication_error_shape;

CREATE OR REPLACE FUNCTION public.enforce_partner_session_operations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_capacity INTEGER;
BEGIN
  SELECT capacity INTO v_total_capacity
  FROM public.activity_sessions
  WHERE id = NEW.activity_session_id;

  IF v_total_capacity IS NOT NULL AND NEW.allocated_capacity > v_total_capacity THEN
    RAISE EXCEPTION 'partner_allocated_capacity_exceeds_session_capacity';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.publication_status := CASE
      WHEN NEW.status = 'ineligible' THEN 'removed'
      ELSE COALESCE(NEW.publication_status, 'needs_publication')
    END;
    NEW.publication_updated_at := now();
  ELSE
    IF OLD.status = 'eligible' AND NEW.status = 'ineligible' THEN
      NEW.publication_status := 'removed';
      NEW.publication_error := NULL;
      NEW.publication_updated_at := now();
    ELSIF OLD.status = 'ineligible' AND NEW.status = 'eligible' THEN
      NEW.publication_status := 'needs_publication';
      NEW.publication_error := NULL;
      NEW.publication_updated_at := now();
    ELSIF NEW.status = 'eligible'
      AND NEW.allocated_capacity IS DISTINCT FROM OLD.allocated_capacity
      AND OLD.publication_status = 'published'
      AND NEW.publication_status = OLD.publication_status THEN
      NEW.publication_status := 'changed';
      NEW.publication_updated_at := now();
    END IF;

    IF NEW.publication_status IS DISTINCT FROM OLD.publication_status
      OR NEW.publication_reference IS DISTINCT FROM OLD.publication_reference
      OR NEW.publication_error IS DISTINCT FROM OLD.publication_error THEN
      NEW.publication_updated_at := now();
    END IF;
  END IF;

  IF NEW.publication_status = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
    NEW.publication_error := NULL;
    NEW.last_published_snapshot := jsonb_build_object(
      'activity_session_id', NEW.activity_session_id,
      'allocated_capacity', NEW.allocated_capacity,
      'published_at', COALESCE(NEW.published_at, now())
    );
  ELSIF NEW.publication_status <> 'error' THEN
    NEW.publication_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_partner_session_operations ON public.partner_program_sessions;
CREATE TRIGGER enforce_partner_session_operations
BEFORE INSERT OR UPDATE OF status, allocated_capacity, publication_status,
  publication_reference, publication_error, published_at
ON public.partner_program_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_session_operations();

CREATE OR REPLACE FUNCTION public.mark_partner_publication_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.partner_program_sessions
  SET publication_status = 'changed',
      publication_updated_at = now()
  WHERE activity_session_id = NEW.id
    AND status = 'eligible'
    AND publication_status = 'published';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_partner_publication_changed ON public.activity_sessions;
CREATE TRIGGER mark_partner_publication_changed
AFTER UPDATE OF name, session_date, start_time, end_time, recurrence_days,
  capacity, publish_status, court_ids
ON public.activity_sessions
FOR EACH ROW
WHEN (
  OLD.name IS DISTINCT FROM NEW.name
  OR OLD.session_date IS DISTINCT FROM NEW.session_date
  OR OLD.start_time IS DISTINCT FROM NEW.start_time
  OR OLD.end_time IS DISTINCT FROM NEW.end_time
  OR OLD.recurrence_days IS DISTINCT FROM NEW.recurrence_days
  OR OLD.capacity IS DISTINCT FROM NEW.capacity
  OR OLD.publish_status IS DISTINCT FROM NEW.publish_status
  OR OLD.court_ids IS DISTINCT FROM NEW.court_ids
)
EXECUTE FUNCTION public.mark_partner_publication_changed();

-- A nullable external reference is intentional in manual V1. Bruce Studio
-- visual verification is auditable, but Pickla never invents a Bruce ID.
-- Idempotency is the canonical customer/session occurrence.
CREATE OR REPLACE FUNCTION public.issue_partner_entitlement(
  p_partner_program_id UUID,
  p_customer_id UUID,
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_service_date DATE,
  p_external_reference TEXT,
  p_user_id UUID DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_operator_note TEXT DEFAULT NULL
)
RETURNS public.access_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program public.partner_programs;
  v_entitlement public.access_entitlements;
  v_assignment_source_id UUID;
  v_assignment_key TEXT;
  v_assignment_revision INTEGER;
  v_external_reference TEXT := NULLIF(BTRIM(COALESCE(p_external_reference, '')), '');
BEGIN
  SELECT * INTO v_program FROM public.partner_programs WHERE id = p_partner_program_id;
  IF v_program.id IS NULL OR v_program.status <> 'active' THEN RAISE EXCEPTION 'partner_program_not_active'; END IF;
  IF (v_program.valid_from IS NOT NULL AND p_service_date < v_program.valid_from::date)
     OR (v_program.valid_until IS NOT NULL AND p_service_date >= v_program.valid_until::date) THEN
    RAISE EXCEPTION 'partner_program_not_valid_for_service_date';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_program_sessions
    WHERE partner_program_id = v_program.id AND venue_id = p_venue_id
      AND activity_session_id = p_activity_session_id AND status = 'eligible'
  ) THEN RAISE EXCEPTION 'partner_session_not_eligible'; END IF;

  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE partner_program_id = v_program.id
    AND customer_id = p_customer_id
    AND activity_session_id = p_activity_session_id
    AND service_date = p_service_date
    AND entitlement_type = 'partner_access'
    AND status <> 'revoked'
  ORDER BY created_at
  LIMIT 1;
  IF v_entitlement.id IS NOT NULL THEN RETURN v_entitlement; END IF;

  SELECT count(*)::integer INTO v_assignment_revision
  FROM public.access_entitlements
  WHERE partner_program_id = v_program.id
    AND customer_id = p_customer_id
    AND activity_session_id = p_activity_session_id
    AND service_date = p_service_date
    AND entitlement_type = 'partner_access';
  v_assignment_key := v_program.id::text || ':' || p_customer_id::text || ':'
    || p_activity_session_id::text || ':' || p_service_date::text || ':' || v_assignment_revision::text;
  v_assignment_source_id := (
    SUBSTR(MD5(v_assignment_key), 1, 8) || '-' ||
    SUBSTR(MD5(v_assignment_key), 9, 4) || '-' ||
    SUBSTR(MD5(v_assignment_key), 13, 4) || '-' ||
    SUBSTR(MD5(v_assignment_key), 17, 4) || '-' ||
    SUBSTR(MD5(v_assignment_key), 21, 12)
  )::uuid;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => p_customer_id,
    p_venue_id => p_venue_id,
    p_entitlement_type => 'partner_access',
    p_scope_type => 'exact_session',
    p_meter_type => 'exact_session',
    p_funding_type => 'partner_funded',
    p_funder => 'partner',
    p_access_reason => v_program.access_reason,
    p_consumption_trigger => v_program.consumption_trigger,
    p_no_show_policy => v_program.no_show_policy,
    p_occurrence_origin => 'paid',
    p_resolution_priority => 50,
    p_user_id => p_user_id,
    p_source_type => 'partner_program',
    p_source_id => v_assignment_source_id,
    p_starts_at => GREATEST(p_starts_at, v_program.valid_from),
    p_expires_at => LEAST(p_expires_at, v_program.valid_until),
    p_service_date => p_service_date,
    p_uses_limit => 1,
    p_requires_consumption => true,
    p_activity_session_id => p_activity_session_id,
    p_session_date => p_service_date,
    p_funding_counterparty_ref => v_program.funding_counterparty_ref,
    p_issuance_key => 'partner-visit:' || v_assignment_key,
    p_metadata => jsonb_build_object(
      'program_key', v_program.program_key,
      'agreement_version_at_issue', v_program.agreement_version,
      'agreement_effective_date_at_issue', v_program.agreement_effective_date,
      'verification_method', 'bruce_studio_visual'
    )
  );

  UPDATE public.access_entitlements
  SET partner_program_id = v_program.id,
      external_reference = v_external_reference,
      operator_note = NULLIF(BTRIM(COALESCE(p_operator_note, '')), '')
  WHERE id = v_entitlement.id
  RETURNING * INTO v_entitlement;
  RETURN v_entitlement;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_partner_visit(
  p_partner_program_id UUID,
  p_customer_id UUID,
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_service_date DATE,
  p_external_reference TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_operator_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_registration RECORD;
BEGIN
  IF p_created_by IS NULL THEN RAISE EXCEPTION 'partner_visit_operator_required'; END IF;

  SELECT * INTO v_entitlement FROM public.issue_partner_entitlement(
    p_partner_program_id,
    p_customer_id,
    p_venue_id,
    p_activity_session_id,
    p_service_date,
    p_external_reference,
    p_user_id,
    NULL,
    NULL,
    p_operator_note
  );

  SELECT * INTO v_registration FROM public.commit_activity_registration_capacity(
    p_venue_id => p_venue_id,
    p_activity_session_id => p_activity_session_id,
    p_session_date => p_service_date,
    p_user_id => p_user_id,
    p_customer_id => p_customer_id,
    p_status => 'confirmed',
    p_price_paid_sek => 0,
    p_stripe_session_id => NULL,
    p_source_type => 'partner_access',
    p_source_id => v_entitlement.id,
    p_metadata => jsonb_build_object(
      'access_reason', v_entitlement.access_reason,
      'funder', 'partner',
      'partner_program_id', p_partner_program_id,
      'verification_method', 'bruce_studio_visual',
      'verified_by', p_created_by,
      'verified_at', now()
    ),
    p_hold_id => NULL
  );

  IF NOT COALESCE(v_registration.ok, false) THEN
    RAISE EXCEPTION 'partner_visit_registration_failed:%', COALESCE(v_registration.reason, 'unknown');
  END IF;

  RETURN jsonb_build_object(
    'entitlement_id', v_entitlement.id,
    'registration_id', v_registration.registration_id,
    'registration_reason', v_registration.reason,
    'available_count', v_registration.available_count,
    'price_paid_sek', 0
  );
END;
$$;

CREATE TABLE public.partner_receivable_settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  partner_receivable_event_id UUID NOT NULL REFERENCES public.partner_receivable_events(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('settled', 'reopened')),
  settlement_reference TEXT,
  note TEXT,
  idempotency_key TEXT NOT NULL CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_receivable_settlement_reference_shape CHECK (
    event_type <> 'settled' OR NULLIF(BTRIM(settlement_reference), '') IS NOT NULL
  ),
  CONSTRAINT partner_receivable_settlement_idempotency UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX partner_receivable_settlement_history
  ON public.partner_receivable_settlement_events (partner_receivable_event_id, occurred_at DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_partner_receivable_settlement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'partner_receivable_settlement_events_are_append_only';
END;
$$;

CREATE TRIGGER prevent_partner_receivable_settlement_update
BEFORE UPDATE ON public.partner_receivable_settlement_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_receivable_settlement_mutation();
CREATE TRIGGER prevent_partner_receivable_settlement_delete
BEFORE DELETE ON public.partner_receivable_settlement_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_receivable_settlement_mutation();

CREATE OR REPLACE FUNCTION public.record_partner_receivable_settlement(
  p_partner_receivable_event_id UUID,
  p_event_type TEXT,
  p_settlement_reference TEXT,
  p_note TEXT,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS public.partner_receivable_settlement_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receivable public.partner_receivable_events;
  v_existing public.partner_receivable_settlement_events;
  v_latest public.partner_receivable_settlement_events;
  v_event public.partner_receivable_settlement_events;
BEGIN
  IF p_event_type NOT IN ('settled', 'reopened') THEN RAISE EXCEPTION 'partner_settlement_event_type_invalid'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'partner_settlement_audit_fields_required';
  END IF;
  IF p_event_type = 'settled' AND NULLIF(BTRIM(COALESCE(p_settlement_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'partner_settlement_reference_required';
  END IF;

  SELECT * INTO v_receivable
  FROM public.partner_receivable_events
  WHERE id = p_partner_receivable_event_id AND event_type = 'accrued'
  FOR SHARE;
  IF v_receivable.id IS NULL THEN RAISE EXCEPTION 'partner_receivable_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_receivable_events reversal
    WHERE reversal.reverses_event_id = v_receivable.id AND reversal.event_type = 'reversal'
  ) THEN RAISE EXCEPTION 'reversed_partner_receivable_cannot_be_settled'; END IF;

  SELECT * INTO v_existing
  FROM public.partner_receivable_settlement_events
  WHERE organization_id = v_receivable.organization_id AND idempotency_key = BTRIM(p_idempotency_key);
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_latest
  FROM public.partner_receivable_settlement_events
  WHERE partner_receivable_event_id = v_receivable.id
  ORDER BY occurred_at DESC, created_at DESC
  LIMIT 1;
  IF p_event_type = 'settled' AND v_latest.event_type = 'settled' THEN RAISE EXCEPTION 'partner_receivable_already_settled'; END IF;
  IF p_event_type = 'reopened' AND (v_latest.id IS NULL OR v_latest.event_type <> 'settled') THEN
    RAISE EXCEPTION 'partner_receivable_not_settled';
  END IF;

  INSERT INTO public.partner_receivable_settlement_events (
    organization_id, partner_receivable_event_id, event_type, settlement_reference,
    note, idempotency_key, created_by
  ) VALUES (
    v_receivable.organization_id, v_receivable.id, p_event_type,
    NULLIF(BTRIM(COALESCE(p_settlement_reference, '')), ''),
    NULLIF(BTRIM(COALESCE(p_note, '')), ''), BTRIM(p_idempotency_key), p_created_by
  ) RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;

ALTER TABLE public.partner_receivable_settlement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner settlement events"
ON public.partner_receivable_settlement_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.partner_receivable_events receivable
    JOIN public.venue_staff staff ON staff.venue_id = receivable.venue_id
    WHERE receivable.id = partner_receivable_settlement_events.partner_receivable_event_id
      AND staff.user_id = auth.uid() AND staff.is_active = true
  )
  OR public.has_role(auth.uid(), 'super_admin')
);

REVOKE ALL ON public.partner_receivable_settlement_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_receivable_settlement_events TO authenticated;
GRANT ALL ON public.partner_receivable_settlement_events TO service_role;

REVOKE ALL ON FUNCTION public.register_partner_visit(UUID, UUID, UUID, UUID, DATE, TEXT, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_partner_visit(UUID, UUID, UUID, UUID, DATE, TEXT, UUID, TEXT, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_partner_receivable_settlement(UUID, TEXT, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_receivable_settlement(UUID, TEXT, TEXT, TEXT, TEXT, UUID)
  TO service_role;

COMMENT ON COLUMN public.partner_program_sessions.allocated_capacity IS
  'Manually recorded Bruce seat allocation. No automatic release or Bruce synchronization is performed.';
COMMENT ON COLUMN public.partner_program_sessions.publication_status IS
  'Manual Bruce Studio publication queue: needs_publication, published, changed, removed, or error.';
COMMENT ON TABLE public.partner_receivable_settlement_events IS
  'Append-only manual settlement state for partner receivables. V1 performs no invoice matching or settlement automation.';
COMMENT ON FUNCTION public.register_partner_visit(UUID, UUID, UUID, UUID, DATE, TEXT, UUID, TEXT, UUID) IS
  'Creates one canonical zero-price partner registration and exact-session entitlement atomically after operator verification in Bruce Studio.';
