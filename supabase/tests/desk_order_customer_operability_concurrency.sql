\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

BEGIN;
INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'd9e7b320-0000-4000-8000-000000000001',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'Desk pickup concurrency test', 'desk-pickup-concurrency-test', true
);
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'd9e7b320-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'desk.concurrent.synthetic@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('d9e7b320-0000-4000-8000-000000000002', 'd9e7b320-0000-4000-8000-000000000001', 'venue_admin', true);
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, status, version, currency, subtotal_minor,
  total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor, guest_token_hash,
  guest_name, guest_email, checkout_frozen_at, paid_at
) VALUES (
  'd9e7b320-0000-4000-8000-000000000010',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'd9e7b320-0000-4000-8000-000000000001', 'draft', 7, 'SEK',
  20000, 20000, 18868, 1132, repeat('d', 64), 'Marcus Theander',
  'marcus.concurrent.synthetic@example.test', now(), now()
);
INSERT INTO public.commerce_order_lines (
  id, commerce_order_id, product_key, product_name, commerce_kind, quantity,
  unit_price_minor, line_total_inc_vat_minor, line_total_ex_vat_minor, vat_rate,
  vat_amount_minor, source_type, fulfillment_type, fulfillment_status,
  product_snapshot, inventory_policy
) VALUES (
  'd9e7b320-0000-4000-8000-000000000011',
  'd9e7b320-0000-4000-8000-000000000010', 'concurrent_hyrrack', 'Hyrrack',
  'rental', 4, 5000, 20000, 18868, 6, 1132, 'catalog', 'desk_pickup',
  'pending_pickup', '{"name":"Hyrrack","unit_price_minor":5000}'::jsonb,
  'stockless'
);
UPDATE public.commerce_orders SET status = 'paid'
WHERE id = 'd9e7b320-0000-4000-8000-000000000010';

CREATE TABLE public.desk_pickup_concurrency_results (
  contender TEXT PRIMARY KEY,
  ok BOOLEAN NOT NULL,
  error_message TEXT
);
CREATE FUNCTION public.test_desk_stockless_pickup_race(p_contender TEXT, p_key TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.commerce_r2a_collect_pickup(
      'd9e7b320-0000-4000-8000-000000000011', 4,
      'd9e7b320-0000-4000-8000-000000000001', p_key,
      'd9e7b320-0000-4000-8000-000000000002'
    );
    INSERT INTO public.desk_pickup_concurrency_results VALUES (p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.desk_pickup_concurrency_results VALUES (p_contender, false, SQLERRM);
  END;
END;
$$;
COMMIT;

SELECT dblink_connect('desk_pickup_a', format(
  'host=host.docker.internal port=54322 dbname=%s user=postgres password=postgres', current_database()
));
SELECT dblink_connect('desk_pickup_b', format(
  'host=host.docker.internal port=54322 dbname=%s user=postgres password=postgres', current_database()
));
SELECT dblink_send_query('desk_pickup_a', $$SELECT public.test_desk_stockless_pickup_race('desk-a','stockless-device-a')$$);
SELECT dblink_send_query('desk_pickup_b', $$SELECT public.test_desk_stockless_pickup_race('desk-b','stockless-device-b')$$);
SELECT * FROM dblink_get_result('desk_pickup_a') AS result(done TEXT);
SELECT * FROM dblink_get_result('desk_pickup_b') AS result(done TEXT);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.desk_pickup_concurrency_results WHERE ok) <> 1
    OR (SELECT count(*) FROM public.desk_pickup_concurrency_results WHERE NOT ok) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.commerce_order_lines
      WHERE id = 'd9e7b320-0000-4000-8000-000000000011'
        AND collected_quantity = 4
        AND fulfillment_status = 'collected'
    )
    OR (SELECT COALESCE(sum(quantity), 0) FROM public.commerce_pickup_commands
        WHERE order_line_id = 'd9e7b320-0000-4000-8000-000000000011') <> 4 THEN
    RAISE EXCEPTION 'two Desk devices over-issued stockless pickup: %',
      (SELECT jsonb_agg(to_jsonb(result)) FROM public.desk_pickup_concurrency_results result);
  END IF;
END $$;

SELECT dblink_disconnect('desk_pickup_a');
SELECT dblink_disconnect('desk_pickup_b');

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.audit_log WHERE venue_id = 'd9e7b320-0000-4000-8000-000000000001';
DELETE FROM public.commerce_pickup_commands WHERE order_line_id = 'd9e7b320-0000-4000-8000-000000000011';
DELETE FROM public.commerce_order_lines WHERE commerce_order_id = 'd9e7b320-0000-4000-8000-000000000010';
DELETE FROM public.commerce_orders WHERE id = 'd9e7b320-0000-4000-8000-000000000010';
DELETE FROM public.venue_staff WHERE venue_id = 'd9e7b320-0000-4000-8000-000000000001';
DELETE FROM public.customer_venue_profiles WHERE venue_id = 'd9e7b320-0000-4000-8000-000000000001';
DELETE FROM public.customer_identities WHERE customer_id IN (
  SELECT id FROM public.customers WHERE auth_user_id = 'd9e7b320-0000-4000-8000-000000000002'
);
DELETE FROM public.player_profiles WHERE auth_user_id = 'd9e7b320-0000-4000-8000-000000000002';
DELETE FROM public.customers WHERE auth_user_id = 'd9e7b320-0000-4000-8000-000000000002';
DELETE FROM public.venues WHERE id = 'd9e7b320-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id = 'd9e7b320-0000-4000-8000-000000000002';
DROP FUNCTION public.test_desk_stockless_pickup_race(TEXT, TEXT);
DROP TABLE public.desk_pickup_concurrency_results;
SET LOCAL session_replication_role = origin;
COMMIT;
