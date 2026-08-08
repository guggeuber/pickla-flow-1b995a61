-- Canonical person-owned access model.
-- Existing rows remain model_version 1. Nothing below guesses historic scope or funding.

ALTER TABLE public.access_entitlements
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS model_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scope_type TEXT,
  ADD COLUMN IF NOT EXISTS meter_type TEXT,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_date DATE,
  ADD COLUMN IF NOT EXISTS funding_type TEXT,
  ADD COLUMN IF NOT EXISTS funding_counterparty_ref TEXT,
  ADD COLUMN IF NOT EXISTS access_reason TEXT,
  ADD COLUMN IF NOT EXISTS requires_consumption BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS issuance_key TEXT;

UPDATE public.access_entitlements entitlement
SET organization_id = venue.organization_id
FROM public.venues venue
WHERE entitlement.venue_id = venue.id
  AND entitlement.organization_id IS NULL;

ALTER TABLE public.access_entitlements
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.access_entitlements
  DROP CONSTRAINT IF EXISTS access_entitlements_status_check;
ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_status_check
  CHECK (status IN ('active', 'exhausted', 'expired', 'revoked', 'suspended', 'consumed'));

ALTER TABLE public.access_entitlements
  DROP CONSTRAINT IF EXISTS access_entitlements_type_check;
ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_type_check
  CHECK (entitlement_type IN (
    'day_access', 'session_ticket', 'membership_access', 'booking_access',
    'punch_card', 'partner_access'
  ));

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_model_version_check
  CHECK (model_version IN (1, 2)) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_model_version_check;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_scope_type_check
  CHECK (scope_type IS NULL OR scope_type IN (
    'exact_session', 'activity_series', 'session_type', 'product_key',
    'open_play', 'venue', 'selected_venues', 'brand', 'sport_type', 'allowlist'
  )) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_scope_type_check;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_meter_type_check
  CHECK (meter_type IS NULL OR meter_type IN (
    'unlimited', 'occurrences', 'one_per_day', 'valid_day', 'exact_session'
  )) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_meter_type_check;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_funding_type_check
  CHECK (funding_type IS NULL OR funding_type IN (
    'customer_prepaid', 'subscription', 'house_granted', 'partner_funded',
    'legacy_import', 'commerce_purchase'
  )) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_funding_type_check;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_canonical_required
  CHECK (
    model_version = 1 OR (
      customer_id IS NOT NULL
      AND scope_type IS NOT NULL
      AND meter_type IS NOT NULL
      AND funding_type IS NOT NULL
      AND NULLIF(BTRIM(access_reason), '') IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_canonical_required;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_validity_order
  CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_validity_order;

ALTER TABLE public.access_entitlements
  ADD CONSTRAINT access_entitlements_occurrence_meter_check
  CHECK (
    meter_type IS DISTINCT FROM 'occurrences'
    OR (uses_limit IS NOT NULL AND uses_limit > 0 AND uses_count BETWEEN 0 AND uses_limit)
  ) NOT VALID;
ALTER TABLE public.access_entitlements
  VALIDATE CONSTRAINT access_entitlements_occurrence_meter_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_entitlements_issuance_key
  ON public.access_entitlements (organization_id, issuance_key)
  WHERE issuance_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_entitlements_customer_resolution
  ON public.access_entitlements (organization_id, customer_id, status, starts_at, expires_at);

CREATE TABLE IF NOT EXISTS public.access_entitlement_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES public.access_entitlements(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN (
    'exact_session', 'activity_series', 'session_type', 'product_key',
    'open_play', 'venue', 'brand', 'sport_type'
  )),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  activity_series_id UUID REFERENCES public.activity_series(id) ON DELETE CASCADE,
  access_product_id UUID REFERENCES public.access_products(id) ON DELETE CASCADE,
  scope_value TEXT,
  service_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_entitlement_scopes_locator_check CHECK (
    (scope_kind = 'exact_session' AND activity_session_id IS NOT NULL AND venue_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'activity_series' AND activity_series_id IS NOT NULL AND venue_id IS NULL AND activity_session_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'venue' AND venue_id IS NOT NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
    OR (scope_kind = 'product_key' AND (access_product_id IS NOT NULL OR NULLIF(BTRIM(scope_value), '') IS NOT NULL) AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL)
    OR (scope_kind IN ('session_type', 'sport_type') AND NULLIF(BTRIM(scope_value), '') IS NOT NULL AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL)
    OR (scope_kind IN ('open_play', 'brand') AND venue_id IS NULL AND activity_session_id IS NULL AND activity_series_id IS NULL AND access_product_id IS NULL AND scope_value IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_entitlement_scopes_unique
  ON public.access_entitlement_scopes (
    entitlement_id,
    scope_kind,
    COALESCE(venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(activity_session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(activity_series_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(access_product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_value, ''),
    COALESCE(service_date, '0001-01-01'::date)
  );

CREATE INDEX IF NOT EXISTS idx_access_entitlement_scopes_entitlement
  ON public.access_entitlement_scopes (entitlement_id, scope_kind);
CREATE INDEX IF NOT EXISTS idx_access_entitlement_scopes_session
  ON public.access_entitlement_scopes (activity_session_id, service_date)
  WHERE activity_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_access_entitlement_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_organization_id UUID;
  v_customer_organization_id UUID;
  v_customer_user_id UUID;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM public.venues
  WHERE id = NEW.venue_id;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'entitlement_venue_missing_organization';
  END IF;

  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_organization_id;
  ELSIF NEW.organization_id <> v_organization_id THEN
    RAISE EXCEPTION 'entitlement_organization_mismatch';
  END IF;

  IF NEW.customer_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT c.id INTO NEW.customer_id
    FROM public.customers c
    WHERE c.organization_id = v_organization_id
      AND c.auth_user_id = NEW.user_id
      AND c.status = 'active'
      AND c.merged_into_id IS NULL
    LIMIT 1;

    IF NEW.customer_id IS NULL THEN
      SELECT pp.customer_id INTO NEW.customer_id
      FROM public.player_profiles pp
      JOIN public.customers c ON c.id = pp.customer_id
      WHERE pp.auth_user_id = NEW.user_id
        AND c.organization_id = v_organization_id
        AND c.status = 'active'
        AND c.merged_into_id IS NULL
      LIMIT 1;
    END IF;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT organization_id, auth_user_id
    INTO v_customer_organization_id, v_customer_user_id
    FROM public.customers
    WHERE id = NEW.customer_id
      AND status = 'active'
      AND merged_into_id IS NULL;

    IF v_customer_organization_id IS NULL THEN
      RAISE EXCEPTION 'entitlement_customer_not_active';
    END IF;
    IF v_customer_organization_id <> v_organization_id THEN
      RAISE EXCEPTION 'entitlement_customer_organization_mismatch';
    END IF;
    IF NEW.user_id IS NOT NULL AND v_customer_user_id IS NOT NULL AND v_customer_user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'entitlement_user_customer_mismatch';
    END IF;
  END IF;

  IF NEW.starts_at IS NULL AND NEW.valid_from IS NOT NULL THEN NEW.starts_at := NEW.valid_from; END IF;
  IF NEW.expires_at IS NULL AND NEW.valid_until IS NOT NULL THEN NEW.expires_at := NEW.valid_until; END IF;
  IF NEW.service_date IS NULL AND NEW.valid_date IS NOT NULL THEN NEW.service_date := NEW.valid_date; END IF;
  IF NEW.valid_from IS NULL AND NEW.starts_at IS NOT NULL THEN NEW.valid_from := NEW.starts_at; END IF;
  IF NEW.valid_until IS NULL AND NEW.expires_at IS NOT NULL THEN NEW.valid_until := NEW.expires_at; END IF;
  IF NEW.valid_date IS NULL AND NEW.service_date IS NOT NULL AND NEW.meter_type = 'valid_day' THEN NEW.valid_date := NEW.service_date; END IF;

  IF NEW.model_version = 2 THEN
    IF NEW.customer_id IS NULL THEN RAISE EXCEPTION 'canonical_entitlement_requires_customer'; END IF;
    IF NEW.meter_type = 'occurrences' AND (NEW.uses_limit IS NULL OR NEW.uses_limit <= 0) THEN
      RAISE EXCEPTION 'occurrence_entitlement_requires_positive_limit';
    END IF;
    IF NEW.meter_type = 'exact_session' AND NEW.uses_limit IS NULL THEN NEW.uses_limit := 1; END IF;
    IF NEW.scope_type = 'exact_session' AND NEW.activity_session_id IS NULL THEN
      RAISE EXCEPTION 'exact_session_entitlement_requires_session';
    END IF;
    IF NEW.meter_type IN ('valid_day', 'one_per_day') AND NEW.service_date IS NULL THEN
      RAISE EXCEPTION 'day_meter_requires_service_date';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_access_entitlement_boundary ON public.access_entitlements;
CREATE TRIGGER enforce_access_entitlement_boundary
BEFORE INSERT OR UPDATE ON public.access_entitlements
FOR EACH ROW EXECUTE FUNCTION public.enforce_access_entitlement_boundary();

CREATE OR REPLACE FUNCTION public.enforce_access_entitlement_scope_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement_organization_id UUID;
  v_scope_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_entitlement_organization_id
  FROM public.access_entitlements
  WHERE id = NEW.entitlement_id;
  IF v_entitlement_organization_id IS NULL THEN RAISE EXCEPTION 'scope_entitlement_missing'; END IF;
  IF NEW.organization_id <> v_entitlement_organization_id THEN RAISE EXCEPTION 'scope_organization_mismatch'; END IF;

  IF NEW.venue_id IS NOT NULL THEN
    SELECT organization_id INTO v_scope_organization_id FROM public.venues WHERE id = NEW.venue_id;
  ELSIF NEW.activity_session_id IS NOT NULL THEN
    SELECT v.organization_id INTO v_scope_organization_id
    FROM public.activity_sessions s JOIN public.venues v ON v.id = s.venue_id
    WHERE s.id = NEW.activity_session_id;
  ELSIF NEW.activity_series_id IS NOT NULL THEN
    SELECT v.organization_id INTO v_scope_organization_id
    FROM public.activity_series s JOIN public.venues v ON v.id = s.venue_id
    WHERE s.id = NEW.activity_series_id;
  ELSIF NEW.access_product_id IS NOT NULL THEN
    SELECT v.organization_id INTO v_scope_organization_id
    FROM public.access_products p JOIN public.venues v ON v.id = p.venue_id
    WHERE p.id = NEW.access_product_id;
  ELSE
    v_scope_organization_id := NEW.organization_id;
  END IF;

  IF v_scope_organization_id IS NULL OR v_scope_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'scope_resource_organization_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_access_entitlement_scope_boundary ON public.access_entitlement_scopes;
CREATE TRIGGER enforce_access_entitlement_scope_boundary
BEFORE INSERT OR UPDATE ON public.access_entitlement_scopes
FOR EACH ROW EXECUTE FUNCTION public.enforce_access_entitlement_scope_boundary();

CREATE OR REPLACE FUNCTION public.issue_access_entitlement(
  p_customer_id UUID,
  p_venue_id UUID,
  p_entitlement_type TEXT,
  p_scope_type TEXT,
  p_meter_type TEXT,
  p_funding_type TEXT,
  p_access_reason TEXT,
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
  p_scopes JSONB DEFAULT '[]'::jsonb
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
    funding_counterparty_ref, access_reason, requires_consumption, issuance_key
  ) VALUES (
    v_organization_id, p_venue_id, p_customer_id, p_user_id, p_entitlement_type, 'active',
    p_source_type, p_source_id, p_activity_session_id, p_session_date,
    CASE WHEN p_meter_type = 'valid_day' THEN p_service_date ELSE NULL END,
    COALESCE(p_includes_session_types, '{}'::text[]), p_uses_limit, 0, COALESCE(p_metadata, '{}'::jsonb), 2,
    p_scope_type, p_meter_type, p_starts_at, p_expires_at, p_service_date, p_funding_type,
    p_funding_counterparty_ref, p_access_reason, p_requires_consumption, p_issuance_key
  )
  RETURNING * INTO v_entitlement;

  FOR v_scope IN SELECT value FROM jsonb_array_elements(p_scopes)
  LOOP
    INSERT INTO public.access_entitlement_scopes (
      entitlement_id, organization_id, scope_kind, venue_id, activity_session_id,
      activity_series_id, access_product_id, scope_value, service_date
    ) VALUES (
      v_entitlement.id,
      v_organization_id,
      v_scope->>'scope_kind',
      NULLIF(v_scope->>'venue_id', '')::uuid,
      NULLIF(v_scope->>'activity_session_id', '')::uuid,
      NULLIF(v_scope->>'activity_series_id', '')::uuid,
      NULLIF(v_scope->>'access_product_id', '')::uuid,
      NULLIF(v_scope->>'scope_value', ''),
      NULLIF(v_scope->>'service_date', '')::date
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
      CASE
        WHEN entitlement.scope_type = 'exact_session' OR entitlement.entitlement_type IN ('session_ticket', 'booking_access') THEN 10
        WHEN entitlement.entitlement_type = 'membership_access' THEN 20
        WHEN entitlement.entitlement_type = 'day_access' THEN 30
        WHEN entitlement.entitlement_type = 'punch_card' THEN 40
        WHEN entitlement.entitlement_type = 'partner_access' THEN 50
        ELSE 60
      END,
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
       AND (v_entitlement.scope_type IS NULL OR v_entitlement.meter_type IS NULL OR v_entitlement.funding_type IS NULL) THEN
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
        )
        WHEN 'session_type' THEN v_entitlement.venue_id = p_venue_id AND (
          v_session_type = ANY(v_entitlement.includes_session_types)
          OR EXISTS (
            SELECT 1 FROM public.access_entitlement_scopes scope
            WHERE scope.entitlement_id = v_entitlement.id
              AND scope.scope_kind = 'session_type' AND scope.scope_value = v_session_type
          )
        )
        WHEN 'product_key' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          LEFT JOIN public.access_products product ON product.id = scope.access_product_id
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'product_key'
            AND COALESCE(scope.scope_value, product.product_key) = v_product_key
        )
        WHEN 'open_play' THEN v_entitlement.venue_id = p_venue_id AND v_session_type = 'open_play'
        WHEN 'venue' THEN v_entitlement.venue_id = p_venue_id
        WHEN 'selected_venues' THEN EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id
        )
        WHEN 'brand' THEN v_entitlement.organization_id = v_organization_id
        WHEN 'sport_type' THEN v_entitlement.venue_id = p_venue_id AND EXISTS (
          SELECT 1 FROM public.access_entitlement_scopes scope
          WHERE scope.entitlement_id = v_entitlement.id
            AND scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type
        )
        WHEN 'allowlist' THEN EXISTS (
          SELECT 1
          FROM public.access_entitlement_scopes scope
          LEFT JOIN public.access_products product ON product.id = scope.access_product_id
          WHERE scope.entitlement_id = v_entitlement.id
            AND (
              (scope.scope_kind = 'exact_session' AND scope.activity_session_id = p_activity_session_id AND (scope.service_date IS NULL OR scope.service_date = v_service_date))
              OR (scope.scope_kind = 'activity_series' AND scope.activity_series_id = v_series_id)
              OR (scope.scope_kind = 'session_type' AND scope.scope_value = v_session_type)
              OR (scope.scope_kind = 'product_key' AND COALESCE(scope.scope_value, product.product_key) = v_product_key)
              OR (scope.scope_kind = 'open_play' AND v_session_type = 'open_play')
              OR (scope.scope_kind = 'venue' AND scope.venue_id = p_venue_id)
              OR (scope.scope_kind = 'brand' AND scope.organization_id = v_organization_id)
              OR (scope.scope_kind = 'sport_type' AND scope.scope_value = v_sport_type)
            )
        )
        ELSE false
      END;

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
      'funding_counterparty_ref', v_entitlement.funding_counterparty_ref,
      'consumption_required', v_entitlement.requires_consumption,
      'pricing_consequence', 'included',
      'source_type', v_entitlement.source_type,
      'service_date', v_service_date
    ));
  END LOOP;

  RETURN jsonb_build_object('status', v_rejection, 'covered', false, 'customer_id', v_customer_id);
END;
$$;

ALTER TABLE public.access_entitlement_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own access entitlements" ON public.access_entitlements;
CREATE POLICY "Users read own access entitlements"
ON public.access_entitlements FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = access_entitlements.customer_id
      AND customer.auth_user_id = auth.uid()
  )
  OR public.is_venue_member(auth.uid(), venue_id)
  OR public.is_super_admin()
);

DROP POLICY IF EXISTS "Venue staff can manage access entitlements" ON public.access_entitlements;

CREATE POLICY "Users and staff read entitlement scopes"
ON public.access_entitlement_scopes FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.access_entitlements entitlement
    WHERE entitlement.id = access_entitlement_scopes.entitlement_id
      AND (
        entitlement.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.customers customer
          WHERE customer.id = entitlement.customer_id
            AND customer.auth_user_id = auth.uid()
        )
        OR public.is_venue_member(auth.uid(), entitlement.venue_id)
        OR public.is_super_admin()
      )
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.access_entitlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.access_entitlement_scopes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.access_entitlements TO authenticated;
GRANT SELECT ON public.access_entitlement_scopes TO authenticated;
GRANT ALL ON public.access_entitlements, public.access_entitlement_scopes TO service_role;

REVOKE ALL ON FUNCTION public.issue_access_entitlement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ,
  TIMESTAMPTZ, DATE, INTEGER, BOOLEAN, UUID, DATE, TEXT[], TEXT, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_access_entitlement(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID, TIMESTAMPTZ,
  TIMESTAMPTZ, DATE, INTEGER, BOOLEAN, UUID, DATE, TEXT[], TEXT, TEXT, JSONB, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_access_entitlement(
  UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB
) TO service_role;

COMMENT ON TABLE public.access_entitlements IS
  'Canonical person/customer-owned participation rights. model_version 1 rows retain approved legacy semantics; version 2 rows require explicit scope, meter, funding and customer ownership.';
COMMENT ON TABLE public.access_entitlement_scopes IS
  'References existing venue, session, series, product and sport truths; never copies schedules.';
COMMENT ON FUNCTION public.resolve_access_entitlement(UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB) IS
  'Server-authoritative participation coverage decision. Does not create money, consume stored value or choose payment sources.';
