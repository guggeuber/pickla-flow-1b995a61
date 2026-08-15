\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug)
VALUES ('f1000000-0000-4000-8000-000000000001', 'First Visit Test', 'first-visit-test');

INSERT INTO public.venues (id, organization_id, name, slug)
VALUES
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'First Visit A', 'first-visit-a'),
  ('f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'First Visit B', 'first-visit-b');

INSERT INTO public.customers (id, organization_id, display_name)
VALUES
  ('f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000001', 'New Customer'),
  ('f1000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001', 'Founder Customer'),
  ('f1000000-0000-4000-8000-000000000012', 'f1000000-0000-4000-8000-000000000001', 'Pending Customer'),
  ('f1000000-0000-4000-8000-000000000013', 'f1000000-0000-4000-8000-000000000001', 'Course Customer'),
  ('f1000000-0000-4000-8000-000000000014', 'f1000000-0000-4000-8000-000000000001', 'Cancelled After Commitment'),
  ('f1000000-0000-4000-8000-000000000015', 'f1000000-0000-4000-8000-000000000001', 'Day Pass Participant');

INSERT INTO public.activity_sessions (
  id, venue_id, name, session_type, session_date, start_time, end_time,
  price_sek, capacity, publish_status, first_visit_offer_enabled,
  first_visit_price_minor, first_visit_only, closed_to_public
) VALUES
  ('f1000000-0000-4000-8000-000000000020', 'f1000000-0000-4000-8000-000000000002', 'Open Play A', 'open_play', '2026-09-01', '18:00', '20:00', 165, 8, 'published', true, 9900, true, false),
  ('f1000000-0000-4000-8000-000000000021', 'f1000000-0000-4000-8000-000000000003', 'Open Play B', 'open_play', '2026-09-02', '18:00', '20:00', 165, 8, 'published', true, 9900, true, false),
  ('f1000000-0000-4000-8000-000000000022', 'f1000000-0000-4000-8000-000000000002', 'Course occurrence', 'course', '2026-09-03', '18:00', '20:00', 0, 8, 'published', false, NULL, true, true);

-- Funding is irrelevant: a committed Founder-covered activity is prior participation.
INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, customer_id, status,
  price_paid_sek, source_type, metadata
) VALUES (
  'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-08-01',
  NULL, 'f1000000-0000-4000-8000-000000000011', 'confirmed', 0, 'access_entitlement',
  '{"purchase_kind":"activity_ticket","access_reason":"Founder"}'::jsonb
);

-- A pending/uncommitted attempt and Course participation are not ordinary
-- committed activity truth. A later cancellation does not erase an earlier
-- commitment; neither does Day Pass funding change the participation kind.
INSERT INTO public.session_registrations (
  venue_id, activity_session_id, session_date, user_id, customer_id, status,
  price_paid_sek, source_type, metadata
) VALUES
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-08-02', NULL, 'f1000000-0000-4000-8000-000000000012', 'pending', 0, 'commerce_order', '{"purchase_kind":"activity_ticket"}'),
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000022', '2026-09-03', NULL, 'f1000000-0000-4000-8000-000000000013', 'confirmed', 0, 'series_commitment', '{"purchase_kind":"course"}'),
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-08-03', NULL, 'f1000000-0000-4000-8000-000000000014', 'cancelled', 165, 'commerce_order', '{"purchase_kind":"activity_ticket","cancelled_after_commitment":true}'),
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-08-04', NULL, 'f1000000-0000-4000-8000-000000000015', 'confirmed', 0, 'day_access', '{"purchase_kind":"day_pass"}');

DO $$
DECLARE
  v_new RECORD;
  v_founder RECORD;
  v_pending RECORD;
  v_course RECORD;
  v_cancelled_after_commitment RECORD;
  v_day_pass RECORD;
BEGIN
  SELECT * INTO v_new FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000010', NULL);
  SELECT * INTO v_founder FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000011', NULL);
  SELECT * INTO v_pending FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000012', NULL);
  SELECT * INTO v_course FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000013', NULL);
  SELECT * INTO v_cancelled_after_commitment FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000014', NULL);
  SELECT * INTO v_day_pass FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000015', NULL);
  IF NOT v_new.eligible THEN RAISE EXCEPTION 'new customer rejected'; END IF;
  IF v_founder.eligible OR NOT v_founder.has_committed_participation THEN RAISE EXCEPTION 'Founder participation did not disqualify'; END IF;
  IF NOT v_pending.eligible THEN RAISE EXCEPTION 'pending uncommitted attempt disqualified'; END IF;
  IF NOT v_course.eligible THEN RAISE EXCEPTION 'Course participation incorrectly treated as ordinary activity'; END IF;
  IF v_cancelled_after_commitment.eligible THEN RAISE EXCEPTION 'later cancellation erased committed participation'; END IF;
  IF v_day_pass.eligible THEN RAISE EXCEPTION 'Day Pass-funded activity did not disqualify'; END IF;
