-- Activity cancellation is a participation command, not a refund side effect.
-- Keep registration, entitlement, invitation and capacity-hold truth atomic
-- while leaving paid financial records untouched until refund reconciliation.

CREATE OR REPLACE FUNCTION public.cancel_activity_registration_participation(
  p_registration_id UUID,
  p_order_id UUID DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'customer',
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_refund_id TEXT DEFAULT NULL,
  p_requested_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  changed BOOLEAN,
  registration_status TEXT,
  order_status TEXT,
  financial_state TEXT,
  hold_status TEXT,
  available_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registration public.session_registrations%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_line public.commerce_order_lines%ROWTYPE;
  v_hold public.capacity_holds%ROWTYPE;
  v_before_status TEXT;
  v_source TEXT := lower(NULLIF(BTRIM(COALESCE(p_source, '')), ''));
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_request_id TEXT := NULLIF(BTRIM(COALESCE(p_request_id, '')), '');
  v_refund_id TEXT := NULLIF(BTRIM(COALESCE(p_refund_id, '')), '');
  v_requested_at TIMESTAMPTZ := COALESCE(p_requested_at, now());
  v_day_pass BOOLEAN := false;
  v_order_paid BOOLEAN := false;
  v_hold_changed INTEGER := 0;
  v_entitlement_changed INTEGER := 0;
  v_invitation_changed INTEGER := 0;
  v_capacity INTEGER;
  v_organization_id UUID;
BEGIN
  IF v_source IS NULL OR v_source NOT IN ('customer', 'staff', 'system', 'stripe_refund', 'repair') THEN
    RAISE EXCEPTION 'invalid_activity_cancellation_source';
  END IF;

  -- Read the immutable scope first, then serialize against every hold/commit
  -- command for this exact occurrence before taking mutable row locks.
  SELECT * INTO v_registration
  FROM public.session_registrations
  WHERE id = p_registration_id;
  IF v_registration.id IS NULL THEN
    RAISE EXCEPTION 'activity_registration_not_found';
  END IF;

  PERFORM public.capacity_lock_scope(
    v_registration.venue_id,
    'activity_session',
    v_registration.activity_session_id::TEXT,
    v_registration.session_date
  );

  SELECT * INTO v_registration
  FROM public.session_registrations
  WHERE id = p_registration_id
  FOR UPDATE;
  v_before_status := v_registration.status;

  IF v_source = 'customer'
    AND (p_actor_user_id IS NULL OR v_registration.user_id IS DISTINCT FROM p_actor_user_id) THEN
    RAISE EXCEPTION 'activity_cancellation_owner_mismatch';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.commerce_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF v_order.id IS NULL THEN
      RAISE EXCEPTION 'activity_cancellation_order_not_found';
    END IF;

    SELECT * INTO v_line
    FROM public.commerce_order_lines
    WHERE commerce_order_id = v_order.id
      AND session_registration_id = v_registration.id
      AND commerce_kind = 'participation'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE;
    IF v_line.id IS NULL THEN
      RAISE EXCEPTION 'activity_cancellation_order_registration_mismatch';
    END IF;
  ELSE
    SELECT * INTO v_line
    FROM public.commerce_order_lines
    WHERE session_registration_id = v_registration.id
      AND commerce_kind = 'participation'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF v_line.id IS NOT NULL THEN
      SELECT * INTO v_order
      FROM public.commerce_orders
      WHERE id = v_line.commerce_order_id
      FOR UPDATE;
    END IF;
  END IF;

  IF v_order.id IS NOT NULL THEN
    IF v_order.venue_id IS DISTINCT FROM v_registration.venue_id THEN
      RAISE EXCEPTION 'activity_cancellation_venue_mismatch';
    END IF;
    IF v_order.status NOT IN ('paid', 'attention', 'cancelled') THEN
      RAISE EXCEPTION 'activity_cancellation_order_not_settled';
    END IF;
    v_order_paid := COALESCE(v_order.total_inc_vat_minor, 0) > 0;
    v_refund_id := COALESCE(v_refund_id, NULLIF(BTRIM(COALESCE(v_order.metadata->>'stripe_refund_id', '')), ''));
    IF v_source = 'customer' AND v_order_paid AND v_refund_id IS NULL THEN
      RAISE EXCEPTION 'paid_customer_cancellation_requires_refund_request';
    END IF;
  END IF;

  v_day_pass := v_line.id IS NOT NULL AND (
    v_line.product_key = 'day_access'
    OR v_line.resolver_snapshot->>'purchase_kind' = 'day_pass'
  );

  changed := v_before_status <> 'cancelled';

  UPDATE public.session_registrations
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
        'participation_cancelled_at', v_requested_at,
        'participation_cancellation_source', v_source,
        'participation_cancellation_reason', v_reason,
        'participation_cancellation_request_id', v_request_id,
        'participation_refund_id', v_refund_id
      )),
      updated_at = now()
  WHERE id = v_registration.id;

  IF v_day_pass AND v_order.id IS NOT NULL THEN
    UPDATE public.access_entitlements
    SET status = 'revoked'
    WHERE source_type = 'commerce_order'
      AND source_id = v_order.id
      AND status <> 'revoked';
    GET DIAGNOSTICS v_entitlement_changed = ROW_COUNT;

    UPDATE public.day_passes
    SET status = 'cancelled'
    WHERE commerce_order_id = v_order.id
      AND status <> 'cancelled';
  ELSE
    UPDATE public.access_entitlements
    SET status = 'revoked'
    WHERE source_type = 'session_ticket'
      AND source_id = v_registration.id
      AND status <> 'revoked';
    GET DIAGNOSTICS v_entitlement_changed = ROW_COUNT;
  END IF;

  UPDATE public.activity_participant_invitations
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
        'participation_cancelled_at', v_requested_at,
        'participation_cancellation_source', v_source,
        'participation_cancellation_request_id', v_request_id
      )),
      updated_at = now()
  WHERE registration_id = v_registration.id
    AND status <> 'cancelled';
  GET DIAGNOSTICS v_invitation_changed = ROW_COUNT;

  IF v_line.capacity_hold_id IS NOT NULL THEN
    UPDATE public.capacity_holds
    SET status = 'released',
        released_at = COALESCE(released_at, now()),
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
          'release_reason', 'activity_participation_cancelled',
          'registration_id', v_registration.id,
          'cancellation_source', v_source,
          'cancellation_request_id', v_request_id
        )),
        updated_at = now()
    WHERE id = v_line.capacity_hold_id
      AND status IN ('active', 'committed');
    GET DIAGNOSTICS v_hold_changed = ROW_COUNT;
  ELSE
    UPDATE public.capacity_holds
    SET status = 'released',
        released_at = COALESCE(released_at, now()),
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
          'release_reason', 'activity_participation_cancelled',
          'registration_id', v_registration.id,
          'cancellation_source', v_source,
          'cancellation_request_id', v_request_id
        )),
        updated_at = now()
    WHERE venue_id = v_registration.venue_id
      AND scope_type = 'activity_session'
      AND scope_id = v_registration.activity_session_id::TEXT
      AND session_date = v_registration.session_date
      AND metadata->>'registration_id' = v_registration.id::TEXT
      AND status IN ('active', 'committed');
    GET DIAGNOSTICS v_hold_changed = ROW_COUNT;
  END IF;

  IF v_order.id IS NOT NULL THEN
    IF v_order_paid THEN
      UPDATE public.commerce_orders
      SET metadata = COALESCE(metadata, '{}'::JSONB)
          || jsonb_strip_nulls(jsonb_build_object(
            'participation_cancelled_at', v_requested_at,
            'participation_cancellation_source', v_source,
            'participation_cancellation_request_id', v_request_id,
            'participation_refund_id', v_refund_id
          ))
          || CASE WHEN v_refund_id IS NOT NULL THEN jsonb_build_object(
            'cancellation_requested_at', COALESCE(metadata->>'cancellation_requested_at', v_requested_at::TEXT),
            'cancellation_source', v_source,
            'stripe_refund_id', v_refund_id
          ) ELSE '{}'::JSONB END
      WHERE id = v_order.id;
    ELSE
      UPDATE public.commerce_orders
      SET status = 'cancelled',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
            'cancelled_at', COALESCE(metadata->>'cancelled_at', v_requested_at::TEXT),
            'cancellation_source', v_source,
            'participation_cancelled_at', v_requested_at,
            'participation_cancellation_request_id', v_request_id
          ))
      WHERE id = v_order.id;
    END IF;
  END IF;

  IF changed OR v_hold_changed > 0 OR v_entitlement_changed > 0 OR v_invitation_changed > 0 THEN
    SELECT organization_id INTO v_organization_id
    FROM public.venues
    WHERE id = v_registration.venue_id;

    INSERT INTO public.audit_log (
      organization_id, venue_id, actor_user_id, actor_type, action,
      entity_table, entity_id, request_id, before, after, metadata
    ) VALUES (
      v_organization_id,
      v_registration.venue_id,
      p_actor_user_id,
      CASE WHEN v_source = 'stripe_refund' THEN 'webhook'
           WHEN v_source IN ('system', 'repair') THEN 'system'
           ELSE 'user' END,
      'activity_registration.participation_cancelled',
      'session_registrations',
      v_registration.id::TEXT,
      v_request_id,
      jsonb_build_object('status', v_before_status, 'has_place', v_before_status IN ('confirmed', 'checked_in', 'no_show')),
      jsonb_build_object('status', 'cancelled', 'has_place', false),
      jsonb_strip_nulls(jsonb_build_object(
        'activity_session_id', v_registration.activity_session_id,
        'session_date', v_registration.session_date,
        'commerce_order_id', v_order.id,
        'financial_state', CASE
          WHEN v_order.id IS NULL THEN 'unmanaged'
          WHEN NOT v_order_paid THEN 'not_applicable'
          WHEN v_refund_id IS NOT NULL THEN 'refund_requested'
          ELSE 'paid_not_refunded'
        END,
        'refund_id', v_refund_id,
        'capacity_hold_released', v_hold_changed > 0,
        'entitlement_revoked', v_entitlement_changed > 0,
        'invitation_cancelled', v_invitation_changed > 0,
        'reason', v_reason
      ))
    );
  END IF;

  SELECT capacity INTO v_capacity
  FROM public.activity_sessions
  WHERE id = v_registration.activity_session_id
    AND venue_id = v_registration.venue_id;

  IF v_line.capacity_hold_id IS NOT NULL THEN
    SELECT * INTO v_hold
    FROM public.capacity_holds
    WHERE id = v_line.capacity_hold_id;
  END IF;

  registration_status := 'cancelled';
  order_status := CASE
    WHEN v_order.id IS NULL THEN NULL
    WHEN v_order_paid THEN v_order.status
    ELSE 'cancelled'
  END;
  financial_state := CASE
    WHEN v_order.id IS NULL THEN 'unmanaged'
    WHEN NOT v_order_paid THEN 'not_applicable'
    WHEN v_refund_id IS NOT NULL THEN 'refund_requested'
    ELSE 'paid_not_refunded'
  END;
  hold_status := v_hold.status;
  available_count := CASE WHEN COALESCE(v_capacity, 0) <= 0 THEN NULL ELSE GREATEST(
    v_capacity
      - public.capacity_committed_count(
          v_registration.venue_id,
          'activity_session',
          v_registration.activity_session_id::TEXT,
          v_registration.session_date
        )
      - public.capacity_active_holds_count(
          v_registration.venue_id,
          'activity_session',
          v_registration.activity_session_id::TEXT,
          v_registration.session_date
        ),
    0
  ) END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_activity_registration_participation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_activity_registration_participation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.cancel_activity_registration_participation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS 'Atomically cancels one activity occurrence participation under the canonical capacity lock. Paid order, receipt and refund truth remain independent.';
