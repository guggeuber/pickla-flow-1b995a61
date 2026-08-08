-- Entitlement Foundation v1.1 constitutional amendments.
-- This migration adds model properties only. Existing production precedence,
-- check-in consumption semantics and customer-visible behavior stay unchanged.

ALTER TABLE public.access_entitlements
  ADD COLUMN IF NOT EXISTS funder TEXT,
  ADD COLUMN IF NOT EXISTS consumption_trigger TEXT NOT NULL DEFAULT 'on_checkin',
  ADD COLUMN IF NOT EXISTS no_show_policy TEXT NOT NULL DEFAULT 'do_not_consume',
  ADD COLUMN IF NOT EXISTS occurrence_origin TEXT,
  ADD COLUMN IF NOT EXISTS constitution_version SMALLINT,
  ADD COLUMN IF NOT EXISTS scope_schema_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS resolution_priority INTEGER,
  ADD COLUMN IF NOT EXISTS scarcity_class TEXT NOT NULL DEFAULT 'non_scarce',
  ADD COLUMN IF NOT EXISTS resolution_origin_priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolution_expiry_at TIMESTAMPTZ;

-- Freeze the old hard-coded order as data before the resolver starts reading it.
-- This is deliberately the production-v1 order, not the future policy.
UPDATE public.access_entitlements entitlement
SET resolution_priority = CASE
  WHEN entitlement.scope_type = 'exact_session'
    OR entitlement.entitlement_type IN ('session_ticket', 'booking_access') THEN 10
  WHEN entitlement.entitlement_type = 'membership_access' THEN 20
  WHEN entitlement.entitlement_type = 'day_access' THEN 30
  WHEN entitlement.entitlement_type = 'punch_card' THEN 40
  WHEN entitlement.entitlement_type = 'partner_access' THEN 50
  ELSE 60
END
WHERE resolution_priority IS NULL;

ALTER TABLE public.access_entitlements
  ALTER COLUMN resolution_priority SET DEFAULT 60,
  ALTER COLUMN resolution_priority SET NOT NULL,
  ADD CONSTRAINT access_entitlements_funder_check
    CHECK (funder IS NULL OR funder IN (
      'self_prepaid', 'subscription', 'house_comped', 'partner', 'employer', 'sponsor'
    )) NOT VALID,
  ADD CONSTRAINT access_entitlements_consumption_trigger_check
    CHECK (consumption_trigger IN ('on_checkin', 'on_commitment', 'on_session_end')) NOT VALID,
  ADD CONSTRAINT access_entitlements_no_show_policy_check
    CHECK (no_show_policy IN ('do_not_consume', 'consume', 'manual_review')) NOT VALID,
  ADD CONSTRAINT access_entitlements_occurrence_origin_check
    CHECK (occurrence_origin IS NULL OR occurrence_origin IN (
      'paid', 'promotional', 'house_comped', 'legacy_import'
    )) NOT VALID,
  ADD CONSTRAINT access_entitlements_scope_schema_version_check
    CHECK (scope_schema_version = 1) NOT VALID,
  ADD CONSTRAINT access_entitlements_resolution_priority_check
    CHECK (resolution_priority > 0 AND resolution_origin_priority >= 0) NOT VALID,
  ADD CONSTRAINT access_entitlements_scarcity_class_check
    CHECK (scarcity_class IN ('non_scarce', 'scarce')) NOT VALID,
  ADD CONSTRAINT access_entitlements_v11_canonical_required
    CHECK (
      constitution_version IS NULL OR model_version = 1 OR (
        funder IS NOT NULL
        AND consumption_trigger IS NOT NULL
        AND no_show_policy IS NOT NULL
        AND resolution_priority IS NOT NULL
        AND (
          meter_type NOT IN ('occurrences', 'exact_session')
          OR occurrence_origin IS NOT NULL
        )
      )
    ) NOT VALID;

ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_funder_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_consumption_trigger_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_no_show_policy_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_occurrence_origin_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_scope_schema_version_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_resolution_priority_check;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_scarcity_class_check;
-- The final canonical constraint intentionally stays NOT VALID. Historic v2
-- rows keep constitution_version NULL and are not assigned a guessed funder.

CREATE OR REPLACE FUNCTION public.mark_new_entitlement_constitution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.model_version = 2 AND NEW.constitution_version IS NULL THEN
    NEW.constitution_version := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_new_entitlement_constitution ON public.access_entitlements;
CREATE TRIGGER mark_new_entitlement_constitution
BEFORE INSERT ON public.access_entitlements
FOR EACH ROW EXECUTE FUNCTION public.mark_new_entitlement_constitution();

ALTER TABLE public.access_entitlements
  DROP CONSTRAINT IF EXISTS access_entitlements_scope_type_check;
ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_scope_type_check
  CHECK (scope_type IS NULL OR scope_type IN (
    'exact_session', 'activity_series', 'session_type', 'product_key',
    'open_play', 'venue', 'selected_venues', 'brand', 'sport_type',
    'allowlist', 'structured'
  )) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_scope_type_check;

ALTER TABLE public.access_entitlement_scopes
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;

ALTER TABLE public.access_entitlement_scopes
  DROP CONSTRAINT IF EXISTS access_entitlement_scopes_scope_kind_check,
  DROP CONSTRAINT IF EXISTS access_entitlement_scopes_locator_check;
ALTER TABLE public.access_entitlement_scopes
  ADD CONSTRAINT access_entitlement_scopes_scope_kind_check CHECK (scope_kind IN (
    'exact_session', 'activity_series', 'session_type', 'activity_format',
    'product_key', 'open_play', 'venue', 'brand', 'sport_type', 'channel'
  )),
  ADD CONSTRAINT access_entitlement_scopes_locator_check CHECK (
    (scope_kind = 'exact_session' AND activity_session_id IS NOT NULL AND venue_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'activity_series' AND activity_series_id IS NOT NULL AND venue_id IS NULL AND activity_session_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'venue' AND venue_id IS NOT NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'product_key' AND (access_product_id IS NOT NULL OR NULLIF(BTRIM(scope_value), '') IS NOT NULL) AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL)
    OR (scope_kind IN ('session_type', 'activity_format', 'sport_type', 'channel') AND NULLIF(BTRIM(scope_value), '') IS NOT NULL AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL)
    OR (scope_kind IN ('open_play', 'brand') AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
  ),
  ADD CONSTRAINT access_entitlement_scopes_validity_order
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from);

