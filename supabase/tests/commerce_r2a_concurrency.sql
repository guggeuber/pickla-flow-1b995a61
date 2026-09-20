\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

BEGIN;
INSERT INTO public.organizations (id, name, slug)
VALUES ('c2b00000-0000-4000-8000-000000000001', 'R2A Concurrency', 'r2a-concurrency');
INSERT INTO public.franchisees (id, organization_id, legal_name, slug, org_number, status)
VALUES ('c2b00000-0000-4000-8000-000000000002', 'c2b00000-0000-4000-8000-000000000001', 'R2A Concurrency AB', 'r2a-concurrency', '559999-0001', 'active');
INSERT INTO public.venues (
  id, organization_id, franchisee_id, name, slug, commerce_enabled, tracked_merch_sales_enabled
) VALUES (
  'c2b00000-0000-4000-8000-000000000003', 'c2b00000-0000-4000-8000-000000000001',
  'c2b00000-0000-4000-8000-000000000002', 'R2A Concurrency', 'r2a-concurrency', true, true
);
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'c2b00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
  'r2a-concurrency@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('c2b00000-0000-4000-8000-000000000004', 'c2b00000-0000-4000-8000-000000000003', 'venue_admin', true);
INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek, vat_rate,
  commerce_kind, fulfillment_type, fulfillment_presentation, commerce_enabled,
  status, standalone_enabled, activity_addon_enabled, inventory_policy,
  catalog_owner_organization_id
) VALUES (
  'c2b00000-0000-4000-8000-000000000010', 'c2b00000-0000-4000-8000-000000000003',
  'classic_tee_concurrency', 'Pickla Classic Tee', 'merchandise', 299, 25,
  'merchandise', 'desk_pickup', 'desk_pickup', true, 'active', true, false,
  'tracked', 'c2b00000-0000-4000-8000-000000000001'
);
INSERT INTO public.product_options (id, product_id, code, label, sort_order) VALUES
  ('c2b00000-0000-4000-8000-000000000011', 'c2b00000-0000-4000-8000-000000000010', 'color', 'Färg', 10),
  ('c2b00000-0000-4000-8000-000000000012', 'c2b00000-0000-4000-8000-000000000010', 'size', 'Storlek', 20);
INSERT INTO public.product_option_values (id, option_id, code, label) VALUES
  ('c2b00000-0000-4000-8000-000000000013', 'c2b00000-0000-4000-8000-000000000011', 'black', 'Black'),
  ('c2b00000-0000-4000-8000-000000000014', 'c2b00000-0000-4000-8000-000000000012', 'm', 'M');
INSERT INTO public.product_variants (
  id, product_id, catalog_owner_organization_id, sku, title, option_signature, status
) VALUES (
  'c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000010',
  'c2b00000-0000-4000-8000-000000000001', 'PCT-BLK-M-CONC', 'Black / M',
  'c2b00000-0000-4000-8000-000000000013,c2b00000-0000-4000-8000-000000000014', 'active'
);
INSERT INTO public.product_variant_option_values (variant_id, option_id, option_value_id) VALUES
  ('c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000011', 'c2b00000-0000-4000-8000-000000000013'),
  ('c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000012', 'c2b00000-0000-4000-8000-000000000014');
INSERT INTO public.inventory_locations (
  id, venue_id, inventory_owner_franchisee_id, code, name, is_default_retail
) VALUES (
  'c2b00000-0000-4000-8000-000000000030', 'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002', 'retail', 'Concurrency desk', true
);
INSERT INTO public.product_venue_listings (
  product_id, venue_id, seller_franchisee_id, default_inventory_location_id,
  currency, status, tracked_sales_enabled
) VALUES (
  'c2b00000-0000-4000-8000-000000000010', 'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002', 'c2b00000-0000-4000-8000-000000000030',
  'SEK', 'active', true
);

CREATE TABLE public.commerce_r2a_concurrency_results (
  case_name TEXT NOT NULL,
  contender TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  error_message TEXT,
  PRIMARY KEY (case_name, contender)
);

