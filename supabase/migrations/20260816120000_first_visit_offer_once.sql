-- Prova-på is the customer's first committed ordinary activity participation,
-- irrespective of funding. A reservation and a completed redemption are both
-- customer-wide across Pickla venues.

CREATE OR REPLACE FUNCTION public.first_visit_offer_eligibility(
  p_customer_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  has_committed_participation BOOLEAN,
  has_completed_redemption BOOLEAN,
  has_active_reservation BOOLEAN,
  eligible BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.session_registrations registration
    JOIN public.activity_sessions session ON session.id = registration.activity_session_id
    WHERE registration.status IN ('confirmed', 'checked_in', 'no_show', 'cancelled')
      AND COALESCE(
        NULLIF(registration.metadata->>'purchase_kind', ''),
        CASE WHEN session.session_type = 'course' THEN 'course' ELSE 'activity_ticket' END
      ) IN ('activity_ticket', 'day_pass')
      AND (
        (p_customer_id IS NOT NULL AND registration.customer_id = p_customer_id)
        OR (p_user_id IS NOT NULL AND registration.user_id = p_user_id)
      )
  ) INTO has_committed_participation;

  SELECT EXISTS (
    SELECT 1
    FROM public.session_registrations registration
    WHERE registration.metadata->>'pricing_reason' = 'first_visit_offer'
      AND (
        (p_customer_id IS NOT NULL AND registration.customer_id = p_customer_id)
        OR (p_user_id IS NOT NULL AND registration.user_id = p_user_id)
      )
  ) INTO has_completed_redemption;

  SELECT EXISTS (
    SELECT 1
    FROM public.capacity_holds hold
    WHERE hold.status = 'active'
      -- Once a Stripe Checkout Session is attached, fail closed until Stripe's
      -- completed/expired webhook resolves the reservation. This prevents a
      -- delayed payment webhook from racing a locally expired reservation.
      AND (hold.expires_at > now() OR hold.stripe_session_id IS NOT NULL)
      AND hold.metadata->>'applied_price_type' = 'first_visit_offer'
      AND (
        (p_customer_id IS NOT NULL AND hold.customer_id = p_customer_id)
        OR (p_user_id IS NOT NULL AND hold.user_id = p_user_id)
      )
  ) INTO has_active_reservation;

  eligible := NOT has_committed_participation
    AND NOT has_completed_redemption
    AND NOT has_active_reservation;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.first_visit_offer_eligibility(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_visit_offer_eligibility(UUID, UUID)
  TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capacity_holds_one_active_first_visit_per_customer
  ON public.capacity_holds (customer_id)
  WHERE customer_id IS NOT NULL
    AND status = 'active'
    AND metadata->>'applied_price_type' = 'first_visit_offer';

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_registrations_one_first_visit_per_customer
  ON public.session_registrations (customer_id)
  WHERE customer_id IS NOT NULL
    AND metadata->>'pricing_reason' = 'first_visit_offer';

CREATE OR REPLACE FUNCTION public.acquire_first_visit_activity_pricing_hold(
  p_venue_id UUID,
  p_activity_session_id UUID,
  p_session_date DATE,
  p_user_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_regular_price_minor INTEGER DEFAULT 0,
  p_regular_price_type TEXT DEFAULT 'regular_price',
  p_quoted_price_minor INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS TABLE (
  ok BOOLEAN,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT,
  applied_price_type TEXT,
  final_price_minor INTEGER,
  early_bird_remaining INTEGER,
  quote_changed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_eligibility RECORD;
  v_price_minor INTEGER := GREATEST(COALESCE(p_regular_price_minor, 0), 0);
  v_price_type TEXT := COALESCE(NULLIF(BTRIM(p_regular_price_type), ''), 'regular_price');
  v_first_visit_price_minor INTEGER;
BEGIN
  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE id = p_activity_session_id
    AND venue_id = p_venue_id;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'activity_session_not_found'; END IF;

  v_first_visit_price_minor := v_session.first_visit_price_minor;
  IF p_customer_id IS NOT NULL
    AND v_session.first_visit_offer_enabled = true
    AND v_session.first_visit_only = true
    AND v_first_visit_price_minor = 9900
    AND COALESCE(p_metadata->>'purchase_kind', 'activity_ticket') = 'activity_ticket'
    AND v_price_minor > v_first_visit_price_minor THEN
    -- Serializes the one customer across all venues and all Prova-på Sessions.
    PERFORM pg_advisory_xact_lock(hashtextextended('first_visit_offer:' || p_customer_id::TEXT, 0));

    UPDATE public.capacity_holds
    SET status = 'expired',
        released_at = COALESCE(released_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('release_reason', 'first_visit_reservation_expired')
    WHERE customer_id = p_customer_id
      AND status = 'active'
      AND expires_at <= now()
      -- Unattached reservations can expire locally. Attached Stripe Sessions
      -- are released only by checkout.session.expired (or committed by payment).
      AND stripe_session_id IS NULL
      AND metadata->>'applied_price_type' = 'first_visit_offer';

    SELECT * INTO v_eligibility
    FROM public.first_visit_offer_eligibility(p_customer_id, p_user_id);
    IF v_eligibility.eligible THEN
      v_price_minor := v_first_visit_price_minor;
      v_price_type := 'first_visit_offer';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.acquire_activity_pricing_hold(
    p_venue_id => p_venue_id,
    p_activity_session_id => p_activity_session_id,
    p_session_date => p_session_date,
    p_user_id => p_user_id,
    p_customer_id => p_customer_id,
    p_source_type => p_source_type,
    p_source_id => p_source_id,
    p_idempotency_key => p_idempotency_key,
    p_regular_price_minor => v_price_minor,
    p_regular_price_type => v_price_type,
    p_quoted_price_minor => p_quoted_price_minor,
    p_metadata => p_metadata,
    p_ttl_seconds => p_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_first_visit_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_first_visit_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.first_visit_offer_eligibility(UUID, UUID) IS
  'Customer-wide Prova-på eligibility from committed activity registrations, completed redemption, and active reservation; never inferred from payment alone.';
COMMENT ON FUNCTION public.acquire_first_visit_activity_pricing_hold(
  UUID, UUID, DATE, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) IS 'Atomically awards at most one customer-wide Prova-på reservation before delegating capacity and Early Bird precedence to the canonical activity hold.';
COMMENT ON COLUMN public.activity_sessions.first_visit_only IS
  'V1 is always limited to customers without prior committed relevant activity participation or a prior/active Prova-på redemption.';
