\set ON_ERROR_STOP on
BEGIN;

-- Deterministic, non-production fixtures for the Classic Tee acceptance model.
INSERT INTO public.organizations (id, name, slug, legal_name, org_number)
VALUES (
  'c2a00000-0000-4000-8000-000000000001', 'Commerce R2A Test', 'commerce-r2a-test',
  'Commerce R2A Test AB', '559999-0000'
);
INSERT INTO public.franchisees (
  id, organization_id, legal_name, slug, org_number, payout_currency, vat_rate, status
) VALUES (
  'c2a00000-0000-4000-8000-000000000002',
  'c2a00000-0000-4000-8000-000000000001',
  'Commerce R2A Test AB', 'commerce-r2a-seller', '559999-0000', 'SEK', 25, 'active'
);
INSERT INTO public.venues (
  id, organization_id, franchisee_id, name, slug, timezone, commerce_enabled,
  tracked_merch_sales_enabled
) VALUES
  ('c2a00000-0000-4000-8000-000000000003', 'c2a00000-0000-4000-8000-000000000001',
    'c2a00000-0000-4000-8000-000000000002', 'Commerce R2A Venue A', 'commerce-r2a-a',
    'Europe/Stockholm', true, true),
  ('c2a00000-0000-4000-8000-000000000004', 'c2a00000-0000-4000-8000-000000000001',
    'c2a00000-0000-4000-8000-000000000002', 'Commerce R2A Venue B', 'commerce-r2a-b',
    'Europe/Stockholm', true, true);
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('c2a00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
    'r2a-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c2a00000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
    'r2a-outsider@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
INSERT INTO public.venue_staff (user_id, venue_id, role, is_active) VALUES
  ('c2a00000-0000-4000-8000-000000000005', 'c2a00000-0000-4000-8000-000000000003', 'venue_admin', true),
  ('c2a00000-0000-4000-8000-000000000005', 'c2a00000-0000-4000-8000-000000000004', 'venue_admin', true);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, description, product_kind, base_price_sek,
  vat_rate, commerce_kind, fulfillment_type, fulfillment_presentation,
  commerce_enabled, status, standalone_enabled, activity_addon_enabled,
  inventory_policy, catalog_owner_organization_id, category
) VALUES (
  'c2a00000-0000-4000-8000-000000000010',
  'c2a00000-0000-4000-8000-000000000003',
  'pickla_classic_tee', 'Pickla Classic Tee', 'Tracked test merchandise', 'merchandise',
  299, 25, 'merchandise', 'desk_pickup', 'desk_pickup', true, 'active', true, false,
  'tracked', 'c2a00000-0000-4000-8000-000000000001', 'merchandise'
);
INSERT INTO public.product_options (id, product_id, code, label, sort_order) VALUES
  ('c2a00000-0000-4000-8000-000000000011', 'c2a00000-0000-4000-8000-000000000010', 'color', 'Färg', 10),
  ('c2a00000-0000-4000-8000-000000000012', 'c2a00000-0000-4000-8000-000000000010', 'size', 'Storlek', 20);
INSERT INTO public.product_option_values (id, option_id, code, label, sort_order) VALUES
  ('c2a00000-0000-4000-8000-000000000013', 'c2a00000-0000-4000-8000-000000000011', 'black', 'Black', 10),
  ('c2a00000-0000-4000-8000-000000000014', 'c2a00000-0000-4000-8000-000000000011', 'off-white', 'Off-white', 20),
  ('c2a00000-0000-4000-8000-000000000015', 'c2a00000-0000-4000-8000-000000000012', 's', 'S', 10),
  ('c2a00000-0000-4000-8000-000000000016', 'c2a00000-0000-4000-8000-000000000012', 'm', 'M', 20),
  ('c2a00000-0000-4000-8000-000000000017', 'c2a00000-0000-4000-8000-000000000012', 'l', 'L', 30),
  ('c2a00000-0000-4000-8000-000000000018', 'c2a00000-0000-4000-8000-000000000012', 'xl', 'XL', 40);

