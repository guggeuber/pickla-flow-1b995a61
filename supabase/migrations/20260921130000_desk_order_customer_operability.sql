-- Desk/Admin order operability repair.
-- Canonically ordered after the independently reviewed product-media migration.
--
-- Keep one quantity-aware pickup command for both tracked merchandise and
-- stockless desk-pickup products (for example multi-racket rentals). Tracked
-- inventory continues to require and consume its allocation. Stockless lines
-- deliberately have no inventory allocation, but still need atomic quantity,
-- idempotency, refund, and audit truth.

ALTER TABLE public.commerce_pickup_commands
  ALTER COLUMN allocation_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.commerce_r2a_collect_pickup(
  p_order_line_id UUID,
  p_quantity INTEGER,
  p_venue_id UUID,
  p_idempotency_key TEXT,
  p_actor_user_id UUID
) RETURNS TABLE(collected_quantity INTEGER, remaining_quantity INTEGER, fulfillment_status TEXT, replayed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_line public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_allocation public.inventory_allocations%ROWTYPE;
  v_level public.inventory_levels%ROWTYPE;
  v_command public.commerce_pickup_commands%ROWTYPE;
  v_remaining INTEGER;
  v_succeeded_refund_quantity INTEGER;
  v_is_tracked BOOLEAN;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'pickup_quantity_must_be_positive'; END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) < 8 THEN
    RAISE EXCEPTION 'pickup_idempotency_key_required';
  END IF;

  PERFORM public.commerce_r2a_assert_staff(p_actor_user_id, p_venue_id);

  SELECT * INTO v_line
  FROM public.commerce_order_lines
  WHERE id = p_order_line_id;
  IF NOT FOUND OR v_line.fulfillment_type <> 'desk_pickup' THEN
    RAISE EXCEPTION 'pickup_line_not_found';
  END IF;

  SELECT * INTO v_order
  FROM public.commerce_orders
  WHERE id = v_line.commerce_order_id
  FOR UPDATE;
  SELECT * INTO v_line
  FROM public.commerce_order_lines
  WHERE id = p_order_line_id
  FOR UPDATE;
  IF v_order.venue_id <> p_venue_id THEN
    RAISE EXCEPTION 'pickup_not_authorized';
  END IF;
  IF v_order.status = 'attention' THEN RAISE EXCEPTION 'pickup_blocked_by_order_attention'; END IF;
  IF v_order.status <> 'paid' THEN RAISE EXCEPTION 'pickup_not_authorized'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_venue_id::TEXT || ':' || p_idempotency_key, 0));
  SELECT * INTO v_command
  FROM public.commerce_pickup_commands
  WHERE venue_id = p_venue_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.order_line_id <> p_order_line_id OR v_command.quantity <> p_quantity
      OR v_command.actor_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT
      (v_command.result->>'collected_quantity')::INTEGER,
      (v_command.result->>'remaining_quantity')::INTEGER,
      v_command.result->>'fulfillment_status',
      true;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.commerce_refund_lines rl
    JOIN public.commerce_refunds r ON r.id = rl.refund_id
    WHERE rl.commerce_order_line_id = p_order_line_id
      AND r.status IN ('preparing', 'pending', 'attention')
  ) THEN
    RAISE EXCEPTION 'pickup_blocked_by_pending_refund';
  END IF;

  SELECT COALESCE(sum(rl.quantity), 0)::INTEGER
  INTO v_succeeded_refund_quantity
  FROM public.commerce_refund_lines rl
  JOIN public.commerce_refunds r ON r.id = rl.refund_id
  WHERE rl.commerce_order_line_id = p_order_line_id
    AND r.status = 'succeeded';

  v_is_tracked := v_line.inventory_policy = 'tracked';
  IF v_is_tracked THEN
    SELECT * INTO v_allocation
    FROM public.inventory_allocations
    WHERE commerce_order_line_id = p_order_line_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory_allocation_not_found'; END IF;

    v_remaining := v_allocation.quantity - v_allocation.collected_quantity - v_allocation.cancelled_quantity
      - GREATEST(v_succeeded_refund_quantity - v_allocation.collected_quantity, 0);
    IF p_quantity > v_remaining THEN
      RAISE EXCEPTION 'pickup_quantity_conflicts_with_allocation_or_refund';
    END IF;

    SELECT * INTO v_level
    FROM public.inventory_levels
    WHERE variant_id = v_allocation.variant_id AND location_id = v_allocation.location_id
    FOR UPDATE;
    IF NOT FOUND OR v_level.incident_blocked THEN RAISE EXCEPTION 'inventory_incident_blocked'; END IF;
    IF v_level.on_hand < p_quantity OR v_level.allocated < p_quantity THEN
      RAISE EXCEPTION 'pickup_balance_mismatch';
    END IF;
  ELSE
    IF v_succeeded_refund_quantity > 0 THEN
      RAISE EXCEPTION 'stockless_pickup_blocked_by_succeeded_refund';
    END IF;
    v_remaining := v_line.quantity - v_line.collected_quantity - v_line.cancelled_quantity;
    IF p_quantity > v_remaining THEN
      RAISE EXCEPTION 'pickup_quantity_conflicts_with_order_or_refund';
    END IF;
  END IF;

  INSERT INTO public.commerce_pickup_commands (
    idempotency_key, venue_id, order_line_id, allocation_id, quantity, actor_user_id
  ) VALUES (
    p_idempotency_key, p_venue_id, p_order_line_id,
    CASE WHEN v_is_tracked THEN v_allocation.id ELSE NULL END,
    p_quantity, p_actor_user_id
  )
  RETURNING * INTO v_command;

  IF v_is_tracked THEN
    UPDATE public.inventory_levels
    SET on_hand = on_hand - p_quantity,
        allocated = allocated - p_quantity,
        version = version + 1
    WHERE id = v_level.id;

    UPDATE public.inventory_allocations
    SET collected_quantity = inventory_allocations.collected_quantity + p_quantity,
        status = CASE
          WHEN inventory_allocations.collected_quantity + p_quantity
            + inventory_allocations.cancelled_quantity = inventory_allocations.quantity
            THEN 'collected'
          ELSE 'partially_collected'
        END
    WHERE id = v_allocation.id
    RETURNING * INTO v_allocation;
  END IF;

  UPDATE public.commerce_order_lines
  SET collected_quantity = commerce_order_lines.collected_quantity + p_quantity,
      fulfillment_status = CASE
        WHEN commerce_order_lines.collected_quantity + p_quantity
          + commerce_order_lines.cancelled_quantity
          = commerce_order_lines.quantity
          THEN 'collected'
        ELSE 'pending_pickup'
      END,
      fulfilled_at = CASE
        WHEN commerce_order_lines.collected_quantity + p_quantity
          + commerce_order_lines.cancelled_quantity
          = commerce_order_lines.quantity
          THEN now()
        ELSE NULL
      END,
      fulfilled_by = p_actor_user_id
  WHERE id = p_order_line_id
  RETURNING * INTO v_line;

  IF v_is_tracked THEN
    INSERT INTO public.inventory_movements (
      variant_id, location_id, movement_type, on_hand_delta, allocated_delta,
      source_effect_key, source_entity_type, source_entity_id, order_id, order_line_id,
      actor_user_id, reason, metadata
    ) VALUES (
      v_allocation.variant_id, v_allocation.location_id, 'pickup', -p_quantity, -p_quantity,
      'pickup:' || v_command.id, 'commerce_pickup_command', v_command.id::TEXT,
      v_order.id, p_order_line_id, p_actor_user_id, 'Customer pickup',
      jsonb_build_object('allocation_id', v_allocation.id)
    );
    v_remaining := v_allocation.quantity - v_allocation.collected_quantity - v_allocation.cancelled_quantity;
  ELSE
    v_remaining := v_line.quantity - v_line.collected_quantity - v_line.cancelled_quantity;
  END IF;

  v_remaining := GREATEST(v_remaining, 0);
  UPDATE public.commerce_pickup_commands
  SET result = jsonb_build_object(
    'collected_quantity', v_line.collected_quantity,
    'remaining_quantity', v_remaining,
    'fulfillment_status', v_line.fulfillment_status,
    'inventory_policy', v_line.inventory_policy
  )
  WHERE id = v_command.id;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, p_venue_id, p_actor_user_id, 'user',
    'commerce.fulfillment.quantity_collected', 'commerce_order_lines', p_order_line_id::TEXT,
    p_idempotency_key,
    jsonb_build_object('collected_quantity', v_line.collected_quantity - p_quantity),
    to_jsonb(v_line),
    jsonb_build_object(
      'quantity', p_quantity,
      'allocation_id', CASE WHEN v_is_tracked THEN v_allocation.id ELSE NULL END,
      'inventory_policy', v_line.inventory_policy
    )
  );

  RETURN QUERY SELECT v_line.collected_quantity, v_remaining, v_line.fulfillment_status, false;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_r2a_collect_pickup(UUID, INTEGER, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commerce_r2a_collect_pickup(UUID, INTEGER, UUID, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_r2a_collect_pickup(UUID, INTEGER, UUID, TEXT, UUID) TO service_role;
