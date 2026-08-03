\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'c2c00000-0000-4000-8000-000000000001',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'Commerce R1B Venue', 'commerce-r1b-venue', true
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'c2c00000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
  'r1b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, user_id, guest_token_hash, draft_scope,
  draft_idempotency_key_hash, expires_at
) VALUES (
  'c2c00000-0000-4000-8000-000000000101',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'c2c00000-0000-4000-8000-000000000001',
  'c2c00000-0000-4000-8000-000000000011', repeat('1', 64), 'shop', repeat('a', 64), now() + interval '30 days'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.commerce_orders (
      organization_id, venue_id, user_id, guest_token_hash, draft_scope,
      draft_idempotency_key_hash, expires_at
    ) VALUES (
      (SELECT id FROM public.organizations WHERE slug = 'pickla'),
      'c2c00000-0000-4000-8000-000000000001',
      'c2c00000-0000-4000-8000-000000000011', repeat('2', 64), 'shop', repeat('b', 64), now() + interval '30 days'
    );
    RAISE EXCEPTION 'duplicate authenticated shop cart was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, guest_token_hash, draft_scope,
  draft_idempotency_key_hash, expires_at
) VALUES (
  'c2c00000-0000-4000-8000-000000000102',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'c2c00000-0000-4000-8000-000000000001', repeat('3', 64), 'shop', repeat('c', 64), now() + interval '30 days'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.commerce_orders (
      organization_id, venue_id, guest_token_hash, draft_scope,
      draft_idempotency_key_hash, expires_at
    ) VALUES (
      (SELECT id FROM public.organizations WHERE slug = 'pickla'),
      'c2c00000-0000-4000-8000-000000000001', repeat('4', 64), 'shop', repeat('c', 64), now() + interval '30 days'
    );
    RAISE EXCEPTION 'duplicate guest shop cart was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

SELECT * FROM public.replace_commerce_cart_lines(
  'c2c00000-0000-4000-8000-000000000101', 1,
  '[{"id":"c2c00000-0000-4000-8000-000000000201","product_key":"r1b_bag","product_name":"Pickla Bag","commerce_kind":"merchandise","quantity":2,"vat_rate":25,"source_type":"catalog","fulfillment_type":"desk_pickup","sort_order":0}]'::jsonb
);

SELECT * FROM public.replace_commerce_cart_lines(
  'c2c00000-0000-4000-8000-000000000101', 2, '[]'::jsonb
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.commerce_order_lines WHERE commerce_order_id = 'c2c00000-0000-4000-8000-000000000101') THEN
    RAISE EXCEPTION 'empty cart retained stale lines';
  END IF;
  IF (SELECT version FROM public.commerce_orders WHERE id = 'c2c00000-0000-4000-8000-000000000101') <> 3 THEN
    RAISE EXCEPTION 'empty cart did not advance version';
  END IF;
  IF (SELECT total_inc_vat_minor FROM public.commerce_orders WHERE id = 'c2c00000-0000-4000-8000-000000000101') <> 0 THEN
    RAISE EXCEPTION 'empty cart retained stale totals';
  END IF;
END $$;

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, guest_token_hash, draft_scope, expires_at
) VALUES (
  'c2c00000-0000-4000-8000-000000000110',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'c2c00000-0000-4000-8000-000000000001', repeat('5', 64), 'shop', now() + interval '30 days'
);

SELECT * FROM public.replace_commerce_cart_lines(
  'c2c00000-0000-4000-8000-000000000110', 1,
  '[{"id":"c2c00000-0000-4000-8000-000000000210","product_key":"r1b_racket","product_name":"Hyrrack","commerce_kind":"rental","quantity":2,"vat_rate":6,"source_type":"catalog","fulfillment_type":"desk_pickup","sort_order":0}]'::jsonb
);
UPDATE public.commerce_orders SET status = 'paid', paid_at = now() WHERE id = 'c2c00000-0000-4000-8000-000000000110';
UPDATE public.commerce_order_lines SET fulfillment_status = 'pending_pickup' WHERE id = 'c2c00000-0000-4000-8000-000000000210';

SELECT public.transition_commerce_fulfillment(
  'c2c00000-0000-4000-8000-000000000210', 'collected',
  'c2c00000-0000-4000-8000-000000000011', 'r1b-collect-first', '{}'
);
SELECT public.transition_commerce_fulfillment(
  'c2c00000-0000-4000-8000-000000000210', 'collected',
  'c2c00000-0000-4000-8000-000000000011', 'r1b-collect-retry', '{}'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_log WHERE entity_id = 'c2c00000-0000-4000-8000-000000000210' AND action = 'commerce.fulfillment.transition') <> 1 THEN
    RAISE EXCEPTION 'fulfillment retry created another audit event';
  END IF;
  IF (SELECT fulfilled_by FROM public.commerce_order_lines WHERE id = 'c2c00000-0000-4000-8000-000000000210') <> 'c2c00000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'fulfillment actor changed';
  END IF;
  IF has_function_privilege('authenticated', 'public.transition_commerce_fulfillment(uuid,text,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fulfillment RPC is exposed outside the Edge Function';
  END IF;
END $$;

ROLLBACK;