INSERT INTO public.product_variants (
  id, product_id, catalog_owner_organization_id, sku, title, price_override_minor,
  option_signature, status
) VALUES
  ('c2a00000-0000-4000-8000-000000000020', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-BLK-S', 'Black / S', null, 'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000015', 'active'),
  ('c2a00000-0000-4000-8000-000000000021', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-BLK-M', 'Black / M', null, 'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000016', 'active'),
  ('c2a00000-0000-4000-8000-000000000022', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-BLK-L', 'Black / L', 31900, 'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000017', 'active'),
  ('c2a00000-0000-4000-8000-000000000023', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-BLK-XL', 'Black / XL', 0, 'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000018', 'active'),
  ('c2a00000-0000-4000-8000-000000000024', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-OW-S', 'Off-white / S', null, 'c2a00000-0000-4000-8000-000000000014,c2a00000-0000-4000-8000-000000000015', 'active'),
  ('c2a00000-0000-4000-8000-000000000025', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-OW-M', 'Off-white / M', null, 'c2a00000-0000-4000-8000-000000000014,c2a00000-0000-4000-8000-000000000016', 'active'),
  ('c2a00000-0000-4000-8000-000000000026', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-OW-L', 'Off-white / L', null, 'c2a00000-0000-4000-8000-000000000014,c2a00000-0000-4000-8000-000000000017', 'active'),
  ('c2a00000-0000-4000-8000-000000000027', 'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001', 'PCT-OW-XL', 'Off-white / XL', null, 'c2a00000-0000-4000-8000-000000000014,c2a00000-0000-4000-8000-000000000018', 'active');
INSERT INTO public.product_variant_option_values (variant_id, option_id, option_value_id)
SELECT variant_id, option_id, option_value_id FROM (VALUES
  ('c2a00000-0000-4000-8000-000000000020'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000013'::uuid),
  ('c2a00000-0000-4000-8000-000000000020'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000015'::uuid),
  ('c2a00000-0000-4000-8000-000000000021'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000013'::uuid),
  ('c2a00000-0000-4000-8000-000000000021'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000016'::uuid),
  ('c2a00000-0000-4000-8000-000000000022'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000013'::uuid),
  ('c2a00000-0000-4000-8000-000000000022'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000017'::uuid),
  ('c2a00000-0000-4000-8000-000000000023'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000013'::uuid),
  ('c2a00000-0000-4000-8000-000000000023'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000018'::uuid),
  ('c2a00000-0000-4000-8000-000000000024'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000014'::uuid),
  ('c2a00000-0000-4000-8000-000000000024'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000015'::uuid),
  ('c2a00000-0000-4000-8000-000000000025'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000014'::uuid),
  ('c2a00000-0000-4000-8000-000000000025'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000016'::uuid),
  ('c2a00000-0000-4000-8000-000000000026'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000014'::uuid),
  ('c2a00000-0000-4000-8000-000000000026'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000017'::uuid),
  ('c2a00000-0000-4000-8000-000000000027'::uuid, 'c2a00000-0000-4000-8000-000000000011'::uuid, 'c2a00000-0000-4000-8000-000000000014'::uuid),
  ('c2a00000-0000-4000-8000-000000000027'::uuid, 'c2a00000-0000-4000-8000-000000000012'::uuid, 'c2a00000-0000-4000-8000-000000000018'::uuid)
) assignment(variant_id, option_id, option_value_id);

INSERT INTO public.inventory_locations (
  id, venue_id, inventory_owner_franchisee_id, code, name, is_default_retail
) VALUES
  ('c2a00000-0000-4000-8000-000000000030', 'c2a00000-0000-4000-8000-000000000003', 'c2a00000-0000-4000-8000-000000000002', 'retail', 'Venue A desk', true),
  ('c2a00000-0000-4000-8000-000000000031', 'c2a00000-0000-4000-8000-000000000004', 'c2a00000-0000-4000-8000-000000000002', 'retail', 'Venue B desk', true);
INSERT INTO public.product_venue_listings (
  product_id, venue_id, seller_franchisee_id, default_inventory_location_id,
  currency, status, tracked_sales_enabled
) VALUES
  ('c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000003', 'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000030', 'SEK', 'active', true),
  ('c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000004', 'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000031', 'SEK', 'active', true);

CREATE FUNCTION pg_temp.make_tracked_order(
  p_order UUID, p_line UUID, p_variant UUID, p_sku TEXT, p_quantity INTEGER,
  p_venue UUID DEFAULT 'c2a00000-0000-4000-8000-000000000003',
  p_location UUID DEFAULT 'c2a00000-0000-4000-8000-000000000030'
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, guest_token_hash, guest_name, guest_email, draft_scope
  ) VALUES (
    p_order, 'c2a00000-0000-4000-8000-000000000001', p_venue,
    encode(digest(p_order::text, 'sha256'), 'hex'), 'R2A Guest', 'r2a-guest@example.test', 'shop'
  );
  PERFORM * FROM public.replace_commerce_cart_lines(
    p_order, 1,
    jsonb_build_array(jsonb_build_object(
      'id', p_line, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
      'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
      'commerce_kind', 'merchandise', 'quantity', p_quantity, 'vat_rate', 25,
      'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
      'variant_id', p_variant, 'sku', p_sku, 'inventory_policy', 'tracked',
      'pickup_location_id', p_location,
      'variant_snapshot', jsonb_build_object('variant_id', p_variant, 'sku', p_sku,
        'options', jsonb_build_array(jsonb_build_object('option_code','color','value_code','black','value_label','Black')))
    ))
  );
END;
$$;

CREATE FUNCTION pg_temp.prepare_tracked_order(
  p_attempt UUID, p_order UUID, p_line UUID, p_variant UUID, p_sku TEXT,
  p_quantity INTEGER, p_unit_price INTEGER DEFAULT 29900,
  p_venue UUID DEFAULT 'c2a00000-0000-4000-8000-000000000003',
  p_location UUID DEFAULT 'c2a00000-0000-4000-8000-000000000030'
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.commerce_r2a_prepare_checkout(
    p_attempt, p_order, 2,
    jsonb_build_array(jsonb_build_object(
      'id', p_line, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
      'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
      'commerce_kind', 'merchandise', 'quantity', p_quantity,
      'unit_price_minor', p_unit_price, 'discount_minor', 0, 'vat_rate', 25,
      'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
      'variant_id', p_variant, 'sku', p_sku, 'inventory_policy', 'tracked',
      'pickup_location_id', p_location, 'resolver_snapshot', jsonb_build_object('pricing_source','product_base'),
      'variant_snapshot', jsonb_build_object('variant_id', p_variant, 'sku', p_sku,
        'seller_franchisee_id', 'c2a00000-0000-4000-8000-000000000002',
        'options', jsonb_build_array(jsonb_build_object('option_code','color','value_code','black','value_label','Black')))
    )),
    'c2a00000-0000-4000-8000-000000000002', p_location,
    'test', 'platform', 'r2a-checkout-' || p_attempt,
    jsonb_build_object('mode','payment','client_reference_id',p_order),
    now() + interval '31 minutes'
  );
END;
$$;

CREATE FUNCTION pg_temp.make_two_line_order(
  p_order UUID, p_line_a UUID, p_variant_a UUID, p_sku_a TEXT, p_quantity_a INTEGER,
  p_line_b UUID, p_variant_b UUID, p_sku_b TEXT, p_quantity_b INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, guest_token_hash, guest_name, guest_email, draft_scope
  ) VALUES (
    p_order, 'c2a00000-0000-4000-8000-000000000001', 'c2a00000-0000-4000-8000-000000000003',
    encode(digest(p_order::text, 'sha256'), 'hex'), 'R2A Multi Guest', 'r2a-multi@example.test', 'shop'
  );
  PERFORM * FROM public.replace_commerce_cart_lines(
    p_order, 1, jsonb_build_array(
      jsonb_build_object(
        'id', p_line_a, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
        'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
        'commerce_kind', 'merchandise', 'quantity', p_quantity_a, 'vat_rate', 25,
        'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
        'variant_id', p_variant_a, 'sku', p_sku_a, 'inventory_policy', 'tracked',
        'pickup_location_id', 'c2a00000-0000-4000-8000-000000000030',
        'variant_snapshot', jsonb_build_object('variant_id', p_variant_a, 'sku', p_sku_a,
          'seller_franchisee_id', 'c2a00000-0000-4000-8000-000000000002')
      ),
      jsonb_build_object(
        'id', p_line_b, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
        'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
        'commerce_kind', 'merchandise', 'quantity', p_quantity_b, 'vat_rate', 25,
        'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
        'variant_id', p_variant_b, 'sku', p_sku_b, 'inventory_policy', 'tracked',
        'pickup_location_id', 'c2a00000-0000-4000-8000-000000000030',
        'variant_snapshot', jsonb_build_object('variant_id', p_variant_b, 'sku', p_sku_b,
          'seller_franchisee_id', 'c2a00000-0000-4000-8000-000000000002')
      )
    )
  );
END;
$$;

CREATE FUNCTION pg_temp.prepare_two_line_order(
  p_attempt UUID, p_order UUID, p_line_a UUID, p_variant_a UUID, p_sku_a TEXT, p_quantity_a INTEGER,
  p_line_b UUID, p_variant_b UUID, p_sku_b TEXT, p_quantity_b INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.commerce_r2a_prepare_checkout(
    p_attempt, p_order, 2, jsonb_build_array(
      jsonb_build_object(
        'id', p_line_a, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
        'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
        'commerce_kind', 'merchandise', 'quantity', p_quantity_a, 'unit_price_minor', 29900,
        'discount_minor', 0, 'vat_rate', 25, 'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
        'variant_id', p_variant_a, 'sku', p_sku_a, 'inventory_policy', 'tracked',
        'pickup_location_id', 'c2a00000-0000-4000-8000-000000000030',
        'resolver_snapshot', jsonb_build_object('pricing_source','product_base'),
        'variant_snapshot', jsonb_build_object('variant_id', p_variant_a, 'sku', p_sku_a,
          'seller_franchisee_id', 'c2a00000-0000-4000-8000-000000000002')
      ),
      jsonb_build_object(
        'id', p_line_b, 'product_id', 'c2a00000-0000-4000-8000-000000000010',
        'product_key', 'pickla_classic_tee', 'product_name', 'Pickla Classic Tee',
        'commerce_kind', 'merchandise', 'quantity', p_quantity_b, 'unit_price_minor', 29900,
        'discount_minor', 0, 'vat_rate', 25, 'source_type', 'catalog', 'fulfillment_type', 'desk_pickup',
        'variant_id', p_variant_b, 'sku', p_sku_b, 'inventory_policy', 'tracked',
        'pickup_location_id', 'c2a00000-0000-4000-8000-000000000030',
        'resolver_snapshot', jsonb_build_object('pricing_source','product_base'),
        'variant_snapshot', jsonb_build_object('variant_id', p_variant_b, 'sku', p_sku_b,
          'seller_franchisee_id', 'c2a00000-0000-4000-8000-000000000002')
      )
    ),
    'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000030',
    'test', 'platform', 'r2a-checkout-' || p_attempt,
    jsonb_build_object('mode','payment','client_reference_id',p_order), now() + interval '31 minutes'
  );
END;
$$;

-- Receiving is idempotent and independently location-scoped.
SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000021', 'c2a00000-0000-4000-8000-000000000030',
  5, 'Opening physical count', 'COUNT-A-001', 'receive-black-m-a',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000021', 'c2a00000-0000-4000-8000-000000000030',
  5, 'Opening physical count', 'COUNT-A-001', 'receive-black-m-a',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT * FROM public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000021', 'c2a00000-0000-4000-8000-000000000031',
  3, 'Opening physical count', 'COUNT-B-001', 'receive-black-m-b',
  'c2a00000-0000-4000-8000-000000000005'
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_inventory_positions
    WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021'
      AND location_id = 'c2a00000-0000-4000-8000-000000000030'
      AND on_hand = 5 AND reserved = 0 AND allocated = 0 AND available_to_sell = 5
      AND ledger_on_hand = 5 AND reconciled
  ) THEN RAISE EXCEPTION 'opening stock or receive idempotency failed'; END IF;
  IF (SELECT count(*) FROM public.inventory_movements WHERE source_effect_key LIKE 'inventory-command:%'
      AND variant_id = 'c2a00000-0000-4000-8000-000000000021'
      AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 1 THEN
    RAISE EXCEPTION 'receive command created duplicate movements';
  END IF;
  IF (SELECT available_to_sell FROM public.commerce_inventory_positions
      WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021'
        AND location_id = 'c2a00000-0000-4000-8000-000000000031') <> 3 THEN
    RAISE EXCEPTION 'same variant location balance was not isolated';
  END IF;
END $$;

-- Zero remains a distinct variant price, but free tracked Checkout is unsupported.
SELECT pg_temp.make_tracked_order(
  'c2a00000-0000-4000-8000-000000000250', 'c2a00000-0000-4000-8000-000000000251',
  'c2a00000-0000-4000-8000-000000000020', 'PCT-BLK-S', 1
);
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.prepare_tracked_order(
      'c2a00000-0000-4000-8000-000000000252', 'c2a00000-0000-4000-8000-000000000250',
      'c2a00000-0000-4000-8000-000000000251', 'c2a00000-0000-4000-8000-000000000020',
      'PCT-BLK-S', 1, 0
    );
    RAISE EXCEPTION 'free tracked checkout was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'free_tracked_checkout_unsupported' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.commerce_checkout_attempts WHERE id = 'c2a00000-0000-4000-8000-000000000252')
    OR (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000020' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 0 THEN
    RAISE EXCEPTION 'rejected free tracked checkout left an effect';
  END IF;
END $$;

-- Duplicate demand is aggregated and a failed multi-line reservation rolls back every earlier effect.
SELECT public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000024', 'c2a00000-0000-4000-8000-000000000030',
  3, 'Aggregate-demand fixture', 'COUNT-OW-S-001', 'receive-ow-s-3',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT pg_temp.make_two_line_order(
  'c2a00000-0000-4000-8000-000000000200',
  'c2a00000-0000-4000-8000-000000000201', 'c2a00000-0000-4000-8000-000000000024', 'PCT-OW-S', 2,
  'c2a00000-0000-4000-8000-000000000202', 'c2a00000-0000-4000-8000-000000000024', 'PCT-OW-S', 2
);
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.prepare_two_line_order(
      'c2a00000-0000-4000-8000-000000000203', 'c2a00000-0000-4000-8000-000000000200',
      'c2a00000-0000-4000-8000-000000000201', 'c2a00000-0000-4000-8000-000000000024', 'PCT-OW-S', 2,
      'c2a00000-0000-4000-8000-000000000202', 'c2a00000-0000-4000-8000-000000000024', 'PCT-OW-S', 2
    );
    RAISE EXCEPTION 'duplicate line demand was not aggregated';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'sold_out' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE checkout_attempt_id = 'c2a00000-0000-4000-8000-000000000203')
    OR (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000024' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 0 THEN
    RAISE EXCEPTION 'failed aggregate reservation left an effect';
  END IF;
END $$;

SELECT public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000025', 'c2a00000-0000-4000-8000-000000000030',
  1, 'Rollback fixture', 'COUNT-OW-M-001', 'receive-ow-m-1',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT pg_temp.make_two_line_order(
  'c2a00000-0000-4000-8000-000000000210',
  'c2a00000-0000-4000-8000-000000000211', 'c2a00000-0000-4000-8000-000000000025', 'PCT-OW-M', 1,
  'c2a00000-0000-4000-8000-000000000212', 'c2a00000-0000-4000-8000-000000000026', 'PCT-OW-L', 1
);
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.prepare_two_line_order(
      'c2a00000-0000-4000-8000-000000000213', 'c2a00000-0000-4000-8000-000000000210',
      'c2a00000-0000-4000-8000-000000000211', 'c2a00000-0000-4000-8000-000000000025', 'PCT-OW-M', 1,
      'c2a00000-0000-4000-8000-000000000212', 'c2a00000-0000-4000-8000-000000000026', 'PCT-OW-L', 1
    );
    RAISE EXCEPTION 'unconfigured second line was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'inventory_not_configured' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE checkout_attempt_id = 'c2a00000-0000-4000-8000-000000000213')
    OR (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000025' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 0
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE order_id = 'c2a00000-0000-4000-8000-000000000210' AND movement_type = 'reserve') THEN
    RAISE EXCEPTION 'multi-line reservation was not atomic';
  END IF;
END $$;

-- A paid event racing a conclusive unpaid close uses the immutable original order.
-- If all stock is still available it reacquires all reservations before allocation.
SELECT pg_temp.make_tracked_order(
  'c2a00000-0000-4000-8000-000000000220', 'c2a00000-0000-4000-8000-000000000221',
  'c2a00000-0000-4000-8000-000000000024', 'PCT-OW-S', 2
);
SELECT pg_temp.prepare_tracked_order(
  'c2a00000-0000-4000-8000-000000000222', 'c2a00000-0000-4000-8000-000000000220',
  'c2a00000-0000-4000-8000-000000000221', 'c2a00000-0000-4000-8000-000000000024',
  'PCT-OW-S', 2
);
SELECT public.commerce_r2a_close_unpaid_attempt(
  'c2a00000-0000-4000-8000-000000000222', null, 'creation_failed', 'late-payment-race-fixture'
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_orders
      WHERE id = 'c2a00000-0000-4000-8000-000000000220' AND status = 'cancelled' AND checkout_attempt_id = 'c2a00000-0000-4000-8000-000000000222')
    OR (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000024' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 0 THEN
    RAISE EXCEPTION 'conclusive unpaid closure did not preserve immutable order truth';
  END IF;
END $$;
SELECT * FROM public.finalize_commerce_payment(
  'c2a00000-0000-4000-8000-000000000220', 3, 'cs_test_r2a_late_paid', 'pi_test_r2a_late_paid',
  null, null, 'Late Paid Guest', 'late-paid@example.test', null, 'Kort via Stripe'
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions
      WHERE variant_id = 'c2a00000-0000-4000-8000-000000000024'
        AND location_id = 'c2a00000-0000-4000-8000-000000000030'
        AND on_hand = 3 AND reserved = 0 AND allocated = 2 AND available_to_sell = 1 AND reconciled)
    OR NOT EXISTS (SELECT 1 FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000220' AND status = 'paid') THEN
    RAISE EXCEPTION 'late paid attempt did not reacquire and allocate original stock';
  END IF;
  IF (SELECT count(*) FROM public.inventory_movements
      WHERE order_id = 'c2a00000-0000-4000-8000-000000000220'
        AND movement_type = 'reserve' AND reason = 'Late paid Session reacquired released reservation') <> 1
    OR (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000220') <> 1
    OR (SELECT count(*) FROM public.ledger_entries WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000220' AND source_type = 'commerce_order') <> 1 THEN
    RAISE EXCEPTION 'late paid reacquisition was not exactly once';
  END IF;
END $$;

-- If another immutable attempt owns the released unit, late payment records
-- financial truth and paid-but-unfulfillable attention without stealing stock.
SELECT pg_temp.make_tracked_order(
  'c2a00000-0000-4000-8000-000000000230', 'c2a00000-0000-4000-8000-000000000231',
  'c2a00000-0000-4000-8000-000000000025', 'PCT-OW-M', 1
);
SELECT pg_temp.prepare_tracked_order(
  'c2a00000-0000-4000-8000-000000000232', 'c2a00000-0000-4000-8000-000000000230',
  'c2a00000-0000-4000-8000-000000000231', 'c2a00000-0000-4000-8000-000000000025',
  'PCT-OW-M', 1
);
SELECT public.commerce_r2a_close_unpaid_attempt(
  'c2a00000-0000-4000-8000-000000000232', null, 'creation_failed', 'late-payment-shortage-fixture'
);
SELECT pg_temp.make_tracked_order(
  'c2a00000-0000-4000-8000-000000000240', 'c2a00000-0000-4000-8000-000000000241',
  'c2a00000-0000-4000-8000-000000000025', 'PCT-OW-M', 1
);
SELECT pg_temp.prepare_tracked_order(
  'c2a00000-0000-4000-8000-000000000242', 'c2a00000-0000-4000-8000-000000000240',
  'c2a00000-0000-4000-8000-000000000241', 'c2a00000-0000-4000-8000-000000000025',
  'PCT-OW-M', 1
);
SELECT * FROM public.finalize_commerce_payment(
  'c2a00000-0000-4000-8000-000000000230', 3, 'cs_test_r2a_late_short', 'pi_test_r2a_late_short',
  null, null, 'Late Short Guest', 'late-short@example.test', null, 'Kort via Stripe'
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000230' AND status = 'attention')
    OR EXISTS (SELECT 1 FROM public.inventory_allocations WHERE checkout_attempt_id = 'c2a00000-0000-4000-8000-000000000232')
    OR NOT EXISTS (SELECT 1 FROM public.inventory_incidents incident
      JOIN public.inventory_levels level ON level.id = incident.inventory_level_id
      WHERE level.variant_id = 'c2a00000-0000-4000-8000-000000000025'
        AND incident.incident_type = 'paid_without_reservation' AND incident.status = 'open')
    OR NOT EXISTS (SELECT 1 FROM public.commerce_inventory_positions
      WHERE variant_id = 'c2a00000-0000-4000-8000-000000000025'
        AND on_hand = 1 AND reserved = 1 AND allocated = 0 AND available_to_sell = 0 AND reconciled)
    OR (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000230') <> 1
    OR (SELECT count(*) FROM public.ledger_entries WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000230' AND source_type = 'commerce_order') <> 1 THEN
    RAISE EXCEPTION 'late paid shortage did not preserve financial and inventory truth';
  END IF;
END $$;
SELECT public.commerce_r2a_close_unpaid_attempt(
  'c2a00000-0000-4000-8000-000000000242', null, 'creation_failed', 'release-competing-fixture'
);

-- Stable SKU and option-combination identity includes archived rows.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.product_variants (
      product_id, catalog_owner_organization_id, sku, title, option_signature, status
    ) VALUES (
      'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001',
      'pct-blk-m', 'Duplicate normalized SKU',
      'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000015', 'archived'
    );
    RAISE EXCEPTION 'normalized duplicate SKU was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.product_variants (
      product_id, catalog_owner_organization_id, sku, title, option_signature, status
    ) VALUES (
      'c2a00000-0000-4000-8000-000000000010', 'c2a00000-0000-4000-8000-000000000001',
      'PCT-OTHER', 'Duplicate combination',
      'c2a00000-0000-4000-8000-000000000013,c2a00000-0000-4000-8000-000000000016', 'active'
    );
    RAISE EXCEPTION 'duplicate option combination was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.access_products SET activity_addon_enabled = true
    WHERE id = 'c2a00000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'tracked merchandise activity add-on was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%tracked_activity_addon%' AND SQLERRM NOT LIKE '%access_products_tracked_merch_shape%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.access_products SET inventory_policy = 'stockless'
    WHERE id = 'c2a00000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'configured tracked product returned to stockless';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'inventory_policy_has_catalog_or_inventory_configuration' THEN RAISE; END IF;
  END;
END $$;

-- Normal paid purchase: reservation -> allocation -> partial pickup -> independent refunds/returns.
SELECT pg_temp.make_tracked_order(
  'c2a00000-0000-4000-8000-000000000100', 'c2a00000-0000-4000-8000-000000000101',
  'c2a00000-0000-4000-8000-000000000021', 'PCT-BLK-M', 2
);
SELECT pg_temp.prepare_tracked_order(
  'c2a00000-0000-4000-8000-000000000102', 'c2a00000-0000-4000-8000-000000000100',
  'c2a00000-0000-4000-8000-000000000101', 'c2a00000-0000-4000-8000-000000000021',
  'PCT-BLK-M', 2
);
-- Exact replay returns the same attempt and does not reserve twice.
SELECT pg_temp.prepare_tracked_order(
  'c2a00000-0000-4000-8000-000000000102', 'c2a00000-0000-4000-8000-000000000100',
  'c2a00000-0000-4000-8000-000000000101', 'c2a00000-0000-4000-8000-000000000021',
  'PCT-BLK-M', 2
);
SELECT (public.commerce_r2a_attach_checkout_session(
  'c2a00000-0000-4000-8000-000000000102', 'cs_test_r2a_a',
  '{"id":"cs_test_r2a_a","status":"open"}'::jsonb
)).id;
SELECT * FROM public.finalize_commerce_payment(
  'c2a00000-0000-4000-8000-000000000100', 3, 'cs_test_r2a_a', 'pi_test_r2a_a',
  null, null, 'R2A Guest', 'r2a-guest@example.test', null, 'Kort via Stripe'
);
SELECT * FROM public.finalize_commerce_payment(
  'c2a00000-0000-4000-8000-000000000100', 3, 'cs_test_r2a_a', 'pi_test_r2a_a',
  null, null, 'R2A Guest', 'r2a-guest@example.test', null, 'Kort via Stripe'
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_inventory_positions
    WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021'
      AND location_id = 'c2a00000-0000-4000-8000-000000000030'
      AND on_hand = 5 AND reserved = 0 AND allocated = 2 AND available_to_sell = 3 AND reconciled
  ) THEN RAISE EXCEPTION 'payment did not convert reservation to allocation'; END IF;
  IF (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100') <> 1
    OR (SELECT count(*) FROM public.ledger_entries WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100' AND source_type = 'commerce_order') <> 1
    OR (SELECT count(*) FROM public.inventory_movements WHERE movement_type = 'payment_commit' AND order_id = 'c2a00000-0000-4000-8000-000000000100') <> 1 THEN
    RAISE EXCEPTION 'payment effects were not exactly once';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_orders
    WHERE id = 'c2a00000-0000-4000-8000-000000000100'
      AND total_inc_vat_minor = 59800 AND vat_amount_minor = 11960 AND total_ex_vat_minor = 47840
  ) THEN RAISE EXCEPTION '299 SEK / 25 percent VAT math failed'; END IF;
END $$;

SELECT * FROM public.commerce_r2a_collect_pickup(
  'c2a00000-0000-4000-8000-000000000101', 1,
  'c2a00000-0000-4000-8000-000000000003', 'pickup-a-1',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT * FROM public.commerce_r2a_collect_pickup(
  'c2a00000-0000-4000-8000-000000000101', 1,
  'c2a00000-0000-4000-8000-000000000003', 'pickup-a-1',
  'c2a00000-0000-4000-8000-000000000005'
);
DO $$
DECLARE v_refund public.commerce_refunds%ROWTYPE;
BEGIN
  v_refund := public.commerce_r2a_prepare_refund(
    'c2a00000-0000-4000-8000-000000000100',
    '[{"line_id":"c2a00000-0000-4000-8000-000000000101","quantity":1}]'::jsonb,
    null, 'Collected unit refund', 'test', 'platform', 'refund-a-1',
    'c2a00000-0000-4000-8000-000000000005'
  );
  PERFORM public.commerce_r2a_reconcile_refund(v_refund.id, 're_test_r2a_1', 'succeeded', '{"status":"succeeded"}', null);
  PERFORM public.commerce_r2a_reconcile_refund(v_refund.id, 're_test_r2a_1', 'succeeded', '{"status":"succeeded"}', null);
  PERFORM public.commerce_r2a_record_disposition(
    'c2a00000-0000-4000-8000-000000000101', 1, 'return_sellable', v_refund.id,
    'Sellable return physically accepted', 'return-a-1', 'c2a00000-0000-4000-8000-000000000005'
  );
  PERFORM public.commerce_r2a_record_disposition(
    'c2a00000-0000-4000-8000-000000000101', 1, 'return_sellable', v_refund.id,
    'Sellable return physically accepted', 'return-a-1', 'c2a00000-0000-4000-8000-000000000005'
  );
END $$;
SELECT * FROM public.commerce_r2a_collect_pickup(
  'c2a00000-0000-4000-8000-000000000101', 1,
  'c2a00000-0000-4000-8000-000000000003', 'pickup-a-2',
  'c2a00000-0000-4000-8000-000000000005'
);
DO $$
DECLARE v_refund public.commerce_refunds%ROWTYPE;
BEGIN
  v_refund := public.commerce_r2a_prepare_refund(
    'c2a00000-0000-4000-8000-000000000100',
    '[{"line_id":"c2a00000-0000-4000-8000-000000000101","quantity":1}]'::jsonb,
    null, 'Second unit refund', 'test', 'platform', 'refund-a-2',
    'c2a00000-0000-4000-8000-000000000005'
  );
  PERFORM public.commerce_r2a_reconcile_refund(v_refund.id, 're_test_r2a_2', 'pending', '{"status":"pending"}', null);
  PERFORM public.commerce_r2a_reconcile_refund(v_refund.id, 're_test_r2a_2', 'succeeded', '{"status":"succeeded"}', null);
  PERFORM public.commerce_r2a_record_disposition(
    'c2a00000-0000-4000-8000-000000000101', 1, 'return_damaged', v_refund.id,
    'Damaged return physically accepted', 'return-a-2', 'c2a00000-0000-4000-8000-000000000005'
  );
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_inventory_positions
    WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021'
      AND location_id = 'c2a00000-0000-4000-8000-000000000030'
      AND on_hand = 4 AND reserved = 0 AND allocated = 0 AND available_to_sell = 4 AND reconciled
  ) THEN RAISE EXCEPTION 'pickup/refund/disposition balances failed'; END IF;
  IF (SELECT count(*) FROM public.ledger_entries WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100' AND source_type = 'commerce_refund') <> 2
    OR (SELECT sum(amount_inc_vat_minor) FROM public.commerce_refunds WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100' AND status = 'succeeded') <> 59800 THEN
    RAISE EXCEPTION 'partial refund financial reconciliation failed';
  END IF;
  IF (SELECT count(*) FROM public.inventory_movements WHERE movement_type = 'return_sellable' AND order_id = 'c2a00000-0000-4000-8000-000000000100') <> 1
    OR (SELECT count(*) FROM public.commerce_physical_dispositions WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100') <> 2 THEN
    RAISE EXCEPTION 'return dispositions were not exactly once';
  END IF;
END $$;

-- A provider refund can be observed as succeeded and later fail. Financial
-- effects compensate exactly once while pickup/return/inventory history stays
-- byte-for-byte owned by its separate physical commands.
DO $$
DECLARE
  v_refund public.commerce_refunds%ROWTYPE;
  v_replacement public.commerce_refunds%ROWTYPE;
  v_movement_count INTEGER;
  v_disposition_count INTEGER;
BEGIN
  SELECT * INTO v_refund
  FROM public.commerce_refunds
  WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100'
    AND provider_refund_id = 're_test_r2a_2';
  SELECT count(*) INTO v_movement_count
  FROM public.inventory_movements
  WHERE order_id = 'c2a00000-0000-4000-8000-000000000100';
  SELECT count(*) INTO v_disposition_count
  FROM public.commerce_physical_dispositions
  WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100';

  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund.id, 're_test_r2a_2', 'failed',
    '{"id":"re_test_r2a_2","status":"failed","failure_reason":"expired_or_canceled_card"}',
    'Stripe refund failed: expired_or_canceled_card'
  );
  -- Duplicate failure and stale, out-of-order success must have no second effect.
  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund.id, 're_test_r2a_2', 'failed',
    '{"id":"re_test_r2a_2","status":"failed","failure_reason":"expired_or_canceled_card"}',
    'Stripe refund failed: expired_or_canceled_card'
  );
  PERFORM public.commerce_r2a_reconcile_refund(
    v_refund.id, 're_test_r2a_2', 'succeeded',
    '{"id":"re_test_r2a_2","status":"succeeded"}', null
  );

  IF (SELECT status FROM public.commerce_refunds WHERE id = v_refund.id) <> 'failed'
    OR NOT EXISTS (
      SELECT 1 FROM public.commerce_refunds
      WHERE id = v_refund.id
        AND provider_succeeded_at IS NOT NULL
        AND provider_failed_at IS NOT NULL
        AND provider_monitor_until IS NULL
    ) THEN
    RAISE EXCEPTION 'provider refund truth did not converge to terminal failure';
  END IF;
  IF (SELECT count(*) FROM public.ledger_entries WHERE source_type = 'commerce_refund' AND source_id = v_refund.id::TEXT) <> 1
    OR (SELECT count(*) FROM public.ledger_entries WHERE source_type = 'commerce_refund_reversal' AND source_id = v_refund.id::TEXT) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.ledger_entries
      WHERE source_type = 'commerce_refund_reversal' AND source_id = v_refund.id::TEXT
        AND payment_status = 'refund_reversed'
        AND (metadata->>'net_refund_delta_minor')::INTEGER = -29900
        AND metadata->>'physical_truth_changed' = 'false'
    ) THEN
    RAISE EXCEPTION 'failed refund compensation was not append-only/exactly-once';
  END IF;
  IF (SELECT payment_status FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100') <> 'partially_refunded'
    OR (SELECT status FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000100') <> 'attention'
    OR (SELECT sum(amount_inc_vat_minor) FROM public.commerce_refunds WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100' AND status = 'succeeded') <> 29900 THEN
    RAISE EXCEPTION 'receipt/order/refundable amount did not reconcile after refund failure';
  END IF;
  IF (SELECT count(*) FROM public.ops_incidents WHERE metadata->>'commerce_refund_id' = v_refund.id::TEXT) <> 1
    OR (SELECT count(*) FROM public.audit_log WHERE action = 'commerce.refund.provider_failed' AND entity_id = v_refund.id::TEXT) <> 1 THEN
    RAISE EXCEPTION 'refund failure incident/audit was not exactly once';
  END IF;
  IF (SELECT count(*) FROM public.inventory_movements WHERE order_id = 'c2a00000-0000-4000-8000-000000000100') <> v_movement_count
    OR (SELECT count(*) FROM public.commerce_physical_dispositions WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000100') <> v_disposition_count
    OR (SELECT fulfillment_status FROM public.commerce_order_lines WHERE id = 'c2a00000-0000-4000-8000-000000000101') <> 'collected'
    OR (SELECT collected_quantity FROM public.inventory_allocations WHERE commerce_order_line_id = 'c2a00000-0000-4000-8000-000000000101') <> 2 THEN
    RAISE EXCEPTION 'financial refund reconciliation rewrote physical truth';
  END IF;

  -- The failed quantity no longer consumes the refundable cap.
  v_replacement := public.commerce_r2a_prepare_refund(
    'c2a00000-0000-4000-8000-000000000100',
    '[{"line_id":"c2a00000-0000-4000-8000-000000000101","quantity":1}]'::jsonb,
    null, 'Replacement refund after provider failure', 'test', 'platform', 'refund-a-3',
    'c2a00000-0000-4000-8000-000000000005'
  );
  IF v_replacement.amount_inc_vat_minor <> 29900 OR v_replacement.status <> 'preparing' THEN
    RAISE EXCEPTION 'failed refund continued to consume refundable quantity/amount';
  END IF;
END $$;

-- Confirmed provider expiry releases once; browser abandonment and local time alone do nothing.
SELECT public.commerce_r2a_receive_inventory(
  'c2a00000-0000-4000-8000-000000000020', 'c2a00000-0000-4000-8000-000000000030',
  1, 'Opening physical count', 'COUNT-S-001', 'receive-black-s-a',
  'c2a00000-0000-4000-8000-000000000005'
);
SELECT pg_temp.make_tracked_order('c2a00000-0000-4000-8000-000000000110', 'c2a00000-0000-4000-8000-000000000111', 'c2a00000-0000-4000-8000-000000000020', 'PCT-BLK-S', 1);
SELECT pg_temp.prepare_tracked_order('c2a00000-0000-4000-8000-000000000112', 'c2a00000-0000-4000-8000-000000000110', 'c2a00000-0000-4000-8000-000000000111', 'c2a00000-0000-4000-8000-000000000020', 'PCT-BLK-S', 1);
DO $$ BEGIN
  IF (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000020' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 1 THEN
    RAISE EXCEPTION 'unattached/local-deadline reservation was released';
  END IF;
END $$;
SELECT (public.commerce_r2a_attach_checkout_session('c2a00000-0000-4000-8000-000000000112', 'cs_test_r2a_expire', '{"status":"open"}')).id;
SELECT (public.commerce_r2a_close_unpaid_attempt('c2a00000-0000-4000-8000-000000000112', 'cs_test_r2a_expire', 'expired', 'provider_confirmed_expired')).id;
SELECT (public.commerce_r2a_close_unpaid_attempt('c2a00000-0000-4000-8000-000000000112', 'cs_test_r2a_expire', 'expired', 'provider_confirmed_expired')).id;
DO $$ BEGIN
  IF (SELECT reserved FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000020' AND location_id = 'c2a00000-0000-4000-8000-000000000030') <> 0
    OR (SELECT count(*) FROM public.inventory_movements WHERE movement_type = 'reservation_release' AND order_id = 'c2a00000-0000-4000-8000-000000000110') <> 1 THEN
    RAISE EXCEPTION 'confirmed expiry release was not exactly once';
  END IF;
END $$;

-- Payment may safely arrive before application Session attachment.
SELECT public.commerce_r2a_receive_inventory('c2a00000-0000-4000-8000-000000000022', 'c2a00000-0000-4000-8000-000000000030', 1, 'Opening physical count', 'COUNT-L-001', 'receive-black-l-a', 'c2a00000-0000-4000-8000-000000000005');
SELECT pg_temp.make_tracked_order('c2a00000-0000-4000-8000-000000000120', 'c2a00000-0000-4000-8000-000000000121', 'c2a00000-0000-4000-8000-000000000022', 'PCT-BLK-L', 1);
SELECT pg_temp.prepare_tracked_order('c2a00000-0000-4000-8000-000000000122', 'c2a00000-0000-4000-8000-000000000120', 'c2a00000-0000-4000-8000-000000000121', 'c2a00000-0000-4000-8000-000000000022', 'PCT-BLK-L', 1, 31900);
SELECT * FROM public.finalize_commerce_payment('c2a00000-0000-4000-8000-000000000120', 3, 'cs_test_webhook_before_attach', 'pi_test_webhook_before_attach', null, null, 'R2A Guest', 'r2a-guest@example.test', null, 'Kort via Stripe');
SELECT (public.commerce_r2a_attach_checkout_session('c2a00000-0000-4000-8000-000000000122', 'cs_test_webhook_before_attach', '{"status":"complete","payment_status":"paid"}')).status;

-- Controlled physical shortage preserves the paid claim, blocks work, and resolves only after evidence reconciles.
SELECT * FROM public.commerce_r2a_correct_inventory(
  'c2a00000-0000-4000-8000-000000000022', 'c2a00000-0000-4000-8000-000000000030',
  0, 4, true, 'Verified physical shortage', 'shortage-l-1',
  'c2a00000-0000-4000-8000-000000000005'
);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_inventory_positions
    WHERE variant_id = 'c2a00000-0000-4000-8000-000000000022'
      AND on_hand = 0 AND reserved = 0 AND allocated = 1 AND available_to_sell = -1
      AND incident_blocked AND reconciled
  ) THEN RAISE EXCEPTION 'shortage truth was hidden or claim was lost'; END IF;
END $$;
SELECT public.commerce_r2a_receive_inventory('c2a00000-0000-4000-8000-000000000022', 'c2a00000-0000-4000-8000-000000000030', 1, 'Shortage replacement', 'COUNT-L-002', 'receive-black-l-replacement', 'c2a00000-0000-4000-8000-000000000005');
SELECT public.commerce_r2a_resolve_inventory_incident(
  (SELECT id FROM public.inventory_incidents WHERE inventory_level_id = (SELECT id FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000022' AND location_id = 'c2a00000-0000-4000-8000-000000000030') AND status = 'open' LIMIT 1),
  '{"physical_recount":"COUNT-L-002","verified":true}', 'resolve-shortage-l',
  'c2a00000-0000-4000-8000-000000000005'
);

-- Reconciliation mismatch is detected, blocks, and cannot be cosmetically closed.
UPDATE public.inventory_levels SET reserved = reserved + 1
WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021'
  AND location_id = 'c2a00000-0000-4000-8000-000000000030';
SELECT public.commerce_r2a_scan_inventory_reconciliation();
DO $$
DECLARE v_incident UUID;
BEGIN
  SELECT id INTO v_incident FROM public.inventory_incidents
  WHERE incident_type = 'reconciliation_mismatch' AND status = 'open'
    AND inventory_level_id = (SELECT id FROM public.inventory_levels WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021' AND location_id = 'c2a00000-0000-4000-8000-000000000030');
  IF v_incident IS NULL THEN RAISE EXCEPTION 'reconciliation mismatch incident missing'; END IF;
  BEGIN
    PERFORM public.commerce_r2a_resolve_inventory_incident(v_incident, '{"note":"not actually fixed"}', 'bad-resolution', 'c2a00000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'unreconciled incident was closed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%inventory_reconciliation_mismatch_remains%' THEN RAISE; END IF;
  END;
  UPDATE public.inventory_levels SET reserved = reserved - 1 WHERE id = (SELECT inventory_level_id FROM public.inventory_incidents WHERE id = v_incident);
  PERFORM public.commerce_r2a_resolve_inventory_incident(v_incident, '{"note":"balance compared to immutable movements"}', 'good-resolution', 'c2a00000-0000-4000-8000-000000000005');
END $$;

-- Direct client mutation and unauthorized command access fail closed; movements are immutable.
DO $$
BEGIN
  BEGIN
    PERFORM public.commerce_r2a_receive_inventory(
      'c2a00000-0000-4000-8000-000000000021', 'c2a00000-0000-4000-8000-000000000030',
      1, 'Unauthorized', 'NOPE', 'unauthorized-receive', 'c2a00000-0000-4000-8000-000000000006'
    );
    RAISE EXCEPTION 'unauthorized inventory command succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.inventory_movements SET reason = 'rewritten' WHERE variant_id = 'c2a00000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'movement mutation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.inventory_levels', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated role retained direct inventory mutation privileges';
  END IF;
  IF has_function_privilege(
    'authenticated', 'public.commerce_r2a_scan_inventory_reconciliation()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated role retained recovery RPC execution privilege';
  END IF;
END $$;

-- Used identity cannot be repurposed, but lifecycle archive remains valid.
DO $$
BEGIN
  BEGIN
    UPDATE public.product_variants SET sku = 'PCT-REPURPOSED'
    WHERE id = 'c2a00000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'used SKU identity was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%used_variant_identity_is_immutable%' THEN RAISE; END IF;
  END;
  UPDATE public.product_variants SET status = 'archived'
  WHERE id = 'c2a00000-0000-4000-8000-000000000021';
  IF (SELECT status FROM public.product_variants WHERE id = 'c2a00000-0000-4000-8000-000000000021') <> 'archived' THEN
    RAISE EXCEPTION 'variant archive failed';
  END IF;
END $$;

-- Legacy rows remain explicit stockless and the legacy canonical regression is run separately unchanged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.access_products WHERE id <> 'c2a00000-0000-4000-8000-000000000010' AND inventory_policy <> 'stockless') THEN
    RAISE EXCEPTION 'legacy product tracking policy changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_inventory_positions WHERE NOT reconciled) THEN
    RAISE EXCEPTION 'final inventory projection does not reconcile';
  END IF;
END $$;

SELECT
  variant_id, location_id, on_hand, reserved, allocated, available_to_sell,
  ledger_on_hand, ledger_reserved, ledger_allocated, reconciled
FROM public.commerce_inventory_positions
WHERE variant_id IN (
  'c2a00000-0000-4000-8000-000000000020',
  'c2a00000-0000-4000-8000-000000000021',
  'c2a00000-0000-4000-8000-000000000022'
)
ORDER BY location_id, variant_id;

ROLLBACK;
