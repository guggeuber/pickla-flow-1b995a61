-- Commerce R2A refund truth repair.
--
-- Stripe can report a Refund as succeeded and later transition the same
-- provider object to failed. Preserve the earlier observation and append an
-- explicit financial compensation; never infer or mutate physical return,
-- pickup, allocation, disposition, or inventory truth here.

ALTER TABLE public.commerce_refunds
  ADD COLUMN IF NOT EXISTS provider_succeeded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_monitor_until TIMESTAMPTZ;

-- Existing succeeded refunds predate the monitoring contract. Schedule them
-- once so a missed failure webhook can converge through provider retrieval.
UPDATE public.commerce_refunds
SET provider_succeeded_at = COALESCE(provider_succeeded_at, completed_at, updated_at),
    provider_monitor_until = COALESCE(provider_monitor_until, now() + interval '30 days'),
    recovery_after = now()
WHERE status = 'succeeded'
  AND refund_type <> 'external_unallocated'
  AND provider_refund_id IS NOT NULL;

DROP INDEX IF EXISTS public.commerce_refunds_recovery_idx;
CREATE INDEX commerce_refunds_recovery_idx
  ON public.commerce_refunds (recovery_after, created_at)
  WHERE status IN ('preparing', 'pending', 'attention', 'succeeded');

-- One actionable incident per provider refund failure, even under duplicate or
-- concurrent webhook/recovery delivery.
CREATE UNIQUE INDEX IF NOT EXISTS ops_incidents_commerce_refund_failure_once
  ON public.ops_incidents ((metadata->>'commerce_refund_id'))
  WHERE metadata->>'incident_type' = 'commerce_refund_provider_failed';

CREATE OR REPLACE FUNCTION public.commerce_r2a_claim_recovery_refunds(
  p_limit INTEGER,
  p_lease_seconds INTEGER,
  p_lease_token UUID
) RETURNS SETOF public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.commerce_refunds
    WHERE (
        status IN ('preparing', 'pending', 'attention')
        OR (
          status = 'succeeded'
          AND refund_type <> 'external_unallocated'
          AND provider_refund_id IS NOT NULL
          AND provider_monitor_until > now()
        )
      )
      AND recovery_after <= now()
      AND (recovery_lease_expires_at IS NULL OR recovery_lease_expires_at <= now())
    ORDER BY recovery_after, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.commerce_refunds refund SET
    recovery_lease_token = p_lease_token,
    recovery_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 15), 300)),
    recovery_attempts = refund.recovery_attempts + 1
  FROM candidates
  WHERE refund.id = candidates.id
  RETURNING refund.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_r2a_reconcile_refund(
  p_refund_id UUID,
  p_provider_refund_id TEXT,
  p_provider_status TEXT,
  p_provider_response JSONB,
  p_error TEXT DEFAULT NULL
) RETURNS public.commerce_refunds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_refund public.commerce_refunds%ROWTYPE;
  v_before public.commerce_refunds%ROWTYPE;
  v_order public.commerce_orders%ROWTYPE;
  v_receipt_number TEXT;
  v_succeeded_amount INTEGER := 0;
  v_financial_state TEXT;
  v_had_refund_effect BOOLEAN := false;
  v_compensation_inserted BOOLEAN := false;
