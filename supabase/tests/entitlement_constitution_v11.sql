\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_org UUID;
  v_venue UUID := 'ef110000-0000-4000-8000-000000000010';
  v_session UUID := 'ef110000-0000-4000-8000-000000000020';
  v_scope_customer UUID := 'ef110000-0000-4000-8000-000000000030';
  v_order_customer UUID := 'ef110000-0000-4000-8000-000000000031';
  v_policy_customer UUID := 'ef110000-0000-4000-8000-000000000032';
  v_structured public.access_entitlements;
  v_expected public.access_entitlements;
  v_policy public.access_entitlements;
  v_result JSONB;
  v_consumption JSONB;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.venues (id, organization_id, name, slug, timezone)
  VALUES (v_venue, v_org, 'Constitution v1.1 Venue', 'constitution-v11-venue', 'Europe/Stockholm');
  INSERT INTO public.customers (id, organization_id, display_name, status)
  VALUES
    (v_scope_customer, v_org, 'Structured Scope', 'active'),
    (v_order_customer, v_org, 'Property Order', 'active'),
    (v_policy_customer, v_org, 'Policy Model', 'active');
  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, session_date, start_time, end_time,
    price_sek, product_key
  ) VALUES (
    v_session, v_venue, 'Structured Open Play', 'open_play', current_date,
    '10:00', '12:00', 165, 'open_play_slot'
  );

  -- New canonical rows cannot omit funder even if funding_type is present.
  BEGIN
    INSERT INTO public.access_entitlements (
      organization_id, venue_id, customer_id, entitlement_type, status,
      model_version, scope_type, meter_type, funding_type, access_reason,
      resolution_priority
    ) VALUES (
      v_org, v_venue, v_scope_customer, 'membership_access', 'active', 2,
      'venue', 'unlimited', 'subscription', 'Invalid inferred funder', 20
    );
    RAISE EXCEPTION 'canonical entitlement accepted inferred/missing funder';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT * INTO v_structured FROM public.issue_access_entitlement(
    p_customer_id => v_scope_customer,
    p_venue_id => v_venue,
    p_entitlement_type => 'punch_card',
    p_scope_type => 'structured',
    p_meter_type => 'occurrences',
    p_funding_type => 'commerce_purchase',
    p_funder => 'self_prepaid',
    p_access_reason => 'Klippkort · 3 gånger kvar',
    p_resolution_priority => 40,
    p_occurrence_origin => 'promotional',
    p_uses_limit => 3,
    p_issuance_key => 'v11-structured',
    p_scopes => jsonb_build_array(
      jsonb_build_object('scope_kind', 'brand'),
      jsonb_build_object('scope_kind', 'venue', 'venue_id', v_venue),
      jsonb_build_object(
        'scope_kind', 'activity_format', 'scope_value', 'open_play',
        'valid_from', now() - interval '1 day', 'valid_until', now() + interval '1 day'
      ),
      jsonb_build_object('scope_kind', 'channel', 'scope_value', 'online')
    )
  );
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue,
    p_customer_id => v_scope_customer,
    p_activity_session_id => v_session,
    p_service_date => current_date,
    p_at => now(),
    p_access_context => '{"channel":"online"}'::jsonb
  ) INTO v_result;
  IF NOT (v_result->>'covered')::boolean
     OR v_result->>'entitlement_id' <> v_structured.id::text
     OR v_result->>'funder' <> 'self_prepaid'
     OR v_result->>'consumption_trigger' <> 'on_checkin'
     OR v_result->>'no_show_policy' <> 'do_not_consume'
     OR v_result->>'occurrence_origin' <> 'promotional' THEN
    RAISE EXCEPTION 'structured canonical scope failed: %', v_result;
  END IF;
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue,
    p_customer_id => v_scope_customer,
    p_activity_session_id => v_session,
    p_service_date => current_date,
    p_at => now(),
    p_access_context => '{"channel":"desk"}'::jsonb
  ) INTO v_result;
  IF (v_result->>'covered')::boolean OR v_result->>'status' <> 'wrong_scope' THEN
    RAISE EXCEPTION 'structured channel boundary failed: %', v_result;
  END IF;
  SELECT public.consume_access_entitlement(
    p_entitlement_id => v_structured.id,
    p_customer_id => v_scope_customer,
    p_venue_id => v_venue,
    p_idempotency_key => 'v11-structured-consumption',
    p_activity_session_id => v_session,
    p_session_date => current_date,
    p_access_context => '{"channel":"online"}'::jsonb
  ) INTO v_consumption;
  IF (v_consumption->>'remaining_uses')::integer <> 2
     OR (SELECT entitlement_funder FROM public.entitlement_consumptions
         WHERE id = (v_consumption->>'consumption_id')::uuid) <> 'self_prepaid' THEN
    RAISE EXCEPTION 'structured scope consumption failed: %', v_consumption;
  END IF;

  -- Future ordering knobs are data properties. Defaults above keep production
  -- ordering unchanged; explicitly configured rows can express the future law.
  PERFORM public.issue_access_entitlement(
    p_customer_id => v_order_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play',
    p_meter_type => 'occurrences', p_funding_type => 'commerce_purchase',
    p_funder => 'self_prepaid', p_access_reason => 'Scarce promotional',
    p_resolution_priority => 40, p_occurrence_origin => 'promotional',
    p_uses_limit => 1, p_scarcity_class => 'scarce',
    p_resolution_origin_priority => 0,
    p_resolution_expiry_at => now() + interval '1 hour', p_issuance_key => 'v11-order-scarce'
  );
  PERFORM public.issue_access_entitlement(
    p_customer_id => v_order_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play',
    p_meter_type => 'occurrences', p_funding_type => 'commerce_purchase',
    p_funder => 'self_prepaid', p_access_reason => 'Non-scarce paid',
    p_resolution_priority => 40, p_occurrence_origin => 'paid',
    p_uses_limit => 1, p_scarcity_class => 'non_scarce',
    p_resolution_origin_priority => 1,
    p_resolution_expiry_at => now() + interval '1 hour', p_issuance_key => 'v11-order-paid'
  );
  PERFORM public.issue_access_entitlement(
    p_customer_id => v_order_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play',
    p_meter_type => 'occurrences', p_funding_type => 'commerce_purchase',
    p_funder => 'self_prepaid', p_access_reason => 'Non-scarce promotional later',
    p_resolution_priority => 40, p_occurrence_origin => 'promotional',
    p_uses_limit => 1, p_scarcity_class => 'non_scarce',
    p_resolution_origin_priority => 0,
    p_resolution_expiry_at => now() + interval '2 days', p_issuance_key => 'v11-order-promo-late'
  );
  SELECT * INTO v_expected FROM public.issue_access_entitlement(
    p_customer_id => v_order_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play',
    p_meter_type => 'occurrences', p_funding_type => 'commerce_purchase',
    p_funder => 'self_prepaid', p_access_reason => 'Non-scarce promotional earliest',
    p_resolution_priority => 40, p_occurrence_origin => 'promotional',
    p_uses_limit => 1, p_scarcity_class => 'non_scarce',
    p_resolution_origin_priority => 0,
    p_resolution_expiry_at => now() + interval '1 day', p_issuance_key => 'v11-order-promo-early'
  );
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue, p_customer_id => v_order_customer,
    p_activity_session_id => v_session, p_service_date => current_date, p_at => now()
  ) INTO v_result;
  IF v_result->>'entitlement_id' <> v_expected.id::text THEN
    RAISE EXCEPTION 'property-driven future ordering failed: %', v_result;
  END IF;

  -- Alternative trigger/no-show values are modeled but do not run themselves.
  SELECT * INTO v_policy FROM public.issue_access_entitlement(
    p_customer_id => v_policy_customer, p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue',
    p_meter_type => 'unlimited', p_funding_type => 'subscription',
    p_funder => 'employer', p_access_reason => 'Employer benefit',
    p_resolution_priority => 20, p_consumption_trigger => 'on_commitment',
    p_no_show_policy => 'manual_review', p_issuance_key => 'v11-policy-model'
  );
  IF v_policy.consumption_trigger <> 'on_commitment'
     OR v_policy.no_show_policy <> 'manual_review'
     OR EXISTS (SELECT 1 FROM public.entitlement_consumptions WHERE entitlement_id = v_policy.id) THEN
    RAISE EXCEPTION 'policy model changed runtime behavior';
  END IF;
END $$;

ROLLBACK;