CREATE TABLE public.commerce_r2a_refund_lease_results (
  contender TEXT PRIMARY KEY,
  lease_token UUID NOT NULL,
  claimed INTEGER NOT NULL
);

CREATE FUNCTION public.commerce_r2a_test_make_order(
  p_order UUID, p_line UUID, p_quantity INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, guest_token_hash, guest_name, guest_email, draft_scope
  ) VALUES (
    p_order, 'c2b00000-0000-4000-8000-000000000001', 'c2b00000-0000-4000-8000-000000000003',
    encode(digest(p_order::TEXT, 'sha256'), 'hex'), 'Concurrency Guest', 'r2a-concurrency-guest@example.test', 'shop'
  );
  PERFORM * FROM public.replace_commerce_cart_lines(
    p_order, 1, jsonb_build_array(jsonb_build_object(
      'id', p_line, 'product_id', 'c2b00000-0000-4000-8000-000000000010',
      'product_key', 'classic_tee_concurrency', 'product_name', 'Pickla Classic Tee',
      'commerce_kind', 'merchandise', 'quantity', p_quantity, 'vat_rate', 25,
      'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
      'variant_id', 'c2b00000-0000-4000-8000-000000000020', 'sku', 'PCT-BLK-M-CONC',
      'inventory_policy', 'tracked', 'pickup_location_id', 'c2b00000-0000-4000-8000-000000000030',
      'variant_snapshot', jsonb_build_object(
        'seller_franchisee_id', 'c2b00000-0000-4000-8000-000000000002',
        'sku', 'PCT-BLK-M-CONC', 'title', 'Black / M'
      )
    ))
  );
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_prepare(
  p_case TEXT, p_contender TEXT, p_attempt UUID, p_order UUID, p_line UUID,
  p_quantity INTEGER, p_delay NUMERIC DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(p_delay);
  BEGIN
    PERFORM * FROM public.commerce_r2a_prepare_checkout(
      p_attempt, p_order, 2, jsonb_build_array(jsonb_build_object(
        'id', p_line, 'product_id', 'c2b00000-0000-4000-8000-000000000010',
        'product_key', 'classic_tee_concurrency', 'product_name', 'Pickla Classic Tee',
        'commerce_kind', 'merchandise', 'quantity', p_quantity,
        'unit_price_minor', 29900, 'discount_minor', 0, 'vat_rate', 25,
        'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
        'variant_id', 'c2b00000-0000-4000-8000-000000000020', 'sku', 'PCT-BLK-M-CONC',
        'inventory_policy', 'tracked', 'pickup_location_id', 'c2b00000-0000-4000-8000-000000000030',
        'resolver_snapshot', jsonb_build_object('pricing_source','product_base'),
        'variant_snapshot', jsonb_build_object(
          'seller_franchisee_id', 'c2b00000-0000-4000-8000-000000000002',
          'sku', 'PCT-BLK-M-CONC', 'title', 'Black / M'
        )
      )),
      'c2b00000-0000-4000-8000-000000000002', 'c2b00000-0000-4000-8000-000000000030',
      'test', 'platform', 'r2a-concurrency-' || p_attempt,
      jsonb_build_object('mode','payment','client_reference_id',p_order),
      now() + interval '31 minutes'
    );
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_pickup(
  p_case TEXT, p_contender TEXT, p_key TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.commerce_r2a_collect_pickup(
      'c2b00000-0000-4000-8000-000000000101', 1,
      'c2b00000-0000-4000-8000-000000000003', p_key,
      'c2b00000-0000-4000-8000-000000000004'
    );
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_correct(
  p_case TEXT, p_contender TEXT, p_physical_on_hand INTEGER,
  p_expected_version INTEGER, p_allow_shortage BOOLEAN,
  p_key TEXT, p_delay NUMERIC DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(p_delay);
  BEGIN
    PERFORM * FROM public.commerce_r2a_correct_inventory(
      'c2b00000-0000-4000-8000-000000000020',
      'c2b00000-0000-4000-8000-000000000030',
      p_physical_on_hand, p_expected_version, p_allow_shortage,
      'Concurrent physical recount', p_key,
      'c2b00000-0000-4000-8000-000000000004'
    );
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_variant_insert(
  p_contender TEXT, p_variant_id UUID, p_sku TEXT, p_delay NUMERIC DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(p_delay);
  BEGIN
    INSERT INTO public.product_variants (
      id, product_id, catalog_owner_organization_id, sku, title, option_signature, status
    ) VALUES (
      p_variant_id, 'c2b00000-0000-4000-8000-000000000010',
      'c2b00000-0000-4000-8000-000000000001', p_sku,
      'Concurrent SKU candidate ' || p_contender, p_variant_id::TEXT, 'active'
    );
    INSERT INTO public.commerce_r2a_concurrency_results VALUES ('sku-race', p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results VALUES ('sku-race', p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_refund(
  p_case TEXT, p_contender TEXT, p_key TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.commerce_r2a_prepare_refund(
      'c2b00000-0000-4000-8000-000000000100',
      '[{"line_id":"c2b00000-0000-4000-8000-000000000101","quantity":2}]'::jsonb,
      null, 'Concurrent full refund request', 'test', 'platform', p_key,
      'c2b00000-0000-4000-8000-000000000004'
    );
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_claim_refund(
  p_contender TEXT, p_token UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.commerce_r2a_claim_recovery_refunds(25, 120, p_token);
  INSERT INTO public.commerce_r2a_refund_lease_results VALUES (p_contender, p_token, v_count);
END;
$$;

CREATE FUNCTION public.commerce_r2a_test_reconcile_refund_failure(
  p_contender TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_refund_id UUID;
BEGIN
  SELECT id INTO v_refund_id
  FROM public.commerce_refunds
  WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100'
  LIMIT 1;
  BEGIN
    PERFORM public.commerce_r2a_reconcile_refund(
      v_refund_id, 're_test_concurrent_failure', 'failed',
      '{"id":"re_test_concurrent_failure","status":"failed","failure_reason":"expired_or_canceled_card"}',
      'Stripe refund failed: expired_or_canceled_card'
    );
    INSERT INTO public.commerce_r2a_concurrency_results
    VALUES ('refund-failure-race', p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.commerce_r2a_concurrency_results
    VALUES ('refund-failure-race', p_contender, false, SQLERRM);
  END;
END;
$$;

SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000030',
  5, 'Opening physical count', 'COUNT-CONC-001', 'receive-concurrency-5',
  'c2b00000-0000-4000-8000-000000000004'
);
SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000030',
  5, 'Opening physical count', 'COUNT-CONC-001', 'receive-concurrency-5',
  'c2b00000-0000-4000-8000-000000000004'
);
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000100', 'c2b00000-0000-4000-8000-000000000101', 2);
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000110', 'c2b00000-0000-4000-8000-000000000111', 2);
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000120', 'c2b00000-0000-4000-8000-000000000121', 1);
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000130', 'c2b00000-0000-4000-8000-000000000131', 1);
COMMIT;

SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_variant_insert('A','c2b00000-0000-4000-8000-000000000901','PCT-RACE-SKU',0.15)$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_variant_insert('B','c2b00000-0000-4000-8000-000000000902','pct-race-sku',0.15)$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'sku-race' AND ok) <> 1
    OR (SELECT count(*) FROM public.product_variants WHERE catalog_owner_organization_id = 'c2b00000-0000-4000-8000-000000000001' AND lower(btrim(sku)) = 'pct-race-sku') <> 1 THEN
    RAISE EXCEPTION 'concurrent normalized SKU uniqueness failed';
  END IF;
END $$;

SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_prepare('two-plus-two','A','c2b00000-0000-4000-8000-000000000102','c2b00000-0000-4000-8000-000000000100','c2b00000-0000-4000-8000-000000000101',2,0.15)$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_prepare('two-plus-two','B','c2b00000-0000-4000-8000-000000000112','c2b00000-0000-4000-8000-000000000110','c2b00000-0000-4000-8000-000000000111',2,0.15)$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'two-plus-two' AND ok) <> 2
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 5 AND reserved = 4 AND allocated = 0 AND available_to_sell = 1 AND reconciled) THEN
    RAISE EXCEPTION 'concurrent two-plus-two reservation failed: %', (SELECT jsonb_agg(to_jsonb(r)) FROM public.commerce_r2a_concurrency_results r);
  END IF;
END $$;

SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_prepare('last-unit','C','c2b00000-0000-4000-8000-000000000122','c2b00000-0000-4000-8000-000000000120','c2b00000-0000-4000-8000-000000000121',1,0.15)$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_prepare('last-unit','D','c2b00000-0000-4000-8000-000000000132','c2b00000-0000-4000-8000-000000000130','c2b00000-0000-4000-8000-000000000131',1,0.15)$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'last-unit' AND ok) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 5 AND reserved = 5 AND allocated = 0 AND available_to_sell = 0 AND reconciled) THEN
    RAISE EXCEPTION 'last-unit oversell protection failed: %', (SELECT jsonb_agg(to_jsonb(r)) FROM public.commerce_r2a_concurrency_results r);
  END IF;
END $$;

-- A local deadline/browser abandonment changes nothing. Authoritative creation failure releases only the winning last-unit attempt.
DO $$
DECLARE v_attempt UUID;
BEGIN
  SELECT CASE contender WHEN 'C' THEN 'c2b00000-0000-4000-8000-000000000122'::uuid ELSE 'c2b00000-0000-4000-8000-000000000132'::uuid END
  INTO v_attempt FROM public.commerce_r2a_concurrency_results WHERE case_name = 'last-unit' AND ok;
  IF (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020') <> 5 THEN
    RAISE EXCEPTION 'local observation released stock';
  END IF;
  PERFORM public.commerce_r2a_close_unpaid_attempt(v_attempt, null, 'creation_failed', 'test_provider_conclusive_no_session');
END $$;

-- B is ambiguous: replay the same durable attempt and prove only one worker lease can claim it.
SELECT public.commerce_r2a_mark_provider_unresolved('c2b00000-0000-4000-8000-000000000112', 'injected response loss after provider call');
SELECT public.commerce_r2a_test_prepare('attempt-replay', 'B', 'c2b00000-0000-4000-8000-000000000112', 'c2b00000-0000-4000-8000-000000000110', 'c2b00000-0000-4000-8000-000000000111', 2, 0);
UPDATE public.commerce_checkout_attempts SET recovery_after = now() + interval '1 day'
WHERE id <> 'c2b00000-0000-4000-8000-000000000112' AND status IN ('prepared','provider_creation_unresolved','open','payment_processing','attention');
UPDATE public.commerce_checkout_attempts SET recovery_after = now() - interval '1 second'
WHERE id = 'c2b00000-0000-4000-8000-000000000112';
CREATE TABLE public.commerce_r2a_lease_results (contender TEXT PRIMARY KEY, claimed INTEGER NOT NULL);
CREATE FUNCTION public.commerce_r2a_test_claim(p_contender TEXT, p_token UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_r2a_claim_recovery_attempts(25, 120, p_token);
  INSERT INTO public.commerce_r2a_lease_results VALUES (p_contender, v_count);
END;
$$;
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_claim('worker-a','c2b00000-0000-4000-8000-000000000201')$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_claim('worker-b','c2b00000-0000-4000-8000-000000000202')$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT sum(claimed) FROM public.commerce_r2a_lease_results) <> 1
    OR (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020') <> 4 THEN
    RAISE EXCEPTION 'overlapping worker claim or ambiguity hold failed';
  END IF;
END $$;
UPDATE public.commerce_checkout_attempts SET recovery_lease_expires_at = now() - interval '1 second', recovery_after = now() - interval '1 second'
WHERE id = 'c2b00000-0000-4000-8000-000000000112';
DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.commerce_r2a_claim_recovery_attempts(25, 120, 'c2b00000-0000-4000-8000-000000000203');
  IF v_count <> 1 THEN RAISE EXCEPTION 'expired worker lease was not recoverable'; END IF;
  PERFORM public.commerce_r2a_finish_recovery_lease('c2b00000-0000-4000-8000-000000000112', 'c2b00000-0000-4000-8000-000000000203', null, 300);
END $$;
SELECT public.commerce_r2a_close_unpaid_attempt('c2b00000-0000-4000-8000-000000000112', null, 'creation_failed', 'test_provider_conclusive_no_session');

-- Webhook-before-attachment and duplicate payment effects remain exactly once.
SELECT * FROM public.finalize_commerce_payment(
  'c2b00000-0000-4000-8000-000000000100', 3, 'cs_test_r2a_concurrency_a', 'pi_test_r2a_concurrency_a',
  null, null, 'Concurrency Guest', 'r2a-concurrency-guest@example.test', null, 'Kort via Stripe'
);
SELECT * FROM public.finalize_commerce_payment(
  'c2b00000-0000-4000-8000-000000000100', 3, 'cs_test_r2a_concurrency_a', 'pi_test_r2a_concurrency_a',
  null, null, 'Concurrency Guest', 'r2a-concurrency-guest@example.test', null, 'Kort via Stripe'
);
SELECT public.commerce_r2a_attach_checkout_session('c2b00000-0000-4000-8000-000000000102', 'cs_test_r2a_concurrency_a', '{"status":"complete","payment_status":"paid"}');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 5 AND reserved = 0 AND allocated = 2 AND available_to_sell = 3 AND reconciled)
    OR (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100') <> 1
    OR (SELECT count(*) FROM public.inventory_movements WHERE order_id = 'c2b00000-0000-4000-8000-000000000100' AND movement_type = 'payment_commit') <> 1 THEN
    RAISE EXCEPTION 'payment idempotency or expected balance failed';
  END IF;
END $$;

-- The same pickup command is concurrently replayed; only one physical effect occurs.
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_pickup('pickup-replay','scan-a','same-scan-key')$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_pickup('pickup-replay','scan-b','same-scan-key')$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'pickup-replay' AND ok) <> 2
    OR (SELECT count(*) FROM public.inventory_movements WHERE order_id = 'c2b00000-0000-4000-8000-000000000100' AND movement_type = 'pickup') <> 1
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 4 AND reserved = 0 AND allocated = 1 AND available_to_sell = 3 AND reconciled) THEN
    RAISE EXCEPTION 'concurrent pickup idempotency failed';
  END IF;
END $$;

-- Correction and reservation serialize on the same inventory level. Exercise both legal orderings.
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000150', 'c2b00000-0000-4000-8000-000000000151', 3);
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_correct('correction-wins','physical-count',2,9,false,'correction-wins',0)$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_prepare('correction-wins','reservation','c2b00000-0000-4000-8000-000000000152','c2b00000-0000-4000-8000-000000000150','c2b00000-0000-4000-8000-000000000151',3,0.25)$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF NOT (SELECT ok FROM public.commerce_r2a_concurrency_results WHERE case_name = 'correction-wins' AND contender = 'physical-count')
    OR (SELECT ok FROM public.commerce_r2a_concurrency_results WHERE case_name = 'correction-wins' AND contender = 'reservation')
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 2 AND reserved = 0 AND allocated = 1 AND available_to_sell = 1 AND reconciled) THEN
    RAISE EXCEPTION 'correction-first serialization failed: %', (SELECT jsonb_agg(to_jsonb(r)) FROM public.commerce_r2a_concurrency_results r WHERE case_name = 'correction-wins');
  END IF;
END $$;

SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000030',
  2, 'Restock for reverse serialization', 'COUNT-CONC-002', 'receive-correction-race-2',
  'c2b00000-0000-4000-8000-000000000004'
);
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_prepare('reservation-wins','reservation','c2b00000-0000-4000-8000-000000000152','c2b00000-0000-4000-8000-000000000150','c2b00000-0000-4000-8000-000000000151',3,0)$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_correct('reservation-wins','stale-count',2,11,false,'correction-loses-stale',0.25)$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF NOT (SELECT ok FROM public.commerce_r2a_concurrency_results WHERE case_name = 'reservation-wins' AND contender = 'reservation')
    OR (SELECT ok FROM public.commerce_r2a_concurrency_results WHERE case_name = 'reservation-wins' AND contender = 'stale-count')
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 4 AND reserved = 3 AND allocated = 1 AND available_to_sell = 0 AND reconciled) THEN
    RAISE EXCEPTION 'reservation-first serialization failed: %', (SELECT jsonb_agg(to_jsonb(r)) FROM public.commerce_r2a_concurrency_results r WHERE case_name = 'reservation-wins');
  END IF;
