-- Partner-funded access and legacy punch-card readiness on the canonical model.
-- No production partner enrollment or legacy import is performed by this migration.

CREATE TABLE public.partner_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  program_key TEXT NOT NULL CHECK (NULLIF(BTRIM(program_key), '') IS NOT NULL),
  name TEXT NOT NULL CHECK (NULLIF(BTRIM(name), '') IS NOT NULL),
  activity_label TEXT NOT NULL CHECK (NULLIF(BTRIM(activity_label), '') IS NOT NULL),
  access_reason TEXT NOT NULL CHECK (NULLIF(BTRIM(access_reason), '') IS NOT NULL),
  desk_label TEXT NOT NULL CHECK (NULLIF(BTRIM(desk_label), '') IS NOT NULL),
  funding_counterparty_ref TEXT NOT NULL CHECK (NULLIF(BTRIM(funding_counterparty_ref), '') IS NOT NULL),
  reimbursement_amount_minor INTEGER NOT NULL CHECK (reimbursement_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SEK' CHECK (currency = 'SEK'),
  settlement_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_programs_validity_order CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT partner_programs_key_unique UNIQUE (organization_id, program_key)
);

CREATE TABLE public.partner_program_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_program_id UUID NOT NULL REFERENCES public.partner_programs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'ineligible')),
  reimbursement_amount_minor INTEGER CHECK (reimbursement_amount_minor IS NULL OR reimbursement_amount_minor >= 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_program_sessions_unique UNIQUE (partner_program_id, activity_session_id)
);

ALTER TABLE public.access_entitlements
  ADD COLUMN IF NOT EXISTS partner_program_id UUID REFERENCES public.partner_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS legacy_source_ref TEXT,
  ADD COLUMN IF NOT EXISTS operator_note TEXT,
  ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_access_entitlements_partner_reference
  ON public.access_entitlements (organization_id, partner_program_id, external_reference)
  WHERE partner_program_id IS NOT NULL AND external_reference IS NOT NULL;
