-- Operationalize configured partner programs on the canonical entitlement model.
-- This migration creates no Bruce program, customer entitlement, eligibility,
-- consumption, or receivable rows.

ALTER TABLE public.partner_programs
  ADD COLUMN IF NOT EXISTS consumption_trigger TEXT NOT NULL DEFAULT 'on_checkin',
  ADD COLUMN IF NOT EXISTS no_show_policy TEXT NOT NULL DEFAULT 'do_not_consume';

ALTER TABLE public.partner_programs
  ADD CONSTRAINT partner_programs_consumption_trigger_check
    CHECK (consumption_trigger IN ('on_checkin', 'on_commitment', 'on_session_end')) NOT VALID,
  ADD CONSTRAINT partner_programs_no_show_policy_check
    CHECK (no_show_policy IN ('do_not_consume', 'consume', 'manual_review')) NOT VALID;

ALTER TABLE public.partner_programs
  VALIDATE CONSTRAINT partner_programs_consumption_trigger_check;
ALTER TABLE public.partner_programs
  VALIDATE CONSTRAINT partner_programs_no_show_policy_check;

-- A program is not one attendance source for life. Each external partner
-- assignment receives a deterministic source UUID below, while this index
-- prevents duplicate non-revoked access for one customer/occurrence.
CREATE UNIQUE INDEX access_entitlements_partner_occurrence_once
  ON public.access_entitlements (
    partner_program_id, customer_id, activity_session_id, service_date
  )
  WHERE entitlement_type = 'partner_access' AND status <> 'revoked';

-- Preserve the released property-driven resolver as the base implementation.
-- The wrapper adds only the generic partner-program boundary: a partner right
-- cannot cover a disabled session or an inactive/expired program. If that
-- partner right is unavailable, the original resolver chooses the next asset.
ALTER FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) RENAME TO resolve_access_entitlement_without_partner_policy;

