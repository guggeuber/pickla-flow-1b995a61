\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES
  ('c2a00000-0000-4000-8000-000000000002', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'Commerce R1 Venue', 'commerce-r1-venue', true),
  ('c2a00000-0000-4000-8000-000000000003', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'Commerce R1 Other Venue', 'commerce-r1-other', true);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('c2a00000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'r1-two@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('c2a00000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'r1-three@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, recurrence_days, start_time, end_time,
  price_sek, capacity, product_key, publish_status
) VALUES (
  'c2a00000-0000-4000-8000-000000000020',
  'c2a00000-0000-4000-8000-000000000002',
  'Commerce R1 Open Play', 'open_play', ARRAY[6], '10:00', '12:00',
  165, 8, 'r1_open_play', 'published'
);

-- R1A authenticated drafts: one active order per user/venue/activity/date.
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, user_id, guest_token_hash, draft_scope, expires_at
) VALUES
  ('c2a00000-0000-4000-8000-000000000101', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000012', repeat('1', 64), 'activity:c2a00000-0000-4000-8000-000000000020:2026-08-01', now() + interval '30 days'),
  ('c2a00000-0000-4000-8000-000000000102', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000012', repeat('2', 64), 'activity:c2a00000-0000-4000-8000-000000000020:2026-08-02', now() + interval '30 days'),
  ('c2a00000-0000-4000-8000-000000000103', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'c2a00000-0000-4000-8000-000000000002', 'c2a00000-0000-4000-8000-000000000013', repeat('3', 64), 'activity:c2a00000-0000-4000-8000-000000000020:2026-08-01', now() + interval '30 days'),
  ('c2a00000-0000-4000-8000-000000000104', (SELECT id FROM public.organizations WHERE slug = 'pickla'), 'c2a00000-0000-4000-8000-000000000003', 'c2a00000-0000-4000-8000-000000000012', repeat('4', 64), 'activity:c2a00000-0000-4000-8000-000000000020:2026-08-01', now() + interval '30 days');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.commerce_orders (
      organization_id, venue_id, user_id, guest_token_hash, draft_scope, expires_at
    ) VALUES (
      (SELECT id FROM public.organizations WHERE slug = 'pickla'),
      'c2a00000-0000-4000-8000-000000000002',
      'c2a00000-0000-4000-8000-000000000012',
      repeat('5', 64),
      'activity:c2a00000-0000-4000-8000-000000000020:2026-08-01',
      now() + interval '30 days'
    );
    RAISE EXCEPTION 'duplicate active activity draft was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

SELECT * FROM public.replace_commerce_cart_lines(
  'c2a00000-0000-4000-8000-000000000101', 1,
  '[
    {"id":"c2a00000-0000-4000-8000-000000000111","product_key":"r1_open_play","product_name":"Open Play","commerce_kind":"participation","quantity":1,"vat_rate":6,"source_type":"activity_session","source_id":"c2a00000-0000-4000-8000-000000000020","fulfillment_type":"participation","activity_session_id":"c2a00000-0000-4000-8000-000000000020","session_date":"2026-08-01","sort_order":0},
    {"id":"c2a00000-0000-4000-8000-000000000112","product_key":"rental_racket","product_name":"Hyrrack","commerce_kind":"rental","quantity":2,"vat_rate":6,"source_type":"activity_addon","fulfillment_type":"desk_pickup","parent_line_id":"c2a00000-0000-4000-8000-000000000111","sort_order":10}
  ]'::jsonb
);

DO $$
DECLARE
  v_version INTEGER;
  v_quantity INTEGER;
BEGIN
  SELECT version INTO v_version FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000101';
  SELECT quantity INTO v_quantity FROM public.commerce_order_lines WHERE id = 'c2a00000-0000-4000-8000-000000000112';
  IF v_version <> 2 OR v_quantity <> 2 THEN RAISE EXCEPTION 'draft quantity/version did not persist'; END IF;
  IF (SELECT count(*) FROM public.commerce_orders WHERE user_id = 'c2a00000-0000-4000-8000-000000000012' AND venue_id = 'c2a00000-0000-4000-8000-000000000002' AND draft_scope = 'activity:c2a00000-0000-4000-8000-000000000020:2026-08-01' AND status = 'draft') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active draft';
  END IF;
END $$;

-- R1B guest order uses the canonical customer, hold, registration and receipt chain.
INSERT INTO public.customers (
  id, organization_id, display_name, primary_email, email_normalized, status, metadata
) VALUES (
  'c2a00000-0000-4000-8000-000000000201',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'Commerce Guest', 'r1-one@example.test', 'r1-one@example.test', 'active', '{"source":"commerce_r1_test"}'
);

INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, customer_id, guest_token_hash, guest_name, guest_email
) VALUES (
  'c2a00000-0000-4000-8000-000000000210',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'c2a00000-0000-4000-8000-000000000002',
  'c2a00000-0000-4000-8000-000000000201',
  repeat('a', 64), 'Commerce Guest', 'r1-one@example.test'
);