END $$;

-- A confirmed shortage may go negative only through the explicit path; the open claim remains visible.
SELECT * FROM public.commerce_r2a_correct_inventory(
  'c2b00000-0000-4000-8000-000000000020', 'c2b00000-0000-4000-8000-000000000030',
  2, 12, true, 'Verified concurrent shortage', 'correction-shortage',
  'c2b00000-0000-4000-8000-000000000004'
);
SELECT public.commerce_r2a_close_unpaid_attempt(
  'c2b00000-0000-4000-8000-000000000152', null, 'creation_failed', 'test_provider_conclusive_no_session'
);
SELECT public.commerce_r2a_resolve_inventory_incident(
  (SELECT id FROM public.inventory_incidents
   WHERE inventory_level_id = (SELECT id FROM public.inventory_levels WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND location_id = 'c2b00000-0000-4000-8000-000000000030')
     AND status = 'open' ORDER BY opened_at DESC LIMIT 1),
  '{"physical_recount":"COUNT-CONC-003","obligation_released":true}'::jsonb,
  'resolve-concurrent-shortage', 'c2b00000-0000-4000-8000-000000000004'
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 2 AND reserved = 0 AND allocated = 1 AND available_to_sell = 1 AND NOT incident_blocked AND reconciled) THEN
    RAISE EXCEPTION 'shortage containment/recovery failed';
  END IF;