CREATE FUNCTION public.resolve_access_entitlement(
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
  v_result JSONB;
  v_partner_valid BOOLEAN := false;
  v_entitlement_types JSONB;
  v_retry_context JSONB;
  v_customer_id UUID;
  v_service_date DATE;
  v_timezone TEXT;
  v_partner_entitlement public.access_entitlements;
BEGIN
  v_result := public.resolve_access_entitlement_without_partner_policy(
    p_venue_id,
    p_customer_id,
    p_user_id,
    p_activity_session_id,
    p_service_date,
    p_at,
    p_product_key,
    COALESCE(p_access_context, '{}'::jsonb)
  );

  IF COALESCE(v_result->>'covered', 'false') <> 'true'
     OR v_result->>'entitlement_type' IS DISTINCT FROM 'partner_access' THEN
    RETURN v_result;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.access_entitlements entitlement
    JOIN public.partner_programs program ON program.id = entitlement.partner_program_id
    JOIN public.partner_program_sessions eligibility
      ON eligibility.partner_program_id = program.id
      AND eligibility.activity_session_id = p_activity_session_id
      AND eligibility.venue_id = p_venue_id
      AND eligibility.status = 'eligible'
    WHERE entitlement.id = (v_result->>'entitlement_id')::uuid
      AND program.status = 'active'
      AND (program.valid_from IS NULL OR p_at >= program.valid_from)
      AND (program.valid_until IS NULL OR p_at < program.valid_until)
  ) INTO v_partner_valid;

  IF v_partner_valid THEN
    RETURN v_result;
  END IF;

  v_customer_id := NULLIF(v_result->>'customer_id', '')::uuid;
  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm')
  INTO v_timezone
  FROM public.venues
  WHERE id = p_venue_id;
  v_service_date := COALESCE(p_service_date, (p_at AT TIME ZONE COALESCE(v_timezone, 'Europe/Stockholm'))::date);

  -- A customer may legitimately hold more than one partner-funded right. If
  -- the released resolver first encountered an inactive program, retain the
  -- canonical property order and try the next valid partner right before
  -- falling back to another entitlement type.
  SELECT entitlement.* INTO v_partner_entitlement
  FROM public.access_entitlements entitlement
  JOIN public.partner_programs program ON program.id = entitlement.partner_program_id
  JOIN public.partner_program_sessions eligibility
    ON eligibility.partner_program_id = program.id
    AND eligibility.activity_session_id = p_activity_session_id
    AND eligibility.venue_id = p_venue_id
    AND eligibility.status = 'eligible'
  WHERE entitlement.organization_id = (
      SELECT organization_id FROM public.venues WHERE id = p_venue_id
    )
    AND entitlement.customer_id = v_customer_id
    AND entitlement.entitlement_type = 'partner_access'
    AND entitlement.status = 'active'
    AND entitlement.scope_type = 'exact_session'
    AND entitlement.activity_session_id = p_activity_session_id
    AND COALESCE(entitlement.service_date, entitlement.session_date, v_service_date) = v_service_date
    AND (COALESCE(entitlement.starts_at, entitlement.valid_from) IS NULL
      OR p_at >= COALESCE(entitlement.starts_at, entitlement.valid_from))
    AND (COALESCE(entitlement.expires_at, entitlement.valid_until) IS NULL
      OR p_at < COALESCE(entitlement.expires_at, entitlement.valid_until))
    AND COALESCE(entitlement.uses_count, 0) < COALESCE(entitlement.uses_limit, 1)
    AND program.status = 'active'
    AND (program.valid_from IS NULL OR v_service_date >= program.valid_from::date)
    AND (program.valid_until IS NULL OR v_service_date < program.valid_until::date)
    AND (
      NOT (COALESCE(p_access_context, '{}'::jsonb) ? 'entitlement_types')
      OR entitlement.entitlement_type IN (
        SELECT jsonb_array_elements_text(COALESCE(p_access_context, '{}'::jsonb)->'entitlement_types')
      )
    )
  ORDER BY
    entitlement.resolution_priority,
    CASE entitlement.scarcity_class WHEN 'non_scarce' THEN 0 ELSE 1 END,
    entitlement.resolution_origin_priority,
    entitlement.resolution_expiry_at ASC NULLS LAST,
    entitlement.created_at
  LIMIT 1;

  IF v_partner_entitlement.id IS NOT NULL THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'status', 'covered',
      'covered', true,
      'customer_id', v_customer_id,
      'entitlement_id', v_partner_entitlement.id,
      'entitlement_type', v_partner_entitlement.entitlement_type,
      'access_reason', COALESCE(NULLIF(v_partner_entitlement.access_reason, ''), 'Giltig rättighet'),
      'meter_type', v_partner_entitlement.meter_type,
      'remaining_uses', GREATEST(COALESCE(v_partner_entitlement.uses_limit, 1) - COALESCE(v_partner_entitlement.uses_count, 0), 0),
      'funding_type', v_partner_entitlement.funding_type,
      'funder', v_partner_entitlement.funder,
      'funding_counterparty_ref', v_partner_entitlement.funding_counterparty_ref,
      'consumption_required', v_partner_entitlement.requires_consumption,
      'consumption_trigger', v_partner_entitlement.consumption_trigger,
      'no_show_policy', v_partner_entitlement.no_show_policy,
      'occurrence_origin', v_partner_entitlement.occurrence_origin,
      'pricing_consequence', 'included',
      'source_type', v_partner_entitlement.source_type,
      'service_date', v_service_date
    ));
  END IF;

  IF COALESCE(p_access_context, '{}'::jsonb) ? 'entitlement_types' THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_entitlement_types
    FROM jsonb_array_elements_text(COALESCE(p_access_context, '{}'::jsonb)->'entitlement_types') AS allowed(value)
    WHERE value <> 'partner_access';
  ELSE
    SELECT COALESCE(jsonb_agg(entitlement_type ORDER BY entitlement_type), '[]'::jsonb)
    INTO v_entitlement_types
    FROM (
      SELECT DISTINCT entitlement.entitlement_type
      FROM public.access_entitlements entitlement
      WHERE entitlement.customer_id = v_customer_id
        AND entitlement.entitlement_type <> 'partner_access'
    ) remaining;
  END IF;

  IF jsonb_array_length(v_entitlement_types) = 0 THEN
    RETURN jsonb_build_object(
      'status', 'wrong_scope',
      'covered', false,
      'customer_id', v_customer_id,
      'reason', 'partner_program_not_available'
    );
  END IF;

  v_retry_context := jsonb_set(
    COALESCE(p_access_context, '{}'::jsonb),
    '{entitlement_types}',
    v_entitlement_types,
    true
  );
  RETURN public.resolve_access_entitlement_without_partner_policy(
    p_venue_id,
    p_customer_id,
    p_user_id,
    p_activity_session_id,
    p_service_date,
    p_at,
    p_product_key,
    v_retry_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_access_entitlement_without_partner_policy(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_access_entitlement_without_partner_policy(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

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
BEGIN
  IF NULLIF(BTRIM(p_external_reference), '') IS NULL THEN RAISE EXCEPTION 'partner_external_reference_required'; END IF;
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

  v_assignment_source_id := (
    SUBSTR(MD5(v_program.id::text || ':' || BTRIM(p_external_reference)), 1, 8) || '-' ||
    SUBSTR(MD5(v_program.id::text || ':' || BTRIM(p_external_reference)), 9, 4) || '-' ||
    SUBSTR(MD5(v_program.id::text || ':' || BTRIM(p_external_reference)), 13, 4) || '-' ||
    SUBSTR(MD5(v_program.id::text || ':' || BTRIM(p_external_reference)), 17, 4) || '-' ||
    SUBSTR(MD5(v_program.id::text || ':' || BTRIM(p_external_reference)), 21, 12)
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

-- Manual attendance reconciliation remains an ordinary canonical consumption.
-- This trigger merely requires and freezes the operator audit fields before the
-- append-only consumption row and receivable event are written.
CREATE OR REPLACE FUNCTION public.prepare_manual_entitlement_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.event_type = 'use'
     AND COALESCE(NEW.access_context->>'source', '') = 'manual_reconciliation' THEN
    IF NEW.created_by IS NULL OR NULLIF(BTRIM(NEW.access_context->>'reason'), '') IS NULL THEN
      RAISE EXCEPTION 'manual_reconciliation_actor_and_reason_required';
    END IF;
    NEW.reason := BTRIM(NEW.access_context->>'reason');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_manual_entitlement_reconciliation
BEFORE INSERT ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.prepare_manual_entitlement_reconciliation();

COMMENT ON COLUMN public.partner_programs.consumption_trigger IS
  'Configured trigger inherited by newly issued partner entitlements. Bruce defaults to on_checkin; no partner-specific resolver branch exists.';
COMMENT ON COLUMN public.partner_programs.no_show_policy IS
  'Configured no-show doctrine inherited by newly issued partner entitlements.';
COMMENT ON FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) IS 'Canonical property-driven resolver with generic active-program and explicit session-eligibility enforcement for partner-funded rights.';
