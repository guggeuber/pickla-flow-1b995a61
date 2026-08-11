\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('bf100000-0000-4000-8000-000000000001', 'Pay First Test', 'pay-first-test');

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES (
  'bf100000-0000-4000-8000-000000000002',
  'bf100000-0000-4000-8000-000000000001',
  'Pay First Venue', 'pay-first-venue'
);

INSERT INTO public.venue_courts (id, venue_id, name, court_number, hourly_rate)
VALUES (
  'bf100000-0000-4000-8000-000000000003',
  'bf100000-0000-4000-8000-000000000002',
  'Bana 1', 1, 350
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'bf100000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
  'pay-first@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

INSERT INTO public.bookings (
  id, venue_id, venue_court_id, user_id, booked_by, start_time, end_time,
  status, total_price, booking_ref, access_code, stripe_session_id,
  participation_funding_mode, participation_funding_source_type,
  participation_funding_source_id, participation_funder
) VALUES (
  'bf100000-0000-4000-8000-000000000021',
  'bf100000-0000-4000-8000-000000000002',
  'bf100000-0000-4000-8000-000000000003',
  'bf100000-0000-4000-8000-000000000011',
  'bf100000-0000-4000-8000-000000000011',
  '2026-08-20T16:00:00Z', '2026-08-20T17:00:00Z',
  'confirmed', 350, 'BF-PAY-FIRST', '2468', 'cs_pay_first_base',
  'resource_funded', 'stripe_payment', 'cs_pay_first_base', 'self_prepaid'
);

DO $$
DECLARE
  v_first RECORD;
  v_second RECORD;
  v_commit RECORD;
  v_after_commit RECORD;
BEGIN
  SELECT * INTO v_first FROM public.acquire_capacity_hold(
    'bf100000-0000-4000-8000-000000000002',
    'booking_group', 'stripe:cs_pay_first_base', '2026-08-20', 1,
    'bf100000-0000-4000-8000-000000000011', NULL,
    'booking_participant', NULL, 'pay-first-one', '{}', 600
  );
  SELECT * INTO v_second FROM public.acquire_capacity_hold(
    'bf100000-0000-4000-8000-000000000002',
    'booking_group', 'stripe:cs_pay_first_base', '2026-08-20', 1,
    NULL, NULL, 'booking_participant', NULL, 'pay-first-two', '{}', 600
  );

  IF NOT v_first.ok OR v_first.hold_id IS NULL THEN
    RAISE EXCEPTION 'first final-spot hold was not acquired: %', row_to_json(v_first);
  END IF;
  IF v_second.ok OR v_second.reason <> 'capacity_full' THEN
    RAISE EXCEPTION 'second final-spot hold oversold capacity: %', row_to_json(v_second);
  END IF;

  SELECT * INTO v_commit FROM public.commit_booking_participant_capacity(
    p_venue_id => 'bf100000-0000-4000-8000-000000000002',
    p_booking_id => 'bf100000-0000-4000-8000-000000000021',
    p_booking_group_key => 'stripe:cs_pay_first_base',
    p_session_date => '2026-08-20',
    p_capacity => 1,
    p_user_id => 'bf100000-0000-4000-8000-000000000011',
    p_display_name => 'Pay First Player',
    p_price_minor => 9900,
    p_payment_status => 'paid',
    p_payment_method => 'stripe',
    p_payment_stripe_session_id => 'cs_participant_paid',
    p_metadata => '{"source":"stripe_payment"}',
    p_hold_id => v_first.hold_id
  );
  IF NOT v_commit.ok OR v_commit.participant_id IS NULL THEN
    RAISE EXCEPTION 'paid participant was not atomically committed: %', row_to_json(v_commit);
  END IF;

  SELECT * INTO v_after_commit FROM public.acquire_capacity_hold(
    'bf100000-0000-4000-8000-000000000002',
    'booking_group', 'stripe:cs_pay_first_base', '2026-08-20', 1,
    NULL, NULL, 'booking_participant', NULL, 'pay-first-after-commit', '{}', 600
  );
  IF v_after_commit.ok THEN
    RAISE EXCEPTION 'committed final spot was oversold: %', row_to_json(v_after_commit);
  END IF;

  BEGIN
    PERFORM public.commit_booking_participant_capacity(
      p_venue_id => 'bf100000-0000-4000-8000-000000000002',
      p_booking_id => 'bf100000-0000-4000-8000-000000000021',
      p_booking_group_key => 'stripe:cs_pay_first_base:pending-check',
      p_session_date => '2026-08-20',
      p_capacity => 4,
      p_display_name => 'Pending Must Fail',
      p_price_minor => 9900,
      p_payment_status => 'pending'
    );
    RAISE EXCEPTION 'pending participant was accepted as committed capacity';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%must be paid or free%' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_expiring RECORD;
  v_replacement RECORD;
BEGIN
  SELECT * INTO v_expiring FROM public.acquire_capacity_hold(
    'bf100000-0000-4000-8000-000000000002',
    'booking_group', 'expiry-proof', '2026-08-21', 1,
    NULL, NULL, 'booking_participant', NULL, 'expiring', '{}', 600
  );
  UPDATE public.capacity_holds SET expires_at = now() - interval '1 second' WHERE id = v_expiring.hold_id;
  SELECT * INTO v_replacement FROM public.acquire_capacity_hold(
    'bf100000-0000-4000-8000-000000000002',
    'booking_group', 'expiry-proof', '2026-08-21', 1,
    NULL, NULL, 'booking_participant', NULL, 'replacement', '{}', 600
  );
  IF NOT v_replacement.ok THEN
    RAISE EXCEPTION 'expired payment hold did not release capacity: %', row_to_json(v_replacement);
  END IF;
END $$;

-- The migration deliberately never rewrites historical desk payment history.
INSERT INTO public.booking_participants (
  venue_id, booking_id, booking_group_key, user_id, display_name,
  price_minor, payment_status, payment_method, metadata
) VALUES (
  'bf100000-0000-4000-8000-000000000002',
  'bf100000-0000-4000-8000-000000000021',
  'historical-desk-proof',
  'bf100000-0000-4000-8000-000000000011',
  'Historical Desk Player', 9900, 'paid', 'desk',
  '{"source":"desk_mark_paid","historical":true}'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_participants
    WHERE booking_group_key = 'historical-desk-proof'
      AND payment_status = 'paid'
      AND payment_method = 'desk'
      AND metadata->>'source' = 'desk_mark_paid'
  ) THEN
    RAISE EXCEPTION 'historical desk payment provenance was not preserved';
  END IF;
END $$;

ROLLBACK;
