\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('a2600000-0000-4000-8000-000000000001', 'Series Benefit Test', 'series-benefit-test');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES ('a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000001', 'Benefit Venue', 'benefit-venue', true);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'a2600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'benefit-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.venue_staff (user_id, venue_id, role, is_active)
VALUES ('a2600000-0000-4000-8000-000000000003', 'a2600000-0000-4000-8000-000000000002', 'venue_admin', true);

INSERT INTO public.customers (
  id, organization_id, display_name, primary_email, email_normalized
) VALUES
  ('a2600000-0000-4000-8000-000000000011', 'a2600000-0000-4000-8000-000000000001', 'Paid Participant', 'benefit-paid@example.test', 'benefit-paid@example.test'),
  ('a2600000-0000-4000-8000-000000000012', 'a2600000-0000-4000-8000-000000000001', 'Comp Participant', 'benefit-comp@example.test', 'benefit-comp@example.test'),
  ('a2600000-0000-4000-8000-000000000013', 'a2600000-0000-4000-8000-000000000001', 'No Course', 'benefit-outsider@example.test', 'benefit-outsider@example.test');

INSERT INTO public.activity_formats (
  id, organization_id, name, description, age_group, level,
  requires_instructor, presentation_type
) VALUES (
  'a2600000-0000-4000-8000-000000000021', 'a2600000-0000-4000-8000-000000000001',
  'Pickla Start Test', 'Fyra veckor', 'adult', 'intro', true, 'course'
);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek,
  commerce_kind, fulfillment_type, fulfillment_presentation,
  commerce_enabled, status, resolver_rules
) VALUES (
  'a2600000-0000-4000-8000-000000000031', 'a2600000-0000-4000-8000-000000000002',
  'pickla_start_test', 'Pickla Start Test', 'series_access', 795,
  'participation', 'participation', 'participation', true, 'active',
  '{"included_benefits":{"open_play_series_period":{"enabled":true,"period_source":"active_series_occurrences"}}}'
);

INSERT INTO public.activity_series (
  id, venue_id, format_id, name, series_type, status, access_product_id,
  product_key, start_date, end_date, total_sessions, capacity,
  recurrence_days, start_time, end_time, court_ids
) VALUES (
  'a2600000-0000-4000-8000-000000000041', 'a2600000-0000-4000-8000-000000000002',
  'a2600000-0000-4000-8000-000000000021', 'Pickla Start · September', 'course', 'active',
  'a2600000-0000-4000-8000-000000000031', 'pickla_start_test',
  '2027-09-09', '2027-09-30', 4, 3, ARRAY[3], '18:00', '19:15', '{}'::UUID[]
);

INSERT INTO public.activity_sessions (
  id, venue_id, series_id, name, session_type, sport_type, session_date,
  start_time, end_time, price_sek, capacity, court_ids, access_policy,
  is_active, publish_status, closed_to_public, series_occurrence_index
) VALUES
  ('a2600000-0000-4000-8000-000000000051', 'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000041', 'Pickla Start 1', 'course', 'pickleball', '2027-09-09', '18:00', '19:15', 0, 3, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 1),
  ('a2600000-0000-4000-8000-000000000052', 'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000041', 'Pickla Start 2', 'course', 'pickleball', '2027-09-16', '18:00', '19:15', 0, 3, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 2),
  ('a2600000-0000-4000-8000-000000000053', 'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000041', 'Pickla Start 3', 'course', 'pickleball', '2027-09-23', '18:00', '19:15', 0, 3, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 3),
  ('a2600000-0000-4000-8000-000000000054', 'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000041', 'Pickla Start 4', 'course', 'pickleball', '2027-09-30', '18:00', '19:15', 0, 3, '{}'::UUID[], '{"series_commitment_required":true}', true, 'published', true, 4),
  ('a2600000-0000-4000-8000-000000000061', 'a2600000-0000-4000-8000-000000000002', NULL, 'Open Play före', 'open_play', 'pickleball', '2027-09-08', '12:00', '14:00', 165, 20, '{}'::UUID[], '{}', true, 'published', false, NULL),
  ('a2600000-0000-4000-8000-000000000062', 'a2600000-0000-4000-8000-000000000002', NULL, 'Open Play startdag', 'open_play', 'pickleball', '2027-09-09', '08:00', '10:00', 165, 20, '{}'::UUID[], '{}', true, 'published', false, NULL),
  ('a2600000-0000-4000-8000-000000000063', 'a2600000-0000-4000-8000-000000000002', NULL, 'Open Play mitten', 'open_play', 'pickleball', '2027-09-15', '12:00', '14:00', 165, 20, '{}'::UUID[], '{}', true, 'published', false, NULL),
  ('a2600000-0000-4000-8000-000000000064', 'a2600000-0000-4000-8000-000000000002', NULL, 'Open Play slutdag', 'open_play', 'pickleball', '2027-09-30', '20:00', '22:00', 165, 20, '{}'::UUID[], '{}', true, 'published', false, NULL),
  ('a2600000-0000-4000-8000-000000000065', 'a2600000-0000-4000-8000-000000000002', NULL, 'Open Play efter', 'open_play', 'pickleball', '2027-10-01', '08:00', '10:00', 165, 20, '{}'::UUID[], '{}', true, 'published', false, NULL),
  ('a2600000-0000-4000-8000-000000000066', 'a2600000-0000-4000-8000-000000000002', NULL, 'Premium event', 'event', 'pickleball', '2027-09-15', '18:00', '20:00', 399, 20, '{}'::UUID[], '{}', true, 'published', false, NULL);

