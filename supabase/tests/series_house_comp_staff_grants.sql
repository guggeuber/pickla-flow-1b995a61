\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('a2200000-0000-4000-8000-000000000001', 'Series Grant Test', 'series-grant-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES (
  'a2200000-0000-4000-8000-000000000002',
  'a2200000-0000-4000-8000-000000000001',
  'Series Grant Venue', 'series-grant-venue', true
);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'a2200000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'series-grant-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES (
  'a2200000-0000-4000-8000-000000000003',
  'a2200000-0000-4000-8000-000000000002',
  'venue_admin', true
);

INSERT INTO public.customers (
  id, organization_id, display_name, primary_email, email_normalized
) VALUES
  ('a2200000-0000-4000-8000-000000000011', 'a2200000-0000-4000-8000-000000000001', 'Anna Event', 'anna@example.test', 'anna@example.test'),
  ('a2200000-0000-4000-8000-000000000012', 'a2200000-0000-4000-8000-000000000001', 'Bertil Kurs', 'bertil@example.test', 'bertil@example.test'),
  ('a2200000-0000-4000-8000-000000000013', 'a2200000-0000-4000-8000-000000000001', 'Cecilia Konkurrens', 'cecilia@example.test', 'cecilia@example.test'),
  ('a2200000-0000-4000-8000-000000000014', 'a2200000-0000-4000-8000-000000000001', 'David Konkurrens', 'david@example.test', 'david@example.test'),
  ('a2200000-0000-4000-8000-000000000015', 'a2200000-0000-4000-8000-000000000001', 'Guardian', 'guardian@example.test', 'guardian@example.test');

INSERT INTO public.dependent_participants (
  id, organization_id, guardian_customer_id, first_name, birth_year
) VALUES (
  'a2200000-0000-4000-8000-000000000016',
  'a2200000-0000-4000-8000-000000000001',
  'a2200000-0000-4000-8000-000000000015',
  'Elsa', 2016
);

