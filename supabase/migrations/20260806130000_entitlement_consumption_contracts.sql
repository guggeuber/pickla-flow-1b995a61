-- One append-only consumption path for canonical participation rights.
-- A visit is consumed at actual check-in. Corrections append a reversal event.

CREATE TABLE public.entitlement_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entitlement_id UUID NOT NULL REFERENCES public.access_entitlements(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  activity_session_id UUID REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
  session_date DATE NOT NULL,
  registration_id UUID REFERENCES public.session_registrations(id) ON DELETE SET NULL,
  venue_checkin_id UUID REFERENCES public.venue_checkins(id) ON DELETE SET NULL,
  commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'use' CHECK (event_type IN ('use', 'reversal')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL),
  reverses_consumption_id UUID REFERENCES public.entitlement_consumptions(id) ON DELETE RESTRICT,
  funding_counterparty_ref TEXT,
  reason TEXT,
  access_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlement_consumptions_reversal_shape CHECK (
    (event_type = 'use' AND reverses_consumption_id IS NULL)
    OR (event_type = 'reversal' AND reverses_consumption_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX entitlement_consumptions_idempotency
  ON public.entitlement_consumptions (entitlement_id, idempotency_key);
CREATE UNIQUE INDEX entitlement_consumptions_checkin_once
  ON public.entitlement_consumptions (entitlement_id, venue_checkin_id)
  WHERE event_type = 'use' AND venue_checkin_id IS NOT NULL;
CREATE UNIQUE INDEX entitlement_consumptions_registration_once
  ON public.entitlement_consumptions (entitlement_id, registration_id)
  WHERE event_type = 'use' AND registration_id IS NOT NULL;
CREATE UNIQUE INDEX entitlement_consumptions_attendance_once
  ON public.entitlement_consumptions (entitlement_id, customer_id, activity_session_id, session_date)
  WHERE event_type = 'use' AND activity_session_id IS NOT NULL;
CREATE UNIQUE INDEX entitlement_consumptions_reversal_once
  ON public.entitlement_consumptions (reverses_consumption_id)
  WHERE event_type = 'reversal';
CREATE INDEX entitlement_consumptions_customer_history
  ON public.entitlement_consumptions (organization_id, customer_id, occurred_at DESC);
CREATE INDEX entitlement_consumptions_venue_history
  ON public.entitlement_consumptions (venue_id, occurred_at DESC);

ALTER TABLE public.venue_checkins
  ADD COLUMN IF NOT EXISTS entitlement_consumption_id UUID
  REFERENCES public.entitlement_consumptions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_checkins_entitlement_consumption
  ON public.venue_checkins (entitlement_consumption_id)
  WHERE entitlement_consumption_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_entitlement_consumption_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'entitlement_consumptions_are_append_only';
END;
$$;

CREATE TRIGGER prevent_entitlement_consumption_update
BEFORE UPDATE ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.prevent_entitlement_consumption_mutation();
CREATE TRIGGER prevent_entitlement_consumption_delete
BEFORE DELETE ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.prevent_entitlement_consumption_mutation();

CREATE OR REPLACE FUNCTION public.enforce_entitlement_consumption_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_venue_organization_id UUID;
  v_customer_organization_id UUID;
  v_original public.entitlement_consumptions;
BEGIN
  SELECT * INTO v_entitlement FROM public.access_entitlements WHERE id = NEW.entitlement_id;
  IF v_entitlement.id IS NULL THEN RAISE EXCEPTION 'consumption_entitlement_not_found'; END IF;

  SELECT organization_id INTO v_venue_organization_id FROM public.venues WHERE id = NEW.venue_id;
  SELECT organization_id INTO v_customer_organization_id FROM public.customers WHERE id = NEW.customer_id;
  IF NEW.organization_id <> v_entitlement.organization_id
     OR NEW.organization_id <> v_venue_organization_id
     OR NEW.organization_id <> v_customer_organization_id THEN
    RAISE EXCEPTION 'consumption_organization_mismatch';
  END IF;
  IF NEW.customer_id <> v_entitlement.customer_id THEN RAISE EXCEPTION 'consumption_customer_mismatch'; END IF;

  IF NEW.activity_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE id = NEW.activity_session_id AND venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'consumption_session_venue_mismatch';
  END IF;

  IF NEW.event_type = 'reversal' THEN
    SELECT * INTO v_original
    FROM public.entitlement_consumptions
    WHERE id = NEW.reverses_consumption_id;
    IF v_original.id IS NULL OR v_original.event_type <> 'use' THEN
      RAISE EXCEPTION 'consumption_reversal_requires_use_event';
    END IF;
    IF v_original.entitlement_id <> NEW.entitlement_id
       OR v_original.customer_id <> NEW.customer_id
       OR v_original.venue_id <> NEW.venue_id
       OR v_original.quantity <> NEW.quantity THEN
      RAISE EXCEPTION 'consumption_reversal_mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_entitlement_consumption_boundary
BEFORE INSERT ON public.entitlement_consumptions
FOR EACH ROW EXECUTE FUNCTION public.enforce_entitlement_consumption_boundary();

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

CREATE OR REPLACE FUNCTION public.reverse_entitlement_consumption(
  p_consumption_id UUID,
  p_idempotency_key TEXT,
  p_reason TEXT,
  p_occurred_at TIMESTAMPTZ DEFAULT now(),
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.entitlement_consumptions;
  v_existing public.entitlement_consumptions;
  v_reversal public.entitlement_consumptions;
  v_entitlement public.access_entitlements;
  v_next_uses INTEGER;
  v_next_status TEXT;
BEGIN
  IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL THEN RAISE EXCEPTION 'reversal_idempotency_key_required'; END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reversal_reason_required'; END IF;

  SELECT * INTO v_original
  FROM public.entitlement_consumptions
  WHERE id = p_consumption_id AND event_type = 'use';
  IF v_original.id IS NULL THEN RAISE EXCEPTION 'consumption_not_found'; END IF;

  SELECT * INTO v_existing
  FROM public.entitlement_consumptions
  WHERE entitlement_id = v_original.entitlement_id
    AND (idempotency_key = p_idempotency_key OR reverses_consumption_id = v_original.id)
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('reversal_id', v_existing.id, 'idempotent', true, 'entitlement_id', v_original.entitlement_id);
  END IF;

  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE id = v_original.entitlement_id
  FOR UPDATE;
  IF v_entitlement.id IS NULL THEN RAISE EXCEPTION 'entitlement_not_found'; END IF;

  INSERT INTO public.entitlement_consumptions (
    organization_id, entitlement_id, customer_id, venue_id, activity_session_id,
    session_date, registration_id, venue_checkin_id, commerce_order_id, event_type,
    quantity, occurred_at, idempotency_key, reverses_consumption_id,
    funding_counterparty_ref, reason, access_context, created_by
  ) VALUES (
    v_original.organization_id, v_original.entitlement_id, v_original.customer_id, v_original.venue_id,
    v_original.activity_session_id, v_original.session_date, v_original.registration_id,
    v_original.venue_checkin_id, v_original.commerce_order_id, 'reversal', v_original.quantity,
    p_occurred_at, p_idempotency_key, v_original.id, v_original.funding_counterparty_ref,
    p_reason, v_original.access_context, p_created_by
  )
  RETURNING * INTO v_reversal;

  v_next_uses := GREATEST(v_entitlement.uses_count - v_original.quantity, 0);
  v_next_status := CASE
    WHEN v_entitlement.status IN ('revoked', 'suspended', 'expired') THEN v_entitlement.status
    WHEN v_entitlement.expires_at IS NOT NULL AND p_occurred_at >= v_entitlement.expires_at THEN 'expired'
    ELSE 'active'
  END;
  UPDATE public.access_entitlements
  SET uses_count = v_next_uses, status = v_next_status
  WHERE id = v_entitlement.id;

  RETURN jsonb_build_object(
    'reversal_id', v_reversal.id,
    'idempotent', false,
    'entitlement_id', v_entitlement.id,
    'remaining_uses', CASE WHEN v_entitlement.meter_type IN ('occurrences', 'exact_session')
      THEN GREATEST(COALESCE(v_entitlement.uses_limit, 1) - v_next_uses, 0) ELSE NULL END,
    'entitlement_state', v_next_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in_with_entitlement(
  p_entitlement_id UUID,
  p_customer_id UUID,
  p_venue_id UUID,
  p_entry_type TEXT,
  p_session_date DATE,
  p_user_id UUID DEFAULT NULL,
  p_player_name TEXT DEFAULT NULL,
  p_player_phone TEXT DEFAULT NULL,
  p_checked_in_by UUID DEFAULT NULL,
  p_activity_session_id UUID DEFAULT NULL,
  p_registration_id UUID DEFAULT NULL,
  p_commerce_order_id UUID DEFAULT NULL,
  p_access_context JSONB DEFAULT '{}'::jsonb,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entitlement public.access_entitlements;
  v_checkin public.venue_checkins;
  v_consumption JSONB;
  v_inserted BOOLEAN := false;
BEGIN
  SELECT * INTO v_entitlement
  FROM public.access_entitlements
  WHERE id = p_entitlement_id;
  IF v_entitlement.id IS NULL OR v_entitlement.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'entitlement_checkin_not_authorized';
  END IF;

  SELECT * INTO v_checkin
  FROM public.venue_checkins
  WHERE venue_id = p_venue_id
    AND session_date = p_session_date
    AND entry_type = p_entry_type
    AND entitlement_id = p_entitlement_id
    AND checked_out_at IS NULL
  ORDER BY checked_in_at DESC
  LIMIT 1;

  IF v_checkin.id IS NULL THEN
    INSERT INTO public.venue_checkins (
      venue_id, customer_id, user_id, player_name, player_phone, entry_type,
      entitlement_id, checked_in_by, session_date, checked_in_at
    ) VALUES (
      p_venue_id, p_customer_id, p_user_id, p_player_name, p_player_phone, p_entry_type,
      p_entitlement_id, p_checked_in_by, p_session_date, p_occurred_at
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_checkin;
    v_inserted := v_checkin.id IS NOT NULL;

    IF v_checkin.id IS NULL THEN
      SELECT * INTO v_checkin
      FROM public.venue_checkins
      WHERE venue_id = p_venue_id
        AND session_date = p_session_date
        AND entry_type = p_entry_type
        AND entitlement_id = p_entitlement_id
        AND checked_out_at IS NULL
      ORDER BY checked_in_at DESC
      LIMIT 1;
    END IF;
  END IF;
  IF v_checkin.id IS NULL THEN RAISE EXCEPTION 'entitlement_checkin_conflict'; END IF;

  IF v_entitlement.requires_consumption THEN
    SELECT public.consume_access_entitlement(
      p_entitlement_id => p_entitlement_id,
      p_customer_id => p_customer_id,
      p_venue_id => p_venue_id,
      p_idempotency_key => 'checkin:' || v_checkin.id::text,
      p_quantity => 1,
      p_activity_session_id => p_activity_session_id,
      p_session_date => p_session_date,
      p_registration_id => p_registration_id,
      p_venue_checkin_id => v_checkin.id,
      p_commerce_order_id => p_commerce_order_id,
      p_occurred_at => p_occurred_at,
      p_access_context => COALESCE(p_access_context, '{}'::jsonb),
      p_created_by => p_checked_in_by
    ) INTO v_consumption;

    UPDATE public.venue_checkins
    SET entitlement_consumption_id = NULLIF(v_consumption->>'consumption_id', '')::uuid
    WHERE id = v_checkin.id AND entitlement_consumption_id IS NULL
    RETURNING * INTO v_checkin;
  END IF;

  RETURN jsonb_build_object(
    'checkin', to_jsonb(v_checkin),
    'consumption', v_consumption,
    'already_checked_in', NOT v_inserted
  );
END;
$$;

ALTER TABLE public.entitlement_consumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers and staff read entitlement consumption"
ON public.entitlement_consumptions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = entitlement_consumptions.customer_id
      AND customer.auth_user_id = auth.uid()
  )
  OR public.is_venue_member(auth.uid(), venue_id)
  OR public.is_super_admin()
);

REVOKE ALL ON public.entitlement_consumptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.entitlement_consumptions TO authenticated;
GRANT ALL ON public.entitlement_consumptions TO service_role;

REVOKE ALL ON FUNCTION public.consume_access_entitlement(
  UUID, UUID, UUID, TEXT, INTEGER, UUID, DATE, UUID, UUID, UUID, TIMESTAMPTZ, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_access_entitlement(
  UUID, UUID, UUID, TEXT, INTEGER, UUID, DATE, UUID, UUID, UUID, TIMESTAMPTZ, JSONB, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_entitlement_consumption(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_entitlement_consumption(UUID, TEXT, TEXT, TIMESTAMPTZ, UUID)
TO service_role;

REVOKE ALL ON FUNCTION public.check_in_with_entitlement(
  UUID, UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_with_entitlement(
  UUID, UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ
) TO service_role;

COMMENT ON TABLE public.entitlement_consumptions IS
  'Append-only real attendance events. Corrections append one reversal; rows are never edited or deleted.';
COMMENT ON FUNCTION public.check_in_with_entitlement(
  UUID, UUID, UUID, TEXT, DATE, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, JSONB, TIMESTAMPTZ
) IS 'Atomic check-in plus entitlement consumption. Retries return the original attendance and cannot consume twice.';