DROP INDEX IF EXISTS public.idx_access_entitlement_scopes_unique;
CREATE UNIQUE INDEX idx_access_entitlement_scopes_unique
  ON public.access_entitlement_scopes (
    entitlement_id,
    scope_kind,
    COALESCE(venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(activity_session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(activity_series_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(access_product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_value, ''),
    COALESCE(service_date, '0001-01-01'::date),
    COALESCE(valid_from, '-infinity'::timestamptz),
    COALESCE(valid_until, 'infinity'::timestamptz)
  );

ALTER TABLE public.partner_programs
  ADD COLUMN IF NOT EXISTS agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS agreement_effective_date DATE;
UPDATE public.partner_programs
SET agreement_version = COALESCE(NULLIF(BTRIM(settlement_rule->>'version'), ''), '1'),
    agreement_effective_date = COALESCE(valid_from::date, created_at::date)
WHERE agreement_version IS NULL OR agreement_effective_date IS NULL;
ALTER TABLE public.partner_programs
  ALTER COLUMN agreement_version SET DEFAULT '1',
  ALTER COLUMN agreement_effective_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN agreement_version SET NOT NULL,
  ALTER COLUMN agreement_effective_date SET NOT NULL,
  ADD CONSTRAINT partner_programs_agreement_version_not_blank
    CHECK (NULLIF(BTRIM(agreement_version), '') IS NOT NULL);

ALTER TABLE public.entitlement_consumptions
  ADD COLUMN IF NOT EXISTS entitlement_funder TEXT,
  ADD COLUMN IF NOT EXISTS partner_program_id UUID REFERENCES public.partner_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS partner_reference TEXT,
  ADD COLUMN IF NOT EXISTS reimbursement_rate_minor INTEGER,
  ADD COLUMN IF NOT EXISTS reimbursement_currency TEXT,
  ADD COLUMN IF NOT EXISTS reimbursement_agreement_version TEXT,
  ADD COLUMN IF NOT EXISTS reimbursement_effective_date DATE;

ALTER TABLE public.entitlement_consumptions
  ADD CONSTRAINT entitlement_consumptions_funder_check
    CHECK (entitlement_funder IS NULL OR entitlement_funder IN (
      'self_prepaid', 'subscription', 'house_comped', 'partner', 'employer', 'sponsor'
    )) NOT VALID,
  ADD CONSTRAINT entitlement_consumptions_reimbursement_rate_check
    CHECK (reimbursement_rate_minor IS NULL OR reimbursement_rate_minor >= 0) NOT VALID,
  ADD CONSTRAINT entitlement_consumptions_partner_snapshot_shape
    CHECK (
      entitlement_funder IS DISTINCT FROM 'partner'
      OR (
        partner_program_id IS NOT NULL
        AND NULLIF(BTRIM(partner_reference), '') IS NOT NULL
        AND reimbursement_rate_minor IS NOT NULL
        AND NULLIF(BTRIM(reimbursement_currency), '') IS NOT NULL
        AND NULLIF(BTRIM(reimbursement_agreement_version), '') IS NOT NULL
        AND reimbursement_effective_date IS NOT NULL
      )
    ) NOT VALID;
ALTER TABLE public.entitlement_consumptions
  VALIDATE CONSTRAINT entitlement_consumptions_funder_check;
ALTER TABLE public.entitlement_consumptions
  VALIDATE CONSTRAINT entitlement_consumptions_reimbursement_rate_check;
-- Existing consumption rows remain historical truth and are not rewritten.

CREATE OR REPLACE FUNCTION public.freeze_entitlement_consumption_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_program public.partner_programs;
  v_eligibility public.partner_program_sessions;
  v_original public.entitlement_consumptions;
BEGIN
  IF NEW.event_type = 'reversal' THEN
    SELECT * INTO v_original
    FROM public.entitlement_consumptions
    WHERE id = NEW.reverses_consumption_id AND event_type = 'use';
    IF v_original.id IS NULL THEN RAISE EXCEPTION 'consumption_reversal_requires_use_event'; END IF;
    NEW.entitlement_funder := v_original.entitlement_funder;
    NEW.partner_program_id := v_original.partner_program_id;
    NEW.partner_reference := v_original.partner_reference;
    NEW.reimbursement_rate_minor := v_original.reimbursement_rate_minor;
    NEW.reimbursement_currency := v_original.reimbursement_currency;
    NEW.reimbursement_agreement_version := v_original.reimbursement_agreement_version;
    NEW.reimbursement_effective_date := v_original.reimbursement_effective_date;
    RETURN NEW;
  END IF;

  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE id = NEW.entitlement_id;
  IF v_entitlement.id IS NULL THEN RAISE EXCEPTION 'consumption_entitlement_not_found'; END IF;
  NEW.entitlement_funder := v_entitlement.funder;

  IF v_entitlement.funder IS DISTINCT FROM 'partner' THEN RETURN NEW; END IF;
  IF v_entitlement.partner_program_id IS NULL THEN RAISE EXCEPTION 'partner_program_missing'; END IF;

  SELECT * INTO v_program
  FROM public.partner_programs
  WHERE id = v_entitlement.partner_program_id;
  IF v_program.id IS NULL
     OR v_program.status <> 'active'
     OR (v_program.valid_from IS NOT NULL AND NEW.occurred_at < v_program.valid_from)
     OR (v_program.valid_until IS NOT NULL AND NEW.occurred_at >= v_program.valid_until) THEN
    RAISE EXCEPTION 'partner_program_not_active';
  END IF;
  IF NEW.activity_session_id IS NULL THEN RAISE EXCEPTION 'partner_attendance_requires_session'; END IF;

  SELECT * INTO v_eligibility
  FROM public.partner_program_sessions
  WHERE partner_program_id = v_program.id
    AND activity_session_id = NEW.activity_session_id
    AND venue_id = NEW.venue_id
    AND status = 'eligible';
  IF v_eligibility.id IS NULL THEN RAISE EXCEPTION 'partner_session_not_eligible'; END IF;

  NEW.partner_program_id := v_program.id;
  NEW.partner_reference := v_program.funding_counterparty_ref;
  NEW.reimbursement_rate_minor := COALESCE(v_eligibility.reimbursement_amount_minor, v_program.reimbursement_amount_minor);
  NEW.reimbursement_currency := v_program.currency;
  NEW.reimbursement_agreement_version := v_program.agreement_version;
  NEW.reimbursement_effective_date := v_program.agreement_effective_date;
  RETURN NEW;
END;
$$;

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
    p_funder => 'partner',
    p_access_reason => v_program.access_reason,
    p_consumption_trigger => 'on_checkin',
    p_no_show_policy => 'do_not_consume',
    p_occurrence_origin => 'paid',
    p_resolution_priority => 50,
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
    p_metadata => jsonb_build_object(
      'program_key', v_program.program_key,
      'agreement_version_at_issue', v_program.agreement_version,
      'agreement_effective_date_at_issue', v_program.agreement_effective_date
    )
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

DROP FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
);

CREATE FUNCTION public.import_legacy_punch_card(
  p_customer_id UUID,
  p_venue_id UUID,
  p_remaining_visits INTEGER,
  p_scope_type TEXT,
  p_legacy_source_ref TEXT,
  p_operator_note TEXT,
  p_imported_by UUID,
  p_funder TEXT,
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
  IF p_funder IS NULL THEN RAISE EXCEPTION 'legacy_punch_card_funder_required'; END IF;
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
    p_funder => p_funder,
    p_access_reason => 'Klippkort · ' || p_remaining_visits::text || ' gånger kvar',
    p_consumption_trigger => 'on_checkin',
    p_no_show_policy => 'do_not_consume',
    p_occurrence_origin => 'legacy_import',
    p_resolution_priority => 40,
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

CREATE OR REPLACE FUNCTION public.record_partner_receivable_from_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original_receivable public.partner_receivable_events;
BEGIN
  IF NEW.entitlement_funder IS DISTINCT FROM 'partner' THEN RETURN NEW; END IF;

  IF NEW.event_type = 'use' THEN
    INSERT INTO public.partner_receivable_events (
      organization_id, partner_program_id, entitlement_consumption_id, customer_id,
      venue_id, activity_session_id, event_type, amount_minor, currency, occurred_at,
      settlement_state, external_reference, metadata
    ) VALUES (
      NEW.organization_id, NEW.partner_program_id, NEW.id, NEW.customer_id, NEW.venue_id,
      NEW.activity_session_id, 'accrued', NEW.reimbursement_rate_minor,
      NEW.reimbursement_currency, NEW.occurred_at, 'pending', NEW.partner_reference,
      jsonb_build_object(
        'source_consumption_id', NEW.id,
        'agreement_version', NEW.reimbursement_agreement_version,
        'agreement_effective_date', NEW.reimbursement_effective_date,
        'frozen_reimbursement_rate_minor', NEW.reimbursement_rate_minor
      )
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
      NEW.organization_id, NEW.partner_program_id, NEW.id, NEW.customer_id,
      NEW.venue_id, v_original_receivable.activity_session_id, 'reversal',
      v_original_receivable.id, NEW.reimbursement_rate_minor,
      NEW.reimbursement_currency, NEW.occurred_at, 'reversed', NEW.partner_reference,
      jsonb_build_object(
        'source_consumption_id', NEW.id,
        'reverses_consumption_id', NEW.reverses_consumption_id,
        'agreement_version', NEW.reimbursement_agreement_version,
        'agreement_effective_date', NEW.reimbursement_effective_date,
        'frozen_reimbursement_rate_minor', NEW.reimbursement_rate_minor
      )
    ) ON CONFLICT (entitlement_consumption_id, event_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_legacy_punch_card(
  UUID, UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB, UUID
) TO service_role;

COMMENT ON COLUMN public.access_entitlements.funder IS
  'Canonical payer/funder. Independent of funding_type provenance and never inferred from it.';
COMMENT ON COLUMN public.access_entitlements.consumption_trigger IS
  'Configured recognition/consumption event. v1.1 stores policy only; runtime remains on_checkin.';
COMMENT ON COLUMN public.access_entitlements.no_show_policy IS
  'Explicit no-show policy. v1.1 does not activate non-check-in consumption.';
COMMENT ON TABLE public.access_entitlement_scopes IS
  'Structured scope axes for brand, venues, activity formats, series, channels and per-scope validity.';
COMMENT ON TABLE public.entitlement_consumptions IS
  'Append-only participation consumption and revenue-recognition event. Partner agreement terms are frozen on each row.';
COMMENT ON COLUMN public.entitlement_consumptions.reimbursement_rate_minor IS
  'Immutable reimbursement rate selected at consumption time; later agreement edits cannot rewrite it.';


CREATE OR REPLACE FUNCTION public.resolve_access_entitlement(
  p_venue_id UUID,
  p_customer_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_activity_session_id UUID DEFAULT NULL,
  p_service_date DATE DEFAULT NULL,
  p_at TIMESTAMPTZ DEFAULT now(),
  p_product_key TEXT DEFAULT NULL,
  p_access_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id UUID;
  v_timezone TEXT;
  v_customer_id UUID := p_customer_id;
  v_service_date DATE;
  v_session_type TEXT;
  v_sport_type TEXT;
  v_series_id UUID;
  v_product_key TEXT := p_product_key;
  v_channel TEXT := NULLIF(COALESCE(p_access_context, '{}'::jsonb)->>'channel', '');
  v_entitlement public.access_entitlements;
  v_scope_matches BOOLEAN;
  v_remaining INTEGER;
  v_rejection TEXT := 'not_covered';
BEGIN
  SELECT organization_id, COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm')
  INTO v_organization_id, v_timezone
  FROM public.venues
  WHERE id = p_venue_id;
  IF v_organization_id IS NULL THEN
    RETURN jsonb_build_object('status', 'manual_review_required', 'covered', false, 'reason', 'venue_not_configured');
  END IF;

  v_service_date := COALESCE(p_service_date, (p_at AT TIME ZONE v_timezone)::date);

  IF v_customer_id IS NULL AND p_user_id IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE organization_id = v_organization_id
      AND auth_user_id = p_user_id
      AND status = 'active'
      AND merged_into_id IS NULL
    LIMIT 1;
    IF v_customer_id IS NULL THEN
      SELECT pp.customer_id INTO v_customer_id
      FROM public.player_profiles pp
      JOIN public.customers c ON c.id = pp.customer_id
      WHERE pp.auth_user_id = p_user_id
        AND c.organization_id = v_organization_id
        AND c.status = 'active'
        AND c.merged_into_id IS NULL
      LIMIT 1;
    END IF;
  END IF;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('status', 'manual_review_required', 'covered', false, 'reason', 'customer_not_resolved');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_customer_id AND organization_id = v_organization_id
      AND status = 'active' AND merged_into_id IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'manual_review_required', 'covered', false, 'reason', 'customer_wrong_organization');
  END IF;

  IF p_activity_session_id IS NOT NULL THEN
    SELECT session_type, sport_type, series_id, COALESCE(v_product_key, product_key)
    INTO v_session_type, v_sport_type, v_series_id, v_product_key
    FROM public.activity_sessions
    WHERE id = p_activity_session_id AND venue_id = p_venue_id;
    IF v_session_type IS NULL THEN
      RETURN jsonb_build_object('status', 'wrong_scope', 'covered', false, 'reason', 'session_wrong_venue');
    END IF;
  END IF;

  FOR v_entitlement IN
    SELECT entitlement.*
    FROM public.access_entitlements entitlement
    WHERE entitlement.organization_id = v_organization_id
      AND entitlement.customer_id = v_customer_id
      AND (
        NOT (COALESCE(p_access_context, '{}'::jsonb) ? 'entitlement_types')
        OR (
          jsonb_typeof(COALESCE(p_access_context, '{}'::jsonb)->'entitlement_types') = 'array'
          AND entitlement.entitlement_type IN (
            SELECT jsonb_array_elements_text(COALESCE(p_access_context, '{}'::jsonb)->'entitlement_types')
          )
        )
      )
    ORDER BY
      entitlement.resolution_priority,
      CASE entitlement.scarcity_class WHEN 'non_scarce' THEN 0 ELSE 1 END,
      entitlement.resolution_origin_priority,
      entitlement.resolution_expiry_at ASC NULLS LAST,
      entitlement.created_at
  LOOP
    IF v_entitlement.status = 'revoked' THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'revoked'; END IF;
      CONTINUE;
    ELSIF v_entitlement.status IN ('exhausted', 'consumed') THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'exhausted'; END IF;
      CONTINUE;
    ELSIF v_entitlement.status = 'expired' THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'expired'; END IF;
      CONTINUE;
    ELSIF v_entitlement.status = 'suspended' THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'manual_review_required'; END IF;
      CONTINUE;
    END IF;

    IF COALESCE(v_entitlement.starts_at, v_entitlement.valid_from) IS NOT NULL
       AND p_at < COALESCE(v_entitlement.starts_at, v_entitlement.valid_from) THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'not_yet_valid'; END IF;
      CONTINUE;
    END IF;
    IF COALESCE(v_entitlement.expires_at, v_entitlement.valid_until) IS NOT NULL
       AND p_at >= COALESCE(v_entitlement.expires_at, v_entitlement.valid_until) THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'expired'; END IF;
      CONTINUE;
    END IF;
    IF v_entitlement.meter_type = 'occurrences'
       AND COALESCE(v_entitlement.uses_count, 0) >= COALESCE(v_entitlement.uses_limit, 0) THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'exhausted'; END IF;
      CONTINUE;
    END IF;
    IF v_entitlement.model_version = 2
       AND (
         v_entitlement.scope_type IS NULL
         OR v_entitlement.meter_type IS NULL
         OR v_entitlement.funding_type IS NULL
         OR (
           v_entitlement.constitution_version = 1
           AND (
             v_entitlement.funder IS NULL
             OR v_entitlement.consumption_trigger IS NULL
             OR v_entitlement.no_show_policy IS NULL
           )
         )
       ) THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'manual_review_required'; END IF;
      CONTINUE;
    END IF;

    IF v_entitlement.model_version = 1 THEN
      v_scope_matches := v_entitlement.venue_id = p_venue_id
        AND (v_entitlement.valid_date IS NULL OR v_entitlement.valid_date = v_service_date)
        AND (v_entitlement.activity_session_id IS NULL OR v_entitlement.activity_session_id = p_activity_session_id)
        AND (v_entitlement.session_date IS NULL OR v_entitlement.session_date = v_service_date)
        AND (
          COALESCE(array_length(v_entitlement.includes_session_types, 1), 0) = 0
          OR v_session_type = ANY(v_entitlement.includes_session_types)
        );
    ELSE
      v_scope_matches := CASE v_entitlement.scope_type
        WHEN 'exact_session' THEN v_entitlement.activity_session_id = p_activity_session_id
          AND COALESCE(v_entitlement.service_date, v_entitlement.session_date, v_service_date) = v_service_date
        WHEN 'activity_series' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'activity_series'
            AND scope.activity_series_id = v_series_id
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
        )
        WHEN 'session_type' THEN v_entitlement.venue_id = p_venue_id AND (
          v_session_type = ANY(v_entitlement.includes_session_types)
          OR EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id
              AND scope.scope_kind IN ('session_type', 'activity_format')
              AND scope.scope_value = v_session_type
              AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
              AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
          )
        )
        WHEN 'product_key' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          LEFT JOIN public.access_products product ON product.id = scope.access_product_id
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'product_key'
            AND COALESCE(scope.scope_value, product.product_key) = v_product_key
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
        )
        WHEN 'open_play' THEN v_entitlement.venue_id = p_venue_id AND v_session_type = 'open_play'
        WHEN 'venue' THEN v_entitlement.venue_id = p_venue_id
        WHEN 'selected_venues' THEN EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
        )
        WHEN 'brand' THEN v_entitlement.organization_id = v_organization_id
        WHEN 'sport_type' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
        )
        WHEN 'allowlist' THEN EXISTS (
          SELECT 1
          FROM public.access_entitlement_scopes scope
          LEFT JOIN public.access_products product ON product.id = scope.access_product_id
          WHERE scope.entitlement_id = v_entitlement.id
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
            AND (
              (scope.scope_kind = 'exact_session' AND scope.activity_session_id = p_activity_session_id AND (scope.service_date IS NULL OR scope.service_date = v_service_date))
              OR (scope.scope_kind = 'activity_series' AND scope.activity_series_id = v_series_id)
              OR (scope.scope_kind IN ('session_type', 'activity_format') AND scope.scope_value = v_session_type)
              OR (scope.scope_kind = 'product_key' AND COALESCE(scope.scope_value, product.product_key) = v_product_key)
              OR (scope.scope_kind = 'open_play' AND v_session_type = 'open_play')
              OR (scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id)
              OR (scope.scope_kind = 'brand' AND scope.organization_id = v_organization_id)
              OR (scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type)
            )
        )
        WHEN 'structured' THEN
          (NOT EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'brand'
          ) OR v_entitlement.organization_id = v_organization_id)
          AND (NOT EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'venue'
          ) OR EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'venue'
              AND scope.venue_id = p_venue_id
              AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
              AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind IN ('session_type', 'activity_format')
          ) OR EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id
              AND scope.scope_kind IN ('session_type', 'activity_format')
              AND scope.scope_value = v_session_type
              AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
              AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'activity_series'
          ) OR EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'activity_series'
              AND scope.activity_series_id = v_series_id
              AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
              AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
          ))
        ELSE false
      END;

      -- Channel is an independent scope axis. No current entitlement has a
      -- channel row, so this adds capability without changing today's matches.
      IF v_scope_matches AND EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'channel'
      ) THEN
        v_scope_matches := v_channel IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'channel' AND scope.scope_value = v_channel
            AND (scope.valid_from IS NULL OR p_at >= scope.valid_from)
            AND (scope.valid_until IS NULL OR p_at < scope.valid_until)
        );
      END IF;

      IF v_scope_matches AND v_entitlement.meter_type IN ('valid_day', 'one_per_day') THEN
        v_scope_matches := v_entitlement.service_date = v_service_date;
      END IF;
    END IF;

    IF NOT COALESCE(v_scope_matches, false) THEN
      IF v_rejection = 'not_covered' THEN v_rejection := 'wrong_scope'; END IF;
      CONTINUE;
    END IF;

    v_remaining := CASE
      WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session')
        THEN GREATEST(COALESCE(v_entitlement.uses_limit, 1) - COALESCE(v_entitlement.uses_count, 0), 0)
      ELSE NULL
    END;

    RETURN jsonb_strip_nulls(jsonb_build_object(
      'status', 'covered',
      'covered', true,
      'customer_id', v_customer_id,
      'entitlement_id', v_entitlement.id,
      'entitlement_type', v_entitlement.entitlement_type,
      'access_reason', COALESCE(NULLIF(v_entitlement.access_reason, ''),
        CASE v_entitlement.entitlement_type
          WHEN 'membership_access' THEN 'Ingår i ditt medlemskap'
          WHEN 'day_access' THEN 'Heldagspass'
          WHEN 'session_ticket' THEN 'Personlig plats'
          ELSE 'Giltig rättighet'
        END),
      'meter_type', COALESCE(v_entitlement.meter_type,
        CASE v_entitlement.entitlement_type WHEN 'day_access' THEN 'valid_day' WHEN 'session_ticket' THEN 'exact_session' ELSE 'unlimited' END),
      'remaining_uses', v_remaining,
      'funding_type', v_entitlement.funding_type,
      'funder', v_entitlement.funder,
      'funding_counterparty_ref', v_entitlement.funding_counterparty_ref,
      'consumption_required', v_entitlement.requires_consumption,
      'consumption_trigger', v_entitlement.consumption_trigger,
      'no_show_policy', v_entitlement.no_show_policy,
      'occurrence_origin', v_entitlement.occurrence_origin,
      'pricing_consequence', 'included',
      'source_type', v_entitlement.source_type,
      'service_date', v_service_date
    ));
  END LOOP;

  RETURN jsonb_build_object('status', v_rejection, 'covered', false, 'customer_id', v_customer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_access_entitlement(
  p_entitlement_id UUID,
  p_customer_id UUID,
  p_venue_id UUID,
  p_idempotency_key TEXT,
  p_quantity INTEGER DEFAULT 1,
  p_activity_session_id UUID DEFAULT NULL,
  p_session_date DATE DEFAULT NULL,
  p_registration_id UUID DEFAULT NULL,
  p_venue_checkin_id UUID DEFAULT NULL,
  p_commerce_order_id UUID DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT now(),
  p_access_context JSONB DEFAULT '{}'::jsonb,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_existing public.entitlement_consumptions;
  v_consumption public.entitlement_consumptions;
  v_organization_id UUID;
  v_timezone TEXT;
  v_service_date DATE;
  v_session_type TEXT;
  v_sport_type TEXT;
  v_series_id UUID;
  v_product_key TEXT;
  v_channel TEXT := NULLIF(COALESCE(p_access_context, '{}'::jsonb)->>'channel', '');
  v_scope_matches BOOLEAN := false;
  v_next_uses INTEGER;
  v_remaining INTEGER;
BEGIN
  IF p_quantity <> 1 THEN RAISE EXCEPTION 'attendance_consumption_quantity_must_be_one'; END IF;
  IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL THEN RAISE EXCEPTION 'consumption_idempotency_key_required'; END IF;

  SELECT * INTO v_existing
  FROM public.entitlement_consumptions
  WHERE entitlement_id = p_entitlement_id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    SELECT * INTO v_entitlement FROM public.access_entitlements WHERE id = p_entitlement_id;
    RETURN jsonb_build_object(
      'consumption_id', v_existing.id,
      'idempotent', true,
      'entitlement_id', p_entitlement_id,
      'remaining_uses', CASE WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session')
        THEN GREATEST(COALESCE(v_entitlement.uses_limit, 1) - v_entitlement.uses_count, 0) ELSE NULL END,
      'entitlement_state', v_entitlement.status
    );
  END IF;

  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE id = p_entitlement_id
  FOR UPDATE;
  IF v_entitlement.id IS NULL THEN RAISE EXCEPTION 'entitlement_not_found'; END IF;
  IF v_entitlement.model_version <> 2 THEN RAISE EXCEPTION 'legacy_entitlement_requires_manual_review'; END IF;
  IF v_entitlement.customer_id <> p_customer_id THEN RAISE EXCEPTION 'entitlement_wrong_customer'; END IF;

  SELECT organization_id, COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm')
  INTO v_organization_id, v_timezone
  FROM public.venues WHERE id = p_venue_id;
  IF v_organization_id IS NULL OR v_organization_id <> v_entitlement.organization_id THEN
    RAISE EXCEPTION 'entitlement_wrong_venue';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND organization_id = v_organization_id
      AND status = 'active' AND merged_into_id IS NULL
  ) THEN
    RAISE EXCEPTION 'entitlement_customer_not_active';
  END IF;

  v_service_date := COALESCE(p_session_date, (p_occurred_at AT TIME ZONE v_timezone)::date);
  IF p_activity_session_id IS NOT NULL THEN
    SELECT session_type, sport_type, series_id, product_key
    INTO v_session_type, v_sport_type, v_series_id, v_product_key
    FROM public.activity_sessions
    WHERE id = p_activity_session_id AND venue_id = p_venue_id;
    IF v_session_type IS NULL THEN RAISE EXCEPTION 'entitlement_wrong_scope'; END IF;
  ELSE
    v_session_type := NULLIF(p_access_context->>'session_type', '');
    v_sport_type := NULLIF(p_access_context->>'sport_type', '');
    v_product_key := NULLIF(p_access_context->>'product_key', '');
  END IF;

  IF v_entitlement.status = 'revoked' THEN RAISE EXCEPTION 'entitlement_revoked'; END IF;
  IF v_entitlement.status IN ('exhausted', 'consumed') THEN RAISE EXCEPTION 'entitlement_exhausted'; END IF;
  IF v_entitlement.status = 'expired' THEN RAISE EXCEPTION 'entitlement_expired'; END IF;
  IF v_entitlement.status = 'suspended' THEN RAISE EXCEPTION 'entitlement_manual_review_required'; END IF;
  IF v_entitlement.starts_at IS NOT NULL AND p_occurred_at < v_entitlement.starts_at THEN RAISE EXCEPTION 'entitlement_not_yet_valid'; END IF;
  IF v_entitlement.expires_at IS NOT NULL AND p_occurred_at >= v_entitlement.expires_at THEN RAISE EXCEPTION 'entitlement_expired'; END IF;
  IF v_entitlement.meter_type IN ('valid_day', 'one_per_day') AND v_entitlement.service_date <> v_service_date THEN
    RAISE EXCEPTION 'entitlement_wrong_service_date';
  END IF;

  v_scope_matches := CASE v_entitlement.scope_type
    WHEN 'exact_session' THEN v_entitlement.activity_session_id = p_activity_session_id
      AND COALESCE(v_entitlement.service_date, v_entitlement.session_date, v_service_date) = v_service_date
    WHEN 'activity_series' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
      SELECT 1 FROM public.access_entitlement_scopes scope
      WHERE scope.entitlement_id = v_entitlement.id
        AND scope.scope_kind = 'activity_series' AND scope.activity_series_id = v_series_id
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
    )
    WHEN 'session_type' THEN v_entitlement.venue_id = p_venue_id AND (
      v_session_type = ANY(v_entitlement.includes_session_types)
      OR EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id
          AND scope.scope_kind IN ('session_type', 'activity_format')
          AND scope.scope_value = v_session_type
          AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
          AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
      )
    )
    WHEN 'product_key' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
      SELECT 1 FROM public.access_entitlement_scopes scope
      LEFT JOIN public.access_products product ON product.id = scope.access_product_id
      WHERE scope.entitlement_id = v_entitlement.id
        AND scope.scope_kind = 'product_key'
        AND COALESCE(scope.scope_value, product.product_key) = v_product_key
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
    )
    WHEN 'open_play' THEN v_entitlement.venue_id = p_venue_id AND v_session_type = 'open_play'
    WHEN 'venue' THEN v_entitlement.venue_id = p_venue_id
    WHEN 'selected_venues' THEN EXISTS (
      SELECT 1 FROM public.access_entitlement_scopes scope
      WHERE scope.entitlement_id = v_entitlement.id
        AND scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
    )
    WHEN 'brand' THEN v_entitlement.organization_id = v_organization_id
    WHEN 'sport_type' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
      SELECT 1 FROM public.access_entitlement_scopes scope
      WHERE scope.entitlement_id = v_entitlement.id
        AND scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
    )
    WHEN 'allowlist' THEN EXISTS (
      SELECT 1
      FROM public.access_entitlement_scopes scope
      LEFT JOIN public.access_products product ON product.id = scope.access_product_id
      WHERE scope.entitlement_id = v_entitlement.id
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
        AND (
          (scope.scope_kind = 'exact_session' AND scope.activity_session_id = p_activity_session_id AND (scope.service_date IS NULL OR scope.service_date = v_service_date))
          OR (scope.scope_kind = 'activity_series' AND scope.activity_series_id = v_series_id)
          OR (scope.scope_kind IN ('session_type', 'activity_format') AND scope.scope_value = v_session_type)
          OR (scope.scope_kind = 'product_key' AND COALESCE(scope.scope_value, product.product_key) = v_product_key)
          OR (scope.scope_kind = 'open_play' AND v_session_type = 'open_play')
          OR (scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id)
          OR (scope.scope_kind = 'brand' AND scope.organization_id = v_organization_id)
          OR (scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type)
        )
    )
    WHEN 'structured' THEN
      (NOT EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'brand'
      ) OR v_entitlement.organization_id = v_organization_id)
      AND (NOT EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'venue'
      ) OR EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'venue'
          AND scope.venue_id = p_venue_id
          AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
          AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
      ))
      AND (NOT EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id
          AND scope.scope_kind IN ('session_type', 'activity_format')
      ) OR EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id
          AND scope.scope_kind IN ('session_type', 'activity_format')
          AND scope.scope_value = v_session_type
          AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
          AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
      ))
      AND (NOT EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'activity_series'
      ) OR EXISTS (
        SELECT 1 FROM public.access_entitlement_scopes scope
        WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'activity_series'
          AND scope.activity_series_id = v_series_id
          AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
          AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
      ))
    ELSE false
  END;

  IF v_scope_matches AND EXISTS (
    SELECT 1 FROM public.access_entitlement_scopes scope
    WHERE scope.entitlement_id = v_entitlement.id AND scope.scope_kind = 'channel'
  ) THEN
    v_scope_matches := v_channel IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.access_entitlement_scopes scope
      WHERE scope.entitlement_id = v_entitlement.id
        AND scope.scope_kind = 'channel' AND scope.scope_value = v_channel
        AND (scope.valid_from IS NULL OR p_occurred_at >= scope.valid_from)
        AND (scope.valid_until IS NULL OR p_occurred_at < scope.valid_until)
    );
  END IF;
  IF NOT COALESCE(v_scope_matches, false) THEN RAISE EXCEPTION 'entitlement_wrong_scope'; END IF;

  SELECT * INTO v_existing
  FROM public.entitlement_consumptions consumption
  WHERE consumption.entitlement_id = p_entitlement_id
    AND consumption.event_type = 'use'
    AND (
      (p_venue_checkin_id IS NOT NULL AND consumption.venue_checkin_id = p_venue_checkin_id)
      OR (p_registration_id IS NOT NULL AND consumption.registration_id = p_registration_id)
      OR (p_activity_session_id IS NOT NULL
        AND consumption.activity_session_id = p_activity_session_id
        AND consumption.session_date = v_service_date
        AND consumption.customer_id = p_customer_id)
      OR (v_entitlement.meter_type = 'one_per_day' AND consumption.session_date = v_service_date)
    )
  ORDER BY consumption.created_at
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'consumption_id', v_existing.id,
      'idempotent', true,
      'entitlement_id', p_entitlement_id,
      'remaining_uses', CASE WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session')
        THEN GREATEST(COALESCE(v_entitlement.uses_limit, 1) - v_entitlement.uses_count, 0) ELSE NULL END,
      'entitlement_state', v_entitlement.status
    );
  END IF;

  v_next_uses := v_entitlement.uses_count + p_quantity;
  IF v_entitlement.meter_type IN ('occurrences', 'exact_session')
     AND v_next_uses > COALESCE(v_entitlement.uses_limit, 1) THEN
    RAISE EXCEPTION 'entitlement_exhausted';
  END IF;

  INSERT INTO public.entitlement_consumptions (
    organization_id, entitlement_id, customer_id, venue_id, activity_session_id,
    session_date, registration_id, venue_checkin_id, commerce_order_id, event_type,
    quantity, occurred_at, idempotency_key, funding_counterparty_ref, access_context, created_by
  ) VALUES (
    v_entitlement.organization_id, v_entitlement.id, p_customer_id, p_venue_id, p_activity_session_id,
    v_service_date, p_registration_id, p_venue_checkin_id, p_commerce_order_id, 'use',
    p_quantity, p_occurred_at, p_idempotency_key, v_entitlement.funding_counterparty_ref,
    COALESCE(p_access_context, '{}'::jsonb), p_created_by
  )
  RETURNING * INTO v_consumption;

  UPDATE public.access_entitlements
  SET uses_count = v_next_uses,
      status = CASE
        WHEN meter_type IN ('occurrences', 'exact_session') AND v_next_uses >= COALESCE(uses_limit, 1) THEN 'exhausted'
        ELSE status
      END
  WHERE id = v_entitlement.id;

  v_remaining := CASE WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session')
    THEN GREATEST(COALESCE(v_entitlement.uses_limit, 1) - v_next_uses, 0) ELSE NULL END;

  RETURN jsonb_build_object(
    'consumption_id', v_consumption.id,
    'idempotent', false,
    'entitlement_id', v_entitlement.id,
    'remaining_uses', v_remaining,
    'entitlement_state', CASE
      WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session') AND v_remaining = 0 THEN 'exhausted'
      ELSE v_entitlement.status
    END
  );
