-- Commerce R1B: canonical standalone Shop drafts and idempotent pickup fulfillment.
-- Activity draft identity and pricing semantics are intentionally unchanged.

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS draft_idempotency_key_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_active_shop_user_draft
  ON public.commerce_orders (venue_id, user_id)
  WHERE status = 'draft'
    AND draft_scope = 'shop'
    AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_active_shop_guest_draft
  ON public.commerce_orders (venue_id, draft_idempotency_key_hash)
  WHERE status = 'draft'
    AND draft_scope = 'shop'
    AND user_id IS NULL
    AND draft_idempotency_key_hash IS NOT NULL;

COMMENT ON COLUMN public.commerce_orders.draft_idempotency_key_hash IS
  'SHA-256 of the client-held standalone Shop bearer/idempotency key. Never stores the raw key.';

COMMENT ON COLUMN public.commerce_orders.draft_scope IS
  'Canonical Commerce draft scope. Activity uses activity:<session_id>:<session_date>; standalone Shop uses shop.';

CREATE OR REPLACE FUNCTION public.replace_commerce_cart_lines(
  p_order_id UUID,
  p_expected_version INTEGER,
  p_lines JSONB,
  p_guest_name TEXT DEFAULT NULL,
  p_guest_email TEXT DEFAULT NULL,
  p_guest_phone TEXT DEFAULT NULL
) RETURNS TABLE(order_id UUID, version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_item JSONB;
  v_is_empty BOOLEAN;
BEGIN
  SELECT * INTO v_order
  FROM public.commerce_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;
  IF v_order.status <> 'draft' THEN RAISE EXCEPTION 'commerce_order_not_draft'; END IF;
  IF v_order.version <> p_expected_version THEN RAISE EXCEPTION 'stale_cart_version'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'commerce_order_lines_invalid'; END IF;

  v_is_empty := jsonb_array_length(p_lines) = 0;
  IF v_is_empty AND v_order.draft_scope IS DISTINCT FROM 'shop' THEN
    RAISE EXCEPTION 'commerce_order_empty';
  END IF;

  DELETE FROM public.commerce_order_lines WHERE commerce_order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.commerce_order_lines (
      id, commerce_order_id, product_id, product_key, product_name, commerce_kind,
      quantity, unit_price_minor, discount_minor, line_total_inc_vat_minor,
      vat_rate, vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
      fulfillment_type, fulfillment_status, activity_session_id, session_date,
      beneficiary_customer_id, beneficiary_user_id, parent_line_id,
      product_snapshot, metadata, sort_order
    ) VALUES (
      (v_item->>'id')::UUID, p_order_id, (v_item->>'product_id')::UUID,
      v_item->>'product_key', v_item->>'product_name', v_item->>'commerce_kind',
      GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 1), 1), 0, 0, 0,
      COALESCE((v_item->>'vat_rate')::NUMERIC, 0), 0, 0,
      v_item->>'source_type', NULLIF(v_item->>'source_id', ''),
      v_item->>'fulfillment_type', 'not_required',
      NULLIF(v_item->>'activity_session_id', '')::UUID,
      NULLIF(v_item->>'session_date', '')::DATE,
      NULLIF(v_item->>'beneficiary_customer_id', '')::UUID,
      NULLIF(v_item->>'beneficiary_user_id', '')::UUID,
      NULLIF(v_item->>'parent_line_id', '')::UUID,
      COALESCE(v_item->'product_snapshot', '{}'::JSONB),
      COALESCE(v_item->'metadata', '{}'::JSONB),
      COALESCE((v_item->>'sort_order')::INTEGER, 0)
    );
  END LOOP;

  UPDATE public.commerce_orders
  SET version = commerce_orders.version + 1,
      guest_name = COALESCE(NULLIF(BTRIM(p_guest_name), ''), guest_name),
      guest_email = COALESCE(NULLIF(lower(BTRIM(p_guest_email)), ''), guest_email),
      guest_phone = COALESCE(NULLIF(BTRIM(p_guest_phone), ''), guest_phone),
      subtotal_minor = CASE WHEN v_is_empty THEN 0 ELSE subtotal_minor END,
      discount_minor = CASE WHEN v_is_empty THEN 0 ELSE discount_minor END,
      total_inc_vat_minor = CASE WHEN v_is_empty THEN 0 ELSE total_inc_vat_minor END,
      total_ex_vat_minor = CASE WHEN v_is_empty THEN 0 ELSE total_ex_vat_minor END,
      vat_amount_minor = CASE WHEN v_is_empty THEN 0 ELSE vat_amount_minor END
  WHERE id = p_order_id
  RETURNING id, commerce_orders.version INTO order_id, version;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_commerce_fulfillment(
  p_line_id UUID,
  p_next_status TEXT,
  p_actor_user_id UUID,
  p_request_id TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS public.commerce_order_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before public.commerce_order_lines%ROWTYPE;
  v_after public.commerce_order_lines%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
BEGIN
  IF p_next_status NOT IN ('pending_pickup', 'collected', 'not_collected', 'attention') THEN
    RAISE EXCEPTION 'invalid_fulfillment_status';
  END IF;

  SELECT * INTO v_before
  FROM public.commerce_order_lines
  WHERE id = p_line_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_line_not_found'; END IF;
  IF v_before.fulfillment_type <> 'desk_pickup' THEN RAISE EXCEPTION 'line_does_not_require_pickup'; END IF;

  SELECT * INTO v_order FROM public.commerce_orders WHERE id = v_before.commerce_order_id;

  -- A fulfilled line is terminal. A retry returns the original state without
  -- touching fulfillment timestamps or producing a second audit event.
  IF v_before.fulfillment_status = 'collected' THEN
    IF p_next_status = 'collected' THEN RETURN v_before; END IF;
    RAISE EXCEPTION 'commerce_fulfillment_already_collected';
  END IF;

  IF v_order.status NOT IN ('paid', 'attention') THEN RAISE EXCEPTION 'commerce_order_not_paid'; END IF;
  IF v_before.fulfillment_status = p_next_status THEN RETURN v_before; END IF;
  IF p_next_status = 'collected' AND v_before.fulfillment_status NOT IN ('pending_pickup', 'attention') THEN
    RAISE EXCEPTION 'commerce_line_not_collectable';
  END IF;

  UPDATE public.commerce_order_lines
  SET fulfillment_status = p_next_status,
      fulfilled_at = CASE WHEN p_next_status = 'collected' THEN now() ELSE NULL END,
      fulfilled_by = CASE WHEN p_next_status = 'collected' THEN p_actor_user_id ELSE NULL END
  WHERE id = p_line_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.venue_id, p_actor_user_id, 'user',
    'commerce.fulfillment.transition', 'commerce_order_lines', p_line_id::TEXT,
    p_request_id, to_jsonb(v_before), to_jsonb(v_after), COALESCE(p_metadata, '{}'::JSONB)
  );

  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_commerce_cart_lines(UUID, INTEGER, JSONB, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.transition_commerce_fulfillment(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_commerce_fulfillment(UUID, TEXT, UUID, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_commerce_fulfillment(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;