END $$;

-- Feature disable rejects new sales but does not disable existing pickup obligations.
UPDATE public.venues SET tracked_merch_sales_enabled = false WHERE id = 'c2b00000-0000-4000-8000-000000000003';
SELECT public.commerce_r2a_test_make_order('c2b00000-0000-4000-8000-000000000140', 'c2b00000-0000-4000-8000-000000000141', 1);
SELECT public.commerce_r2a_test_prepare('feature-off', 'new-sale', 'c2b00000-0000-4000-8000-000000000142', 'c2b00000-0000-4000-8000-000000000140', 'c2b00000-0000-4000-8000-000000000141', 1, 0);
SELECT * FROM public.commerce_r2a_collect_pickup(
  'c2b00000-0000-4000-8000-000000000101', 1,
  'c2b00000-0000-4000-8000-000000000003', 'second-valid-scan',
  'c2b00000-0000-4000-8000-000000000004'
);
DO $$ BEGIN
  IF (SELECT ok FROM public.commerce_r2a_concurrency_results WHERE case_name = 'feature-off')
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020' AND on_hand = 1 AND reserved = 0 AND allocated = 0 AND available_to_sell = 1 AND reconciled) THEN
    RAISE EXCEPTION 'feature disable affected wrong boundary';
  END IF;