END;
$$;


DROP TRIGGER IF EXISTS freeze_entitlement_consumption_terms ON public.entitlement_consumptions;
CREATE TRIGGER freeze_entitlement_consumption_terms
BEFORE INSERT ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.freeze_entitlement_consumption_terms();

-- Replace the issuance contract so funder is an independent required input.
-- funding_type remains source provenance and is never used to derive funder.
DROP FUNCTION public.issue_access_entitlement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ,
  TIMESTAMPTZ, DATE, INTEGER, BOOLEAN, UUID, DATE, TEXT[], TEXT, TEXT, JSONB, JSONB
);

CREATE FUNCTION public.issue_access_entitlement(
  p_customer_id UUID,
  p_venue_id UUID,
  p_entitlement_type TEXT,
  p_scope_type TEXT,
  p_meter_type TEXT,
  p_funding_type TEXT,
  p_funder TEXT,
  p_access_reason TEXT,
  p_resolution_priority INTEGER,
  p_consumption_trigger TEXT DEFAULT 'on_checkin',
  p_no_show_policy TEXT DEFAULT 'do_not_consume',
  p_occurrence_origin TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_service_date DATE DEFAULT NULL,
  p_uses_limit INTEGER DEFAULT NULL,
  p_requires_consumption BOOLEAN DEFAULT true,
  p_activity_session_id UUID DEFAULT NULL,
  p_session_date DATE DEFAULT NULL,
  p_includes_session_types TEXT[] DEFAULT '{}'::text[],
  p_funding_counterparty_ref TEXT DEFAULT NULL,
  p_issuance_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_scopes JSONB DEFAULT '[]'::jsonb,
  p_scarcity_class TEXT DEFAULT 'non_scarce',
  p_resolution_origin_priority INTEGER DEFAULT 0,
  p_resolution_expiry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.access_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_organization_id UUID;
  v_scope JSONB;
BEGIN
  IF p_customer_id IS NULL OR p_venue_id IS NULL THEN RAISE EXCEPTION 'entitlement_customer_and_venue_required'; END IF;
  IF p_funder IS NULL THEN RAISE EXCEPTION 'entitlement_funder_required'; END IF;
  IF p_consumption_trigger IS NULL THEN RAISE EXCEPTION 'entitlement_consumption_trigger_required'; END IF;
  IF p_no_show_policy IS NULL THEN RAISE EXCEPTION 'entitlement_no_show_policy_required'; END IF;
  IF p_resolution_priority IS NULL OR p_resolution_priority <= 0 THEN RAISE EXCEPTION 'entitlement_resolution_priority_required'; END IF;
  IF p_meter_type IN ('occurrences', 'exact_session') AND p_occurrence_origin IS NULL THEN
    RAISE EXCEPTION 'entitlement_occurrence_origin_required';
  END IF;
  IF p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array' THEN RAISE EXCEPTION 'entitlement_scopes_must_be_array'; END IF;

  SELECT organization_id INTO v_organization_id FROM public.venues WHERE id = p_venue_id;
  IF v_organization_id IS NULL THEN RAISE EXCEPTION 'entitlement_venue_missing_organization'; END IF;

  IF p_issuance_key IS NOT NULL THEN
    SELECT * INTO v_entitlement
    FROM public.access_entitlements
    WHERE organization_id = v_organization_id AND issuance_key = p_issuance_key;
    IF FOUND THEN
      IF v_entitlement.customer_id <> p_customer_id OR v_entitlement.venue_id <> p_venue_id THEN
        RAISE EXCEPTION 'entitlement_issuance_key_conflict';
      END IF;
      RETURN v_entitlement;
    END IF;
  END IF;

  INSERT INTO public.access_entitlements (
    organization_id, venue_id, customer_id, user_id, entitlement_type, status,
    source_type, source_id, activity_session_id, session_date, valid_date,
    includes_session_types, uses_limit, uses_count, metadata, model_version,
    scope_type, meter_type, starts_at, expires_at, service_date, funding_type,
    funder, funding_counterparty_ref, access_reason, requires_consumption,
    consumption_trigger, no_show_policy, occurrence_origin, constitution_version, scope_schema_version,
    resolution_priority, scarcity_class, resolution_origin_priority,
    resolution_expiry_at, issuance_key
  ) VALUES (
    v_organization_id, p_venue_id, p_customer_id, p_user_id, p_entitlement_type, 'active',
    p_source_type, p_source_id, p_activity_session_id, p_session_date,
    CASE WHEN p_meter_type = 'valid_day' THEN p_service_date ELSE NULL END,
    COALESCE(p_includes_session_types, '{}'::text[]), p_uses_limit, 0,
    COALESCE(p_metadata, '{}'::jsonb), 2, p_scope_type, p_meter_type, p_starts_at,
    p_expires_at, p_service_date, p_funding_type, p_funder,
    p_funding_counterparty_ref, p_access_reason, p_requires_consumption,
    p_consumption_trigger, p_no_show_policy, p_occurrence_origin, 1, 1,
    p_resolution_priority, p_scarcity_class, p_resolution_origin_priority,
    p_resolution_expiry_at, p_issuance_key
  )
  RETURNING * INTO v_entitlement;

  FOR v_scope IN SELECT value FROM jsonb_array_elements(p_scopes)
  LOOP
    INSERT INTO public.access_entitlement_scopes (
      entitlement_id, organization_id, scope_kind, venue_id, activity_session_id,
      activity_series_id, access_product_id, scope_value, service_date,
      valid_from, valid_until
    ) VALUES (
      v_entitlement.id,
      v_organization_id,
      v_scope->>'scope_kind',
      NULLIF(v_scope->>'venue_id', '')::uuid,
      NULLIF(v_scope->>'activity_session_id', '')::uuid,
      NULLIF(v_scope->>'activity_series_id', '')::uuid,
      NULLIF(v_scope->>'access_product_id', '')::uuid,
      NULLIF(v_scope->>'scope_value', ''),
      NULLIF(v_scope->>'service_date', '')::date,
      NULLIF(v_scope->>'valid_from', '')::timestamptz,
      NULLIF(v_scope->>'valid_until', '')::timestamptz
    );
  END LOOP;

  RETURN v_entitlement;
EXCEPTION WHEN unique_violation THEN
  IF p_issuance_key IS NULL THEN RAISE; END IF;
  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE organization_id = v_organization_id AND issuance_key = p_issuance_key;
  IF v_entitlement.id IS NULL OR v_entitlement.customer_id <> p_customer_id OR v_entitlement.venue_id <> p_venue_id THEN
    RAISE EXCEPTION 'entitlement_issuance_key_conflict';
  END IF;
  RETURN v_entitlement;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_access_entitlement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT,
  UUID, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, DATE, INTEGER, BOOLEAN, UUID,
  DATE, TEXT[], TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_access_entitlement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT,
  UUID, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, DATE, INTEGER, BOOLEAN, UUID,
  DATE, TEXT[], TEXT, TEXT, JSONB, JSONB, TEXT, INTEGER, TIMESTAMPTZ
) TO service_role;
