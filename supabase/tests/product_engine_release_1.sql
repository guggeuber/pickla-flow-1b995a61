\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('c1000000-0000-4000-8000-000000000001', 'Commerce Test', 'commerce-test');
INSERT INTO public.venues (id, organization_id, name, slug)
VALUES ('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Commerce Test Venue', 'commerce-test-venue');

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, guest_token_hash, guest_name, guest_email
) VALUES (
  'c1000000-0000-4000-8000-000000000010',
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  repeat('a', 64), 'Guest Test', 'guest-commerce@example.test'
);

SELECT * FROM public.replace_commerce_cart_lines(
  'c1000000-0000-4000-8000-000000000010', 1,
  '[
    {"id":"c1000000-0000-4000-8000-000000000101","product_key":"open_play_slot","product_name":"Open Play","commerce_kind":"participation","quantity":1,"vat_rate":6,"source_type":"activity_session","fulfillment_type":"participation","sort_order":0},
    {"id":"c1000000-0000-4000-8000-000000000102","product_key":"rental_racket","product_name":"Hyrrack","commerce_kind":"rental","quantity":1,"vat_rate":6,"source_type":"activity_addon","fulfillment_type":"desk_pickup","parent_line_id":"c1000000-0000-4000-8000-000000000101","sort_order":10},
    {"id":"c1000000-0000-4000-8000-000000000103","product_key":"pink_pickla_bag","product_name":"Pink Pickla Bag","commerce_kind":"merchandise","quantity":1,"vat_rate":25,"source_type":"catalog","fulfillment_type":"desk_pickup","sort_order":20}
  ]'::jsonb
);

DO $$
BEGIN
  BEGIN
    PERFORM public.replace_commerce_cart_lines(
      'c1000000-0000-4000-8000-000000000010', 1,
      '[{"id":"c1000000-0000-4000-8000-000000000104","product_key":"x","product_name":"x","commerce_kind":"merchandise","quantity":1,"vat_rate":25,"source_type":"catalog","fulfillment_type":"desk_pickup"}]'::jsonb
    );
    RAISE EXCEPTION 'stale version was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_cart_version%' THEN RAISE; END IF;
  END;
END $$;

SELECT * FROM public.freeze_commerce_order(
  'c1000000-0000-4000-8000-000000000010', 2,
  '[
    {"id":"c1000000-0000-4000-8000-000000000101","product_key":"open_play_slot","product_name":"Open Play","commerce_kind":"participation","quantity":1,"unit_price_minor":16500,"discount_minor":0,"vat_rate":6,"fulfillment_type":"participation","resolver_snapshot":{"source":"test"}},
    {"id":"c1000000-0000-4000-8000-000000000102","product_key":"rental_racket","product_name":"Hyrrack","commerce_kind":"rental","quantity":1,"unit_price_minor":5000,"discount_minor":0,"vat_rate":6,"fulfillment_type":"desk_pickup","resolver_snapshot":{"source":"test"}},
    {"id":"c1000000-0000-4000-8000-000000000103","product_key":"pink_pickla_bag","product_name":"Pink Pickla Bag","commerce_kind":"merchandise","quantity":1,"unit_price_minor":20000,"discount_minor":0,"vat_rate":25,"fulfillment_type":"desk_pickup","resolver_snapshot":{"source":"test"}}
  ]'::jsonb
);
SELECT public.attach_commerce_order_stripe_session(
  'c1000000-0000-4000-8000-000000000010', 3, 'cs_test_commerce_415'
);

DO $$
DECLARE
  v_order public.commerce_orders%ROWTYPE;
  v_vat INTEGER;
  v_auth_before INTEGER;
  v_auth_after INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.commerce_orders WHERE id = 'c1000000-0000-4000-8000-000000000010';
  IF v_order.total_inc_vat_minor <> 41500 OR v_order.vat_amount_minor <> 5217 OR v_order.total_ex_vat_minor <> 36283 THEN
    RAISE EXCEPTION 'mixed VAT totals wrong: %, %, %', v_order.total_inc_vat_minor, v_order.vat_amount_minor, v_order.total_ex_vat_minor;
  END IF;
  BEGIN
    UPDATE public.commerce_orders SET total_inc_vat_minor = 1 WHERE id = v_order.id;
    RAISE EXCEPTION 'frozen order was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%commerce_order_is_frozen%' THEN RAISE; END IF;
  END;
  SELECT SUM(vat_amount_minor) INTO v_vat FROM public.commerce_order_lines WHERE commerce_order_id = v_order.id;
  IF v_vat <> v_order.vat_amount_minor THEN RAISE EXCEPTION 'order VAT is not line-derived'; END IF;

  BEGIN
    UPDATE public.commerce_order_lines SET unit_price_minor = 1 WHERE id = 'c1000000-0000-4000-8000-000000000103';
    RAISE EXCEPTION 'frozen line was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%commerce_order_lines_are_frozen%' THEN RAISE; END IF;
  END;

  SELECT COUNT(*) INTO v_auth_before FROM auth.users;
  PERFORM * FROM public.finalize_commerce_payment(
    v_order.id, 3, 'cs_test_commerce_415', 'pi_test_commerce_415', NULL, NULL,
    'Guest Test', 'guest-commerce@example.test', NULL, 'card'
  );
  PERFORM * FROM public.finalize_commerce_payment(
    v_order.id, 3, 'cs_test_commerce_415', 'pi_test_commerce_415', NULL, NULL,
    'Guest Test', 'guest-commerce@example.test', NULL, 'card'
  );
  SELECT COUNT(*) INTO v_auth_after FROM auth.users;
  IF v_auth_after <> v_auth_before THEN RAISE EXCEPTION 'guest order created auth user'; END IF;