END $$;

-- Concurrent maximum-quantity refund intents serialize on the order; exactly one can reserve the financial cap.
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_refund('refund-cap','refund-a','refund-cap-a')$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_refund('refund-cap','refund-b','refund-cap-b')$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'refund-cap' AND ok) <> 1
    OR (SELECT count(*) FROM public.commerce_refunds WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100') <> 1
    OR (SELECT sum(quantity) FROM public.commerce_refund_lines WHERE commerce_order_line_id = 'c2b00000-0000-4000-8000-000000000101') <> 2 THEN
    RAISE EXCEPTION 'concurrent refund cap failed';
  END IF;
END $$;

-- Succeeded refunds remain recoverable for a bounded provider-monitoring
-- window; overlapping workers claim the row only once.
DO $$
DECLARE v_refund_id UUID;
BEGIN
  SELECT id INTO v_refund_id
  FROM public.commerce_refunds
  WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100'
  LIMIT 1;
  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund_id, 're_test_concurrent_failure', 'succeeded',
    '{"id":"re_test_concurrent_failure","status":"succeeded"}', null
  );
  UPDATE public.commerce_refunds SET recovery_after = now() - interval '1 second'
  WHERE id = v_refund_id;
END $$;
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_claim_refund('refund-worker-a','c2b00000-0000-4000-8000-000000000301')$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_claim_refund('refund-worker-b','c2b00000-0000-4000-8000-000000000302')$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$ BEGIN
  IF (SELECT sum(claimed) FROM public.commerce_r2a_refund_lease_results) <> 1 THEN
    RAISE EXCEPTION 'overlapping succeeded-refund recovery claim failed';
  END IF;
  UPDATE public.commerce_refunds SET
    recovery_lease_expires_at = now() - interval '1 second',
    recovery_after = now() - interval '1 second'
  WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100';
