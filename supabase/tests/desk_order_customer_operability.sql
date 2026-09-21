\set ON_ERROR_STOP on
BEGIN;

-- Synthetic fixture permanently mirrors the observed production shape while
-- every mutation remains inside this rollback-only transaction.
INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'd9f6a210-0000-4000-8000-000000000001',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'Desk order operability test', 'desk-order-operability-test', true
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('d9f6a210-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'desk.staff.synthetic@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d9f6a210-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'marcus.synthetic@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Marcus"}', now(), now());

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('d9f6a210-0000-4000-8000-000000000002', 'd9f6a210-0000-4000-8000-000000000001', 'venue_admin', true);

UPDATE public.customers
SET display_name = 'Marcus',
    primary_email = 'marcus.synthetic@example.test',
    email_normalized = 'marcus.synthetic@example.test',
    status = 'active'
WHERE auth_user_id = 'd9f6a210-0000-4000-8000-000000000003';

INSERT INTO public.customer_venue_profiles (customer_id, venue_id, first_seen_at, last_seen_at)
VALUES ((SELECT id FROM public.customers WHERE auth_user_id = 'd9f6a210-0000-4000-8000-000000000003'), 'd9f6a210-0000-4000-8000-000000000001', now(), now());

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, customer_id, user_id, status, version, currency,
  subtotal_minor, total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor,
  guest_token_hash, guest_name, guest_email, checkout_frozen_at, paid_at
) VALUES (
  'd9f6a210-0000-4000-8000-000000000010',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'd9f6a210-0000-4000-8000-000000000001',
  (SELECT id FROM public.customers WHERE auth_user_id = 'd9f6a210-0000-4000-8000-000000000003'),
  'd9f6a210-0000-4000-8000-000000000003',
  'draft', 7, 'SEK', 20000, 20000, 18868, 1132, repeat('a', 64),
  'Marcus Theander', 'marcus.synthetic@example.test', now(), now()
);

INSERT INTO public.commerce_order_lines (
  id, commerce_order_id, product_key, product_name, commerce_kind, quantity,
  unit_price_minor, line_total_inc_vat_minor, line_total_ex_vat_minor, vat_rate,
  vat_amount_minor, source_type, fulfillment_type, fulfillment_status,
  product_snapshot, inventory_policy
) VALUES (
  'd9f6a210-0000-4000-8000-000000000011',
  'd9f6a210-0000-4000-8000-000000000010', 'synthetic_hyrrack', 'Hyrrack',
  'rental', 4, 5000, 20000, 18868, 6, 1132, 'catalog', 'desk_pickup',
  'pending_pickup', '{"name":"Hyrrack","unit_price_minor":5000,"vat_rate":6}'::jsonb,
  'stockless'
);
UPDATE public.commerce_orders SET status = 'paid' WHERE id = 'd9f6a210-0000-4000-8000-000000000010';

INSERT INTO public.booking_receipts (
  id, receipt_number, venue_id, user_id, customer_id, customer_name, customer_email,
  total_inc_vat, total_ex_vat, vat_amount, total_inc_vat_sek, total_ex_vat_sek,
  vat_amount_sek, vat_rate, currency, payment_provider, payment_method,
  payment_status, purchase_type, product_description, commerce_order_id
) VALUES (
  'd9f6a210-0000-4000-8000-000000000012', 'PICKLA-2026-000829',
  'd9f6a210-0000-4000-8000-000000000001',
  'd9f6a210-0000-4000-8000-000000000003',
  (SELECT id FROM public.customers WHERE auth_user_id = 'd9f6a210-0000-4000-8000-000000000003'), 'Marcus Theander',
  'marcus.synthetic@example.test', 200, 189, 11, 200, 188.68, 11.32, 6,
  'SEK', 'stripe', 'Card via Stripe', 'paid', 'commerce_order', 'Hyrrack × 4',
  'd9f6a210-0000-4000-8000-000000000010'
);
UPDATE public.commerce_orders
SET booking_receipt_id = 'd9f6a210-0000-4000-8000-000000000012'
WHERE id = 'd9f6a210-0000-4000-8000-000000000010';

DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.commerce_r2a_collect_pickup(
    'd9f6a210-0000-4000-8000-000000000011', 1,
    'd9f6a210-0000-4000-8000-000000000001', 'synthetic-pickup-one',
    'd9f6a210-0000-4000-8000-000000000002'
  );
  IF v_result.collected_quantity <> 1 OR v_result.remaining_quantity <> 3
    OR v_result.fulfillment_status <> 'pending_pickup' OR v_result.replayed THEN
    RAISE EXCEPTION 'partial stockless pickup did not move 4 to 3: %', to_jsonb(v_result);
  END IF;

  SELECT * INTO v_result FROM public.commerce_r2a_collect_pickup(
    'd9f6a210-0000-4000-8000-000000000011', 1,
    'd9f6a210-0000-4000-8000-000000000001', 'synthetic-pickup-one',
    'd9f6a210-0000-4000-8000-000000000002'
  );
  IF NOT v_result.replayed OR v_result.collected_quantity <> 1 OR v_result.remaining_quantity <> 3
    OR (SELECT collected_quantity FROM public.commerce_order_lines WHERE id = 'd9f6a210-0000-4000-8000-000000000011') <> 1 THEN
    RAISE EXCEPTION 'pickup replay issued twice: %', to_jsonb(v_result);
  END IF;

  SELECT * INTO v_result FROM public.commerce_r2a_collect_pickup(
    'd9f6a210-0000-4000-8000-000000000011', 3,
    'd9f6a210-0000-4000-8000-000000000001', 'synthetic-pickup-all-three',
    'd9f6a210-0000-4000-8000-000000000002'
  );
  IF v_result.collected_quantity <> 4 OR v_result.remaining_quantity <> 0
    OR v_result.fulfillment_status <> 'collected' THEN
    RAISE EXCEPTION 'pickup all did not complete safely: %', to_jsonb(v_result);
  END IF;

  BEGIN
    PERFORM * FROM public.commerce_r2a_collect_pickup(
      'd9f6a210-0000-4000-8000-000000000011', 1,
      'd9f6a210-0000-4000-8000-000000000001', 'synthetic-over-issue',
      'd9f6a210-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'over-collection was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'over-collection was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%pickup_quantity_conflicts_with_order_or_refund%' THEN RAISE; END IF;
  END;
END $$;

-- Attention and unresolved refund states are hard server-side pickup gates.
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, status, currency, subtotal_minor,
  total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor, guest_token_hash,
  guest_name, guest_email, paid_at
) VALUES
  ('d9f6a210-0000-4000-8000-000000000020', (SELECT id FROM public.organizations WHERE slug = 'pickla'),
   'd9f6a210-0000-4000-8000-000000000001', 'draft', 'SEK', 5000, 5000, 4717, 283,
   repeat('b', 64), 'Attention Guest', 'attention.synthetic@example.test', now()),
  ('d9f6a210-0000-4000-8000-000000000030', (SELECT id FROM public.organizations WHERE slug = 'pickla'),
   'd9f6a210-0000-4000-8000-000000000001', 'draft', 'SEK', 5000, 5000, 4717, 283,
   repeat('c', 64), 'Refund Guest', 'refund.synthetic@example.test', now());

INSERT INTO public.commerce_order_lines (
  id, commerce_order_id, product_key, product_name, commerce_kind, quantity,
  unit_price_minor, line_total_inc_vat_minor, line_total_ex_vat_minor, vat_rate,
  vat_amount_minor, source_type, fulfillment_type, fulfillment_status, inventory_policy
) VALUES
  ('d9f6a210-0000-4000-8000-000000000021', 'd9f6a210-0000-4000-8000-000000000020',
   'attention_racket', 'Hyrrack', 'rental', 1, 5000, 5000, 4717, 6, 283,
   'catalog', 'desk_pickup', 'pending_pickup', 'stockless'),
  ('d9f6a210-0000-4000-8000-000000000031', 'd9f6a210-0000-4000-8000-000000000030',
   'refund_racket', 'Hyrrack', 'rental', 1, 5000, 5000, 4717, 6, 283,
   'catalog', 'desk_pickup', 'pending_pickup', 'stockless');
UPDATE public.commerce_orders
SET status = CASE id
  WHEN 'd9f6a210-0000-4000-8000-000000000020'::uuid THEN 'attention'
  ELSE 'paid'
END
WHERE id IN ('d9f6a210-0000-4000-8000-000000000020', 'd9f6a210-0000-4000-8000-000000000030');

INSERT INTO public.commerce_refunds (
  id, commerce_order_id, idempotency_key, refund_type, status,
  amount_inc_vat_minor, vat_amount_minor, currency, provider_environment,
  provider_account_key, provider_idempotency_key, provider_request, actor_user_id, reason
) VALUES (
  'd9f6a210-0000-4000-8000-000000000032', 'd9f6a210-0000-4000-8000-000000000030',
  'synthetic-refund', 'quantity', 'pending', 5000, 283, 'SEK', 'test',
  'platform', 'synthetic-refund-provider', '{}'::jsonb,
  'd9f6a210-0000-4000-8000-000000000002', 'Synthetic pending refund gate'
);
INSERT INTO public.commerce_refund_lines (
  refund_id, commerce_order_line_id, quantity, amount_inc_vat_minor, vat_amount_minor
) VALUES (
  'd9f6a210-0000-4000-8000-000000000032',
  'd9f6a210-0000-4000-8000-000000000031', 1, 5000, 283
);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.commerce_r2a_collect_pickup(
      'd9f6a210-0000-4000-8000-000000000021', 1,
      'd9f6a210-0000-4000-8000-000000000001', 'synthetic-attention-block',
      'd9f6a210-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'attention pickup was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'attention pickup was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%pickup_blocked_by_order_attention%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.commerce_r2a_collect_pickup(
      'd9f6a210-0000-4000-8000-000000000031', 1,
      'd9f6a210-0000-4000-8000-000000000001', 'synthetic-refund-block',
      'd9f6a210-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'pending-refund pickup was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'pending-refund pickup was accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%pickup_blocked_by_pending_refund%' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
