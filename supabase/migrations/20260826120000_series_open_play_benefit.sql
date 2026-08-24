-- Generic managed-Series benefit: included Open Play during the exact Series
-- occurrence period. Configuration remains product-owned in resolver_rules;
-- access is issued through the existing canonical entitlement model.

CREATE OR REPLACE FUNCTION public.series_open_play_benefit_period(p_series_id UUID)
RETURNS TABLE(starts_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (MIN(session.session_date)::TIMESTAMP AT TIME ZONE 'Europe/Stockholm') AS starts_at,
    ((MAX(session.session_date) + 1)::TIMESTAMP AT TIME ZONE 'Europe/Stockholm') AS expires_at
  FROM public.activity_sessions session
  WHERE session.series_id = p_series_id
    AND session.is_active = true
    AND session.publish_status = 'published';
$$;

CREATE OR REPLACE FUNCTION public.series_open_play_benefit_enabled(p_series_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (product.resolver_rules #>> '{included_benefits,open_play_series_period,enabled}')::BOOLEAN,
    false
  )
  FROM public.activity_series series
  JOIN public.access_products product
    ON product.id = series.access_product_id
   AND product.venue_id = series.venue_id
  WHERE series.id = p_series_id
    AND series.format_id IS NOT NULL
    AND product.product_kind = 'series_access';
$$;

CREATE OR REPLACE FUNCTION public.sync_series_open_play_benefit(p_commitment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_commitment public.series_commitments;
  v_series public.activity_series;
  v_product public.access_products;
  v_customer public.customers;
  v_format_name TEXT;
  v_starts_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_entitlement public.access_entitlements;
  v_enabled BOOLEAN := false;
  v_house_comp BOOLEAN := false;
  v_access_reason TEXT;
  v_issuance_key TEXT := 'series_open_play:' || p_commitment_id::TEXT;
BEGIN
  SELECT * INTO v_commitment
  FROM public.series_commitments
  WHERE id = p_commitment_id
  FOR UPDATE;

  IF v_commitment.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = v_commitment.activity_series_id;

  IF v_series.id IS NOT NULL AND v_series.access_product_id IS NOT NULL THEN
    SELECT * INTO v_product
    FROM public.access_products
    WHERE id = v_series.access_product_id
      AND venue_id = v_series.venue_id
      AND product_kind = 'series_access';
  END IF;

  IF v_product.id IS NOT NULL THEN
    v_enabled := COALESCE(
      (v_product.resolver_rules #>> '{included_benefits,open_play_series_period,enabled}')::BOOLEAN,
      false
    );
  END IF;

  SELECT period.starts_at, period.expires_at
  INTO v_starts_at, v_expires_at
  FROM public.series_open_play_benefit_period(v_commitment.activity_series_id) period;

  SELECT format.name INTO v_format_name
  FROM public.activity_formats format
  WHERE format.id = v_series.format_id;

  v_access_reason := 'Ingår i ' || COALESCE(NULLIF(BTRIM(v_format_name), ''), NULLIF(BTRIM(v_series.name), ''), 'programmet');
  v_house_comp := COALESCE(v_commitment.metadata->>'funding_source', '') = 'series_staff_grant';

  SELECT * INTO v_entitlement
  FROM public.access_entitlements entitlement
  WHERE entitlement.organization_id = v_commitment.organization_id
    AND entitlement.issuance_key = v_issuance_key
  FOR UPDATE;

  IF v_commitment.status <> 'active' OR NOT v_enabled OR v_starts_at IS NULL OR v_expires_at IS NULL THEN
    IF v_entitlement.id IS NOT NULL AND v_entitlement.status <> 'revoked' THEN
      UPDATE public.access_entitlements
      SET status = 'revoked',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'revocation_source', CASE
              WHEN v_commitment.status <> 'active' THEN 'series_commitment_status'
              WHEN NOT v_enabled THEN 'series_benefit_disabled'
              ELSE 'series_occurrence_period_missing'
            END,
            'revoked_at', now()
          ),
          updated_at = now()
      WHERE id = v_entitlement.id;
    END IF;
    RETURN v_entitlement.id;
  END IF;

  IF v_commitment.participant_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
    FROM public.customers
    WHERE id = v_commitment.participant_customer_id
      AND organization_id = v_commitment.organization_id;
  END IF;

  IF v_entitlement.id IS NULL THEN
    INSERT INTO public.access_entitlements (
      organization_id, venue_id, customer_id, user_id, dependent_participant_id,
      entitlement_type, status, source_type, source_id, metadata, model_version,
      scope_type, meter_type, starts_at, expires_at, funding_type, funder,
      access_reason, requires_consumption, consumption_trigger, no_show_policy,
      occurrence_origin, constitution_version, scope_schema_version,
      resolution_priority, scarcity_class, resolution_origin_priority,
      issuance_key, includes_session_types
    ) VALUES (
      v_commitment.organization_id, v_commitment.venue_id,
      v_commitment.participant_customer_id, v_customer.auth_user_id,
      v_commitment.dependent_participant_id,
      'series_access', 'active', 'series_benefit', v_commitment.id,
      jsonb_build_object(
        'benefit_type', 'open_play_series_period',
        'activity_series_id', v_commitment.activity_series_id,
        'access_product_id', v_series.access_product_id,
        'series_commitment_id', v_commitment.id,
        'funding_source', CASE WHEN v_house_comp THEN 'series_staff_grant' ELSE 'series_commitment' END
      ),
      2, 'open_play', 'unlimited', v_starts_at, v_expires_at,
      CASE WHEN v_house_comp THEN 'house_granted' ELSE 'commerce_purchase' END,
      CASE WHEN v_house_comp THEN 'house_comped' ELSE 'self_prepaid' END,
      v_access_reason, false, 'on_commitment', 'do_not_consume',
      CASE WHEN v_house_comp THEN 'house_comped' ELSE 'paid' END,
      1, 1, 15, 'non_scarce', 0, v_issuance_key, ARRAY['open_play']::TEXT[]
    )
    RETURNING * INTO v_entitlement;
  ELSE
    UPDATE public.access_entitlements
    SET customer_id = v_commitment.participant_customer_id,
        user_id = v_customer.auth_user_id,
        dependent_participant_id = v_commitment.dependent_participant_id,
        status = 'active',
        starts_at = v_starts_at,
        expires_at = v_expires_at,
        access_reason = v_access_reason,
        funding_type = CASE WHEN v_house_comp THEN 'house_granted' ELSE 'commerce_purchase' END,
        funder = CASE WHEN v_house_comp THEN 'house_comped' ELSE 'self_prepaid' END,
        occurrence_origin = CASE WHEN v_house_comp THEN 'house_comped' ELSE 'paid' END,
        includes_session_types = ARRAY['open_play']::TEXT[],
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
          'benefit_type', 'open_play_series_period',
          'activity_series_id', v_commitment.activity_series_id,
          'access_product_id', v_series.access_product_id,
          'series_commitment_id', v_commitment.id,
          'reconciled_at', now()
        ),
        updated_at = now()
    WHERE id = v_entitlement.id
    RETURNING * INTO v_entitlement;
  END IF;

  UPDATE public.access_entitlement_scopes
  SET valid_from = v_starts_at,
      valid_until = v_expires_at
  WHERE entitlement_id = v_entitlement.id
    AND scope_kind = 'open_play';

  IF NOT FOUND THEN
    INSERT INTO public.access_entitlement_scopes (
      entitlement_id, organization_id, scope_kind, valid_from, valid_until
    ) VALUES (
      v_entitlement.id, v_commitment.organization_id, 'open_play', v_starts_at, v_expires_at
    );
  END IF;

  RETURN v_entitlement.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_series_open_play_benefits(p_series_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_commitment RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_commitment IN
    SELECT id
    FROM public.series_commitments
    WHERE activity_series_id = p_series_id
      AND commitment_type = 'participant'
  LOOP
    PERFORM public.sync_series_open_play_benefit(v_commitment.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_series_open_play_benefit(
  p_series_id UUID,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series;
  v_product public.access_products;
  v_current BOOLEAN;
  v_commitment_count INTEGER;
  v_order_count INTEGER;
  v_rules JSONB;
  v_starts_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id
    AND format_id IS NOT NULL
    AND access_product_id IS NOT NULL
  FOR UPDATE;

  IF v_series.id IS NULL THEN
    RAISE EXCEPTION 'series_open_play_benefit_series_not_found';
  END IF;

  SELECT * INTO v_product
  FROM public.access_products
  WHERE id = v_series.access_product_id
    AND venue_id = v_series.venue_id
    AND product_kind = 'series_access'
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'series_open_play_benefit_product_invalid';
  END IF;

  v_current := COALESCE(
    (v_product.resolver_rules #>> '{included_benefits,open_play_series_period,enabled}')::BOOLEAN,
    false
  );

  IF v_current IS DISTINCT FROM COALESCE(p_enabled, false) THEN
    SELECT COUNT(*) INTO v_commitment_count
    FROM public.series_commitments
    WHERE activity_series_id = v_series.id;

    SELECT COUNT(*) INTO v_order_count
    FROM public.commerce_order_lines line
    JOIN public.commerce_orders order_row ON order_row.id = line.commerce_order_id
    WHERE line.activity_series_id = v_series.id
      AND order_row.status IN ('checkout_pending', 'paid', 'attention', 'cancelled');

    IF v_commitment_count > 0 OR v_order_count > 0 THEN
      RAISE EXCEPTION 'series_open_play_benefit_commercial_history_locked';
    END IF;
  END IF;

  v_rules := COALESCE(v_product.resolver_rules, '{}'::JSONB)
    || jsonb_build_object(
      'included_benefits',
      COALESCE(v_product.resolver_rules->'included_benefits', '{}'::JSONB)
        || jsonb_build_object(
          'open_play_series_period',
          jsonb_build_object('enabled', COALESCE(p_enabled, false), 'period_source', 'active_series_occurrences')
        )
    );

  UPDATE public.access_products
  SET resolver_rules = v_rules,
      updated_at = now()
  WHERE id = v_product.id;

  PERFORM public.reconcile_series_open_play_benefits(v_series.id);

  SELECT period.starts_at, period.expires_at
  INTO v_starts_at, v_expires_at
  FROM public.series_open_play_benefit_period(v_series.id) period;

  RETURN jsonb_build_object(
    'series_id', v_series.id,
    'access_product_id', v_product.id,
    'enabled', COALESCE(p_enabled, false),
    'starts_at', v_starts_at,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_sync_series_open_play_benefit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_series_open_play_benefit(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_series_open_play_benefit_on_commitment ON public.series_commitments;
CREATE TRIGGER sync_series_open_play_benefit_on_commitment
AFTER INSERT OR UPDATE OF status, activity_series_id, participant_customer_id, dependent_participant_id
ON public.series_commitments
FOR EACH ROW
WHEN (NEW.commitment_type = 'participant')
EXECUTE FUNCTION public.trigger_sync_series_open_play_benefit();

CREATE OR REPLACE FUNCTION public.trigger_reconcile_series_open_play_benefits_from_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.series_id IS NOT NULL THEN
      PERFORM public.reconcile_series_open_play_benefits(OLD.series_id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.series_id IS DISTINCT FROM NEW.series_id AND OLD.series_id IS NOT NULL THEN
    PERFORM public.reconcile_series_open_play_benefits(OLD.series_id);
  END IF;
  IF NEW.series_id IS NOT NULL THEN
    PERFORM public.reconcile_series_open_play_benefits(NEW.series_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reconcile_series_open_play_benefits_on_session ON public.activity_sessions;
CREATE TRIGGER reconcile_series_open_play_benefits_on_session
AFTER INSERT OR DELETE OR UPDATE OF series_id, session_date, start_time, end_time, is_active, publish_status
ON public.activity_sessions
FOR EACH ROW
EXECUTE FUNCTION public.trigger_reconcile_series_open_play_benefits_from_session();

REVOKE ALL ON FUNCTION public.series_open_play_benefit_period(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.series_open_play_benefit_enabled(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_series_open_play_benefit(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_series_open_play_benefits(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_series_open_play_benefit(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.series_open_play_benefit_period(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.series_open_play_benefit_enabled(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_series_open_play_benefit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_series_open_play_benefits(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_series_open_play_benefit(UUID, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.set_series_open_play_benefit(UUID, BOOLEAN) IS
  'Configures the generic product-owned Open Play benefit for a managed sellable Series. Commercial history locks changes.';
COMMENT ON FUNCTION public.sync_series_open_play_benefit(UUID) IS
  'Idempotently issues, reconciles or revokes participant-owned Open Play access for one Series commitment.';
