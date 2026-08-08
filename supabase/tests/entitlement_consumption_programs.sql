\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ef200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'entitlement-operator@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

DO $$
DECLARE
  v_org UUID;
  v_venue UUID := 'ef200000-0000-4000-8000-000000000010';
  v_other_venue UUID := 'ef200000-0000-4000-8000-000000000011';
  v_customer UUID := 'ef200000-0000-4000-8000-000000000020';
  v_other_customer UUID := 'ef200000-0000-4000-8000-000000000021';
  v_session UUID := 'ef200000-0000-4000-8000-000000000030';
  v_noneligible_session UUID := 'ef200000-0000-4000-8000-000000000031';
  v_program UUID;
  v_digital public.access_entitlements;
  v_legacy public.access_entitlements;
  v_partner public.access_entitlements;
  v_no_show public.access_entitlements;
  v_first JSONB;
  v_retry JSONB;
  v_checkin JSONB;
  v_checkin_retry JSONB;
  v_reversal JSONB;
  v_consumption UUID;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.venues (id, organization_id, name, slug, timezone)
  VALUES
    (v_venue, v_org, 'Entitlement Consumption Venue', 'entitlement-consumption-venue', 'Europe/Stockholm'),
    (v_other_venue, v_org, 'Entitlement Other Consumption Venue', 'entitlement-other-consumption-venue', 'Europe/Stockholm');
  INSERT INTO public.customers (id, organization_id, display_name, status)
  VALUES
    (v_customer, v_org, 'Consumption Owner', 'active'),
    (v_other_customer, v_org, 'Consumption Other', 'active');
  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, session_date, start_time, end_time, price_sek, product_key
  ) VALUES
    (v_session, v_venue, 'Consumption Open Play', 'open_play', current_date, '10:00', '12:00', 165, 'open_play_slot'),
    (v_noneligible_session, v_venue, 'Noneligible Open Play', 'open_play', current_date, '13:00', '15:00', 165, 'open_play_slot');

  -- Future digital cards and imported cards share the exact same occurrence contract.
  SELECT * INTO v_digital FROM public.issue_access_entitlement(
    p_customer_id => v_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play', p_meter_type => 'occurrences',
    p_funding_type => 'commerce_purchase', p_funder => 'self_prepaid', p_resolution_priority => 40,
    p_occurrence_origin => 'paid', p_access_reason => 'Klippkort · 2 gånger kvar',
    p_uses_limit => 2, p_issuance_key => 'digital-punch-fixture'
  );
  SELECT public.consume_access_entitlement(
    p_entitlement_id => v_digital.id, p_customer_id => v_customer, p_venue_id => v_venue,
    p_idempotency_key => 'digital-attendance-1', p_activity_session_id => v_session,
    p_session_date => current_date
  ) INTO v_first;
  SELECT public.consume_access_entitlement(
    p_entitlement_id => v_digital.id, p_customer_id => v_customer, p_venue_id => v_venue,
    p_idempotency_key => 'digital-attendance-1', p_activity_session_id => v_session,
    p_session_date => current_date
  ) INTO v_retry;
  IF (v_first->>'idempotent')::boolean OR NOT (v_retry->>'idempotent')::boolean
     OR (SELECT uses_count FROM public.access_entitlements WHERE id = v_digital.id) <> 1
     OR (v_first->>'remaining_uses')::integer <> 1 THEN
    RAISE EXCEPTION 'first-use or retry contract failed';
  END IF;

  BEGIN
    PERFORM public.consume_access_entitlement(
      p_entitlement_id => v_digital.id, p_customer_id => v_other_customer, p_venue_id => v_venue,
      p_idempotency_key => 'wrong-customer', p_activity_session_id => v_session, p_session_date => current_date
    );
    RAISE EXCEPTION 'cross-customer consumption accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-customer consumption accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.consume_access_entitlement(
      p_entitlement_id => v_digital.id, p_customer_id => v_customer, p_venue_id => v_other_venue,
      p_idempotency_key => 'wrong-venue', p_session_date => current_date,
      p_access_context => '{"session_type":"open_play"}'::jsonb
    );
    RAISE EXCEPTION 'cross-venue consumption accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-venue consumption accepted' THEN RAISE; END IF;
  END;

  SELECT public.reverse_entitlement_consumption(
    (v_first->>'consumption_id')::uuid, 'digital-reversal-1', 'Cancelled valid attendance', now(),
    'ef200000-0000-4000-8000-000000000001'
  ) INTO v_reversal;
  IF (v_reversal->>'idempotent')::boolean
     OR (SELECT uses_count FROM public.access_entitlements WHERE id = v_digital.id) <> 0
     OR (SELECT count(*) FROM public.entitlement_consumptions WHERE entitlement_id = v_digital.id) <> 2 THEN
    RAISE EXCEPTION 'append-only reversal failed';
  END IF;
  SELECT public.reverse_entitlement_consumption(
    (v_first->>'consumption_id')::uuid, 'digital-reversal-retry', 'Retry', now(),
    'ef200000-0000-4000-8000-000000000001'
  ) INTO v_retry;
  IF NOT (v_retry->>'idempotent')::boolean
     OR (SELECT count(*) FROM public.entitlement_consumptions WHERE entitlement_id = v_digital.id) <> 2 THEN
    RAISE EXCEPTION 'reversal retry duplicated history';
  END IF;
  BEGIN
    UPDATE public.entitlement_consumptions SET quantity = 2 WHERE entitlement_id = v_digital.id;
    RAISE EXCEPTION 'consumption update accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'consumption update accepted' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.entitlement_consumptions WHERE entitlement_id = v_digital.id;
    RAISE EXCEPTION 'consumption delete accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'consumption delete accepted' THEN RAISE; END IF;
  END;

  SELECT * INTO v_legacy FROM public.import_legacy_punch_card(
    p_customer_id => v_customer, p_venue_id => v_venue, p_remaining_visits => 4,
    p_scope_type => 'open_play', p_legacy_source_ref => 'legacy-card-fixture-1',
    p_operator_note => 'Physical card verified at desk',
    p_imported_by => 'ef200000-0000-4000-8000-000000000001', p_funder => 'self_prepaid'
  );
  IF v_legacy.funding_type <> 'legacy_import' OR v_legacy.funder <> 'self_prepaid'
     OR v_legacy.occurrence_origin <> 'legacy_import'
     OR v_legacy.uses_limit <> 4 OR v_legacy.uses_count <> 0
     OR v_legacy.imported_by <> 'ef200000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'legacy import provenance failed';
  END IF;
  BEGIN
    PERFORM public.import_legacy_punch_card(
      p_customer_id => v_customer, p_venue_id => v_venue, p_remaining_visits => 4,
      p_scope_type => 'open_play', p_legacy_source_ref => 'legacy-card-fixture-1',
      p_operator_note => 'Duplicate', p_imported_by => 'ef200000-0000-4000-8000-000000000001',
      p_funder => 'self_prepaid'
    );
    RAISE EXCEPTION 'duplicate legacy import accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate legacy import accepted' THEN RAISE; END IF;
  END;
  PERFORM public.adjust_entitlement_occurrences(
    v_legacy.id, 1, 'Verified fifth remaining visit', 'legacy-adjustment-1',
    'ef200000-0000-4000-8000-000000000001'
  );
  PERFORM public.adjust_entitlement_occurrences(
    v_legacy.id, 1, 'Retry', 'legacy-adjustment-1',
    'ef200000-0000-4000-8000-000000000001'
  );
  IF (SELECT uses_limit FROM public.access_entitlements WHERE id = v_legacy.id) <> 5
     OR (SELECT count(*) FROM public.entitlement_adjustments WHERE entitlement_id = v_legacy.id) <> 1 THEN
    RAISE EXCEPTION 'manual adjustment was not audited/idempotent';
  END IF;

  -- Bruce is a configured partner program, never a boolean or separate entitlement table.
  INSERT INTO public.partner_programs (
    organization_id, program_key, name, activity_label, access_reason, desk_label,
    funding_counterparty_ref, reimbursement_amount_minor, settlement_rule,
    agreement_version, agreement_effective_date, created_by
  ) VALUES (
    v_org, 'bruce', 'Bruce', 'Bruce gäller', 'Ingår via Bruce', 'Bruce',
    'bruce-fixture-contract', 12500, '{"version":"1","basis":"valid_attendance"}',
    'bruce-v1', current_date,
    'ef200000-0000-4000-8000-000000000001'
  ) RETURNING id INTO v_program;
  INSERT INTO public.partner_program_sessions (
    partner_program_id, organization_id, venue_id, activity_session_id, status, created_by
  ) VALUES (
    v_program, v_org, v_venue, v_session, 'eligible',
    'ef200000-0000-4000-8000-000000000001'
  );
  BEGIN
    PERFORM public.issue_partner_entitlement(
      p_partner_program_id => v_program, p_customer_id => v_customer, p_venue_id => v_venue,
      p_activity_session_id => v_noneligible_session, p_service_date => current_date,
      p_external_reference => 'bruce-noneligible'
    );
    RAISE EXCEPTION 'noneligible Bruce session accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'noneligible Bruce session accepted' THEN RAISE; END IF;
  END;

  SELECT * INTO v_partner FROM public.issue_partner_entitlement(
    p_partner_program_id => v_program, p_customer_id => v_customer, p_venue_id => v_venue,
    p_activity_session_id => v_session, p_service_date => current_date,
    p_external_reference => 'bruce-booking-fixture-1'
  );
  IF v_partner.funding_type <> 'partner_funded' OR v_partner.funder <> 'partner'
     OR v_partner.consumption_trigger <> 'on_checkin'
     OR v_partner.no_show_policy <> 'do_not_consume'
     OR v_partner.occurrence_origin <> 'paid'
     OR v_partner.access_reason <> 'Ingår via Bruce'
     OR v_partner.uses_limit <> 1 OR v_partner.uses_count <> 0 THEN
    RAISE EXCEPTION 'partner-funded entitlement shape failed';
  END IF;

  -- Issuance, registration intent and no-show do not consume. Actual check-in is canonical timing.
  SELECT * INTO v_no_show FROM public.issue_partner_entitlement(
    p_partner_program_id => v_program, p_customer_id => v_other_customer, p_venue_id => v_venue,
    p_activity_session_id => v_session, p_service_date => current_date,
    p_external_reference => 'bruce-no-show-fixture'
  );
  IF v_no_show.uses_count <> 0 OR EXISTS (
    SELECT 1 FROM public.partner_receivable_events WHERE partner_program_id = v_program
  ) THEN RAISE EXCEPTION 'issuance/no-show created consumption or receivable'; END IF;

  SELECT public.check_in_with_entitlement(
    p_entitlement_id => v_partner.id, p_customer_id => v_customer, p_venue_id => v_venue,
    p_entry_type => 'partner_access', p_session_date => current_date,
    p_activity_session_id => v_session
  ) INTO v_checkin;
  SELECT public.check_in_with_entitlement(
    p_entitlement_id => v_partner.id, p_customer_id => v_customer, p_venue_id => v_venue,
    p_entry_type => 'partner_access', p_session_date => current_date,
    p_activity_session_id => v_session
  ) INTO v_checkin_retry;
  IF (v_checkin->>'already_checked_in')::boolean OR NOT (v_checkin_retry->>'already_checked_in')::boolean
     OR (SELECT count(*) FROM public.venue_checkins WHERE entitlement_id = v_partner.id) <> 1
     OR (SELECT count(*) FROM public.entitlement_consumptions WHERE entitlement_id = v_partner.id AND event_type = 'use') <> 1
     OR (SELECT count(*) FROM public.partner_receivable_events WHERE partner_program_id = v_program AND event_type = 'accrued') <> 1
     OR (SELECT amount_minor FROM public.partner_receivable_events WHERE partner_program_id = v_program AND event_type = 'accrued') <> 12500 THEN
    RAISE EXCEPTION 'partner check-in/receivable idempotency failed';
  END IF;
  SELECT id INTO v_consumption FROM public.entitlement_consumptions
  WHERE entitlement_id = v_partner.id AND event_type = 'use';
  UPDATE public.partner_programs
  SET reimbursement_amount_minor = 99900,
      agreement_version = 'bruce-v2',
      agreement_effective_date = current_date + 1
  WHERE id = v_program;
  IF (SELECT reimbursement_rate_minor FROM public.entitlement_consumptions WHERE id = v_consumption) <> 12500
     OR (SELECT reimbursement_agreement_version FROM public.entitlement_consumptions WHERE id = v_consumption) <> 'bruce-v1'
     OR (SELECT reimbursement_effective_date FROM public.entitlement_consumptions WHERE id = v_consumption) <> current_date
     OR (SELECT partner_reference FROM public.entitlement_consumptions WHERE id = v_consumption) <> 'bruce-fixture-contract' THEN
    RAISE EXCEPTION 'partner reimbursement snapshot changed with agreement';
  END IF;
  PERFORM public.reverse_entitlement_consumption(
    v_consumption, 'partner-reversal-1', 'Attendance corrected', now(),
    'ef200000-0000-4000-8000-000000000001'
  );
  IF (SELECT count(*) FROM public.partner_receivable_events WHERE partner_program_id = v_program AND event_type = 'reversal') <> 1
     OR (SELECT uses_count FROM public.access_entitlements WHERE id = v_partner.id) <> 0 THEN
    RAISE EXCEPTION 'partner reversal did not restore access and reverse receivable';
  END IF;
  BEGIN
    DELETE FROM public.partner_receivable_events WHERE partner_program_id = v_program;
    RAISE EXCEPTION 'partner receivable delete accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'partner receivable delete accepted' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