CREATE UNIQUE INDEX idx_access_entitlements_legacy_source
  ON public.access_entitlements (organization_id, legacy_source_ref)
  WHERE legacy_source_ref IS NOT NULL;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_partner_program_funding_check
    CHECK (partner_program_id IS NULL OR funding_type = 'partner_funded'),
  ADD CONSTRAINT access_entitlements_legacy_import_funding_check
    CHECK (legacy_source_ref IS NULL OR funding_type = 'legacy_import'),
  ADD CONSTRAINT access_entitlements_import_audit_shape_check
    CHECK (
      (legacy_source_ref IS NULL AND imported_by IS NULL AND imported_at IS NULL)
      OR (legacy_source_ref IS NOT NULL AND imported_by IS NOT NULL AND imported_at IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION public.enforce_access_entitlement_program_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program_organization_id UUID;
BEGIN
  IF NEW.partner_program_id IS NOT NULL THEN
    SELECT organization_id INTO v_program_organization_id
    FROM public.partner_programs
    WHERE id = NEW.partner_program_id;

    IF v_program_organization_id IS NULL OR v_program_organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'entitlement_partner_program_organization_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_access_entitlement_program_boundary
BEFORE INSERT OR UPDATE OF partner_program_id, organization_id ON public.access_entitlements
FOR EACH ROW EXECUTE FUNCTION public.enforce_access_entitlement_program_boundary();

CREATE OR REPLACE FUNCTION public.enforce_partner_program_session_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program_organization_id UUID;
  v_venue_organization_id UUID;
  v_session_venue_id UUID;
BEGIN
  SELECT organization_id INTO v_program_organization_id
  FROM public.partner_programs WHERE id = NEW.partner_program_id;
  SELECT organization_id INTO v_venue_organization_id
  FROM public.venues WHERE id = NEW.venue_id;
  SELECT venue_id INTO v_session_venue_id
  FROM public.activity_sessions WHERE id = NEW.activity_session_id;

  IF v_program_organization_id IS NULL
     OR NEW.organization_id <> v_program_organization_id
     OR NEW.organization_id <> v_venue_organization_id
     OR NEW.venue_id <> v_session_venue_id THEN
    RAISE EXCEPTION 'partner_session_scope_mismatch';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_partner_program_session_boundary
BEFORE INSERT OR UPDATE ON public.partner_program_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_program_session_boundary();

CREATE TABLE public.partner_receivable_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  partner_program_id UUID NOT NULL REFERENCES public.partner_programs(id) ON DELETE RESTRICT,
  entitlement_consumption_id UUID NOT NULL REFERENCES public.entitlement_consumptions(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('accrued', 'reversal')),
  reverses_event_id UUID REFERENCES public.partner_receivable_events(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SEK' CHECK (currency = 'SEK'),
  occurred_at TIMESTAMPTZ NOT NULL,
  settlement_state TEXT NOT NULL CHECK (settlement_state IN ('pending', 'reversed')),
  external_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_receivable_event_shape CHECK (
    (event_type = 'accrued' AND reverses_event_id IS NULL AND settlement_state = 'pending')
    OR (event_type = 'reversal' AND reverses_event_id IS NOT NULL AND settlement_state = 'reversed')
  )
);

CREATE UNIQUE INDEX partner_receivable_events_consumption_once
  ON public.partner_receivable_events (entitlement_consumption_id, event_type);
CREATE UNIQUE INDEX partner_receivable_events_reversal_once
  ON public.partner_receivable_events (reverses_event_id)
  WHERE event_type = 'reversal';
CREATE INDEX partner_receivable_events_pending
  ON public.partner_receivable_events (partner_program_id, occurred_at)
  WHERE settlement_state = 'pending';

CREATE OR REPLACE FUNCTION public.prevent_partner_receivable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'partner_receivable_events_are_append_only';
END;
$$;

CREATE TRIGGER prevent_partner_receivable_update
BEFORE UPDATE ON public.partner_receivable_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_receivable_mutation();
CREATE TRIGGER prevent_partner_receivable_delete
BEFORE DELETE ON public.partner_receivable_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_partner_receivable_mutation();

CREATE OR REPLACE FUNCTION public.record_partner_receivable_from_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_program public.partner_programs;
  v_eligibility public.partner_program_sessions;
  v_original_receivable public.partner_receivable_events;
  v_amount INTEGER;
BEGIN
  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE id = NEW.entitlement_id;
  IF v_entitlement.funding_type <> 'partner_funded' THEN RETURN NEW; END IF;
  IF v_entitlement.partner_program_id IS NULL THEN RAISE EXCEPTION 'partner_program_missing'; END IF;

  SELECT * INTO v_program FROM public.partner_programs WHERE id = v_entitlement.partner_program_id;
  IF v_program.id IS NULL THEN RAISE EXCEPTION 'partner_program_missing'; END IF;

  IF NEW.event_type = 'use' THEN
    IF NEW.activity_session_id IS NULL THEN RAISE EXCEPTION 'partner_attendance_requires_session'; END IF;
    IF v_program.status <> 'active'
       OR (v_program.valid_from IS NOT NULL AND NEW.occurred_at < v_program.valid_from)
       OR (v_program.valid_until IS NOT NULL AND NEW.occurred_at >= v_program.valid_until) THEN
      RAISE EXCEPTION 'partner_program_not_active';
    END IF;

    SELECT * INTO v_eligibility
    FROM public.partner_program_sessions
    WHERE partner_program_id = v_program.id
      AND activity_session_id = NEW.activity_session_id
      AND venue_id = NEW.venue_id
      AND status = 'eligible';
    IF v_eligibility.id IS NULL THEN RAISE EXCEPTION 'partner_session_not_eligible'; END IF;

    v_amount := COALESCE(v_eligibility.reimbursement_amount_minor, v_program.reimbursement_amount_minor);
    INSERT INTO public.partner_receivable_events (
      organization_id, partner_program_id, entitlement_consumption_id, customer_id,
      venue_id, activity_session_id, event_type, amount_minor, currency, occurred_at,
      settlement_state, external_reference, metadata
    ) VALUES (
      NEW.organization_id, v_program.id, NEW.id, NEW.customer_id, NEW.venue_id,
      NEW.activity_session_id, 'accrued', v_amount, v_program.currency, NEW.occurred_at,
      'pending', v_entitlement.external_reference,
      jsonb_build_object('source_consumption_id', NEW.id, 'settlement_rule_version', COALESCE(v_program.settlement_rule->>'version', '1'))
    ) ON CONFLICT (entitlement_consumption_id, event_type) DO NOTHING;
  ELSE
    SELECT receivable.* INTO v_original_receivable
    FROM public.entitlement_consumptions original_consumption
    JOIN public.partner_receivable_events receivable
      ON receivable.entitlement_consumption_id = original_consumption.id
      AND receivable.event_type = 'accrued'
    WHERE original_consumption.id = NEW.reverses_consumption_id;
    IF v_original_receivable.id IS NULL THEN RAISE EXCEPTION 'partner_receivable_to_reverse_missing'; END IF;

    INSERT INTO public.partner_receivable_events (
      organization_id, partner_program_id, entitlement_consumption_id, customer_id,
      venue_id, activity_session_id, event_type, reverses_event_id, amount_minor,
      currency, occurred_at, settlement_state, external_reference, metadata
    ) VALUES (
      NEW.organization_id, v_original_receivable.partner_program_id, NEW.id, NEW.customer_id,
      NEW.venue_id, v_original_receivable.activity_session_id, 'reversal', v_original_receivable.id,
      v_original_receivable.amount_minor, v_original_receivable.currency, NEW.occurred_at,
      'reversed', v_original_receivable.external_reference,
      jsonb_build_object('source_consumption_id', NEW.id, 'reverses_consumption_id', NEW.reverses_consumption_id)
    ) ON CONFLICT (entitlement_consumption_id, event_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER record_partner_receivable_from_consumption
AFTER INSERT ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.record_partner_receivable_from_consumption();

CREATE TABLE public.entitlement_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entitlement_id UUID NOT NULL REFERENCES public.access_entitlements(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  adjustment_delta INTEGER NOT NULL CHECK (adjustment_delta <> 0),
  previous_uses_limit INTEGER NOT NULL,
  new_uses_limit INTEGER NOT NULL CHECK (new_uses_limit > 0),
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  idempotency_key TEXT NOT NULL CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_adjustments_idempotency UNIQUE (entitlement_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.prevent_entitlement_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'entitlement_adjustments_are_append_only';
END;
$$;
CREATE TRIGGER prevent_entitlement_adjustment_update
BEFORE UPDATE ON public.entitlement_adjustments
FOR EACH ROW EXECUTE FUNCTION public.prevent_entitlement_adjustment_mutation();
CREATE TRIGGER prevent_entitlement_adjustment_delete
BEFORE DELETE ON public.entitlement_adjustments
FOR EACH ROW EXECUTE FUNCTION public.prevent_entitlement_adjustment_mutation();

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
BEGIN
  IF NULLIF(BTRIM(p_external_reference), '') IS NULL THEN RAISE EXCEPTION 'partner_external_reference_required'; END IF;
  SELECT * INTO v_program FROM public.partner_programs WHERE id = p_partner_program_id;
  IF v_program.id IS NULL OR v_program.status <> 'active' THEN RAISE EXCEPTION 'partner_program_not_active'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_program_sessions
    WHERE partner_program_id = v_program.id AND venue_id = p_venue_id
      AND activity_session_id = p_activity_session_id AND status = 'eligible'
  ) THEN RAISE EXCEPTION 'partner_session_not_eligible'; END IF;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => p_customer_id,
    p_venue_id => p_venue_id,
    p_entitlement_type => 'partner_access',
    p_scope_type => 'exact_session',
    p_meter_type => 'exact_session',
    p_funding_type => 'partner_funded',
    p_access_reason => v_program.access_reason,
    p_user_id => p_user_id,
    p_source_type => 'partner_program',
    p_source_id => v_program.id,
    p_starts_at => p_starts_at,
    p_expires_at => p_expires_at,
    p_service_date => p_service_date,
    p_uses_limit => 1,
    p_requires_consumption => true,
    p_activity_session_id => p_activity_session_id,
    p_session_date => p_service_date,
    p_funding_counterparty_ref => v_program.funding_counterparty_ref,
    p_issuance_key => 'partner:' || v_program.id::text || ':' || BTRIM(p_external_reference),
    p_metadata => jsonb_build_object('program_key', v_program.program_key)
  );

  UPDATE public.access_entitlements
  SET partner_program_id = v_program.id,
      external_reference = BTRIM(p_external_reference),
      operator_note = NULLIF(BTRIM(p_operator_note), '')
  WHERE id = v_entitlement.id
  RETURNING * INTO v_entitlement;
  RETURN v_entitlement;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_legacy_punch_card(
  p_customer_id UUID,
  p_venue_id UUID,
  p_remaining_visits INTEGER,
  p_scope_type TEXT,
  p_legacy_source_ref TEXT,
  p_operator_note TEXT,
  p_imported_by UUID,
  p_valid_from TIMESTAMPTZ DEFAULT NULL,
  p_valid_until TIMESTAMPTZ DEFAULT NULL,
  p_includes_session_types TEXT[] DEFAULT ARRAY['open_play']::text[],
  p_scopes JSONB DEFAULT '[]'::jsonb,
  p_user_id UUID DEFAULT NULL
)
RETURNS public.access_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id UUID;
  v_entitlement public.access_entitlements;
BEGIN
  IF p_remaining_visits <= 0 THEN RAISE EXCEPTION 'legacy_punch_card_remaining_visits_must_be_positive'; END IF;
  IF NULLIF(BTRIM(p_legacy_source_ref), '') IS NULL THEN RAISE EXCEPTION 'legacy_punch_card_source_reference_required'; END IF;
  IF NULLIF(BTRIM(p_operator_note), '') IS NULL THEN RAISE EXCEPTION 'legacy_punch_card_operator_note_required'; END IF;
  IF p_imported_by IS NULL THEN RAISE EXCEPTION 'legacy_punch_card_importer_required'; END IF;
  SELECT organization_id INTO v_organization_id FROM public.venues WHERE id = p_venue_id;
  IF EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE organization_id = v_organization_id AND legacy_source_ref = BTRIM(p_legacy_source_ref)
  ) THEN RAISE EXCEPTION 'legacy_punch_card_already_imported'; END IF;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => p_customer_id,
    p_venue_id => p_venue_id,
    p_entitlement_type => 'punch_card',
    p_scope_type => p_scope_type,
    p_meter_type => 'occurrences',
    p_funding_type => 'legacy_import',
    p_access_reason => 'Klippkort · ' || p_remaining_visits::text || ' gånger kvar',
    p_user_id => p_user_id,
    p_source_type => 'legacy_import',
    p_starts_at => p_valid_from,
    p_expires_at => p_valid_until,
    p_uses_limit => p_remaining_visits,
    p_requires_consumption => true,
    p_includes_session_types => COALESCE(p_includes_session_types, '{}'::text[]),
    p_issuance_key => 'legacy-punch:' || BTRIM(p_legacy_source_ref),
    p_metadata => jsonb_build_object('opening_remaining_visits', p_remaining_visits),
    p_scopes => COALESCE(p_scopes, '[]'::jsonb)
  );

  UPDATE public.access_entitlements
  SET legacy_source_ref = BTRIM(p_legacy_source_ref),
      operator_note = BTRIM(p_operator_note),
      imported_by = p_imported_by,
      imported_at = now()
  WHERE id = v_entitlement.id
  RETURNING * INTO v_entitlement;
  RETURN v_entitlement;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_entitlement_occurrences(
  p_entitlement_id UUID,
  p_adjustment_delta INTEGER,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_existing public.entitlement_adjustments;
  v_new_limit INTEGER;
  v_adjustment public.entitlement_adjustments;
BEGIN
  IF p_adjustment_delta = 0 THEN RAISE EXCEPTION 'entitlement_adjustment_delta_required'; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL OR NULLIF(BTRIM(p_idempotency_key), '') IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'entitlement_adjustment_audit_fields_required';
  END IF;
  SELECT * INTO v_existing FROM public.entitlement_adjustments
  WHERE entitlement_id = p_entitlement_id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('adjustment_id', v_existing.id, 'idempotent', true, 'new_uses_limit', v_existing.new_uses_limit);
  END IF;

  SELECT * INTO v_entitlement FROM public.access_entitlements WHERE id = p_entitlement_id FOR UPDATE;
  IF v_entitlement.id IS NULL OR v_entitlement.meter_type <> 'occurrences' THEN
    RAISE EXCEPTION 'occurrence_entitlement_required';
  END IF;
  v_new_limit := COALESCE(v_entitlement.uses_limit, 0) + p_adjustment_delta;
  IF v_new_limit <= 0 OR v_new_limit < v_entitlement.uses_count THEN
    RAISE EXCEPTION 'entitlement_adjustment_would_overspend';
  END IF;

  INSERT INTO public.entitlement_adjustments (
    organization_id, entitlement_id, customer_id, venue_id, adjustment_delta,
    previous_uses_limit, new_uses_limit, reason, idempotency_key, created_by
  ) VALUES (
    v_entitlement.organization_id, v_entitlement.id, v_entitlement.customer_id,
    v_entitlement.venue_id, p_adjustment_delta, v_entitlement.uses_limit,
    v_new_limit, BTRIM(p_reason), p_idempotency_key, p_created_by
  ) RETURNING * INTO v_adjustment;

  UPDATE public.access_entitlements
  SET uses_limit = v_new_limit,
      status = CASE WHEN uses_count >= v_new_limit THEN 'exhausted' ELSE 'active' END
  WHERE id = v_entitlement.id;
  RETURN jsonb_build_object('adjustment_id', v_adjustment.id, 'idempotent', false, 'new_uses_limit', v_new_limit);
END;
$$;

ALTER TABLE public.partner_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_program_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_receivable_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read partner programs" ON public.partner_programs FOR SELECT TO authenticated
USING (public.is_organization_member(auth.uid(), organization_id) OR public.is_super_admin());
CREATE POLICY "Staff read partner session eligibility" ON public.partner_program_sessions FOR SELECT TO authenticated
USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());
CREATE POLICY "Staff read partner receivables" ON public.partner_receivable_events FOR SELECT TO authenticated
USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());
CREATE POLICY "Staff read entitlement adjustments" ON public.entitlement_adjustments FOR SELECT TO authenticated
USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