BEGIN
  SELECT * INTO v_refund
  FROM public.commerce_refunds
  WHERE id = p_refund_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF p_provider_status NOT IN ('pending', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_refund_status';
  END IF;
  IF NULLIF(btrim(COALESCE(p_provider_refund_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'provider_refund_id_required';
  END IF;
  IF v_refund.provider_refund_id IS NOT NULL
    AND v_refund.provider_refund_id <> p_provider_refund_id THEN
    RAISE EXCEPTION 'provider_refund_identity_mismatch';
  END IF;

  -- Stripe failure/cancellation is terminal for this immutable Refund object.
  -- Ignore stale success/pending snapshots that arrive out of order afterward.
  IF v_refund.status = 'failed' THEN RETURN v_refund; END IF;
  IF v_refund.status = 'succeeded' AND p_provider_status <> 'failed' THEN
    RETURN v_refund;
  END IF;

  -- Duplicate same-state events carry no new business effect. stripe_events
  -- remains the immutable delivery audit for every provider event ID.
  IF v_refund.status = p_provider_status THEN RETURN v_refund; END IF;

  v_before := v_refund;
  SELECT * INTO v_order
  FROM public.commerce_orders
  WHERE id = v_refund.commerce_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commerce_order_not_found'; END IF;

  UPDATE public.commerce_refunds SET
    provider_refund_id = COALESCE(provider_refund_id, p_provider_refund_id),
    status = p_provider_status,
    provider_response = COALESCE(p_provider_response, '{}'::JSONB),
    last_error = CASE
      WHEN p_provider_status = 'failed' THEN COALESCE(NULLIF(left(p_error, 1000), ''), 'Stripe refund failed')
      ELSE NULL
    END,
    provider_succeeded_at = CASE
      WHEN p_provider_status = 'succeeded' THEN COALESCE(provider_succeeded_at, now())
      ELSE provider_succeeded_at
    END,
    provider_failed_at = CASE
      WHEN p_provider_status = 'failed' THEN COALESCE(provider_failed_at, now())
      ELSE provider_failed_at
    END,
    provider_monitor_until = CASE
      WHEN p_provider_status = 'succeeded' THEN COALESCE(provider_monitor_until, now() + interval '30 days')
      WHEN p_provider_status = 'failed' THEN NULL
      ELSE provider_monitor_until
    END,
    recovery_after = CASE
      WHEN p_provider_status IN ('pending', 'succeeded') THEN now() + interval '5 minutes'
      ELSE now() + interval '1 day'
    END,
    completed_at = CASE
      WHEN p_provider_status IN ('succeeded', 'failed') THEN now()
      ELSE completed_at
    END
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  SELECT receipt_number INTO v_receipt_number
  FROM public.booking_receipts
  WHERE id = v_order.booking_receipt_id;

  IF p_provider_status = 'succeeded' THEN
    INSERT INTO public.ledger_entries (
      venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
      customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
      payment_method, receipt_number, booking_receipt_id, commerce_order_id, metadata
    ) VALUES (
      v_order.venue_id, v_order.customer_id, 'commerce_refund', v_refund.id::TEXT,
      (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), v_order.guest_name,
      v_refund.amount_inc_vat_minor, v_refund.vat_amount_minor, 'refunded', 'stripe',
      v_receipt_number, v_order.booking_receipt_id, v_order.id,
      jsonb_build_object(
        'commerce_refund_id', v_refund.id,
        'stripe_refund_id', p_provider_refund_id,
        'refund_type', v_refund.refund_type,
        'unallocated_amount_minor', v_refund.unallocated_amount_minor,
        'financial_direction', 'refund'
      )
    ) ON CONFLICT (source_type, source_id) DO NOTHING;
  ELSIF p_provider_status = 'failed' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ledger_entries
      WHERE source_type = 'commerce_refund' AND source_id = v_refund.id::TEXT
    ) INTO v_had_refund_effect;

    IF v_had_refund_effect THEN
      INSERT INTO public.ledger_entries (
        venue_id, customer_id, source_type, source_id, accounting_date, occurred_at,
        customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status,
        payment_method, receipt_number, booking_receipt_id, commerce_order_id, metadata
      ) VALUES (
        v_order.venue_id, v_order.customer_id, 'commerce_refund_reversal', v_refund.id::TEXT,
        (now() AT TIME ZONE 'Europe/Stockholm')::DATE, now(), v_order.guest_name,
        v_refund.amount_inc_vat_minor, v_refund.vat_amount_minor, 'refund_reversed', 'stripe',
        v_receipt_number, v_order.booking_receipt_id, v_order.id,
        jsonb_build_object(
          'commerce_refund_id', v_refund.id,
          'stripe_refund_id', p_provider_refund_id,
          'reverses_source_type', 'commerce_refund',
          'reverses_source_id', v_refund.id::TEXT,
          'net_refund_delta_minor', -v_refund.amount_inc_vat_minor,
          'net_vat_refund_delta_minor', -v_refund.vat_amount_minor,
          'financial_direction', 'refund_reversal',
          'physical_truth_changed', false
        )
      ) ON CONFLICT (source_type, source_id) DO NOTHING
      RETURNING true INTO v_compensation_inserted;
    END IF;

    INSERT INTO public.ops_incidents (
      venue_id, severity, title, status, affected_route, affected_ids,
      impact, containment, verification, metadata
    ) VALUES (
      v_order.venue_id, 'P2', 'Stripe refund failed after Pickla processing', 'open',
      '/admin', v_refund.id::TEXT,
      'Provider refund is failed; Pickla financial truth was reconciled and customer reimbursement requires attention.',
      'Do not alter pickup, return, disposition, allocation, or inventory truth. Resolve the customer financial obligation separately.',
      'Confirm provider refund status and any replacement reimbursement before resolving.',
      jsonb_build_object(
        'incident_type', 'commerce_refund_provider_failed',
        'commerce_refund_id', v_refund.id,
        'commerce_order_id', v_order.id,
        'stripe_refund_id', p_provider_refund_id,
        'prior_status', v_before.status,
        'compensation_inserted', v_compensation_inserted,
        'physical_truth_changed', false
      )
    ) ON CONFLICT DO NOTHING;
  END IF;

  SELECT COALESCE(sum(amount_inc_vat_minor), 0)::INTEGER
  INTO v_succeeded_amount
  FROM public.commerce_refunds
  WHERE commerce_order_id = v_order.id AND status = 'succeeded';

  v_financial_state := CASE
    WHEN v_succeeded_amount >= v_order.total_inc_vat_minor THEN 'refunded'
    WHEN v_succeeded_amount > 0 THEN 'partially_refunded'
    ELSE 'paid'
  END;

  IF v_order.booking_receipt_id IS NOT NULL THEN
    UPDATE public.booking_receipts SET
      payment_status = v_financial_state,
      metadata = metadata || jsonb_build_object(
        'refund_financial_state', v_financial_state,
        'succeeded_refund_amount_minor', v_succeeded_amount,
        'refund_reconciled_at', now()
      ),
      updated_at = now()
    WHERE id = v_order.booking_receipt_id;
  END IF;

  UPDATE public.commerce_orders SET
    status = CASE
      WHEN v_succeeded_amount >= total_inc_vat_minor THEN 'cancelled'
      WHEN p_provider_status = 'failed' THEN 'attention'
      WHEN status = 'cancelled' THEN 'attention'
      ELSE status
    END,
    metadata = metadata || jsonb_build_object(
      'refund_financial_state', v_financial_state,
      'succeeded_refund_amount_minor', v_succeeded_amount,
      'refund_reconciled_at', now(),
      'refund_attention_required', p_provider_status = 'failed',
      'last_reconciled_refund_id', v_refund.id,
      'physical_truth_changed', false
    ) || CASE
      WHEN v_succeeded_amount >= total_inc_vat_minor
        THEN jsonb_build_object('fully_refunded_at', COALESCE(metadata->'fully_refunded_at', to_jsonb(now())))
      ELSE '{}'::JSONB
    END
  WHERE id = v_order.id;

  INSERT INTO public.audit_log (
    organization_id, franchisee_id, venue_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_order.organization_id, v_order.seller_franchisee_id, v_order.venue_id,
    'webhook',
    CASE p_provider_status
      WHEN 'succeeded' THEN 'commerce.refund.provider_succeeded'
      WHEN 'failed' THEN 'commerce.refund.provider_failed'
      ELSE 'commerce.refund.provider_pending'
    END,
    'commerce_refunds', v_refund.id::TEXT,
    'provider-refund:' || p_provider_refund_id || ':' || p_provider_status,
    to_jsonb(v_before), to_jsonb(v_refund),
    jsonb_build_object(
      'prior_status', v_before.status,
      'provider_status', p_provider_status,
      'compensation_inserted', v_compensation_inserted,
      'succeeded_refund_amount_minor', v_succeeded_amount,
      'receipt_financial_state', v_financial_state,
      'physical_truth_changed', false
    )
  );

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_r2a_claim_recovery_refunds(INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_r2a_claim_recovery_refunds(INTEGER, INTEGER, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

COMMENT ON COLUMN public.commerce_refunds.provider_monitor_until IS
  'Bounded provider-retrieval backstop after an initially succeeded Stripe refund; webhooks remain authoritative after this window.';
COMMENT ON FUNCTION public.commerce_r2a_reconcile_refund(UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Converges Stripe refund truth, appends exactly-once financial compensation for succeeded-to-failed, and never mutates physical fulfillment or inventory.';