SELECT * FROM public.replace_commerce_cart_lines(
  'c2a00000-0000-4000-8000-000000000210', 1,
  '[
    {"id":"c2a00000-0000-4000-8000-000000000211","product_key":"r1_open_play","product_name":"Open Play","commerce_kind":"participation","quantity":1,"vat_rate":6,"source_type":"activity_session","source_id":"c2a00000-0000-4000-8000-000000000020","fulfillment_type":"participation","activity_session_id":"c2a00000-0000-4000-8000-000000000020","session_date":"2026-08-01","sort_order":0},
    {"id":"c2a00000-0000-4000-8000-000000000212","product_key":"rental_racket","product_name":"Hyrrack","commerce_kind":"rental","quantity":1,"vat_rate":6,"source_type":"activity_addon","fulfillment_type":"desk_pickup","parent_line_id":"c2a00000-0000-4000-8000-000000000211","sort_order":10}
  ]'::jsonb
);

DO $$
DECLARE
  v_hold_id UUID;
  v_hold_id_retry UUID;
  v_registration_id UUID;
BEGIN
  SELECT hold_id INTO v_hold_id FROM public.acquire_capacity_hold(
    'c2a00000-0000-4000-8000-000000000002', 'activity_session',
    'c2a00000-0000-4000-8000-000000000020', '2026-08-01', 8,
    NULL, 'c2a00000-0000-4000-8000-000000000201', 'commerce_order',
    'c2a00000-0000-4000-8000-000000000210', 'commerce-r1-hold', '{}', 600
  ) WHERE ok;
  SELECT hold_id INTO v_hold_id_retry FROM public.acquire_capacity_hold(
    'c2a00000-0000-4000-8000-000000000002', 'activity_session',
    'c2a00000-0000-4000-8000-000000000020', '2026-08-01', 8,
    NULL, 'c2a00000-0000-4000-8000-000000000201', 'commerce_order',
    'c2a00000-0000-4000-8000-000000000210', 'commerce-r1-hold', '{}', 600
  ) WHERE ok;
  IF v_hold_id IS NULL OR v_hold_id <> v_hold_id_retry THEN RAISE EXCEPTION 'hold was not idempotent'; END IF;

  PERFORM * FROM public.freeze_commerce_order(
    'c2a00000-0000-4000-8000-000000000210', 2,
    jsonb_build_array(
      jsonb_build_object('id','c2a00000-0000-4000-8000-000000000211','product_key','r1_open_play','product_name','Open Play','commerce_kind','participation','quantity',1,'unit_price_minor',16500,'discount_minor',0,'vat_rate',6,'fulfillment_type','participation','capacity_hold_id',v_hold_id),
      jsonb_build_object('id','c2a00000-0000-4000-8000-000000000212','product_key','rental_racket','product_name','Hyrrack','commerce_kind','rental','quantity',1,'unit_price_minor',5000,'discount_minor',0,'vat_rate',6,'fulfillment_type','desk_pickup')
    )
  );
  PERFORM public.attach_commerce_order_stripe_session('c2a00000-0000-4000-8000-000000000210', 3, 'cs_test_r1_guest');
  PERFORM * FROM public.finalize_commerce_payment(
    'c2a00000-0000-4000-8000-000000000210', 3, 'cs_test_r1_guest', 'pi_test_r1_guest',
    'c2a00000-0000-4000-8000-000000000201', NULL, 'Commerce Guest', 'r1-one@example.test', NULL, 'card'
  );
  PERFORM * FROM public.finalize_commerce_payment(
    'c2a00000-0000-4000-8000-000000000210', 3, 'cs_test_r1_guest', 'pi_test_r1_guest',
    'c2a00000-0000-4000-8000-000000000201', NULL, 'Commerce Guest', 'r1-one@example.test', NULL, 'card'
  );

  SELECT registration_id INTO v_registration_id FROM public.commit_activity_registration_capacity(
    'c2a00000-0000-4000-8000-000000000002',
    'c2a00000-0000-4000-8000-000000000020', '2026-08-01', NULL,
    'c2a00000-0000-4000-8000-000000000201', 'confirmed', 215,
    'cs_test_r1_guest', 'commerce_order', 'c2a00000-0000-4000-8000-000000000211',
    '{"source":"commerce_r1_test"}', v_hold_id
  ) WHERE ok;
  IF v_registration_id IS NULL THEN RAISE EXCEPTION 'guest registration was not committed'; END IF;
  UPDATE public.commerce_order_lines SET session_registration_id = v_registration_id
  WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000210';
  INSERT INTO public.access_entitlements (
    venue_id, user_id, customer_id, entitlement_type, status, source_type, source_id,
    activity_session_id, session_date, includes_session_types, metadata
  ) VALUES (
    'c2a00000-0000-4000-8000-000000000002', NULL,
    'c2a00000-0000-4000-8000-000000000201', 'session_ticket', 'active',
    'session_ticket', v_registration_id, 'c2a00000-0000-4000-8000-000000000020',
    '2026-08-01', ARRAY['open_play'], '{"source":"commerce_r1_test"}'
  );
  UPDATE public.commerce_orders SET claim_expires_at = now() + interval '30 days'
  WHERE id = 'c2a00000-0000-4000-8000-000000000210';

  PERFORM * FROM public.commit_activity_registration_capacity(
    'c2a00000-0000-4000-8000-000000000002',
    'c2a00000-0000-4000-8000-000000000020', '2026-08-01', NULL,
    'c2a00000-0000-4000-8000-000000000201', 'confirmed', 215,
    'cs_test_r1_guest', 'commerce_order', 'c2a00000-0000-4000-8000-000000000211',
    '{}', v_hold_id
  );