DO $$
DECLARE
  v_paid RECORD;
  v_comp RECORD;
  v_comp_cancel RECORD;
  v_result JSONB;
  v_orders INTEGER := (SELECT COUNT(*) FROM public.commerce_orders);
  v_receipts INTEGER := (SELECT COUNT(*) FROM public.booking_receipts);
  v_ledger INTEGER := (SELECT COUNT(*) FROM public.ledger_entries);
BEGIN
  SELECT * INTO v_paid FROM public.commit_series_participant_capacity(
    p_venue_id => 'a2600000-0000-4000-8000-000000000002',
    p_activity_series_id => 'a2600000-0000-4000-8000-000000000041',
    p_participant_customer_id => 'a2600000-0000-4000-8000-000000000011',
    p_payer_customer_id => 'a2600000-0000-4000-8000-000000000011'
  );
  IF NOT v_paid.ok THEN RAISE EXCEPTION 'paid Series commitment failed'; END IF;

  IF (SELECT COUNT(*) FROM public.access_entitlements WHERE source_type = 'series_benefit' AND source_id = v_paid.commitment_id) <> 1 THEN
    RAISE EXCEPTION 'paid participant did not receive exactly one benefit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'series_benefit' AND source_id = v_paid.commitment_id
      AND customer_id = 'a2600000-0000-4000-8000-000000000011'
      AND scope_type = 'open_play' AND meter_type = 'unlimited'
      AND starts_at = '2027-09-08 22:00:00+00'::TIMESTAMPTZ
      AND expires_at = '2027-09-30 22:00:00+00'::TIMESTAMPTZ
      AND access_reason = 'Ingår i Pickla Start Test'
      AND funding_type = 'commerce_purchase' AND funder = 'self_prepaid'
      AND requires_consumption = false
  ) THEN RAISE EXCEPTION 'paid benefit ownership, period or provenance is incorrect'; END IF;

  SELECT public.resolve_access_entitlement(
    'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000011', NULL,
    'a2600000-0000-4000-8000-000000000061', '2027-09-08', '2027-09-08 12:00 Europe/Stockholm'::TIMESTAMPTZ,
    'open_play_slot', '{"entitlement_types":["series_access"]}'
  ) INTO v_result;
  IF COALESCE((v_result->>'covered')::BOOLEAN, false) THEN RAISE EXCEPTION 'Open Play before Course period was included'; END IF;

  FOR v_result IN
    SELECT public.resolve_access_entitlement(
      'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000011', NULL,
      session.id, session.session_date, (session.session_date::TEXT || ' ' || session.start_time::TEXT || ' Europe/Stockholm')::TIMESTAMPTZ,
      'open_play_slot', '{"entitlement_types":["series_access"]}'
    )
    FROM public.activity_sessions session
    WHERE session.id IN (
      'a2600000-0000-4000-8000-000000000062',
      'a2600000-0000-4000-8000-000000000063',
      'a2600000-0000-4000-8000-000000000064'
    )
  LOOP
    IF NOT COALESCE((v_result->>'covered')::BOOLEAN, false)
       OR v_result->>'access_reason' <> 'Ingår i Pickla Start Test' THEN
      RAISE EXCEPTION 'Open Play during Course period was not included: %', v_result;
    END IF;
  END LOOP;

  SELECT public.resolve_access_entitlement(
    'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000011', NULL,
    'a2600000-0000-4000-8000-000000000065', '2027-10-01', '2027-10-01 08:00 Europe/Stockholm'::TIMESTAMPTZ,
    'open_play_slot', '{"entitlement_types":["series_access"]}'
  ) INTO v_result;
  IF COALESCE((v_result->>'covered')::BOOLEAN, false) THEN RAISE EXCEPTION 'Open Play after Course period was included'; END IF;

  SELECT public.resolve_access_entitlement(
    'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000011', NULL,
    'a2600000-0000-4000-8000-000000000066', '2027-09-15', '2027-09-15 18:00 Europe/Stockholm'::TIMESTAMPTZ,
    'premium_event', '{"entitlement_types":["series_access"]}'
  ) INTO v_result;
  IF COALESCE((v_result->>'covered')::BOOLEAN, false) THEN RAISE EXCEPTION 'Series benefit leaked into unrelated activity'; END IF;

  SELECT public.resolve_access_entitlement(
    'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000013', NULL,
    'a2600000-0000-4000-8000-000000000063', '2027-09-15', '2027-09-15 12:00 Europe/Stockholm'::TIMESTAMPTZ,
    'open_play_slot', '{"entitlement_types":["series_access"]}'
  ) INTO v_result;
  IF COALESCE((v_result->>'covered')::BOOLEAN, false) THEN RAISE EXCEPTION 'non-participant received Course benefit'; END IF;

  SELECT * INTO v_comp FROM public.grant_series_staff_place(
    'a2600000-0000-4000-8000-000000000002', 'a2600000-0000-4000-8000-000000000041',
    'a2600000-0000-4000-8000-000000000003', 'a2600000-0000-4000-8000-000000000012', NULL,
    'Kontrollerad friplats', 'series-benefit-comp-one'
  );
  IF NOT v_comp.ok OR NOT EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'series_benefit' AND source_id = v_comp.commitment_id
      AND customer_id = 'a2600000-0000-4000-8000-000000000012'
      AND funding_type = 'house_granted' AND funder = 'house_comped'
  ) THEN RAISE EXCEPTION 'House Comp participant did not receive canonical benefit'; END IF;

  IF (SELECT COUNT(*) FROM public.commerce_orders) <> v_orders
     OR (SELECT COUNT(*) FROM public.booking_receipts) <> v_receipts
     OR (SELECT COUNT(*) FROM public.ledger_entries) <> v_ledger THEN
    RAISE EXCEPTION 'House Comp benefit fabricated financial history';
  END IF;

  SELECT * INTO v_comp_cancel FROM public.cancel_series_staff_place(
    'a2600000-0000-4000-8000-000000000002', v_comp.commitment_id,
    'a2600000-0000-4000-8000-000000000003', 'Avbokad friplats', 'series-benefit-comp-cancel'
  );
  IF NOT v_comp_cancel.ok OR NOT EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'series_benefit' AND source_id = v_comp.commitment_id AND status = 'revoked'
  ) THEN RAISE EXCEPTION 'House Comp cancellation left benefit active'; END IF;

  UPDATE public.activity_sessions
  SET session_date = '2027-10-07'
  WHERE id = 'a2600000-0000-4000-8000-000000000054';
  IF NOT EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'series_benefit' AND source_id = v_paid.commitment_id
      AND expires_at = '2027-10-07 22:00:00+00'::TIMESTAMPTZ
  ) THEN RAISE EXCEPTION 'canonical occurrence move did not reconcile benefit period'; END IF;

  PERFORM public.reconcile_series_open_play_benefits('a2600000-0000-4000-8000-000000000041');
  PERFORM public.reconcile_series_open_play_benefits('a2600000-0000-4000-8000-000000000041');
  IF (SELECT COUNT(*) FROM public.access_entitlements WHERE source_type = 'series_benefit' AND source_id = v_paid.commitment_id) <> 1 THEN
    RAISE EXCEPTION 'benefit reconciliation is not idempotent';
  END IF;

  BEGIN
    PERFORM public.set_series_open_play_benefit('a2600000-0000-4000-8000-000000000041', false);
    RAISE EXCEPTION 'benefit configuration changed despite commercial history';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'series_open_play_benefit_commercial_history_locked' THEN RAISE; END IF;
  END;

  UPDATE public.series_commitments SET status = 'cancelled', cancelled_at = now() WHERE id = v_paid.commitment_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE source_type = 'series_benefit' AND source_id = v_paid.commitment_id AND status = 'revoked'
  ) THEN RAISE EXCEPTION 'paid cancellation status did not revoke benefit'; END IF;
END;
$$;

ROLLBACK;
