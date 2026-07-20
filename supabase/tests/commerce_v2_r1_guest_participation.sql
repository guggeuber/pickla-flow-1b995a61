\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES (
  'c1100000-0000-4000-8000-000000000001',
  'Commerce R1 Test',
  'commerce-r1-test'
);

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES (
  'c1100000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'Commerce R1 Test Venue',
  'commerce-r1-test-venue'
);

INSERT INTO public.customers (
  id,
  organization_id,
  display_name,
  primary_email,
  email_normalized,
  metadata
)
VALUES
  (
    'c1100000-0000-4000-8000-000000000011',
    'c1100000-0000-4000-8000-000000000001',
    'Guest One',
    'guest-one@example.test',
    'guest-one@example.test',
    '{"source":"commerce_r1_test"}'::jsonb
  ),
  (
    'c1100000-0000-4000-8000-000000000012',
    'c1100000-0000-4000-8000-000000000001',
    'Guest Two',
    'guest-two@example.test',
    'guest-two@example.test',
    '{"source":"commerce_r1_test"}'::jsonb
  );

INSERT INTO public.activity_sessions (
  id,
  venue_id,
  name,
  session_type,
  session_date,
  start_time,
  end_time,
  price_sek,
  capacity,
  metadata
)
VALUES (
  'c1100000-0000-4000-8000-000000000020',
  'c1100000-0000-4000-8000-000000000002',
  'Guest Participation Test',
  'open_play',
  '2026-07-20',
  '18:00',
  '19:00',
  59,
  1,
  '{"source":"commerce_r1_test"}'::jsonb
);

DO $$
DECLARE
  v_first RECORD;
  v_replay RECORD;
  v_capacity RECORD;
  v_registration_count INTEGER;
  v_entitlement_count INTEGER;
  v_price INTEGER;
BEGIN
  SELECT * INTO v_first
  FROM public.commit_activity_registration_capacity(
    'c1100000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000020',
    '2026-07-20',
    NULL,
    'c1100000-0000-4000-8000-000000000011',
    'confirmed',
    59,
    'cs_test_r1_guest',
    'commerce_order',
    'c1100000-0000-4000-8000-000000000101',
    '{"line_total_inc_vat_minor":5940}'::jsonb,
    NULL
  );

  SELECT * INTO v_replay
  FROM public.commit_activity_registration_capacity(
    'c1100000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000020',
    '2026-07-20',
    NULL,
    'c1100000-0000-4000-8000-000000000011',
    'confirmed',
    59,
    'cs_test_r1_guest',
    'commerce_order',
    'c1100000-0000-4000-8000-000000000101',
    '{"line_total_inc_vat_minor":5940,"replay":true}'::jsonb,
    NULL
  );

  IF NOT v_first.ok OR NOT v_replay.ok THEN
    RAISE EXCEPTION 'guest registration or replay was rejected';
  END IF;
  IF v_first.registration_id <> v_replay.registration_id THEN
    RAISE EXCEPTION 'guest replay created a different registration';
  END IF;

  SELECT COUNT(*), MAX(price_paid_sek)
  INTO v_registration_count, v_price
  FROM public.session_registrations
  WHERE source_type = 'commerce_order'
    AND source_id = 'c1100000-0000-4000-8000-000000000101';

  IF v_registration_count <> 1 OR v_price <> 59 THEN
    RAISE EXCEPTION
      'guest registration truth failed count=% price=%',
      v_registration_count,
      v_price;
  END IF;

  INSERT INTO public.access_entitlements (
    venue_id,
    user_id,
    customer_id,
    entitlement_type,
    status,
    source_type,
    source_id,
    activity_session_id,
    session_date,
    includes_session_types,
    metadata
  )
  VALUES (
    'c1100000-0000-4000-8000-000000000002',
    NULL,
    'c1100000-0000-4000-8000-000000000011',
    'session_ticket',
    'active',
    'session_ticket',
    v_first.registration_id,
    'c1100000-0000-4000-8000-000000000020',
    '2026-07-20',
    ARRAY['open_play'],
    '{"line_total_inc_vat_minor":5940}'::jsonb
  )
  ON CONFLICT (source_type, source_id, customer_id, entitlement_type)
  DO UPDATE SET status = EXCLUDED.status;

  INSERT INTO public.access_entitlements (
    venue_id,
    user_id,
    customer_id,
    entitlement_type,
    status,
    source_type,
    source_id,
    activity_session_id,
    session_date,
    includes_session_types,
    metadata
  )
  VALUES (
    'c1100000-0000-4000-8000-000000000002',
    NULL,
    'c1100000-0000-4000-8000-000000000011',
    'session_ticket',
    'active',
    'session_ticket',
    v_first.registration_id,
    'c1100000-0000-4000-8000-000000000020',
    '2026-07-20',
    ARRAY['open_play'],
    '{"line_total_inc_vat_minor":5940,"replay":true}'::jsonb
  )
  ON CONFLICT (source_type, source_id, customer_id, entitlement_type)
  DO UPDATE SET status = EXCLUDED.status;

  SELECT COUNT(*) INTO v_entitlement_count
  FROM public.access_entitlements
  WHERE source_type = 'session_ticket'
    AND source_id = v_first.registration_id
    AND customer_id = 'c1100000-0000-4000-8000-000000000011'
    AND status = 'active';

  IF v_entitlement_count <> 1 THEN
    RAISE EXCEPTION
      'guest entitlement replay created duplicates: %',
      v_entitlement_count;
  END IF;

  SELECT * INTO v_capacity
  FROM public.commit_activity_registration_capacity(
    'c1100000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000020',
    '2026-07-20',
    NULL,
    'c1100000-0000-4000-8000-000000000012',
    'confirmed',
    59,
    'cs_test_r1_guest_second',
    'commerce_order',
    'c1100000-0000-4000-8000-000000000102',
    '{"line_total_inc_vat_minor":5940}'::jsonb,
    NULL
  );

  IF v_capacity.ok OR v_capacity.reason <> 'capacity_full' THEN
    RAISE EXCEPTION
      'capacity changed for guest purchase: ok=% reason=%',
      v_capacity.ok,
      v_capacity.reason;
  END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.commit_activity_registration_capacity(uuid,uuid,date,uuid,uuid,text,integer,text,text,uuid,jsonb,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can execute guest registration commit RPC';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.commit_activity_registration_capacity(uuid,uuid,date,uuid,uuid,text,integer,text,text,uuid,jsonb,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute guest registration commit RPC';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.commit_activity_registration_capacity(uuid,uuid,date,uuid,uuid,text,integer,text,text,uuid,jsonb,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute guest registration commit RPC';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.acquire_capacity_hold(uuid,text,text,date,integer,uuid,uuid,text,uuid,text,jsonb,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can create capacity holds directly';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.acquire_capacity_hold(uuid,text,text,date,integer,uuid,uuid,text,uuid,text,jsonb,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot create capacity holds';
  END IF;
END $$;

ROLLBACK;