INSERT INTO public.activity_formats (
  id, organization_id, name, description, age_group, level,
  requires_instructor, presentation_type
) VALUES
  ('a2200000-0000-4000-8000-000000000021', 'a2200000-0000-4000-8000-000000000001', 'Parker Test', 'One-off', 'adult', 'intro', false, 'social_event'),
  ('a2200000-0000-4000-8000-000000000022', 'a2200000-0000-4000-8000-000000000001', 'Pickla 101 Test', 'Four occurrences', 'adult', 'beginner', true, 'course'),
  ('a2200000-0000-4000-8000-000000000023', 'a2200000-0000-4000-8000-000000000001', 'Final Seat Test', 'Concurrency', 'adult', 'intro', false, 'clinic'),
  ('a2200000-0000-4000-8000-000000000024', 'a2200000-0000-4000-8000-000000000001', 'Dependent Test', 'Privacy', 'youth', 'intro', false, 'tournament');

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek,
  commerce_kind, fulfillment_type, fulfillment_presentation,
  commerce_enabled, status
) VALUES
  ('a2200000-0000-4000-8000-000000000031', 'a2200000-0000-4000-8000-000000000002', 'staff_grant_event', 'Parker Test', 'series_access', 199, 'participation', 'participation', 'participation', true, 'active'),
  ('a2200000-0000-4000-8000-000000000032', 'a2200000-0000-4000-8000-000000000002', 'staff_grant_course', 'Pickla 101 Test', 'series_access', 1495, 'participation', 'participation', 'participation', true, 'active'),
  ('a2200000-0000-4000-8000-000000000033', 'a2200000-0000-4000-8000-000000000002', 'staff_grant_final', 'Final Seat Test', 'series_access', 399, 'participation', 'participation', 'participation', true, 'active'),
  ('a2200000-0000-4000-8000-000000000034', 'a2200000-0000-4000-8000-000000000002', 'staff_grant_dependent', 'Dependent Test', 'series_access', 795, 'participation', 'participation', 'participation', true, 'active');

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id,
  product_key, start_date, end_date, total_sessions, capacity,
  recurrence_days, start_time, end_time, court_ids
) VALUES
  ('a2200000-0000-4000-8000-000000000041', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000021', 'Parker Test Run', 'course', 'active', 'a2200000-0000-4000-8000-000000000031', 'staff_grant_event', '2027-09-05', '2027-09-05', 1, 40, ARRAY[0], '13:00', '18:00', '{}'::UUID[]),
  ('a2200000-0000-4000-8000-000000000042', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000022', 'Pickla 101 Test Run', 'course', 'active', 'a2200000-0000-4000-8000-000000000032', 'staff_grant_course', '2027-09-07', '2027-09-28', 4, 8, ARRAY[2], '18:00', '19:00', '{}'::UUID[]),
  ('a2200000-0000-4000-8000-000000000043', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000023', 'Final Seat Test Run', 'course', 'active', 'a2200000-0000-4000-8000-000000000033', 'staff_grant_final', '2027-10-01', '2027-10-01', 1, 1, ARRAY[5], '18:00', '19:00', '{}'::UUID[]),
  ('a2200000-0000-4000-8000-000000000044', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000024', 'Dependent Test Run', 'course', 'active', 'a2200000-0000-4000-8000-000000000034', 'staff_grant_dependent', '2027-11-01', '2027-11-01', 1, 2, ARRAY[1], '16:00', '17:00', '{}'::UUID[]);

INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, sport_type, session_date,
  start_time, end_time, price_sek, capacity, court_ids, access_policy,
  is_active, publish_status, closed_to_public, series_occurrence_index
) VALUES
  ('a2200000-0000-4000-8000-000000000051', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000041', 'Parker Test Run', 'course', 'pickleball', '2027-09-05', '13:00', '18:00', 0, 40, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 1),
  ('a2200000-0000-4000-8000-000000000052', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000042', 'Pickla 101 Test Run', 'course', 'pickleball', '2027-09-07', '18:00', '19:00', 0, 8, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 1),
  ('a2200000-0000-4000-8000-000000000053', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000042', 'Pickla 101 Test Run', 'course', 'pickleball', '2027-09-14', '18:00', '19:00', 0, 8, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 2),
  ('a2200000-0000-4000-8000-000000000054', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000042', 'Pickla 101 Test Run', 'course', 'pickleball', '2027-09-21', '18:00', '19:00', 0, 8, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 3),
  ('a2200000-0000-4000-8000-000000000055', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000042', 'Pickla 101 Test Run', 'course', 'pickleball', '2027-09-28', '18:00', '19:00', 0, 8, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 4),
  ('a2200000-0000-4000-8000-000000000056', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000043', 'Final Seat Test Run', 'course', 'pickleball', '2027-10-01', '18:00', '19:00', 0, 1, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 1),
  ('a2200000-0000-4000-8000-000000000057', 'a2200000-0000-4000-8000-000000000002', 'a2200000-0000-4000-8000-000000000044', 'Dependent Test Run', 'course', 'pickleball', '2027-11-01', '16:00', '17:00', 0, 2, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 1);

DO $$
DECLARE
  v_orders INTEGER := (SELECT COUNT(*) FROM public.commerce_orders);
  v_receipts INTEGER := (SELECT COUNT(*) FROM public.booking_receipts);
  v_ledger INTEGER := (SELECT COUNT(*) FROM public.ledger_entries);
  v_event RECORD;
  v_event_retry RECORD;
  v_duplicate RECORD;
  v_course RECORD;
  v_cancel RECORD;
  v_cancel_retry RECORD;
  v_hold RECORD;
  v_blocked RECORD;
  v_first RECORD;
  v_second RECORD;
  v_dependent RECORD;
BEGIN
  SELECT * INTO v_event FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000041',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000011', NULL,
    'Invigningens värdplats', 'grant-event-one'
  );
  IF NOT v_event.ok OR v_event.available_count <> 39 THEN
    RAISE EXCEPTION 'one-off Series grant did not consume exactly one place';
  END IF;
  IF (SELECT COUNT(*) FROM public.series_commitments WHERE id = v_event.commitment_id AND payer_customer_id IS NULL AND commerce_order_id IS NULL AND commerce_order_line_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'staff grant fabricated payer or Commerce provenance';
  END IF;
  IF (SELECT COUNT(*) FROM public.access_entitlements WHERE id = v_event.entitlement_id
      AND entitlement_type = 'series_access' AND scope_type = 'activity_series'
      AND meter_type = 'unlimited' AND funding_type = 'house_granted'
      AND funder = 'house_comped' AND occurrence_origin = 'house_comped'
      AND source_type = 'series_staff_grant' AND requires_consumption = false) <> 1 THEN
    RAISE EXCEPTION 'house-comp entitlement provenance is not canonical';
  END IF;
  IF (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_event.commitment_id AND status = 'confirmed') <> 1 THEN
    RAISE EXCEPTION 'one-off Series expected registration missing';
  END IF;
  IF (SELECT COUNT(*) FROM public.audit_log WHERE action = 'series.staff_grant.created' AND request_id = 'grant-event-one' AND actor_user_id = 'a2200000-0000-4000-8000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'grant audit provenance missing';
  END IF;

  SELECT * INTO v_event_retry FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000041',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000011', NULL,
    'Invigningens värdplats', 'grant-event-one'
  );
  IF NOT v_event_retry.ok OR v_event_retry.commitment_id <> v_event.commitment_id OR v_event_retry.reason <> 'existing_grant' THEN
    RAISE EXCEPTION 'grant retry was not idempotent';
  END IF;

  SELECT * INTO v_duplicate FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000041',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000011', NULL,
    'Dubblett', 'grant-event-duplicate'
  );
  IF v_duplicate.ok OR v_duplicate.reason <> 'duplicate_active_place' THEN
    RAISE EXCEPTION 'duplicate active Series place was not rejected: ok=%, reason=%', v_duplicate.ok, v_duplicate.reason;
  END IF;

  UPDATE public.session_registrations SET status = 'checked_in'
  WHERE series_commitment_id = v_event.commitment_id;
  SELECT * INTO v_cancel FROM public.cancel_series_staff_place(
    'a2200000-0000-4000-8000-000000000002', v_event.commitment_id,
    'a2200000-0000-4000-8000-000000000003',
    'Deltagaren fick förhinder', 'cancel-event-one'
  );
  IF NOT v_cancel.ok OR v_cancel.available_count <> 40 THEN
    RAISE EXCEPTION 'one-off cancellation did not restore capacity';
  END IF;
  IF (SELECT status FROM public.access_entitlements WHERE id = v_event.entitlement_id) <> 'revoked' THEN
    RAISE EXCEPTION 'cancelled grant entitlement was not revoked';
  END IF;
  IF (SELECT status FROM public.session_registrations WHERE series_commitment_id = v_event.commitment_id) <> 'checked_in' THEN
    RAISE EXCEPTION 'historical attendance was destroyed by cancellation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.series_commitments
    WHERE id = v_event.commitment_id
      AND metadata->>'grant_reason' = 'Invigningens värdplats'
      AND metadata->>'cancel_reason' = 'Deltagaren fick förhinder'
  ) THEN
    RAISE EXCEPTION 'cancellation replaced original grant metadata';
  END IF;
  SELECT * INTO v_cancel_retry FROM public.cancel_series_staff_place(
    'a2200000-0000-4000-8000-000000000002', v_event.commitment_id,
    'a2200000-0000-4000-8000-000000000003',
    'Deltagaren fick förhinder', 'cancel-event-one'
  );
  IF NOT v_cancel_retry.ok OR v_cancel_retry.commitment_id <> v_event.commitment_id
     OR v_cancel_retry.reason <> 'existing_cancellation'
     OR (SELECT COUNT(*) FROM public.audit_log WHERE action = 'series.staff_grant.cancelled' AND request_id = 'cancel-event-one') <> 1 THEN
    RAISE EXCEPTION 'cancellation retry was not idempotent';
  END IF;

  SELECT * INTO v_course FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000042',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000012', NULL,
    'Lokal community-insats', 'grant-course-one'
  );
  IF NOT v_course.ok OR v_course.available_count <> 7 THEN
    RAISE EXCEPTION 'multi-occurrence grant did not consume one Series place';
  END IF;
  IF (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_course.commitment_id AND status = 'confirmed') <> 4 THEN
    RAISE EXCEPTION 'multi-occurrence grant did not project four expected registrations';
  END IF;
  UPDATE public.session_registrations SET status = 'checked_in'
  WHERE series_commitment_id = v_course.commitment_id
    AND activity_session_id = 'a2200000-0000-4000-8000-000000000052';
  UPDATE public.session_registrations SET status = 'no_show'
  WHERE series_commitment_id = v_course.commitment_id
    AND activity_session_id = 'a2200000-0000-4000-8000-000000000053';
  PERFORM * FROM public.cancel_series_staff_place(
    'a2200000-0000-4000-8000-000000000002', v_course.commitment_id,
    'a2200000-0000-4000-8000-000000000003',
    'Operativ korrigering', 'cancel-course-one'
  );
  IF (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_course.commitment_id AND status = 'cancelled') <> 2
     OR (SELECT COUNT(*) FROM public.session_registrations WHERE series_commitment_id = v_course.commitment_id AND status IN ('checked_in', 'no_show')) <> 2 THEN
    RAISE EXCEPTION 'multi-occurrence cancellation did not preserve attendance and cancel only confirmed projections';
  END IF;

  SELECT * INTO v_hold FROM public.acquire_capacity_hold(
    'a2200000-0000-4000-8000-000000000002', 'activity_series',
    'a2200000-0000-4000-8000-000000000043', '2027-10-01', 1,
    NULL, 'a2200000-0000-4000-8000-000000000013',
    'commerce_order', NULL, 'final-seat-hold', '{}', 600
  );
  SELECT * INTO v_blocked FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000043',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000014', NULL,
    'Kapacitetstest', 'grant-blocked-by-hold'
  );
  IF NOT v_hold.ok OR v_blocked.ok OR v_blocked.reason <> 'capacity_full' THEN
    RAISE EXCEPTION 'active checkout hold and staff grant did not share Series capacity truth';
  END IF;
  UPDATE public.capacity_holds SET status = 'released', released_at = now()
  WHERE id = v_hold.hold_id;

  SELECT * INTO v_first FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000043',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000013', NULL,
    'Första finalplatsen', 'grant-final-first'
  );
  SELECT * INTO v_second FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000043',
    'a2200000-0000-4000-8000-000000000003',
    'a2200000-0000-4000-8000-000000000014', NULL,
    'Andra finalplatsen', 'grant-final-second'
  );
  IF NOT v_first.ok OR v_second.ok OR v_second.reason <> 'capacity_full'
     OR (SELECT COUNT(*) FROM public.series_commitments WHERE activity_series_id = 'a2200000-0000-4000-8000-000000000043' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'two staff grants oversold the final Series seat';
  END IF;

  SELECT * INTO v_dependent FROM public.grant_series_staff_place(
    'a2200000-0000-4000-8000-000000000002',
    'a2200000-0000-4000-8000-000000000044',
    'a2200000-0000-4000-8000-000000000003',
    NULL, 'a2200000-0000-4000-8000-000000000016',
    'Ungdomsverksamhet', 'grant-dependent-one'
  );
  IF NOT v_dependent.ok THEN
    RAISE EXCEPTION 'dependent grant failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.series_commitments
    WHERE id = v_dependent.commitment_id
      AND (participant_customer_id IS NOT NULL OR payer_customer_id IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.session_registrations
    WHERE series_commitment_id = v_dependent.commitment_id
      AND (customer_id IS NOT NULL OR user_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dependent grant created adult/payer identity leakage';
  END IF;

  IF (SELECT COUNT(*) FROM public.commerce_orders) <> v_orders
     OR (SELECT COUNT(*) FROM public.booking_receipts) <> v_receipts
     OR (SELECT COUNT(*) FROM public.ledger_entries) <> v_ledger THEN
    RAISE EXCEPTION 'house comp fabricated financial records';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.series_commitments', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated retained direct Series Commitment mutation privileges';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.series_commitments', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated Series Commitment reads were removed';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.series_commitments', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'service-role canonical paid/refund writers were broken';
  END IF;
  IF has_function_privilege('authenticated', 'public.grant_series_staff_place(uuid,uuid,uuid,uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.grant_series_staff_place(uuid,uuid,uuid,uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grant primitive is callable outside service role';
  END IF;
END;
$$;

ROLLBACK;
