\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id,name,slug)
VALUES ('c1500000-0000-4000-8000-000000000001','Cancellation Policy V1 Test','cancellation-policy-v1-test');

INSERT INTO public.venues (id,organization_id,name,slug,commerce_enabled)
VALUES ('c1500000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000001','Cancellation Policy V1 Test','cancellation-policy-v1-test',true);

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('c1500000-0000-4000-8000-000000000101','authenticated','authenticated','policy-owner@example.test','',now(),'{}','{}',now(),now()),
('c1500000-0000-4000-8000-000000000102','authenticated','authenticated','policy-other@example.test','',now(),'{}','{}',now(),now()),
('c1500000-0000-4000-8000-000000000103','authenticated','authenticated','policy-staff@example.test','',now(),'{}','{}',now(),now());

DELETE FROM public.customers WHERE auth_user_id IN (
  'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000102','c1500000-0000-4000-8000-000000000103'
);
INSERT INTO public.customers (id,organization_id,auth_user_id,display_name,primary_email,email_normalized)
VALUES
('c1500000-0000-4000-8000-000000000111','c1500000-0000-4000-8000-000000000001','c1500000-0000-4000-8000-000000000101','Policy Owner','policy-owner@example.test','policy-owner@example.test'),
('c1500000-0000-4000-8000-000000000112','c1500000-0000-4000-8000-000000000001','c1500000-0000-4000-8000-000000000102','Policy Other','policy-other@example.test','policy-other@example.test');
INSERT INTO public.venue_staff (user_id,venue_id,role,is_active)
VALUES ('c1500000-0000-4000-8000-000000000103','c1500000-0000-4000-8000-000000000002','venue_admin',true);

INSERT INTO public.venue_courts (id,venue_id,name,court_number,sport_type)
SELECT ('c1500000-0000-4000-8000-' || lpad(n::TEXT,12,'0'))::UUID,
  'c1500000-0000-4000-8000-000000000002', 'Policy Court ' || n, n, 'pickleball'
FROM generate_series(201,212) n;

CREATE OR REPLACE FUNCTION pg_temp.make_policy_booking(
  p_booking_id UUID,
  p_court_id UUID,
  p_policy_family TEXT,
  p_start_at TIMESTAMPTZ,
  p_amount_minor INTEGER,
  p_meter_type TEXT DEFAULT 'unlimited',
  p_registration_close TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_snapshot public.cancellation_policy_snapshots%ROWTYPE; v_receipt UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_snapshot FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002',p_policy_family,'policy_v1_test',p_booking_id,
    p_start_at,p_registration_close,NULL,NULL,NULL,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111',
    jsonb_build_object('amount_minor',p_amount_minor,'payment_intent_id','pi_test_'||replace(p_booking_id::TEXT,'-','')),
    jsonb_build_object('meter_type',p_meter_type)
  );
  IF p_amount_minor > 0 THEN
    INSERT INTO public.booking_receipts (
      id,receipt_number,booking_refs,stripe_session_id,venue_id,user_id,customer_id,customer_name,
      total_inc_vat,total_ex_vat,vat_amount,total_inc_vat_sek,total_ex_vat_sek,vat_amount_sek,
      payment_provider,payment_status,purchase_type,stripe_payment_intent_id
    ) VALUES (
      v_receipt,'POLICY-'||right(replace(p_booking_id::TEXT,'-',''),10),ARRAY['POL-'||right(p_booking_id::TEXT,8)],
      'cs_test_'||replace(p_booking_id::TEXT,'-',''),'c1500000-0000-4000-8000-000000000002',
      'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','Policy Owner',
      p_amount_minor/100,(p_amount_minor-round(p_amount_minor*6.0/106.0))/100,round(p_amount_minor*6.0/106.0)/100,
      p_amount_minor/100.0,(p_amount_minor-round(p_amount_minor*6.0/106.0))/100.0,round(p_amount_minor*6.0/106.0)/100.0,
      'stripe','paid','booking','pi_test_'||replace(p_booking_id::TEXT,'-','')
    );
  END IF;
  INSERT INTO public.bookings (
    id,venue_id,venue_court_id,user_id,customer_id,start_time,end_time,status,total_price,currency,
    booking_ref,stripe_session_id,cancellation_policy_snapshot_id,booked_by
  ) VALUES (
    p_booking_id,'c1500000-0000-4000-8000-000000000002',p_court_id,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111',
    p_start_at,p_start_at+interval '1 hour',
    CASE WHEN p_policy_family='court_booking' THEN 'confirmed' ELSE 'pending' END::public.booking_status,
    p_amount_minor/100.0,'SEK',
    'POL-'||right(p_booking_id::TEXT,8),CASE WHEN p_amount_minor>0 THEN 'cs_test_'||replace(p_booking_id::TEXT,'-','') ELSE NULL END,
    v_snapshot.id,'c1500000-0000-4000-8000-000000000101'
  );
  RETURN v_snapshot.id;
