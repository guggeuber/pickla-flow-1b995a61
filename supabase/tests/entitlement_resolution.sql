\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
(
  'ef100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'entitlement-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
),
(
  'ef100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'entitlement-other@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

DO $$
DECLARE
  v_org UUID;
  v_venue UUID := 'ef100000-0000-4000-8000-000000000010';
  v_other_venue UUID := 'ef100000-0000-4000-8000-000000000011';
  v_session UUID := 'ef100000-0000-4000-8000-000000000020';
  v_other_session UUID := 'ef100000-0000-4000-8000-000000000021';
  v_customer UUID;
  v_other_customer UUID;
  v_entitlement public.access_entitlements;
  v_result JSONB;
  v_at TIMESTAMPTZ := '2026-08-06T10:00:00Z';
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  INSERT INTO public.venues (id, organization_id, name, slug, timezone)
  VALUES
    (v_venue, v_org, 'Entitlement Resolver Venue', 'entitlement-resolver-venue', 'Europe/Stockholm'),
    (v_other_venue, v_org, 'Entitlement Other Venue', 'entitlement-other-venue', 'Europe/Stockholm');
  SELECT id INTO v_customer FROM public.customers
  WHERE auth_user_id = 'ef100000-0000-4000-8000-000000000001';
  UPDATE public.customers
  SET organization_id = v_org, display_name = 'Resolver Owner', status = 'active'
  WHERE id = v_customer;
  SELECT id INTO v_other_customer FROM public.customers
  WHERE auth_user_id = 'ef100000-0000-4000-8000-000000000002';
  UPDATE public.customers
  SET organization_id = v_org, display_name = 'Resolver Other', status = 'active'
  WHERE id = v_other_customer;
  INSERT INTO public.activity_sessions (
    id, venue_id, name, session_type, session_date, start_time, end_time, price_sek, product_key
  ) VALUES
    (v_session, v_venue, 'Resolver Open Play', 'open_play', '2026-08-06', '10:00', '12:00', 165, 'open_play_slot'),
    (v_other_session, v_other_venue, 'Other Open Play', 'open_play', '2026-08-06', '10:00', '12:00', 165, 'open_play_slot');

  -- Exact-session access returns explicit zero-price provenance.
  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => v_customer, p_venue_id => v_venue,
    p_entitlement_type => 'session_ticket', p_scope_type => 'exact_session',
    p_meter_type => 'exact_session', p_funding_type => 'commerce_purchase', p_funder => 'self_prepaid',
    p_resolution_priority => 10, p_occurrence_origin => 'paid',
    p_access_reason => 'Personlig plats', p_activity_session_id => v_session,
    p_service_date => '2026-08-06', p_session_date => '2026-08-06',
    p_uses_limit => 1, p_issuance_key => 'resolver-exact'
  );
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue, p_customer_id => v_customer,
    p_activity_session_id => v_session, p_service_date => '2026-08-06', p_at => v_at
  ) INTO v_result;
  IF NOT (v_result->>'covered')::boolean
     OR v_result->>'status' <> 'covered'
     OR v_result->>'entitlement_id' <> v_entitlement.id::text
     OR v_result->>'meter_type' <> 'exact_session'
     OR v_result->>'pricing_consequence' <> 'included' THEN
    RAISE EXCEPTION 'exact-session resolver contract failed: %', v_result;
  END IF;

  SELECT public.resolve_access_entitlement(
    p_venue_id => v_other_venue, p_customer_id => v_customer,
    p_activity_session_id => v_other_session, p_service_date => '2026-08-06', p_at => v_at
  ) INTO v_result;
  IF v_result->>'status' <> 'wrong_scope' OR (v_result->>'covered')::boolean THEN
    RAISE EXCEPTION 'wrong venue/session was covered: %', v_result;
  END IF;

  -- Each rejection fixture uses a separate customer so precedence cannot mask the result.
  INSERT INTO public.customers (id, organization_id, display_name, status)
  SELECT id, v_org, label, 'active'
  FROM (VALUES
    ('ef100000-0000-4000-8000-000000000032'::uuid, 'Not Yet'),
    ('ef100000-0000-4000-8000-000000000033'::uuid, 'Expired'),
    ('ef100000-0000-4000-8000-000000000034'::uuid, 'Exhausted'),
    ('ef100000-0000-4000-8000-000000000035'::uuid, 'Revoked'),
    ('ef100000-0000-4000-8000-000000000036'::uuid, 'Manual Review'),
    ('ef100000-0000-4000-8000-000000000037'::uuid, 'Unlimited'),
    ('ef100000-0000-4000-8000-000000000038'::uuid, 'Occurrences'),
    ('ef100000-0000-4000-8000-000000000039'::uuid, 'Venue Local Day')
  ) fixture(id, label);

  PERFORM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000032', p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
    p_funding_type => 'subscription', p_funder => 'subscription', p_resolution_priority => 20,
    p_access_reason => 'Ingår i ditt medlemskap',
    p_starts_at => '2026-08-07T00:00:00Z', p_issuance_key => 'resolver-not-yet'
  );
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000032', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF v_result->>'status' <> 'not_yet_valid' THEN RAISE EXCEPTION 'not-yet-valid failed: %', v_result; END IF;

  PERFORM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000033', p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
    p_funding_type => 'subscription', p_funder => 'subscription', p_resolution_priority => 20,
    p_access_reason => 'Ingår i ditt medlemskap',
    p_expires_at => '2026-08-06T09:00:00Z', p_issuance_key => 'resolver-expired'
  );
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000033', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF v_result->>'status' <> 'expired' THEN RAISE EXCEPTION 'expired failed: %', v_result; END IF;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000034', p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play', p_meter_type => 'occurrences',
    p_funding_type => 'customer_prepaid', p_funder => 'self_prepaid', p_resolution_priority => 40,
    p_occurrence_origin => 'paid', p_access_reason => 'Klippkort · 0 gånger kvar',
    p_uses_limit => 1, p_issuance_key => 'resolver-exhausted'
  );
  UPDATE public.access_entitlements SET uses_count = 1, status = 'exhausted' WHERE id = v_entitlement.id;
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000034', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF v_result->>'status' <> 'exhausted' THEN RAISE EXCEPTION 'exhausted failed: %', v_result; END IF;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000035', p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
    p_funding_type => 'house_granted', p_funder => 'house_comped', p_resolution_priority => 20,
    p_access_reason => 'Founder', p_issuance_key => 'resolver-revoked'
  );
  UPDATE public.access_entitlements SET status = 'revoked' WHERE id = v_entitlement.id;
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000035', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF v_result->>'status' <> 'revoked' THEN RAISE EXCEPTION 'revoked failed: %', v_result; END IF;

  SELECT * INTO v_entitlement FROM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000036', p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
    p_funding_type => 'house_granted', p_funder => 'house_comped', p_resolution_priority => 20,
    p_access_reason => 'Manuell kontroll', p_issuance_key => 'resolver-suspended'
  );
  UPDATE public.access_entitlements SET status = 'suspended' WHERE id = v_entitlement.id;
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000036', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF v_result->>'status' <> 'manual_review_required' THEN RAISE EXCEPTION 'manual review failed: %', v_result; END IF;

  PERFORM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000037', p_venue_id => v_venue,
    p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
    p_funding_type => 'subscription', p_funder => 'subscription', p_resolution_priority => 20,
    p_access_reason => 'Ingår i ditt medlemskap', p_issuance_key => 'resolver-unlimited'
  );
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000037', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF NOT (v_result->>'covered')::boolean OR v_result->>'meter_type' <> 'unlimited' OR v_result ? 'remaining_uses' THEN
    RAISE EXCEPTION 'unlimited resolver failed: %', v_result;
  END IF;

  PERFORM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000038', p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play', p_meter_type => 'occurrences',
    p_funding_type => 'customer_prepaid', p_funder => 'self_prepaid', p_resolution_priority => 40,
    p_occurrence_origin => 'paid', p_access_reason => 'Klippkort · 4 gånger kvar',
    p_uses_limit => 4, p_issuance_key => 'resolver-occurrences'
  );
  SELECT public.resolve_access_entitlement(v_venue, 'ef100000-0000-4000-8000-000000000038', NULL, v_session, '2026-08-06', v_at)
  INTO v_result;
  IF NOT (v_result->>'covered')::boolean OR (v_result->>'remaining_uses')::integer <> 4 THEN
    RAISE EXCEPTION 'occurrences resolver failed: %', v_result;
  END IF;

  -- Callers can narrow the canonical resolver to a safe entitlement family
  -- without letting a higher-precedence exact ticket mask a punch/partner right.
  PERFORM public.issue_access_entitlement(
    p_customer_id => v_customer, p_venue_id => v_venue,
    p_entitlement_type => 'punch_card', p_scope_type => 'open_play', p_meter_type => 'occurrences',
    p_funding_type => 'customer_prepaid', p_funder => 'self_prepaid', p_resolution_priority => 40,
    p_occurrence_origin => 'paid', p_access_reason => 'Klippkort · 2 gånger kvar',
    p_uses_limit => 2, p_issuance_key => 'resolver-filtered-punch'
  );
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue, p_customer_id => v_customer,
    p_activity_session_id => v_session, p_service_date => '2026-08-06', p_at => v_at,
    p_access_context => '{"entitlement_types":["punch_card","partner_access"]}'::jsonb
  ) INTO v_result;
  IF NOT (v_result->>'covered')::boolean OR v_result->>'entitlement_type' <> 'punch_card'
     OR (v_result->>'remaining_uses')::integer <> 2 THEN
    RAISE EXCEPTION 'filtered resolver failed: %', v_result;
  END IF;

  PERFORM public.issue_access_entitlement(
    p_customer_id => 'ef100000-0000-4000-8000-000000000039', p_venue_id => v_venue,
    p_entitlement_type => 'day_access', p_scope_type => 'open_play', p_meter_type => 'valid_day',
    p_funding_type => 'commerce_purchase', p_funder => 'self_prepaid', p_resolution_priority => 30,
    p_access_reason => 'Heldagspass',
    p_service_date => '2026-08-07', p_issuance_key => 'resolver-local-day'
  );
  SELECT public.resolve_access_entitlement(
    p_venue_id => v_venue, p_customer_id => 'ef100000-0000-4000-8000-000000000039',
    p_activity_session_id => v_session, p_at => '2026-08-06T22:30:00Z'
  ) INTO v_result;
  IF NOT (v_result->>'covered')::boolean OR v_result->>'service_date' <> '2026-08-07' THEN
    RAISE EXCEPTION 'venue-local day boundary failed: %', v_result;
  END IF;

  -- Owner/user mismatch and cross-organization writes are rejected by the boundary trigger.
  BEGIN
    PERFORM public.issue_access_entitlement(
      p_customer_id => v_other_customer, p_venue_id => v_venue,
      p_entitlement_type => 'membership_access', p_scope_type => 'venue', p_meter_type => 'unlimited',
      p_funding_type => 'subscription', p_funder => 'subscription', p_resolution_priority => 20,
      p_access_reason => 'Mismatch',
      p_user_id => 'ef100000-0000-4000-8000-000000000001', p_issuance_key => 'resolver-user-mismatch'
    );
    RAISE EXCEPTION 'user/customer mismatch accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'user/customer mismatch accepted' THEN RAISE; END IF;
  END;
END $$;

-- Authenticated customers cannot grant, mutate or read private partner/import columns.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ef100000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.access_entitlements (venue_id, user_id, entitlement_type, status)
    VALUES ('ef100000-0000-4000-8000-000000000010', auth.uid(), 'day_access', 'active');
    RAISE EXCEPTION 'customer self-grant accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.access_entitlements SET uses_count = 0 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'customer balance mutation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM funding_counterparty_ref FROM public.access_entitlements WHERE user_id = auth.uid();
    RAISE EXCEPTION 'private funding reference was readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.access_entitlements) <> 2 THEN
    RAISE EXCEPTION 'owner-safe entitlement projection failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.access_entitlements
    WHERE user_id = 'ef100000-0000-4000-8000-000000000002'
  ) THEN RAISE EXCEPTION 'cross-customer RLS exposure'; END IF;
END $$;
RESET ROLE;

ROLLBACK;