REVOKE ALL ON public.partner_programs, public.partner_program_sessions,
  public.partner_receivable_events, public.entitlement_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_programs, public.partner_program_sessions,
  public.partner_receivable_events, public.entitlement_adjustments TO authenticated;
GRANT ALL ON public.partner_programs, public.partner_program_sessions,
  public.partner_receivable_events, public.entitlement_adjustments TO service_role;

-- Customers retain row-scoped access to operationally safe fields only. Partner
-- references, import notes, issuance keys and settlement provenance are API-only.
REVOKE SELECT ON public.access_entitlements FROM authenticated;
GRANT SELECT (
  id, venue_id, user_id, customer_id, entitlement_type, status,
  activity_session_id, session_date, valid_date, valid_from, valid_until,
  includes_session_types, uses_limit, uses_count, created_at, updated_at,
  model_version, scope_type, meter_type, starts_at, expires_at, service_date,
  funding_type, access_reason, requires_consumption
) ON public.access_entitlements TO authenticated;

REVOKE SELECT ON public.entitlement_consumptions FROM authenticated;
GRANT SELECT (
  id, entitlement_id, customer_id, venue_id, activity_session_id, session_date,
  registration_id, venue_checkin_id, commerce_order_id, event_type, quantity,
  occurred_at, reverses_consumption_id, reason, created_at
) ON public.entitlement_consumptions TO authenticated;

REVOKE ALL ON FUNCTION public.issue_partner_entitlement(
  UUID, UUID, UUID, UUID, DATE, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_partner_entitlement(
  UUID, UUID, UUID, UUID, DATE, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.adjust_entitlement_occurrences(UUID, INTEGER, TEXT, TEXT, UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_entitlement_occurrences(UUID, INTEGER, TEXT, TEXT, UUID)
TO service_role;

COMMENT ON TABLE public.partner_programs IS
  'Configured funding programs such as Bruce. Public projections expose labels only, never counterparty or settlement metadata.';
COMMENT ON TABLE public.partner_receivable_events IS
  'Append-only receivable boundary created from valid partner-funded attendance. Invoicing, payout matching and automated settlement are deliberately deferred.';
COMMENT ON FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
) IS 'Service-only, audited import contract. It imports visits, never money, and rejects duplicate legacy source references.';