END;
$$;

-- Every venue receives exactly the approved immutable presets. Events are
-- intentionally explicit while the other five families have one default.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.cancellation_policies WHERE venue_id='c1500000-0000-4000-8000-000000000002') <> 6 THEN
    RAISE EXCEPTION 'approved preset count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.cancellation_policy_bindings WHERE venue_id='c1500000-0000-4000-8000-000000000002' AND is_active) <> 5 THEN
    RAISE EXCEPTION 'default binding count mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cancellation_policy_bindings WHERE venue_id='c1500000-0000-4000-8000-000000000002' AND policy_family='event' AND is_active) THEN
    RAISE EXCEPTION 'event policy must be explicit';
  END IF;
END $$;

SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000301','c1500000-0000-4000-8000-000000000201','occurrence_ticket','2030-03-31 10:00:00+02',16500);
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000302','c1500000-0000-4000-8000-000000000202','court_booking','2030-04-02 10:00:00+02',35000,'court_hours');
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000303','c1500000-0000-4000-8000-000000000203','managed_course','2030-04-05 10:00:00+02',149900);
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000304','c1500000-0000-4000-8000-000000000204','league_team','2030-04-10 18:00:00+02',299900,'unlimited','2030-04-01 23:59:00+02');

-- Exact boundary convention: strictly before refunds, exact boundary is late.
DO $$
DECLARE v JSONB;
BEGIN
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000301','c1500000-0000-4000-8000-000000000101',false,'2030-03-30 20:59:59+01');
  IF v->>'refund_mode' <> 'automatic_full' OR (v->>'refund_amount_minor')::INTEGER <> 16500 THEN RAISE EXCEPTION 'STANDARD 12H +1 second failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000301','c1500000-0000-4000-8000-000000000101',false,'2030-03-30 21:00:00+01');
  IF v->>'refund_mode' <> 'none' THEN RAISE EXCEPTION 'STANDARD 12H exact boundary failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000301','c1500000-0000-4000-8000-000000000101',false,'2030-03-30 21:00:01+01');
  IF v->>'refund_mode' <> 'none' THEN RAISE EXCEPTION 'STANDARD 12H -1 second failed: %',v; END IF;

  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000302','c1500000-0000-4000-8000-000000000101',false,'2030-04-01 07:59:59+00');
  IF v->>'refund_mode' <> 'automatic_full' OR v->>'entitlement_restore_mode' <> 'measurable' THEN RAISE EXCEPTION 'COURT 24H +1 second failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000302','c1500000-0000-4000-8000-000000000101',false,'2030-04-01 08:00:00+00');
  IF v->>'refund_mode' <> 'none' OR v->>'entitlement_restore_mode' <> 'none' THEN RAISE EXCEPTION 'COURT 24H exact boundary failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000302','c1500000-0000-4000-8000-000000000101',false,'2030-04-01 08:00:01+00');
  IF v->>'refund_mode' <> 'none' THEN RAISE EXCEPTION 'COURT 24H -1 second failed: %',v; END IF;

  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000303','c1500000-0000-4000-8000-000000000101',false,'2030-04-03 07:59:59+00');
  IF v->>'refund_mode' <> 'automatic_full' THEN RAISE EXCEPTION 'COURSE 48H +1 second failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000303','c1500000-0000-4000-8000-000000000101',false,'2030-04-03 08:00:00+00');
  IF v->>'refund_mode' <> 'none' THEN RAISE EXCEPTION 'COURSE 48H exact boundary failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000303','c1500000-0000-4000-8000-000000000101',false,'2030-04-05 08:00:00+00');
  IF (v->>'allowed')::BOOLEAN OR v->>'reason_code' <> 'course_started' THEN RAISE EXCEPTION 'course start lock failed: %',v; END IF;

  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000304','c1500000-0000-4000-8000-000000000101',false,'2030-04-01 21:58:59+00');
  IF v->>'refund_mode' <> 'automatic_full' THEN RAISE EXCEPTION 'league before close failed: %',v; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000304','c1500000-0000-4000-8000-000000000101',false,'2030-04-01 21:59:00+00');
  IF (v->>'allowed')::BOOLEAN OR v->>'refund_mode' <> 'none' THEN RAISE EXCEPTION 'league exact close failed: %',v; END IF;
