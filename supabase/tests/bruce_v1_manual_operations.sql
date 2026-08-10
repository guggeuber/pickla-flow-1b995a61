\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'b7010000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'bruce-v1-operator@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

DO $$
DECLARE
  v_org UUID;
  v_venue UUID := 'b7010000-0000-4000-8000-000000000010';
  v_customer UUID := 'b7010000-0000-4000-8000-000000000020';
  v_session UUID := 'b7010000-0000-4000-8000-000000000030';
  v_program UUID;
  v_visit JSONB;
  v_retry JSONB;
  v_entitlement UUID;
  v_registration UUID;
  v_checkin JSONB;
  v_receivable UUID;
  v_settlement public.partner_receivable_settlement_events;
  v_settlement_retry public.partner_receivable_settlement_events;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.venues (id, organization_id, name, slug, timezone)
  VALUES (v_venue, v_org, 'Bruce V1 Operations Venue', 'bruce-v1-operations-venue', 'Europe/Stockholm');
  INSERT INTO public.customers (id, organization_id, display_name, first_name, last_name, primary_phone, phone_e164, status)
  VALUES (v_customer, v_org, 'Bruce Operator Fixture', 'Bruce', 'Fixture', '+46700000000', '+46700000000', 'active');
  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, session_date, start_time, end_time,
    price_sek, capacity, product_key, publish_status
  ) VALUES (
    v_session, v_venue, 'Bruce V1 Open Play', 'open_play', current_date,
    '10:00', '12:00', 165, 8, 'open_play_slot', 'published'
  );
  INSERT INTO public.partner_programs (
    organization_id, program_key, name, activity_label, access_reason, desk_label,
    funding_counterparty_ref, reimbursement_amount_minor, settlement_rule,
    agreement_version, agreement_effective_date, consumption_trigger,
    no_show_policy, created_by
  ) VALUES (
    v_org, 'bruce-v1-fixture', 'Bruce', 'Bruce gäller', 'Ingår via Bruce', 'Bruce',
    'real-contract-fixture', 12500, '{"version":"bruce-v1","basis":"attendance"}',
    'bruce-v1', current_date, 'on_checkin', 'do_not_consume',
    'b7010000-0000-4000-8000-000000000001'
  ) RETURNING id INTO v_program;

  INSERT INTO public.partner_program_sessions (
    partner_program_id, organization_id, venue_id, activity_session_id,
    status, allocated_capacity, created_by
  ) VALUES (
    v_program, v_org, v_venue, v_session, 'eligible', 4,
    'b7010000-0000-4000-8000-000000000001'
  );
  IF (SELECT publication_status FROM public.partner_program_sessions WHERE partner_program_id = v_program) <> 'needs_publication'
     OR (SELECT allocated_capacity FROM public.partner_program_sessions WHERE partner_program_id = v_program) <> 4 THEN
    RAISE EXCEPTION 'Bruce eligibility did not enter publication queue with allocation';
  END IF;

  BEGIN
    UPDATE public.partner_program_sessions SET allocated_capacity = 9 WHERE partner_program_id = v_program;
    RAISE EXCEPTION 'Bruce allocation above total capacity accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Bruce allocation above total capacity accepted' THEN RAISE; END IF;
  END;

  UPDATE public.partner_program_sessions
  SET publication_status = 'published', publication_updated_by = 'b7010000-0000-4000-8000-000000000001'
  WHERE partner_program_id = v_program;
  UPDATE public.activity_sessions SET name = 'Bruce V1 Open Play Updated' WHERE id = v_session;
  IF (SELECT publication_status FROM public.partner_program_sessions WHERE partner_program_id = v_program) <> 'changed' THEN
    RAISE EXCEPTION 'Published Bruce session did not become changed';
  END IF;
  UPDATE public.partner_program_sessions SET status = 'ineligible' WHERE partner_program_id = v_program;
  IF (SELECT publication_status FROM public.partner_program_sessions WHERE partner_program_id = v_program) <> 'removed' THEN
    RAISE EXCEPTION 'Disabled Bruce session did not become removed';
  END IF;
  UPDATE public.partner_program_sessions SET status = 'eligible' WHERE partner_program_id = v_program;
  IF (SELECT publication_status FROM public.partner_program_sessions WHERE partner_program_id = v_program) <> 'needs_publication' THEN
    RAISE EXCEPTION 'Re-enabled Bruce session did not re-enter publication queue';
  END IF;

  SELECT public.register_partner_visit(
    p_partner_program_id => v_program,
    p_customer_id => v_customer,
    p_venue_id => v_venue,
    p_activity_session_id => v_session,
    p_service_date => current_date,
    p_external_reference => NULL,
    p_operator_note => 'Verified visually in Bruce Studio',
    p_created_by => 'b7010000-0000-4000-8000-000000000001'
  ) INTO v_visit;
  SELECT public.register_partner_visit(
    p_partner_program_id => v_program,
    p_customer_id => v_customer,
    p_venue_id => v_venue,
    p_activity_session_id => v_session,
    p_service_date => current_date,
    p_external_reference => NULL,
    p_operator_note => 'Retry',
    p_created_by => 'b7010000-0000-4000-8000-000000000001'
  ) INTO v_retry;
  v_entitlement := (v_visit->>'entitlement_id')::uuid;
  v_registration := (v_visit->>'registration_id')::uuid;
  IF v_entitlement IS NULL OR v_registration IS NULL
     OR (v_retry->>'entitlement_id')::uuid <> v_entitlement
     OR (v_retry->>'registration_id')::uuid <> v_registration
     OR (SELECT count(*) FROM public.access_entitlements WHERE partner_program_id = v_program AND customer_id = v_customer) <> 1
     OR (SELECT count(*) FROM public.session_registrations WHERE source_type = 'partner_access' AND source_id = v_entitlement) <> 1
     OR (SELECT price_paid_sek FROM public.session_registrations WHERE id = v_registration) <> 0
     OR (SELECT stripe_session_id FROM public.session_registrations WHERE id = v_registration) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.entitlement_consumptions WHERE entitlement_id = v_entitlement)
     OR EXISTS (SELECT 1 FROM public.partner_receivable_events WHERE partner_program_id = v_program) THEN
    RAISE EXCEPTION 'Manual Bruce visit was not atomic, idempotent and payment-free';
  END IF;

  SELECT public.check_in_with_entitlement(
    p_entitlement_id => v_entitlement,
    p_customer_id => v_customer,
    p_venue_id => v_venue,
    p_entry_type => 'partner_access',
    p_session_date => current_date,
    p_activity_session_id => v_session
  ) INTO v_checkin;
  SELECT public.check_in_with_entitlement(
    p_entitlement_id => v_entitlement,
    p_customer_id => v_customer,
    p_venue_id => v_venue,
    p_entry_type => 'partner_access',
    p_session_date => current_date,
    p_activity_session_id => v_session
  ) INTO v_retry;
  IF (v_checkin->>'already_checked_in')::boolean
     OR NOT (v_retry->>'already_checked_in')::boolean
     OR (SELECT count(*) FROM public.entitlement_consumptions WHERE entitlement_id = v_entitlement AND event_type = 'use') <> 1
     OR (SELECT count(*) FROM public.partner_receivable_events WHERE partner_program_id = v_program AND event_type = 'accrued') <> 1 THEN
    RAISE EXCEPTION 'Bruce check-in did not create exactly one consumption and receivable';
  END IF;

  SELECT id INTO v_receivable FROM public.partner_receivable_events
  WHERE partner_program_id = v_program AND event_type = 'accrued';
  IF (SELECT reimbursement_rate_minor FROM public.entitlement_consumptions WHERE entitlement_id = v_entitlement AND event_type = 'use') <> 12500
     OR (SELECT reimbursement_agreement_version FROM public.entitlement_consumptions WHERE entitlement_id = v_entitlement AND event_type = 'use') <> 'bruce-v1'
     OR (SELECT reimbursement_effective_date FROM public.entitlement_consumptions WHERE entitlement_id = v_entitlement AND event_type = 'use') <> current_date THEN
    RAISE EXCEPTION 'Bruce reimbursement terms were not frozen at consumption';
  END IF;

  SELECT * INTO v_settlement FROM public.record_partner_receivable_settlement(
    v_receivable, 'settled', 'bruce-self-invoice-fixture', 'Manual V1 settlement',
    'settle-fixture-1', 'b7010000-0000-4000-8000-000000000001'
  );
  SELECT * INTO v_settlement_retry FROM public.record_partner_receivable_settlement(
    v_receivable, 'settled', 'bruce-self-invoice-fixture', 'Retry',
    'settle-fixture-1', 'b7010000-0000-4000-8000-000000000001'
  );
  IF v_settlement.id <> v_settlement_retry.id
     OR (SELECT count(*) FROM public.partner_receivable_settlement_events WHERE partner_receivable_event_id = v_receivable) <> 1 THEN
    RAISE EXCEPTION 'Manual settlement was not idempotent';
  END IF;
  BEGIN
    UPDATE public.partner_receivable_settlement_events SET note = 'Mutated' WHERE id = v_settlement.id;
    RAISE EXCEPTION 'Settlement history update accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Settlement history update accepted' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