END $$;

DO $$
DECLARE
  v_receipts INTEGER;
  v_ledger INTEGER;
  v_lines INTEGER;
  v_amount INTEGER;
  v_vat INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_receipts FROM public.booking_receipts WHERE commerce_order_id = 'c1000000-0000-4000-8000-000000000010';
  SELECT COUNT(*), MAX(amount_inc_vat_minor), MAX(vat_amount_minor) INTO v_ledger, v_amount, v_vat
  FROM public.ledger_entries WHERE commerce_order_id = 'c1000000-0000-4000-8000-000000000010';
  SELECT COUNT(*) INTO v_lines FROM public.commerce_receipt_lines WHERE commerce_order_id = 'c1000000-0000-4000-8000-000000000010';
  IF v_receipts <> 1 OR v_ledger <> 1 OR v_lines <> 3 OR v_amount <> 41500 OR v_vat <> 5217 THEN
    RAISE EXCEPTION 'idempotency/financial truth failed receipts=% ledger=% lines=% amount=% vat=%', v_receipts, v_ledger, v_lines, v_amount, v_vat;
  END IF;
END $$;

SELECT (public.transition_commerce_fulfillment(
  'c1000000-0000-4000-8000-000000000102', 'collected', NULL,
  'commerce-test-request', '{"test":true}'::jsonb
)).fulfillment_status;

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, guest_token_hash
) VALUES (
  'c1000000-0000-4000-8000-000000000020',
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  repeat('b', 64)
);
SELECT * FROM public.replace_commerce_cart_lines(
  'c1000000-0000-4000-8000-000000000020', 1,
  '[{"id":"c1000000-0000-4000-8000-000000000201","product_key":"bag","product_name":"Bag","commerce_kind":"merchandise","quantity":1,"vat_rate":25,"source_type":"catalog","fulfillment_type":"desk_pickup"}]'::jsonb
);
SELECT * FROM public.freeze_commerce_order(
  'c1000000-0000-4000-8000-000000000020', 2,
  '[{"id":"c1000000-0000-4000-8000-000000000201","product_key":"bag","product_name":"Bag","commerce_kind":"merchandise","quantity":1,"unit_price_minor":20000,"discount_minor":0,"vat_rate":25,"fulfillment_type":"desk_pickup"}]'::jsonb
);
SELECT public.reopen_commerce_order_after_checkout_failure('c1000000-0000-4000-8000-000000000020', 3);
DO $$
BEGIN
  IF (SELECT status FROM public.commerce_orders WHERE id = 'c1000000-0000-4000-8000-000000000020') <> 'draft' THEN
    RAISE EXCEPTION 'failed checkout could not safely reopen';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE entity_table = 'commerce_order_lines'
      AND entity_id = 'c1000000-0000-4000-8000-000000000102'
      AND action = 'commerce.fulfillment.transition'
  ) THEN RAISE EXCEPTION 'fulfillment transition was not audited'; END IF;
END $$;

SELECT
  o.total_inc_vat_minor,
  o.total_ex_vat_minor,
  o.vat_amount_minor,
  COUNT(DISTINCT r.id) AS receipts,
  COUNT(DISTINCT l.id) AS ledger_entries,
  COUNT(DISTINCT rl.id) AS receipt_lines
FROM public.commerce_orders o
LEFT JOIN public.booking_receipts r ON r.commerce_order_id = o.id
LEFT JOIN public.ledger_entries l ON l.commerce_order_id = o.id
LEFT JOIN public.commerce_receipt_lines rl ON rl.commerce_order_id = o.id
WHERE o.id = 'c1000000-0000-4000-8000-000000000010'
GROUP BY o.id;

ROLLBACK;