END $$;

SELECT * FROM public.confirm_commerce_guest_identity(
  'c2a00000-0000-4000-8000-000000000210',
  'c2a00000-0000-4000-8000-000000000201', 'Ada Guest'
);
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'c2a00000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
  'r1-one@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
SELECT * FROM public.claim_commerce_activity_order(
  'c2a00000-0000-4000-8000-000000000210',
  'c2a00000-0000-4000-8000-000000000201',
  'c2a00000-0000-4000-8000-000000000011'
);

DO $$
DECLARE
  v_registration_id UUID;
BEGIN
  SELECT session_registration_id INTO v_registration_id
  FROM public.commerce_order_lines
  WHERE id = 'c2a00000-0000-4000-8000-000000000211';
  IF (SELECT count(*) FROM public.session_registrations WHERE source_type = 'commerce_order' AND source_id = 'c2a00000-0000-4000-8000-000000000211') <> 1 THEN
    RAISE EXCEPTION 'duplicate participant was created';
  END IF;
  IF (SELECT customer_id FROM public.session_registrations WHERE id = v_registration_id) <> 'c2a00000-0000-4000-8000-000000000201' THEN
    RAISE EXCEPTION 'registration lost canonical customer';
  END IF;
  IF (SELECT user_id FROM public.session_registrations WHERE id = v_registration_id) <> 'c2a00000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'registration was not linked to account';
  END IF;
  IF (SELECT claimed_user_id FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000210') <> 'c2a00000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'order was not linked to account';
  END IF;
  IF (SELECT user_id FROM public.access_entitlements WHERE source_id = v_registration_id) <> 'c2a00000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'ticket was not linked to account';
  END IF;
  IF (SELECT status FROM public.capacity_holds WHERE source_id = 'c2a00000-0000-4000-8000-000000000210') <> 'committed' THEN
    RAISE EXCEPTION 'capacity hold was not committed';
  END IF;
  IF (SELECT total_inc_vat_minor FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000210') <> 21500 THEN
    RAISE EXCEPTION 'server-frozen total drifted';
  END IF;
  IF (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000210') <> 1 THEN
    RAISE EXCEPTION 'receipt idempotency failed';
  END IF;
  IF has_function_privilege('anon', 'public.confirm_commerce_guest_identity(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guest identity RPC is exposed directly';
  END IF;
  BEGIN
    PERFORM * FROM public.claim_commerce_activity_order(
      'c2a00000-0000-4000-8000-000000000210',
      'c2a00000-0000-4000-8000-000000000201',
      'c2a00000-0000-4000-8000-000000000012'
    );
    RAISE EXCEPTION 'second account claimed the order';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%commerce_order_already_claimed%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO public.customers (
  id, organization_id, display_name, primary_email, email_normalized, status
) VALUES (
  'c2a00000-0000-4000-8000-000000000301',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'Expired Guest', 'expired@example.test', 'expired@example.test', 'active'
);
INSERT INTO public.commerce_orders (
  id, organization_id, venue_id, customer_id, status, guest_token_hash,
  guest_name, guest_email, paid_at, claim_expires_at
) VALUES (
  'c2a00000-0000-4000-8000-000000000310',
  (SELECT id FROM public.organizations WHERE slug = 'pickla'),
  'c2a00000-0000-4000-8000-000000000002',
  'c2a00000-0000-4000-8000-000000000301', 'paid', repeat('e', 64),
  'Expired Guest', 'expired@example.test', now() - interval '31 days', now() - interval '1 second'
);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.confirm_commerce_guest_identity(
      'c2a00000-0000-4000-8000-000000000310',
      'c2a00000-0000-4000-8000-000000000301', 'Too Late'
    );
    RAISE EXCEPTION 'expired claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%commerce_claim_expired%' THEN RAISE; END IF;
  END;
END $$;

SELECT
  (SELECT count(*) FROM public.commerce_orders WHERE id = 'c2a00000-0000-4000-8000-000000000210') AS orders,
  (SELECT count(*) FROM public.session_registrations WHERE source_id = 'c2a00000-0000-4000-8000-000000000211') AS participants,
  (SELECT count(*) FROM public.booking_receipts WHERE commerce_order_id = 'c2a00000-0000-4000-8000-000000000210') AS receipts;

ROLLBACK;