END $$;

-- Stockholm spring/autumn offset changes do not change the instant-based
-- strict deadline result.
DO $$
DECLARE spring_snapshot public.cancellation_policy_snapshots%ROWTYPE; autumn_snapshot public.cancellation_policy_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO spring_snapshot FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','occurrence_ticket','dst_test','c1500000-0000-4000-8000-000000000401',
    '2030-03-31 10:00:00 Europe/Stockholm',NULL,NULL,NULL,NULL,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','{}','{}'
  );
  SELECT * INTO autumn_snapshot FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','occurrence_ticket','dst_test','c1500000-0000-4000-8000-000000000402',
    '2030-10-27 10:00:00 Europe/Stockholm',NULL,NULL,NULL,NULL,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','{}','{}'
  );
  IF spring_snapshot.refund_deadline_at <> spring_snapshot.start_at-interval '12 hours'
    OR autumn_snapshot.refund_deadline_at <> autumn_snapshot.start_at-interval '12 hours' THEN
    RAISE EXCEPTION 'DST instant deadline arithmetic failed';
  END IF;
END $$;

-- Event presets are explicit and support A -> B without mutating an existing
-- purchase snapshot.
DO $$
DECLARE v_a UUID; v_b UUID; snap_a public.cancellation_policy_snapshots%ROWTYPE; snap_b public.cancellation_policy_snapshots%ROWTYPE;
BEGIN
  SELECT version.id INTO v_a FROM public.cancellation_policy_versions version JOIN public.cancellation_policies policy ON policy.id=version.policy_id
    WHERE policy.venue_id='c1500000-0000-4000-8000-000000000002' AND version.preset_key='event_24h';
  SELECT version.id INTO v_b FROM public.cancellation_policy_versions version JOIN public.cancellation_policies policy ON policy.id=version.policy_id
    WHERE policy.venue_id='c1500000-0000-4000-8000-000000000002' AND version.preset_key='event_non_refundable';
  INSERT INTO public.cancellation_policy_bindings (venue_id,policy_family,subject_type,subject_id,policy_version_id)
    VALUES ('c1500000-0000-4000-8000-000000000002','event','event','c1500000-0000-4000-8000-000000000501',v_a);
  SELECT * INTO snap_a FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','event','event_test','c1500000-0000-4000-8000-000000000511',
    now()+interval '10 days',NULL,NULL,NULL,'c1500000-0000-4000-8000-000000000501',
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','{}','{}');
  UPDATE public.cancellation_policy_bindings SET is_active=false,retired_at=now()
    WHERE venue_id='c1500000-0000-4000-8000-000000000002' AND policy_family='event' AND subject_id='c1500000-0000-4000-8000-000000000501' AND is_active;
  INSERT INTO public.cancellation_policy_bindings (venue_id,policy_family,subject_type,subject_id,policy_version_id)
    VALUES ('c1500000-0000-4000-8000-000000000002','event','event','c1500000-0000-4000-8000-000000000501',v_b);
  SELECT * INTO snap_b FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','event','event_test','c1500000-0000-4000-8000-000000000512',
    now()+interval '10 days',NULL,NULL,NULL,'c1500000-0000-4000-8000-000000000501',
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','{}','{}');
  IF snap_a.policy_key <> 'event_24h' OR snap_b.policy_key <> 'event_non_refundable'
    OR snap_a.rules->>'refund_mode' <> 'automatic' OR snap_b.rules->>'refund_mode' <> 'none' THEN
    RAISE EXCEPTION 'Policy A/B purchase snapshots did not remain distinct';
  END IF;
  INSERT INTO public.bookings (
    id,venue_id,venue_court_id,user_id,customer_id,start_time,end_time,status,total_price,currency,
    booking_ref,cancellation_policy_snapshot_id,booked_by
  ) VALUES
    ('c1500000-0000-4000-8000-000000000313','c1500000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000210',
      'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111',snap_a.start_at,snap_a.start_at+interval '1 hour','pending',165,'SEK','POL-EVENT-A',snap_a.id,'c1500000-0000-4000-8000-000000000101'),
    ('c1500000-0000-4000-8000-000000000314','c1500000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000211',
      'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111',snap_b.start_at,snap_b.start_at+interval '1 hour','pending',165,'SEK','POL-EVENT-B',snap_b.id,'c1500000-0000-4000-8000-000000000101');
  IF (public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000313','c1500000-0000-4000-8000-000000000101')->>'refund_mode') <> 'automatic_full'
    OR (public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000314','c1500000-0000-4000-8000-000000000101')->>'refund_mode') <> 'none' THEN
    RAISE EXCEPTION 'event refundable/non-refundable decisions failed';
  END IF;
END $$;

-- Co-player cancellation refunds the frozen payer, not the participant who
-- releases the place.
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000308','c1500000-0000-4000-8000-000000000208','court_booking',now()+interval '48 hours',0);
DO $$
DECLARE snapshot public.cancellation_policy_snapshots%ROWTYPE; receipt_id UUID := 'c1500000-0000-4000-8000-000000000701'; preview JSONB; result JSONB;
BEGIN
  SELECT * INTO snapshot FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','booking_participant','co_player_test','c1500000-0000-4000-8000-000000000601',
    now()+interval '48 hours',NULL,NULL,NULL,NULL,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111',
    jsonb_build_object('amount_minor',16500),jsonb_build_object('meter_type','unlimited'));
  INSERT INTO public.booking_receipts (
    id,receipt_number,booking_refs,stripe_session_id,venue_id,user_id,customer_id,customer_name,
    total_inc_vat,total_ex_vat,vat_amount,total_inc_vat_sek,total_ex_vat_sek,vat_amount_sek,
    payment_provider,payment_status,purchase_type,stripe_payment_intent_id
  ) VALUES (
    receipt_id,'POLICY-CO-PLAYER',ARRAY['POL-CO-PLAYER'],'cs_test_co_player','c1500000-0000-4000-8000-000000000002',
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','Policy Payer',
    165,155.66,9.34,165,155.66,9.34,'stripe','paid','booking_participant','pi_test_co_player');
  INSERT INTO public.booking_participants (
    id,venue_id,booking_id,booking_group_key,customer_id,user_id,display_name,role,price_minor,currency,
    payment_status,payment_method,payment_stripe_session_id,booking_receipt_id,cancellation_policy_snapshot_id
  ) VALUES (
    'c1500000-0000-4000-8000-000000000601','c1500000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000308',
    'policy-co-player','c1500000-0000-4000-8000-000000000112','c1500000-0000-4000-8000-000000000102','Policy Participant',
    'player',16500,'SEK','paid','stripe','cs_test_co_player',receipt_id,snapshot.id);
  preview := public.cancellation_subject_state('booking_participant','c1500000-0000-4000-8000-000000000601','c1500000-0000-4000-8000-000000000102');
  result := public.confirm_cancellation_policy_v1('booking_participant','c1500000-0000-4000-8000-000000000601',
    'c1500000-0000-4000-8000-000000000102',preview->>'state_revision','co-player-payer-1');
  IF preview->>'refund_mode' <> 'automatic_full'
    OR (SELECT payment_status FROM public.booking_participants WHERE id='c1500000-0000-4000-8000-000000000601') <> 'cancelled'
    OR (SELECT provider_request#>>'{metadata,payer_user_id}' FROM public.commerce_refunds WHERE cancellation_decision_id=(result->>'decision_id')::UUID)
      <> 'c1500000-0000-4000-8000-000000000101' THEN
    RAISE EXCEPTION 'co-player actual payer/capacity result failed: %',result;
  END IF;
END $$;

-- Customer self-cancellation is blocked after check-in. Explicit staff
-- override keeps check-in history and records actor/reason/choice.
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000309','c1500000-0000-4000-8000-000000000209','court_booking',now()+interval '48 hours',0);
DO $$
DECLARE snapshot public.cancellation_policy_snapshots%ROWTYPE; customer_preview JSONB; staff_preview JSONB; result JSONB;
BEGIN
  SELECT * INTO snapshot FROM public.create_cancellation_policy_snapshot(
    'c1500000-0000-4000-8000-000000000002','booking_participant','staff_override_test','c1500000-0000-4000-8000-000000000602',
    now()+interval '48 hours',NULL,NULL,NULL,NULL,
    'c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000111','{}',jsonb_build_object('meter_type','unlimited'));
  INSERT INTO public.booking_participants (
    id,venue_id,booking_id,booking_group_key,customer_id,user_id,display_name,role,price_minor,currency,
    payment_status,checked_in_at,cancellation_policy_snapshot_id
  ) VALUES (
    'c1500000-0000-4000-8000-000000000602','c1500000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000309',
    'policy-staff-override','c1500000-0000-4000-8000-000000000111','c1500000-0000-4000-8000-000000000101','Checked In Owner',
    'player',0,'SEK','free',now(),snapshot.id);
  customer_preview := public.cancellation_subject_state('booking_participant','c1500000-0000-4000-8000-000000000602','c1500000-0000-4000-8000-000000000101');
  IF (customer_preview->>'allowed')::BOOLEAN OR customer_preview->>'reason_code' <> 'checked_in_locked' THEN
    RAISE EXCEPTION 'checked-in customer was not blocked: %',customer_preview;
  END IF;
  staff_preview := public.cancellation_subject_state('booking_participant','c1500000-0000-4000-8000-000000000602',
    'c1500000-0000-4000-8000-000000000103',true,now(),'none','none');
  result := public.confirm_cancellation_policy_v1('booking_participant','c1500000-0000-4000-8000-000000000602',
    'c1500000-0000-4000-8000-000000000103',staff_preview->>'state_revision','staff-override-1',true,'Pickla/systemfel','test','platform','none','none');
  IF (SELECT checked_in_at IS NULL FROM public.booking_participants WHERE id='c1500000-0000-4000-8000-000000000602')
    OR (SELECT payment_status FROM public.booking_participants WHERE id='c1500000-0000-4000-8000-000000000602') <> 'cancelled'
    OR NOT COALESCE((result->>'checkin_preserved')::BOOLEAN,false)
    OR NOT EXISTS (SELECT 1 FROM public.cancellation_decisions WHERE id=(result->>'decision_id')::UUID
      AND actor_mode='staff_override' AND staff_reason='Pickla/systemfel') THEN
    RAISE EXCEPTION 'staff override/check-in preservation failed: %',result;
  END IF;
END $$;

-- Automatic refund command, immediate court release and idempotency.
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000305','c1500000-0000-4000-8000-000000000205','court_booking',now()+interval '48 hours',35000,'unlimited');
DO $$
DECLARE v JSONB; first_result JSONB; second_result JSONB;
BEGIN
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000305','c1500000-0000-4000-8000-000000000101');
  first_result := public.confirm_cancellation_policy_v1('court_booking','c1500000-0000-4000-8000-000000000305','c1500000-0000-4000-8000-000000000101',v->>'state_revision','policy-idempotent-1');
  second_result := public.confirm_cancellation_policy_v1('court_booking','c1500000-0000-4000-8000-000000000305','c1500000-0000-4000-8000-000000000101',v->>'state_revision','policy-idempotent-1');
  IF (SELECT status FROM public.bookings WHERE id='c1500000-0000-4000-8000-000000000305') <> 'cancelled'
    OR (SELECT count(*) FROM public.cancellation_decisions WHERE subject_id='c1500000-0000-4000-8000-000000000305') <> 1
    OR (SELECT count(*) FROM public.commerce_refunds WHERE cancellation_decision_id=(first_result->>'decision_id')::UUID) <> 1
    OR COALESCE((second_result->>'idempotent')::BOOLEAN,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'confirmation idempotency/refund preparation failed: % %',first_result,second_result;
  END IF;
END $$;

-- Measurable court hour restores exactly once before cutoff; no price=0
-- inference is used because the snapshot carries meter provenance.
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000306','c1500000-0000-4000-8000-000000000206','court_booking',now()+interval '48 hours',0,'court_hours');
UPDATE public.bookings SET included_court_hours=2,membership_usage_period_start=current_date,membership_usage_period_end=current_date+6
WHERE id='c1500000-0000-4000-8000-000000000306';
INSERT INTO public.membership_usage (user_id,venue_id,entitlement_type,period_start,period_end,used_value)
VALUES ('c1500000-0000-4000-8000-000000000101','c1500000-0000-4000-8000-000000000002','court_hours_per_week',current_date,current_date+6,2);
DO $$
DECLARE v JSONB;
BEGIN
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000306','c1500000-0000-4000-8000-000000000101');
  PERFORM public.confirm_cancellation_policy_v1('court_booking','c1500000-0000-4000-8000-000000000306','c1500000-0000-4000-8000-000000000101',v->>'state_revision','court-hour-restore-1');
  PERFORM public.confirm_cancellation_policy_v1('court_booking','c1500000-0000-4000-8000-000000000306','c1500000-0000-4000-8000-000000000101',v->>'state_revision','court-hour-restore-1');
  IF (SELECT used_value FROM public.membership_usage WHERE user_id='c1500000-0000-4000-8000-000000000101' AND venue_id='c1500000-0000-4000-8000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'court hour was not restored exactly once';
  END IF;
END $$;

-- Stale preview, ownership and immutable records fail closed.
SELECT pg_temp.make_policy_booking('c1500000-0000-4000-8000-000000000307','c1500000-0000-4000-8000-000000000207','court_booking',now()+interval '48 hours',0);
DO $$
DECLARE v JSONB; changed JSONB; failed BOOLEAN := false; v_version_id UUID; failure_message TEXT;
BEGIN
  BEGIN
    PERFORM public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000307','c1500000-0000-4000-8000-000000000102');
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM LIKE '%owner_mismatch%'; END;
  IF NOT failed THEN RAISE EXCEPTION 'cross-customer preview was not rejected'; END IF;
  v := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000307','c1500000-0000-4000-8000-000000000101');
  UPDATE public.bookings SET status='pending' WHERE id='c1500000-0000-4000-8000-000000000307';
  changed := public.cancellation_subject_state('court_booking','c1500000-0000-4000-8000-000000000307','c1500000-0000-4000-8000-000000000101');
  IF changed->>'state_revision' = v->>'state_revision' THEN
    RAISE EXCEPTION 'state revision ignored subject status: before %, after %, db %',v->>'state_revision',changed->>'state_revision',
      (SELECT status FROM public.bookings WHERE id='c1500000-0000-4000-8000-000000000307');
  END IF;
  failed := false;
  BEGIN
    PERFORM public.confirm_cancellation_policy_v1('court_booking','c1500000-0000-4000-8000-000000000307','c1500000-0000-4000-8000-000000000101',v->>'state_revision','stale-1');
  EXCEPTION WHEN OTHERS THEN failure_message := SQLERRM; failed := SQLERRM LIKE '%stale_cancellation_preview%'; END;
  IF NOT failed OR (SELECT status FROM public.bookings WHERE id='c1500000-0000-4000-8000-000000000307')='cancelled' THEN
    RAISE EXCEPTION 'stale preview did not fail without mutation: failed %, status %, error %',failed,
      (SELECT status FROM public.bookings WHERE id='c1500000-0000-4000-8000-000000000307'),failure_message;
  END IF;
  failed := false;
  BEGIN
    UPDATE public.cancellation_policy_snapshots SET copy_schema_version=1 WHERE id=(v->>'snapshot_id')::UUID;
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM LIKE '%immutable%'; END;
  IF NOT failed THEN RAISE EXCEPTION 'snapshot mutation was not rejected'; END IF;
  SELECT version.id INTO v_version_id FROM public.cancellation_policy_versions version
    JOIN public.cancellation_policies policy ON policy.id=version.policy_id
    WHERE version.lifecycle_status='published' AND policy.venue_id='c1500000-0000-4000-8000-000000000002'
    ORDER BY version.created_at LIMIT 1;
  failed := false;
  BEGIN
    UPDATE public.cancellation_policy_versions SET change_note='forbidden' WHERE id=v_version_id;
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM LIKE '%immutable%'; END;
  IF NOT failed THEN RAISE EXCEPTION 'published version mutation was not rejected'; END IF;
END $$;

DO $$
BEGIN
  IF has_table_privilege('anon','public.cancellation_policy_snapshots','UPDATE')
    OR has_table_privilege('authenticated','public.cancellation_policy_snapshots','UPDATE')
    OR has_function_privilege('authenticated','public.confirm_cancellation_policy_v1(text,uuid,uuid,text,text,boolean,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'policy security grants are too broad';
  END IF;
END $$;

ROLLBACK;

SELECT 'cancellation_policy_v1_ok' AS result;
