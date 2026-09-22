-- Run after 20260922120000 against the local/stage-only synthetic fixture.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE v_preflight JSONB; v_baseline RECORD; v_links BIGINT; v_snapshots BIGINT;
  v_legacy JSONB; v_new JSONB; v_failed BOOLEAN := false;
  v_snapshot public.cancellation_policy_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO v_baseline FROM policy_forward_cert.baseline;
  IF (v_baseline.commerce_rows,v_baseline.registration_rows,v_baseline.booking_rows,v_baseline.participant_rows)
    IS DISTINCT FROM (814::BIGINT,273::BIGINT,453::BIGINT,343::BIGINT) THEN
    RAISE EXCEPTION 'production_shape_fixture_count_mismatch';
  END IF;
  IF v_baseline.booking_digest IS DISTINCT FROM (
      SELECT md5(string_agg(id::TEXT||':'||status,',' ORDER BY id)) FROM public.bookings
      WHERE venue_id='91000000-0000-4000-8000-000000000002'
    ) OR v_baseline.participant_digest IS DISTINCT FROM (
      SELECT md5(string_agg(id::TEXT||':'||payment_status,',' ORDER BY id)) FROM public.booking_participants
      WHERE venue_id='91000000-0000-4000-8000-000000000002'
    ) THEN RAISE EXCEPTION 'historical_business_rows_changed'; END IF;

  SELECT
    (SELECT count(*) FROM public.commerce_order_lines line JOIN public.commerce_orders order_row ON order_row.id=line.commerce_order_id WHERE order_row.venue_id='91000000-0000-4000-8000-000000000002' AND line.cancellation_policy_snapshot_id IS NOT NULL)
    + (SELECT count(*) FROM public.session_registrations WHERE venue_id='91000000-0000-4000-8000-000000000002' AND cancellation_policy_snapshot_id IS NOT NULL)
    + (SELECT count(*) FROM public.bookings WHERE venue_id='91000000-0000-4000-8000-000000000002' AND cancellation_policy_snapshot_id IS NOT NULL)
    + (SELECT count(*) FROM public.booking_participants WHERE venue_id='91000000-0000-4000-8000-000000000002' AND cancellation_policy_snapshot_id IS NOT NULL)
  INTO v_links;
  SELECT count(*) INTO v_snapshots FROM public.cancellation_policy_snapshots
    WHERE venue_id='91000000-0000-4000-8000-000000000002';
  IF v_links <> 0 OR v_snapshots <> 0 THEN RAISE EXCEPTION 'historical_snapshot_backfill_detected'; END IF;

  v_preflight := public.cancellation_policy_rollout_preflight('91000000-0000-4000-8000-000000000002');
  IF (v_preflight->>'legacy_policy_details_unavailable')::BIGINT <> 1883
    OR (v_preflight->>'historical_business_rows_mutated')::BIGINT <> 0
    OR (v_preflight->>'historical_snapshots_created')::BIGINT <> 0
    OR (v_preflight->>'historical_fk_links_changed')::BIGINT <> 0
    OR (v_preflight->>'post_cutover_missing_snapshot')::BIGINT <> 0 THEN
    RAISE EXCEPTION 'forward_only_preflight_failed:%',v_preflight;
  END IF;

  v_legacy := public.cancellation_subject_state(
    'activity_registration','94000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',false,'2027-01-01T00:00:00Z'
  );
  IF v_legacy->>'policy_mode' <> 'legacy' OR v_legacy->>'snapshot_id' IS NOT NULL
    OR (v_legacy->>'allowed')::BOOLEAN IS NOT TRUE
    OR v_legacy->>'capacity_release_mode' <> 'immediate'
    OR v_legacy->>'refund_mode' <> 'none'
    OR (v_legacy->>'legacy_policy_details_available')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'legacy_occurrence_dispatch_failed:%',v_legacy;
  END IF;
  v_legacy := public.cancellation_subject_state(
    'booking_participant','96000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',false,'2027-01-01T00:00:00Z'
  );
  IF v_legacy->>'policy_mode' <> 'legacy' OR v_legacy->>'refund_mode' <> 'manual_legacy' THEN
    RAISE EXCEPTION 'legacy_co_player_dispatch_failed:%',v_legacy;
  END IF;
  v_legacy := public.cancellation_subject_state(
    'court_booking','95000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',false,'2027-01-01T00:00:00Z'
  );
  IF v_legacy->>'policy_mode' <> 'legacy' OR v_legacy->>'refund_mode' <> 'none' THEN
    RAISE EXCEPTION 'legacy_court_dispatch_failed:%',v_legacy;
  END IF;

  BEGIN
    INSERT INTO public.bookings (
      id,venue_id,venue_court_id,user_id,booked_by,start_time,end_time,status,total_price
    ) VALUES (
      '97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000003',now()+interval '10 days',now()+interval '11 days',
      'confirmed',0
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%cancellation_policy_snapshot_required_after_cutover%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'new_court_without_snapshot_did_not_fail_closed'; END IF;

  SELECT * INTO v_snapshot FROM public.create_cancellation_policy_snapshot(
    '91000000-0000-4000-8000-000000000002','court_booking','booking',
    '97000000-0000-4000-8000-000000000002',now()+interval '10 days',NULL,NULL,NULL,NULL,
    '91000000-0000-4000-8000-000000000003',NULL,
    jsonb_build_object('amount_minor',35000,'currency','SEK'),jsonb_build_object('meter_type','unlimited')
  );
  INSERT INTO public.bookings (
    id,venue_id,venue_court_id,user_id,booked_by,start_time,end_time,status,total_price,
    cancellation_policy_snapshot_id
  ) VALUES (
    '97000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003',v_snapshot.start_at,v_snapshot.start_at+interval '1 hour',
    'confirmed',350,v_snapshot.id
  );
  v_new := public.cancellation_subject_state(
    'court_booking','97000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',false,now()
  );
  IF v_new->>'policy_mode' <> 'policy_v1' OR v_new->>'policy_key' <> 'court_24h'
    OR v_new->>'snapshot_id' IS NULL THEN RAISE EXCEPTION 'new_court_policy_v1_failed:%',v_new; END IF;
  RAISE NOTICE 'POLICY_FORWARD_PRODUCTION_SHAPE_OK %',v_preflight;
END $$;
ROLLBACK;
