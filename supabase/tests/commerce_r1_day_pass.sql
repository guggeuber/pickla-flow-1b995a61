\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('da100000-0000-4000-8000-000000000001', 'Commerce Day Pass Test', 'commerce-day-pass-test');
INSERT INTO public.venues (id, organization_id, name, slug)
VALUES ('da100000-0000-4000-8000-000000000002', 'da100000-0000-4000-8000-000000000001', 'Day Pass Venue', 'commerce-day-pass-venue');
INSERT INTO public.customers (id, organization_id, display_name, primary_email, email_normalized, status)
VALUES ('da100000-0000-4000-8000-000000000003', 'da100000-0000-4000-8000-000000000001', 'Guest Day Pass', 'daypass@example.test', 'daypass@example.test', 'active');
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, customer_id, guest_token_hash, guest_name, guest_email, status,
  total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor
) VALUES (
  'da100000-0000-4000-8000-000000000004', 'da100000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000002', 'da100000-0000-4000-8000-000000000003', repeat('d', 64),
  'Guest Day Pass', 'daypass@example.test', 'paid', 23750, 22406, 1344
);

INSERT INTO public.day_passes (
  venue_id, user_id, customer_id, valid_date, price, status, commerce_order_id
) VALUES (
  'da100000-0000-4000-8000-000000000002', NULL, 'da100000-0000-4000-8000-000000000003',
  '2026-08-01', 237.50, 'active', 'da100000-0000-4000-8000-000000000004'
) ON CONFLICT (commerce_order_id) DO UPDATE SET price = EXCLUDED.price;

INSERT INTO public.access_entitlements (
  venue_id, user_id, customer_id, entitlement_type, status, source_type, source_id,
  valid_date, includes_session_types, metadata
) VALUES (
  'da100000-0000-4000-8000-000000000002', NULL, 'da100000-0000-4000-8000-000000000003',
  'day_access', 'active', 'commerce_order', 'da100000-0000-4000-8000-000000000004',
  '2026-08-01', ARRAY['open_play'], '{"commerce_order_id":"da100000-0000-4000-8000-000000000004"}'
);

DO $$
DECLARE
  v_price NUMERIC;
  v_count INTEGER;
BEGIN
  SELECT price INTO v_price FROM public.day_passes WHERE commerce_order_id = 'da100000-0000-4000-8000-000000000004';
  IF v_price <> 237.50 THEN RAISE EXCEPTION 'configured product price was not preserved exactly'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.access_entitlements
  WHERE source_type = 'commerce_order' AND source_id = 'da100000-0000-4000-8000-000000000004'
    AND entitlement_type = 'day_access' AND valid_date = '2026-08-01';
  IF v_count <> 1 THEN RAISE EXCEPTION 'day access was not idempotent'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'commerce_order' AND source_id = 'da100000-0000-4000-8000-000000000004'
      AND entitlement_type = 'session_ticket'
  ) THEN RAISE EXCEPTION 'ordinary session ticket was created for day pass'; END IF;
END $$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'da100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'daypass@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
UPDATE public.day_passes SET user_id = 'da100000-0000-4000-8000-000000000005'
WHERE commerce_order_id = 'da100000-0000-4000-8000-000000000004';
UPDATE public.access_entitlements SET user_id = 'da100000-0000-4000-8000-000000000005'
WHERE source_type = 'commerce_order' AND source_id = 'da100000-0000-4000-8000-000000000004';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.day_passes
    WHERE commerce_order_id = 'da100000-0000-4000-8000-000000000004'
      AND user_id = 'da100000-0000-4000-8000-000000000005'
  ) THEN RAISE EXCEPTION 'account activation did not expose day pass history'; END IF;
END $$;

UPDATE public.access_entitlements SET status = 'revoked'
WHERE source_type = 'commerce_order' AND source_id = 'da100000-0000-4000-8000-000000000004';
UPDATE public.day_passes SET status = 'cancelled'
WHERE commerce_order_id = 'da100000-0000-4000-8000-000000000004';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'commerce_order' AND source_id = 'da100000-0000-4000-8000-000000000004'
      AND status = 'active'
  ) THEN RAISE EXCEPTION 'refund left day access active'; END IF;
END $$;

ROLLBACK;