END $$;

-- Concurrent duplicate provider failures serialize on the refund row. One
-- immutable refund effect and one immutable compensation survive.
SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');
SELECT dblink_connect('r2a_a', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('r2a_b', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('r2a_a', $$SELECT public.commerce_r2a_test_reconcile_refund_failure('failure-event-a')$$);
SELECT dblink_send_query('r2a_b', $$SELECT public.commerce_r2a_test_reconcile_refund_failure('failure-event-b')$$);
SELECT * FROM dblink_get_result('r2a_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('r2a_b') AS result(done TEXT);
DO $$
DECLARE v_refund_id UUID;
BEGIN
  SELECT id INTO v_refund_id
  FROM public.commerce_refunds
  WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100'
  LIMIT 1;
  IF (SELECT count(*) FROM public.commerce_r2a_concurrency_results WHERE case_name = 'refund-failure-race' AND ok) <> 2
    OR (SELECT status FROM public.commerce_refunds WHERE id = v_refund_id) <> 'failed'
    OR (SELECT count(*) FROM public.ledger_entries WHERE source_type = 'commerce_refund' AND source_id = v_refund_id::TEXT) <> 1
    OR (SELECT count(*) FROM public.ledger_entries WHERE source_type = 'commerce_refund_reversal' AND source_id = v_refund_id::TEXT) <> 1
    OR (SELECT count(*) FROM public.ops_incidents WHERE metadata->>'commerce_refund_id' = v_refund_id::TEXT) <> 1
    OR (SELECT payment_status FROM public.booking_receipts WHERE commerce_order_id = 'c2b00000-0000-4000-8000-000000000100') <> 'paid'
    OR (SELECT status FROM public.commerce_orders WHERE id = 'c2b00000-0000-4000-8000-000000000100') <> 'attention'
    OR NOT EXISTS (
      SELECT 1 FROM public.commerce_inventory_positions
      WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020'
        AND on_hand = 1 AND reserved = 0 AND allocated = 0 AND available_to_sell = 1 AND reconciled
    ) THEN
    RAISE EXCEPTION 'concurrent refund failure convergence/effect independence failed';
  END IF;
  -- Stale success and another failure replay cannot revive or compensate twice.
  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund_id, 're_test_concurrent_failure', 'succeeded',
    '{"id":"re_test_concurrent_failure","status":"succeeded"}', null
  );
  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund_id, 're_test_concurrent_failure', 'failed',
    '{"id":"re_test_concurrent_failure","status":"failed"}', 'duplicate failure'
  );
  IF (SELECT status FROM public.commerce_refunds WHERE id = v_refund_id) <> 'failed'
    OR (SELECT count(*) FROM public.ledger_entries WHERE source_type = 'commerce_refund_reversal' AND source_id = v_refund_id::TEXT) <> 1 THEN
    RAISE EXCEPTION 'out-of-order/replayed refund event changed terminal truth';
  END IF;
END $$;

SELECT * FROM public.commerce_r2a_concurrency_results ORDER BY case_name, contender;
SELECT * FROM public.commerce_r2a_lease_results ORDER BY contender;
SELECT * FROM public.commerce_r2a_refund_lease_results ORDER BY contender;
SELECT variant_id, on_hand, reserved, allocated, available_to_sell, reconciled
FROM public.commerce_inventory_positions WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020';

SELECT dblink_disconnect('r2a_a');
SELECT dblink_disconnect('r2a_b');

-- Cleanup keeps the permanent test rerunnable on a disposable database.
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.commerce_orders SET checkout_attempt_id = null, booking_receipt_id = null, ledger_entry_id = null
WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001';
DELETE FROM public.commerce_refund_lines WHERE refund_id IN (SELECT id FROM public.commerce_refunds WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001'));
DELETE FROM public.commerce_refunds WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.commerce_pickup_commands WHERE venue_id = 'c2b00000-0000-4000-8000-000000000003';
DELETE FROM public.inventory_movements WHERE location_id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.inventory_allocations WHERE location_id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.inventory_reservations WHERE location_id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.commerce_checkout_attempt_lines WHERE checkout_attempt_id IN (SELECT id FROM public.commerce_checkout_attempts WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001'));
DELETE FROM public.commerce_receipt_lines WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.ledger_entries WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.booking_receipts WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.commerce_order_lines WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.commerce_checkout_attempts WHERE commerce_order_id IN (SELECT id FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001');
DELETE FROM public.commerce_orders WHERE organization_id = 'c2b00000-0000-4000-8000-000000000001';
DELETE FROM public.inventory_commands WHERE location_id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.inventory_levels WHERE location_id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.product_venue_listings WHERE product_id = 'c2b00000-0000-4000-8000-000000000010';
DELETE FROM public.inventory_locations WHERE id = 'c2b00000-0000-4000-8000-000000000030';
DELETE FROM public.product_variant_option_values WHERE variant_id = 'c2b00000-0000-4000-8000-000000000020';
DELETE FROM public.product_variants WHERE product_id = 'c2b00000-0000-4000-8000-000000000010';
DELETE FROM public.product_option_values WHERE option_id IN ('c2b00000-0000-4000-8000-000000000011','c2b00000-0000-4000-8000-000000000012');
DELETE FROM public.product_options WHERE product_id = 'c2b00000-0000-4000-8000-000000000010';
DELETE FROM public.access_products WHERE id = 'c2b00000-0000-4000-8000-000000000010';
DELETE FROM public.ops_incidents WHERE venue_id = 'c2b00000-0000-4000-8000-000000000003';
DELETE FROM public.audit_log WHERE venue_id = 'c2b00000-0000-4000-8000-000000000003';
DELETE FROM public.venue_staff WHERE venue_id = 'c2b00000-0000-4000-8000-000000000003';
DELETE FROM public.venues WHERE id = 'c2b00000-0000-4000-8000-000000000003';
DELETE FROM public.franchisees WHERE id = 'c2b00000-0000-4000-8000-000000000002';
DELETE FROM auth.users WHERE id = 'c2b00000-0000-4000-8000-000000000004';
DELETE FROM public.organizations WHERE id = 'c2b00000-0000-4000-8000-000000000001';
DROP FUNCTION public.commerce_r2a_test_claim(TEXT, UUID);
DROP FUNCTION public.commerce_r2a_test_claim_refund(TEXT, UUID);
DROP FUNCTION public.commerce_r2a_test_reconcile_refund_failure(TEXT);
DROP FUNCTION public.commerce_r2a_test_refund(TEXT, TEXT, TEXT);
DROP FUNCTION public.commerce_r2a_test_correct(TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, TEXT, NUMERIC);
DROP FUNCTION public.commerce_r2a_test_variant_insert(TEXT, UUID, TEXT, NUMERIC);
DROP FUNCTION public.commerce_r2a_test_pickup(TEXT, TEXT, TEXT);
DROP FUNCTION public.commerce_r2a_test_prepare(TEXT, TEXT, UUID, UUID, UUID, INTEGER, NUMERIC);
DROP FUNCTION public.commerce_r2a_test_make_order(UUID, UUID, INTEGER);
DROP TABLE public.commerce_r2a_lease_results;
DROP TABLE public.commerce_r2a_refund_lease_results;
DROP TABLE public.commerce_r2a_concurrency_results;
SET LOCAL session_replication_role = origin;
COMMIT;