END $$;

DO $$
DECLARE
  v_a RECORD;
  v_b RECORD;
  v_after_release RECORD;
  v_committed RECORD;
  v_retry RECORD;
  v_after_payment RECORD;
  v_state RECORD;
BEGIN
  SELECT * INTO v_a FROM public.acquire_first_visit_activity_pricing_hold(
    'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-09-01',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'commerce_order', 'f1000000-0000-4000-8000-000000000101',
    'first-visit-a', 16500, 'regular_price', 9900, '{"purchase_kind":"activity_ticket"}', 1920
  );
  IF NOT v_a.ok OR v_a.final_price_minor <> 9900 OR v_a.applied_price_type <> 'first_visit_offer' THEN
    RAISE EXCEPTION 'first reservation failed: %', row_to_json(v_a);
  END IF;

  SELECT * INTO v_b FROM public.acquire_first_visit_activity_pricing_hold(
    'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000021', '2026-09-02',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'commerce_order', 'f1000000-0000-4000-8000-000000000102',
    'first-visit-b', 16500, 'regular_price', 9900, '{"purchase_kind":"activity_ticket"}', 1920
  );
  IF v_b.final_price_minor <> 16500 OR v_b.applied_price_type <> 'regular_price' OR NOT v_b.quote_changed THEN
    RAISE EXCEPTION 'second venue received duplicate offer: %', row_to_json(v_b);
  END IF;
  PERFORM public.release_capacity_hold(v_b.hold_id, 'quote_changed');

  UPDATE public.capacity_holds SET expires_at = now() - interval '1 second' WHERE id = v_a.hold_id;
  SELECT * INTO v_after_release FROM public.acquire_first_visit_activity_pricing_hold(
    'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000021', '2026-09-02',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'commerce_order', 'f1000000-0000-4000-8000-000000000103',
    'first-visit-after-expiry', 16500, 'regular_price', 9900, '{"purchase_kind":"activity_ticket"}', 1920
  );
  IF v_after_release.final_price_minor <> 9900 OR v_after_release.applied_price_type <> 'first_visit_offer' THEN
    RAISE EXCEPTION 'expired reservation did not release: %', row_to_json(v_after_release);
  END IF;

  SELECT * INTO v_committed FROM public.commit_activity_registration_capacity(
    'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000021', '2026-09-02',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'confirmed', 99, 'cs_first_visit_once',
    'commerce_order', 'f1000000-0000-4000-8000-000000000103',
    '{"purchase_kind":"activity_ticket","pricing_reason":"first_visit_offer"}', v_after_release.hold_id
  );
  SELECT * INTO v_retry FROM public.commit_activity_registration_capacity(
    'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000021', '2026-09-02',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'confirmed', 99, 'cs_first_visit_once',
    'commerce_order', 'f1000000-0000-4000-8000-000000000103',
    '{"purchase_kind":"activity_ticket","pricing_reason":"first_visit_offer"}', v_after_release.hold_id
  );
  IF v_committed.registration_id IS NULL OR v_retry.registration_id <> v_committed.registration_id THEN
    RAISE EXCEPTION 'duplicate webhook/retry was not idempotent';
  END IF;

  SELECT * INTO v_state FROM public.first_visit_offer_eligibility('f1000000-0000-4000-8000-000000000010', NULL);
  IF v_state.eligible OR NOT v_state.has_completed_redemption OR NOT v_state.has_committed_participation THEN
    RAISE EXCEPTION 'successful purchase did not permanently consume offer: %', row_to_json(v_state);
  END IF;

  SELECT * INTO v_after_payment FROM public.acquire_first_visit_activity_pricing_hold(
    'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000020', '2026-09-01',
    NULL, 'f1000000-0000-4000-8000-000000000010', 'commerce_order', 'f1000000-0000-4000-8000-000000000104',
    'first-visit-after-payment', 16500, 'regular_price', 9900, '{"purchase_kind":"activity_ticket"}', 1920
  );
  IF v_after_payment.final_price_minor <> 16500 OR NOT v_after_payment.quote_changed THEN
    RAISE EXCEPTION 'completed redemption received another offer: %', row_to_json(v_after_payment);
  END IF;
END $$;

ROLLBACK;
