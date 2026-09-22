\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

-- Keep the destructive fixture explicitly local and rerunnable after an
-- interrupted assertion.
DROP FUNCTION IF EXISTS public.activity_cancellation_test_cancel(TEXT, TEXT, UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.activity_cancellation_test_replacement(TEXT, TEXT, DATE, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.activity_cancellation_test_fixture(UUID, UUID, UUID, UUID, UUID, UUID, UUID, DATE, INTEGER, TEXT);
DROP TABLE IF EXISTS public.activity_cancellation_concurrency_results;
DELETE FROM public.venue_checkins WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.access_entitlements WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_participant_invitations WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
UPDATE public.commerce_orders SET status = 'draft'
WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.commerce_order_lines WHERE commerce_order_id IN (
  SELECT id FROM public.commerce_orders WHERE venue_id = 'ca110000-0000-4000-8000-000000000002'
);
UPDATE public.booking_receipts SET commerce_order_id = NULL WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
UPDATE public.commerce_orders SET booking_receipt_id = NULL WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.commerce_orders WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.booking_receipts WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.session_registrations WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.capacity_holds WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.venue_staff WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_session_overrides WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_sessions WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';

INSERT INTO public.organizations (id, name, slug)
VALUES ('ca110000-0000-4000-8000-000000000001', 'Cancellation Truth Test', 'cancellation-truth-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'ca110000-0000-4000-8000-000000000002',
  'ca110000-0000-4000-8000-000000000001',
  'Cancellation Truth Test', 'cancellation-truth-test', true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, recurrence_days, start_time, end_time,
  price_sek, capacity, product_key, publish_status
) VALUES (
  'ca110000-0000-4000-8000-000000000010',
  'ca110000-0000-4000-8000-000000000002',
  'Singel Träning Hög nivå - Högt tempo', 'training', ARRAY[2], '18:00', '20:00',
  165, 8, 'cancellation_truth', 'published'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('ca110000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'cancel-1@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'cancel-2@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'cancel-3@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'cancel-4@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'cancel-5@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000106', 'authenticated', 'authenticated', 'cancel-6@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000110', 'authenticated', 'authenticated', 'cancel-10@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000111', 'authenticated', 'authenticated', 'cancel-11@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000112', 'authenticated', 'authenticated', 'cancel-12@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000113', 'authenticated', 'authenticated', 'cancel-13@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000114', 'authenticated', 'authenticated', 'cancel-14@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000115', 'authenticated', 'authenticated', 'cancel-15@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000116', 'authenticated', 'authenticated', 'cancel-16@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('ca110000-0000-4000-8000-000000000190', 'authenticated', 'authenticated', 'cancel-staff@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Local auth bootstrap creates one default-organization customer per new auth
-- user. Remove only those unreferenced bootstrap rows on the first run; keep
-- the deterministic fixture customers and immutable snapshot references on
-- every rerun.
DELETE FROM public.customers customer
WHERE customer.auth_user_id::TEXT LIKE 'ca110000-0000-4000-8000-0000000001%'
  AND customer.id NOT IN (
    'ca110000-0000-4000-8000-000000000201',
    'ca110000-0000-4000-8000-000000000202',
    'ca110000-0000-4000-8000-000000000203',
    'ca110000-0000-4000-8000-000000000204',
    'ca110000-0000-4000-8000-000000000205',
    'ca110000-0000-4000-8000-000000000206',
    'ca110000-0000-4000-8000-000000000210',
    'ca110000-0000-4000-8000-000000000211',
    'ca110000-0000-4000-8000-000000000212',
    'ca110000-0000-4000-8000-000000000213',
    'ca110000-0000-4000-8000-000000000214',
    'ca110000-0000-4000-8000-000000000215',
    'ca110000-0000-4000-8000-000000000216'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cancellation_policy_snapshots snapshot
    WHERE snapshot.payer_customer_id = customer.id
  );

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('ca110000-0000-4000-8000-000000000190', 'ca110000-0000-4000-8000-000000000002', 'venue_admin', true);

INSERT INTO public.customers (id, organization_id, auth_user_id, display_name, primary_email, email_normalized)
VALUES
  ('ca110000-0000-4000-8000-000000000201', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000101', 'Cancel One', 'cancel-1@example.test', 'cancel-1@example.test'),
  ('ca110000-0000-4000-8000-000000000202', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000102', 'Cancel Two', 'cancel-2@example.test', 'cancel-2@example.test'),
  ('ca110000-0000-4000-8000-000000000203', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000103', 'Cancel Three', 'cancel-3@example.test', 'cancel-3@example.test'),
  ('ca110000-0000-4000-8000-000000000204', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000104', 'Cancel Four', 'cancel-4@example.test', 'cancel-4@example.test'),
  ('ca110000-0000-4000-8000-000000000205', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000105', 'Cancel Five', 'cancel-5@example.test', 'cancel-5@example.test'),
  ('ca110000-0000-4000-8000-000000000206', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000106', 'Cancel Six', 'cancel-6@example.test', 'cancel-6@example.test'),
  ('ca110000-0000-4000-8000-000000000210', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000110', 'Capacity Host', 'cancel-10@example.test', 'cancel-10@example.test'),
  ('ca110000-0000-4000-8000-000000000211', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000111', 'Capacity Player 1', 'cancel-11@example.test', 'cancel-11@example.test'),
  ('ca110000-0000-4000-8000-000000000212', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000112', 'Capacity Player 2', 'cancel-12@example.test', 'cancel-12@example.test'),
  ('ca110000-0000-4000-8000-000000000213', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000113', 'Capacity Player 3', 'cancel-13@example.test', 'cancel-13@example.test'),
  ('ca110000-0000-4000-8000-000000000214', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000114', 'Capacity Player 4', 'cancel-14@example.test', 'cancel-14@example.test'),
  ('ca110000-0000-4000-8000-000000000215', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000115', 'Capacity Player 5', 'cancel-15@example.test', 'cancel-15@example.test'),
  ('ca110000-0000-4000-8000-000000000216', 'ca110000-0000-4000-8000-000000000001', 'ca110000-0000-4000-8000-000000000116', 'Capacity Player 6', 'cancel-16@example.test', 'cancel-16@example.test')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.activity_cancellation_test_fixture(
  p_registration_id UUID,
  p_order_id UUID,
  p_line_id UUID,
  p_hold_id UUID,
  p_receipt_id UUID,
  p_user_id UUID,
  p_customer_id UUID,
  p_session_date DATE,
  p_amount_minor INTEGER,
  p_registration_status TEXT DEFAULT 'confirmed'
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vat_minor INTEGER := round(p_amount_minor * 6.0 / 106.0);
  v_snapshot public.cancellation_policy_snapshots%ROWTYPE;
BEGIN
  INSERT INTO public.booking_receipts (
    id, receipt_number, venue_id, user_id, customer_id, customer_name,
    total_inc_vat, total_ex_vat, vat_amount, payment_provider,
    payment_status, purchase_type, total_inc_vat_sek, total_ex_vat_sek,
    vat_amount_sek
  ) VALUES (
    p_receipt_id, 'CANCEL-' || right(p_receipt_id::TEXT, 12),
    'ca110000-0000-4000-8000-000000000002', p_user_id, p_customer_id,
    'Cancellation fixture', p_amount_minor / 100, (p_amount_minor - v_vat_minor) / 100,
    v_vat_minor / 100, 'stripe', 'paid', 'activity', p_amount_minor / 100.0,
    (p_amount_minor - v_vat_minor) / 100.0, v_vat_minor / 100.0
  );

  INSERT INTO public.commerce_orders (
    id, organization_id, venue_id, customer_id, user_id, status,
    subtotal_minor, total_inc_vat_minor, total_ex_vat_minor, vat_amount_minor,
    stripe_session_id, stripe_payment_intent_id, booking_receipt_id,
    guest_token_hash, guest_name, guest_email, paid_at, metadata
  ) VALUES (
    p_order_id, 'ca110000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000002', p_customer_id, p_user_id, 'draft',
    p_amount_minor, p_amount_minor, p_amount_minor - v_vat_minor, v_vat_minor,
    'cs_test_' || right(p_order_id::TEXT, 12), 'pi_test_' || right(p_order_id::TEXT, 12),
    p_receipt_id, md5(p_order_id::TEXT) || md5(p_order_id::TEXT || ':2'),
    'Cancellation fixture', 'fixture@example.test', NULL, '{}'
  );
  UPDATE public.booking_receipts SET commerce_order_id = p_order_id WHERE id = p_receipt_id;

  INSERT INTO public.capacity_holds (
    id, venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, status, expires_at, committed_at,
    metadata
  ) VALUES (
    p_hold_id, 'ca110000-0000-4000-8000-000000000002', 'activity_session',
    'ca110000-0000-4000-8000-000000000010', p_session_date, p_user_id,
    p_customer_id, 'commerce_order', p_order_id, 'cancel-fixture-' || p_order_id,
    'committed', now() + interval '30 days', now(),
    jsonb_build_object('registration_id', p_registration_id)
  );

  SELECT * INTO v_snapshot FROM public.create_cancellation_policy_snapshot(
    'ca110000-0000-4000-8000-000000000002', 'occurrence_ticket',
    'activity_cancellation_capacity_test', p_line_id,
    ((p_session_date::TEXT || 'T18:00:00')::TIMESTAMP AT TIME ZONE 'Europe/Stockholm'),
    NULL, NULL, NULL, NULL, p_user_id, p_customer_id,
    jsonb_build_object('commerce_order_id',p_order_id,'commerce_order_line_id',p_line_id,
      'amount_minor',p_amount_minor,'currency','SEK'),
    jsonb_build_object('meter_type','unlimited')
  );

  INSERT INTO public.session_registrations (
    id, venue_id, activity_session_id, session_date, user_id, customer_id,
    status, price_paid_sek, stripe_session_id, source_type, source_id, metadata,
    cancellation_policy_snapshot_id
  ) VALUES (
    p_registration_id, 'ca110000-0000-4000-8000-000000000002',
    'ca110000-0000-4000-8000-000000000010', p_session_date, p_user_id,
    p_customer_id, p_registration_status, p_amount_minor / 100,
    'cs_test_' || right(p_order_id::TEXT, 12), 'commerce_order', p_line_id,
    CASE WHEN p_amount_minor = 0
      THEN '{"pricing_reason":"membership","access_reason":"Medlemskap"}'::JSONB
      ELSE '{"pricing_reason":"regular_price"}'::JSONB END,
    v_snapshot.id
  );

  INSERT INTO public.commerce_order_lines (
    id, commerce_order_id, product_key, product_name, commerce_kind, quantity,
    unit_price_minor, discount_minor, line_total_inc_vat_minor, vat_rate,
    vat_amount_minor, line_total_ex_vat_minor, source_type, source_id,
    fulfillment_type, fulfillment_status, activity_session_id, session_date,
    session_registration_id, beneficiary_customer_id, beneficiary_user_id,
    capacity_hold_id, resolver_snapshot, cancellation_policy_snapshot_id
  ) VALUES (
    p_line_id, p_order_id, 'cancellation_truth', 'Cancellation truth',
    'participation', 1, p_amount_minor, 0, p_amount_minor, 6,
    v_vat_minor, p_amount_minor - v_vat_minor, 'activity_session',
    'ca110000-0000-4000-8000-000000000010', 'participation', 'not_required',
    'ca110000-0000-4000-8000-000000000010', p_session_date,
    p_registration_id, p_customer_id, p_user_id, p_hold_id,
    CASE WHEN p_amount_minor = 0
      THEN '{"purchase_kind":"activity_ticket","pricing_reason":"membership"}'::JSONB
      ELSE '{"purchase_kind":"activity_ticket","pricing_reason":"regular_price"}'::JSONB END,
    v_snapshot.id
  );

  UPDATE public.commerce_orders
  SET status = 'paid', paid_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.access_entitlements (
    id, organization_id, venue_id, user_id, customer_id, entitlement_type,
    status, source_type, source_id, activity_session_id, session_date,
    model_version, metadata
  ) VALUES (
    gen_random_uuid(), 'ca110000-0000-4000-8000-000000000001',
    'ca110000-0000-4000-8000-000000000002', p_user_id, p_customer_id,
    'session_ticket', 'active', 'session_ticket', p_registration_id,
    'ca110000-0000-4000-8000-000000000010', p_session_date, 1,
    '{"source":"activity_cancellation_test"}'
  );
END;
$$;

-- Paid customer cancellation: participation releases immediately while the
-- order and receipt remain paid and the refund remains a separate fact.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000301', 'ca110000-0000-4000-8000-000000000401',
  'ca110000-0000-4000-8000-000000000501', 'ca110000-0000-4000-8000-000000000601',
  'ca110000-0000-4000-8000-000000000701', 'ca110000-0000-4000-8000-000000000101',
  'ca110000-0000-4000-8000-000000000201', '2031-01-07', 16500, 'confirmed'
);

SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000301', 'ca110000-0000-4000-8000-000000000401',
  'ca110000-0000-4000-8000-000000000101', 'customer',
  'customer_self_service_before_activity_start', 'paid-cancel-1',
  're_test_paid_cancel', now()
);

DO $$
BEGIN
  IF (SELECT status FROM public.session_registrations WHERE id = 'ca110000-0000-4000-8000-000000000301') <> 'cancelled'
    OR (SELECT status FROM public.capacity_holds WHERE id = 'ca110000-0000-4000-8000-000000000601') <> 'released'
    OR (SELECT status FROM public.access_entitlements WHERE source_id = 'ca110000-0000-4000-8000-000000000301') <> 'revoked'
    OR (SELECT status FROM public.commerce_orders WHERE id = 'ca110000-0000-4000-8000-000000000401') <> 'paid'
    OR (SELECT payment_status FROM public.booking_receipts WHERE id = 'ca110000-0000-4000-8000-000000000701') <> 'paid'
    OR public.capacity_committed_count('ca110000-0000-4000-8000-000000000002', 'activity_session', 'ca110000-0000-4000-8000-000000000010', '2031-01-07') <> 0
    OR public.capacity_active_holds_count('ca110000-0000-4000-8000-000000000002', 'activity_session', 'ca110000-0000-4000-8000-000000000010', '2031-01-07') <> 0 THEN
    RAISE EXCEPTION 'paid cancellation did not separate participation, capacity and financial truth';
  END IF;
END $$;

CREATE TEMP TABLE activity_cancellation_audit_baselines (
  entity_id TEXT PRIMARY KEY,
  audit_count INTEGER NOT NULL
);
INSERT INTO activity_cancellation_audit_baselines
SELECT 'ca110000-0000-4000-8000-000000000301', count(*)::INTEGER
FROM public.audit_log
WHERE entity_id = 'ca110000-0000-4000-8000-000000000301'
  AND action = 'activity_registration.participation_cancelled';

-- Repeating the exact command is idempotent and does not fabricate another
-- transition audit row.
SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000301', 'ca110000-0000-4000-8000-000000000401',
  'ca110000-0000-4000-8000-000000000101', 'customer',
  'customer_self_service_before_activity_start', 'paid-cancel-1',
  're_test_paid_cancel', now()
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_log
      WHERE entity_id = 'ca110000-0000-4000-8000-000000000301'
        AND action = 'activity_registration.participation_cancelled')
      <> (SELECT audit_count FROM activity_cancellation_audit_baselines
          WHERE entity_id = 'ca110000-0000-4000-8000-000000000301') THEN
    RAISE EXCEPTION 'repeated cancellation was not audit-idempotent';
  END IF;
END $$;

-- A zero-price/member-funded order has no refund dependency and can close its
-- financial shell immediately.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000302', 'ca110000-0000-4000-8000-000000000402',
  'ca110000-0000-4000-8000-000000000502', 'ca110000-0000-4000-8000-000000000602',
  'ca110000-0000-4000-8000-000000000702', 'ca110000-0000-4000-8000-000000000102',
  'ca110000-0000-4000-8000-000000000202', '2031-01-08', 0, 'confirmed'
);
SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000302', 'ca110000-0000-4000-8000-000000000402',
  'ca110000-0000-4000-8000-000000000102', 'customer',
  'customer_self_service_before_activity_start', 'free-cancel-1', NULL, now()
);

DO $$
BEGIN
  IF (SELECT status FROM public.commerce_orders WHERE id = 'ca110000-0000-4000-8000-000000000402') <> 'cancelled'
    OR (SELECT status FROM public.session_registrations WHERE id = 'ca110000-0000-4000-8000-000000000302') <> 'cancelled'
    OR (SELECT status FROM public.capacity_holds WHERE id = 'ca110000-0000-4000-8000-000000000602') <> 'released' THEN
    RAISE EXCEPTION 'free/member cancellation did not release atomically';
  END IF;
END $$;

-- Staff cancellation deliberately does not invent a refund. Existing check-in
-- history survives even though the participant no longer owns capacity.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000303', 'ca110000-0000-4000-8000-000000000403',
  'ca110000-0000-4000-8000-000000000503', 'ca110000-0000-4000-8000-000000000603',
  'ca110000-0000-4000-8000-000000000703', 'ca110000-0000-4000-8000-000000000103',
  'ca110000-0000-4000-8000-000000000203', '2031-01-09', 16500, 'checked_in'
);
INSERT INTO public.venue_checkins (
  id, venue_id, user_id, customer_id, player_name, entry_type,
  entitlement_id, checked_in_by, session_date
) VALUES (
  'ca110000-0000-4000-8000-000000000803', 'ca110000-0000-4000-8000-000000000002',
  'ca110000-0000-4000-8000-000000000103', 'ca110000-0000-4000-8000-000000000203',
  'Cancel Three', 'session_ticket', 'ca110000-0000-4000-8000-000000000303',
  'ca110000-0000-4000-8000-000000000190', '2031-01-09'
);
SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000303', 'ca110000-0000-4000-8000-000000000403',
  'ca110000-0000-4000-8000-000000000190', 'staff',
  'staff cancellation without refund', 'staff-cancel-1', NULL, now()
);

DO $$
BEGIN
  IF (SELECT status FROM public.commerce_orders WHERE id = 'ca110000-0000-4000-8000-000000000403') <> 'paid'
    OR (SELECT payment_status FROM public.booking_receipts WHERE id = 'ca110000-0000-4000-8000-000000000703') <> 'paid'
    OR NOT EXISTS (SELECT 1 FROM public.venue_checkins WHERE id = 'ca110000-0000-4000-8000-000000000803')
    OR (SELECT status FROM public.session_registrations WHERE id = 'ca110000-0000-4000-8000-000000000303') <> 'cancelled' THEN
    RAISE EXCEPTION 'staff cancellation corrupted financial or attendance history';
  END IF;
END $$;

-- Exact Henry-shaped missed-webhook regression: capacity eight, one playing
-- host, six ordinary participants and one regular-price 165 SEK participant.
-- Stripe has accepted the refund request (refund id exists), but no webhook is
-- present. Participation must still release immediately to 7/8 with one place
-- available while order and receipt truth remain paid.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000309', 'ca110000-0000-4000-8000-000000000409',
  'ca110000-0000-4000-8000-000000000509', 'ca110000-0000-4000-8000-000000000609',
  'ca110000-0000-4000-8000-000000000709', 'ca110000-0000-4000-8000-000000000103',
  'ca110000-0000-4000-8000-000000000203', '2031-01-14', 16500, 'confirmed'
);

INSERT INTO public.session_registrations (
  id, venue_id, activity_session_id, session_date, user_id, customer_id,
  status, price_paid_sek, source_type, source_id, role, metadata
)
SELECT
  fixture.registration_id,
  'ca110000-0000-4000-8000-000000000002'::UUID,
  'ca110000-0000-4000-8000-000000000010'::UUID,
  '2031-01-14'::DATE,
  fixture.user_id,
  fixture.customer_id,
  'confirmed',
  0,
  CASE WHEN fixture.role = 'host' THEN 'playing_host' ELSE 'test_capacity_fill' END,
  fixture.source_id,
  fixture.role,
  jsonb_build_object('pricing_reason', CASE WHEN fixture.role = 'host' THEN 'playing_host' ELSE 'test_fill' END)
FROM (VALUES
  ('ca110000-0000-4000-8000-000000000320'::UUID, 'ca110000-0000-4000-8000-000000000110'::UUID, 'ca110000-0000-4000-8000-000000000210'::UUID, 'ca110000-0000-4000-8000-000000000920'::UUID, 'host'),
  ('ca110000-0000-4000-8000-000000000321'::UUID, 'ca110000-0000-4000-8000-000000000111'::UUID, 'ca110000-0000-4000-8000-000000000211'::UUID, 'ca110000-0000-4000-8000-000000000921'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000322'::UUID, 'ca110000-0000-4000-8000-000000000112'::UUID, 'ca110000-0000-4000-8000-000000000212'::UUID, 'ca110000-0000-4000-8000-000000000922'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000323'::UUID, 'ca110000-0000-4000-8000-000000000113'::UUID, 'ca110000-0000-4000-8000-000000000213'::UUID, 'ca110000-0000-4000-8000-000000000923'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000324'::UUID, 'ca110000-0000-4000-8000-000000000114'::UUID, 'ca110000-0000-4000-8000-000000000214'::UUID, 'ca110000-0000-4000-8000-000000000924'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000325'::UUID, 'ca110000-0000-4000-8000-000000000115'::UUID, 'ca110000-0000-4000-8000-000000000215'::UUID, 'ca110000-0000-4000-8000-000000000925'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000326'::UUID, 'ca110000-0000-4000-8000-000000000116'::UUID, 'ca110000-0000-4000-8000-000000000216'::UUID, 'ca110000-0000-4000-8000-000000000926'::UUID, 'participant')
) AS fixture(registration_id, user_id, customer_id, source_id, role);

DO $$
DECLARE v_fill RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.capacity_fill(
    'ca110000-0000-4000-8000-000000000002', 'activity_session',
    'ca110000-0000-4000-8000-000000000010', '2031-01-14', 8
  );
  IF v_fill.committed_count <> 8 OR v_fill.active_holds_count <> 0
    OR v_fill.fill_count <> 8 OR v_fill.available_count <> 0
    OR (SELECT count(*) FROM public.session_registrations
        WHERE activity_session_id = 'ca110000-0000-4000-8000-000000000010'
          AND session_date = '2031-01-14' AND role = 'host'
          AND status IN ('confirmed', 'checked_in', 'no_show')) <> 1 THEN
    RAISE EXCEPTION 'exact Henry-shaped fixture did not begin 8/8: %', row_to_json(v_fill);
  END IF;
END $$;

CREATE TEMP TABLE henry_cancellation_result AS
SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000309', 'ca110000-0000-4000-8000-000000000409',
  'ca110000-0000-4000-8000-000000000103', 'customer',
  'customer_self_service_before_activity_start', 'henry-paid-cancel-1',
  're_test_henry_165', now()
);
TABLE henry_cancellation_result;

DO $$
DECLARE v_fill RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.capacity_fill(
    'ca110000-0000-4000-8000-000000000002', 'activity_session',
    'ca110000-0000-4000-8000-000000000010', '2031-01-14', 8
  );
  IF NOT EXISTS (
      SELECT 1 FROM henry_cancellation_result
      WHERE changed AND registration_status = 'cancelled'
        AND order_status = 'paid' AND financial_state = 'refund_requested'
        AND hold_status = 'released' AND available_count = 1
    )
    OR v_fill.committed_count <> 7 OR v_fill.active_holds_count <> 0
    OR v_fill.fill_count <> 7 OR v_fill.available_count <> 1
    OR (SELECT status FROM public.commerce_orders WHERE id = 'ca110000-0000-4000-8000-000000000409') <> 'paid'
    OR (SELECT payment_status FROM public.booking_receipts WHERE id = 'ca110000-0000-4000-8000-000000000709') <> 'paid'
    OR EXISTS (SELECT 1 FROM public.stripe_events WHERE payload::TEXT LIKE '%re_test_henry_165%') THEN
    RAISE EXCEPTION 'Henry-shaped cancellation did not release immediately without webhook: %', row_to_json(v_fill);
  END IF;
END $$;

-- Public visibility is not participation ownership. A customer who already
-- owns a paid place can still release it when the occurrence is hidden or
-- cancelled; the refund request remains a separate prerequisite/fact.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000307', 'ca110000-0000-4000-8000-000000000407',
  'ca110000-0000-4000-8000-000000000507', 'ca110000-0000-4000-8000-000000000607',
  'ca110000-0000-4000-8000-000000000707', 'ca110000-0000-4000-8000-000000000101',
  'ca110000-0000-4000-8000-000000000201', '2031-01-12', 16500, 'confirmed'
);
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000308', 'ca110000-0000-4000-8000-000000000408',
  'ca110000-0000-4000-8000-000000000508', 'ca110000-0000-4000-8000-000000000608',
  'ca110000-0000-4000-8000-000000000708', 'ca110000-0000-4000-8000-000000000102',
  'ca110000-0000-4000-8000-000000000202', '2031-01-13', 16500, 'confirmed'
);
INSERT INTO public.activity_session_overrides (
  id, venue_id, activity_session_id, session_date, status, reason
) VALUES
  ('ca110000-0000-4000-8000-000000000917', 'ca110000-0000-4000-8000-000000000002', 'ca110000-0000-4000-8000-000000000010', '2031-01-12', 'hidden', 'cancellation regression'),
  ('ca110000-0000-4000-8000-000000000918', 'ca110000-0000-4000-8000-000000000002', 'ca110000-0000-4000-8000-000000000010', '2031-01-13', 'cancelled', 'cancellation regression');

SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000307', 'ca110000-0000-4000-8000-000000000407',
  'ca110000-0000-4000-8000-000000000101', 'customer',
  'customer_self_service_before_activity_start', 'hidden-cancel-1',
  're_test_hidden_cancel', now()
);
SELECT * FROM public.cancel_activity_registration_participation(
  'ca110000-0000-4000-8000-000000000308', 'ca110000-0000-4000-8000-000000000408',
  'ca110000-0000-4000-8000-000000000102', 'customer',
  'customer_self_service_before_activity_start', 'cancelled-occurrence-cancel-1',
  're_test_cancelled_occurrence', now()
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.session_registrations
      WHERE id IN ('ca110000-0000-4000-8000-000000000307', 'ca110000-0000-4000-8000-000000000308')
        AND status = 'cancelled') <> 2
    OR (SELECT count(*) FROM public.capacity_holds
        WHERE id IN ('ca110000-0000-4000-8000-000000000607', 'ca110000-0000-4000-8000-000000000608')
          AND status = 'released') <> 2
    OR (SELECT count(*) FROM public.commerce_orders
        WHERE id IN ('ca110000-0000-4000-8000-000000000407', 'ca110000-0000-4000-8000-000000000408')
          AND status = 'paid') <> 2 THEN
    RAISE EXCEPTION 'hidden or cancelled occurrence prevented participation release';
  END IF;
END $$;

CREATE TABLE public.activity_cancellation_concurrency_results (
  case_name TEXT NOT NULL,
  contender TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  detail TEXT,
  PRIMARY KEY (case_name, contender)
);
INSERT INTO public.activity_cancellation_concurrency_results
VALUES ('__config__', 'run', true, gen_random_uuid()::TEXT);

CREATE OR REPLACE FUNCTION public.activity_cancellation_test_cancel(
  p_case TEXT, p_contender TEXT, p_registration_id UUID, p_order_id UUID,
  p_delay_after NUMERIC DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_preview JSONB;
BEGIN
  BEGIN
    v_preview := public.cancellation_subject_state(
      'activity_registration', p_registration_id, 'ca110000-0000-4000-8000-000000000190',
      true, now(), 'none', 'none'
    );
    PERFORM public.confirm_cancellation_policy_v1(
      'activity_registration', p_registration_id, 'ca110000-0000-4000-8000-000000000190',
      v_preview->>'state_revision', p_case || ':' || (
        SELECT detail FROM public.activity_cancellation_concurrency_results
        WHERE case_name='__config__' AND contender='run'
      ), true, 'concurrent staff cancellation',
      'test', 'platform', 'none', 'none'
    );
    PERFORM pg_sleep(p_delay_after);
    INSERT INTO public.activity_cancellation_concurrency_results
    VALUES (p_case, p_contender, true, null);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.activity_cancellation_concurrency_results
    VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.activity_cancellation_test_replacement(
  p_case TEXT, p_contender TEXT, p_session_date DATE,
  p_user_id UUID, p_customer_id UUID, p_source_id UUID
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_hold RECORD;
  v_registration RECORD;
BEGIN
  BEGIN
    SELECT * INTO v_hold FROM public.acquire_capacity_hold(
      'ca110000-0000-4000-8000-000000000002', 'activity_session',
      'ca110000-0000-4000-8000-000000000010', p_session_date, 1,
      p_user_id, p_customer_id, 'test_replacement', p_source_id,
      p_case || '-' || p_contender, '{}', 600
    );
    IF NOT v_hold.ok THEN RAISE EXCEPTION 'replacement_hold_failed:%', v_hold.reason; END IF;
    SELECT * INTO v_registration FROM public.commit_activity_registration_capacity(
      'ca110000-0000-4000-8000-000000000002',
      'ca110000-0000-4000-8000-000000000010', p_session_date,
      p_user_id, p_customer_id, 'confirmed', 0, NULL,
      'test_replacement', p_source_id, '{"source":"concurrency_test"}', v_hold.hold_id
    );
    IF NOT v_registration.ok THEN RAISE EXCEPTION 'replacement_commit_failed:%', v_registration.reason; END IF;
    INSERT INTO public.activity_cancellation_concurrency_results
    VALUES (p_case, p_contender, true, v_registration.registration_id::TEXT);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.activity_cancellation_concurrency_results
    VALUES (p_case, p_contender, false, SQLERRM);
  END;
END;
$$;

-- A replacement checkout starts while the final seat cancellation still holds
-- the occurrence lock. It must wait, then become the sole committed place.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000304', 'ca110000-0000-4000-8000-000000000404',
  'ca110000-0000-4000-8000-000000000504', 'ca110000-0000-4000-8000-000000000604',
  'ca110000-0000-4000-8000-000000000704', 'ca110000-0000-4000-8000-000000000104',
  'ca110000-0000-4000-8000-000000000204', '2031-01-10', 16500, 'confirmed'
);

-- Match the production shape: capacity eight, one playing host, six other
-- active players and the paid participant who is about to cancel.
INSERT INTO public.session_registrations (
  id, venue_id, activity_session_id, session_date, user_id, customer_id,
  status, price_paid_sek, source_type, source_id, role, metadata
)
SELECT
  fixture.registration_id,
  'ca110000-0000-4000-8000-000000000002'::UUID,
  'ca110000-0000-4000-8000-000000000010'::UUID,
  '2031-01-10'::DATE,
  fixture.user_id,
  fixture.customer_id,
  'confirmed',
  0,
  CASE WHEN fixture.role = 'host' THEN 'playing_host' ELSE 'test_capacity_fill' END,
  fixture.source_id,
  fixture.role,
  jsonb_build_object('pricing_reason', CASE WHEN fixture.role = 'host' THEN 'playing_host' ELSE 'test_fill' END)
FROM (VALUES
  ('ca110000-0000-4000-8000-000000000310'::UUID, 'ca110000-0000-4000-8000-000000000110'::UUID, 'ca110000-0000-4000-8000-000000000210'::UUID, 'ca110000-0000-4000-8000-000000000910'::UUID, 'host'),
  ('ca110000-0000-4000-8000-000000000311'::UUID, 'ca110000-0000-4000-8000-000000000111'::UUID, 'ca110000-0000-4000-8000-000000000211'::UUID, 'ca110000-0000-4000-8000-000000000911'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000312'::UUID, 'ca110000-0000-4000-8000-000000000112'::UUID, 'ca110000-0000-4000-8000-000000000212'::UUID, 'ca110000-0000-4000-8000-000000000912'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000313'::UUID, 'ca110000-0000-4000-8000-000000000113'::UUID, 'ca110000-0000-4000-8000-000000000213'::UUID, 'ca110000-0000-4000-8000-000000000913'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000314'::UUID, 'ca110000-0000-4000-8000-000000000114'::UUID, 'ca110000-0000-4000-8000-000000000214'::UUID, 'ca110000-0000-4000-8000-000000000914'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000315'::UUID, 'ca110000-0000-4000-8000-000000000115'::UUID, 'ca110000-0000-4000-8000-000000000215'::UUID, 'ca110000-0000-4000-8000-000000000915'::UUID, 'participant'),
  ('ca110000-0000-4000-8000-000000000316'::UUID, 'ca110000-0000-4000-8000-000000000116'::UUID, 'ca110000-0000-4000-8000-000000000216'::UUID, 'ca110000-0000-4000-8000-000000000916'::UUID, 'participant')
) AS fixture(registration_id, user_id, customer_id, source_id, role);

DO $$
DECLARE v_fill RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.capacity_fill(
    'ca110000-0000-4000-8000-000000000002', 'activity_session',
    'ca110000-0000-4000-8000-000000000010', '2031-01-10', 8
  );
  IF v_fill.committed_count <> 8 OR v_fill.active_holds_count <> 0
    OR v_fill.fill_count <> 8 OR v_fill.available_count <> 0
    OR (SELECT count(*) FROM public.session_registrations
        WHERE activity_session_id = 'ca110000-0000-4000-8000-000000000010'
          AND session_date = '2031-01-10' AND role = 'host'
          AND status IN ('confirmed', 'checked_in', 'no_show')) <> 1 THEN
    RAISE EXCEPTION 'Henry-shaped fixture did not begin full with exactly one playing host: %', row_to_json(v_fill);
  END IF;
END $$;

SELECT dblink_connect('cancel_checkout_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('cancel_checkout_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('cancel_checkout_1', $$SELECT public.activity_cancellation_test_cancel('cancel-v-checkout','cancel','ca110000-0000-4000-8000-000000000304','ca110000-0000-4000-8000-000000000404',0.5)$$);
SELECT pg_sleep(0.15);
SELECT dblink_send_query('cancel_checkout_2', $$SELECT public.activity_cancellation_test_replacement('cancel-v-checkout','replacement','2031-01-10','ca110000-0000-4000-8000-000000000105','ca110000-0000-4000-8000-000000000205','ca110000-0000-4000-8000-000000000905')$$);
SELECT * FROM dblink_get_result('cancel_checkout_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('cancel_checkout_2') AS result(done TEXT);
SELECT dblink_disconnect('cancel_checkout_1');
SELECT dblink_disconnect('cancel_checkout_2');

DO $$
DECLARE v_fill RECORD;
BEGIN
  SELECT * INTO v_fill FROM public.capacity_fill(
    'ca110000-0000-4000-8000-000000000002', 'activity_session',
    'ca110000-0000-4000-8000-000000000010', '2031-01-10', 8
  );
  IF (SELECT count(*) FROM public.activity_cancellation_concurrency_results WHERE case_name = 'cancel-v-checkout' AND ok) <> 2
    OR (SELECT status FROM public.session_registrations WHERE id = 'ca110000-0000-4000-8000-000000000304') <> 'cancelled'
    OR v_fill.committed_count <> 8 OR v_fill.active_holds_count <> 0
    OR v_fill.fill_count <> 8 OR v_fill.available_count <> 0
    OR (SELECT count(*) FROM public.session_registrations
        WHERE activity_session_id = 'ca110000-0000-4000-8000-000000000010'
          AND session_date = '2031-01-10'
          AND source_type = 'test_replacement'
          AND status IN ('confirmed', 'checked_in', 'no_show')) <> 1 THEN
    RAISE EXCEPTION 'cancel-versus-checkout serialization failed: %, %',
      row_to_json(v_fill),
      (SELECT jsonb_agg(to_jsonb(result)) FROM public.activity_cancellation_concurrency_results result WHERE case_name = 'cancel-v-checkout');
  END IF;
END $$;

-- Two simultaneous retries may both return success, but only one transition
-- and one audit event are allowed.
SELECT public.activity_cancellation_test_fixture(
  'ca110000-0000-4000-8000-000000000305', 'ca110000-0000-4000-8000-000000000405',
  'ca110000-0000-4000-8000-000000000505', 'ca110000-0000-4000-8000-000000000605',
  'ca110000-0000-4000-8000-000000000705', 'ca110000-0000-4000-8000-000000000106',
  'ca110000-0000-4000-8000-000000000206', '2031-01-11', 16500, 'confirmed'
);
INSERT INTO activity_cancellation_audit_baselines
SELECT 'ca110000-0000-4000-8000-000000000305', count(*)::INTEGER
FROM public.audit_log
WHERE entity_id = 'ca110000-0000-4000-8000-000000000305'
  AND action = 'activity_registration.participation_cancelled';

SELECT dblink_connect('cancel_retry_1', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_connect('cancel_retry_2', 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres');
SELECT dblink_send_query('cancel_retry_1', $$SELECT public.activity_cancellation_test_cancel('cancel-retry','a','ca110000-0000-4000-8000-000000000305','ca110000-0000-4000-8000-000000000405',0.3)$$);
SELECT pg_sleep(0.1);
SELECT dblink_send_query('cancel_retry_2', $$SELECT public.activity_cancellation_test_cancel('cancel-retry','b','ca110000-0000-4000-8000-000000000305','ca110000-0000-4000-8000-000000000405',0)$$);
SELECT * FROM dblink_get_result('cancel_retry_1') AS result(done TEXT);
SELECT * FROM dblink_get_result('cancel_retry_2') AS result(done TEXT);
SELECT dblink_disconnect('cancel_retry_1');
SELECT dblink_disconnect('cancel_retry_2');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.activity_cancellation_concurrency_results WHERE case_name = 'cancel-retry' AND ok) <> 2
    OR (SELECT count(*) FROM public.audit_log
        WHERE entity_id = 'ca110000-0000-4000-8000-000000000305'
          AND action = 'activity_registration.participation_cancelled')
      <> (SELECT audit_count + 1 FROM activity_cancellation_audit_baselines
          WHERE entity_id = 'ca110000-0000-4000-8000-000000000305')
    OR public.capacity_committed_count(
      'ca110000-0000-4000-8000-000000000002', 'activity_session',
      'ca110000-0000-4000-8000-000000000010', '2031-01-11'
    ) <> 0 THEN
    RAISE EXCEPTION 'concurrent cancellation retry was not idempotent';
  END IF;
END $$;

DROP FUNCTION public.activity_cancellation_test_cancel(TEXT, TEXT, UUID, UUID, NUMERIC);
DROP FUNCTION public.activity_cancellation_test_replacement(TEXT, TEXT, DATE, UUID, UUID, UUID);
DROP FUNCTION public.activity_cancellation_test_fixture(UUID, UUID, UUID, UUID, UUID, UUID, UUID, DATE, INTEGER, TEXT);
DROP TABLE public.activity_cancellation_concurrency_results;

DELETE FROM public.venue_checkins WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.access_entitlements WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_participant_invitations WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
UPDATE public.commerce_orders SET status = 'draft'
WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.commerce_order_lines WHERE commerce_order_id IN (
  SELECT id FROM public.commerce_orders WHERE venue_id = 'ca110000-0000-4000-8000-000000000002'
);
UPDATE public.booking_receipts SET commerce_order_id = NULL WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
UPDATE public.commerce_orders SET booking_receipt_id = NULL WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.commerce_orders WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.booking_receipts WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.session_registrations WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.capacity_holds WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.venue_staff WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_session_overrides WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';
DELETE FROM public.activity_sessions WHERE venue_id = 'ca110000-0000-4000-8000-000000000002';

SELECT 'activity cancellation capacity truth tests passed' AS result;
