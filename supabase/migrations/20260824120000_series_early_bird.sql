-- Series Early Bird reuses the existing access_product scarcity fields and the
-- canonical capacity_holds table. No Series pricing columns or redemption
-- table are introduced. The first N rule counts only paid allocations where
-- Early Bird actually won; every Commitment/hold still counts toward capacity.

CREATE OR REPLACE FUNCTION public.series_early_bird_fill(
  p_venue_id UUID,
  p_activity_series_id UUID
)
RETURNS TABLE (committed_count INTEGER, active_holds_count INTEGER, fill_count INTEGER)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      SELECT COUNT(*)::INTEGER
      FROM public.series_commitments commitment
      JOIN public.commerce_order_lines line
        ON line.id = commitment.commerce_order_line_id
      WHERE commitment.venue_id = p_venue_id
        AND commitment.activity_series_id = p_activity_series_id
        AND commitment.commitment_type = 'participant'
        AND commitment.status = 'active'
        AND line.resolver_snapshot->>'pricing_reason' = 'early_bird'
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.capacity_holds hold
      WHERE hold.venue_id = p_venue_id
        AND hold.scope_type = 'activity_series'
        AND hold.scope_id = p_activity_series_id::TEXT
        AND hold.status = 'active'
        AND hold.expires_at > now()
        AND hold.metadata->>'applied_price_type' = 'early_bird'
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.series_commitments commitment
      JOIN public.commerce_order_lines line
        ON line.id = commitment.commerce_order_line_id
      WHERE commitment.venue_id = p_venue_id
        AND commitment.activity_series_id = p_activity_series_id
        AND commitment.commitment_type = 'participant'
        AND commitment.status = 'active'
        AND line.resolver_snapshot->>'pricing_reason' = 'early_bird'
    ) + (
      SELECT COUNT(*)::INTEGER
      FROM public.capacity_holds hold
      WHERE hold.venue_id = p_venue_id
        AND hold.scope_type = 'activity_series'
        AND hold.scope_id = p_activity_series_id::TEXT
        AND hold.status = 'active'
        AND hold.expires_at > now()
        AND hold.metadata->>'applied_price_type' = 'early_bird'
    );
$$;

CREATE OR REPLACE FUNCTION public.acquire_series_pricing_hold(
  p_venue_id UUID,
  p_activity_series_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_regular_price_minor INTEGER DEFAULT 0,
  p_regular_price_type TEXT DEFAULT 'series_product_base_price',
  p_quoted_price_minor INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
  ok BOOLEAN,
  hold_id UUID,
  available_count INTEGER,
  reason TEXT,
  applied_price_type TEXT,
  final_price_minor INTEGER,
  early_bird_remaining INTEGER,
  quote_changed BOOLEAN,
  series_fill_count INTEGER,
  early_bird_allocated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_product public.access_products%ROWTYPE;
  v_existing public.capacity_holds%ROWTYPE;
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_early_bird_committed INTEGER := 0;
  v_early_bird_holds INTEGER := 0;
  v_price_type TEXT := COALESCE(NULLIF(BTRIM(p_regular_price_type), ''), 'series_product_base_price');
  v_final_price_minor INTEGER := GREATEST(COALESCE(p_regular_price_minor, 0), 0);
  v_rule_active BOOLEAN := false;
BEGIN
  PERFORM public.capacity_lock_scope(
    p_venue_id,
    'activity_series',
    p_activity_series_id::TEXT,
    (SELECT start_date FROM public.activity_series WHERE id = p_activity_series_id AND venue_id = p_venue_id)
  );

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_activity_series_id
    AND venue_id = p_venue_id
  FOR UPDATE;
  IF v_series.id IS NULL OR v_series.start_date IS NULL THEN
    RAISE EXCEPTION 'activity_series_not_found';
  END IF;

  SELECT * INTO v_product
  FROM public.access_products
  WHERE id = v_series.access_product_id
    AND venue_id = p_venue_id
  FOR UPDATE;
  IF v_product.id IS NULL
    OR v_product.product_kind <> 'series_access'
    OR v_product.is_active IS DISTINCT FROM true
    OR v_product.status <> 'active' THEN
    RAISE EXCEPTION 'series_access_product_unavailable';
  END IF;

  v_rule_active := v_product.scarcity_mode = 'early_bird';
  IF v_rule_active AND (
    COALESCE(v_product.early_bird_price_minor, 0) <= 0
    OR COALESCE(v_product.early_bird_slots, 0) < 1
    OR v_product.early_bird_price_minor >= ROUND(COALESCE(v_product.base_price_sek, 0) * 100)::INTEGER
    OR (v_series.capacity IS NOT NULL AND v_product.early_bird_slots > v_series.capacity)
  ) THEN
    RAISE EXCEPTION 'series_early_bird_configuration_invalid';
  END IF;

  -- Unattached holds may expire locally. Stripe-attached holds are released by
  -- checkout.session.expired or committed by payment, preserving paid truth.
  UPDATE public.capacity_holds
  SET status = 'expired',
      released_at = COALESCE(released_at, now()),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('release_reason', 'lazy_expired_before_series_pricing_acquire')
  WHERE venue_id = p_venue_id
    AND scope_type = 'activity_series'
    AND scope_id = p_activity_series_id::TEXT
    AND session_date = v_series.start_date
    AND status = 'active'
    AND expires_at <= now()
    AND stripe_session_id IS NULL;

  SELECT * INTO v_existing
  FROM public.capacity_holds hold
  WHERE hold.venue_id = p_venue_id
    AND hold.scope_type = 'activity_series'
    AND hold.scope_id = p_activity_series_id::TEXT
    AND hold.session_date = v_series.start_date
    AND hold.status = 'active'
    AND hold.expires_at > now()
    AND (
      (NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NOT NULL
        AND hold.idempotency_key = NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''))
      OR (p_source_id IS NOT NULL AND hold.source_id = p_source_id)
    )
  ORDER BY hold.created_at DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    final_price_minor := COALESCE((v_existing.metadata->>'final_price_minor')::INTEGER, v_final_price_minor);
    applied_price_type := COALESCE(v_existing.metadata->>'applied_price_type', v_price_type);
    early_bird_remaining := NULLIF((v_existing.metadata->>'early_bird_remaining')::INTEGER, -1);
    series_fill_count := COALESCE((v_existing.metadata->>'series_fill_count')::INTEGER, 0);
    early_bird_allocated_count := COALESCE((v_existing.metadata->>'early_bird_allocated_count')::INTEGER, 0);
    available_count := CASE
      WHEN v_series.capacity IS NULL THEN NULL
      ELSE GREATEST(v_series.capacity - series_fill_count, 0)
    END;
    quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> final_price_minor;
    ok := true;
    hold_id := v_existing.id;
    reason := 'existing_hold';
    RETURN NEXT;
    RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(p_venue_id, 'activity_series', p_activity_series_id::TEXT, NULL);
  v_committed := public.capacity_committed_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.start_date);
  v_holds := public.capacity_active_holds_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.start_date);
  IF v_capacity IS NOT NULL AND (v_committed + v_holds) >= v_capacity THEN
    ok := false;
    hold_id := NULL;
    available_count := 0;
    reason := 'capacity_full';
    applied_price_type := v_price_type;
    final_price_minor := v_final_price_minor;
    early_bird_remaining := NULL;
    quote_changed := false;
    series_fill_count := v_committed + v_holds;
    early_bird_allocated_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_rule_active THEN
    SELECT fill.committed_count, fill.active_holds_count
    INTO v_early_bird_committed, v_early_bird_holds
    FROM public.series_early_bird_fill(p_venue_id, p_activity_series_id) fill;

    IF (v_early_bird_committed + v_early_bird_holds) < v_product.early_bird_slots
      AND v_final_price_minor > v_product.early_bird_price_minor THEN
      v_price_type := 'early_bird';
      v_final_price_minor := v_product.early_bird_price_minor;
    END IF;
  END IF;

  series_fill_count := v_committed + v_holds + 1;
  early_bird_allocated_count := v_early_bird_committed + v_early_bird_holds
    + CASE WHEN v_price_type = 'early_bird' THEN 1 ELSE 0 END;
  early_bird_remaining := CASE
    WHEN v_rule_active THEN GREATEST(v_product.early_bird_slots - early_bird_allocated_count, 0)
    ELSE NULL
  END;

  INSERT INTO public.capacity_holds (
    venue_id, scope_type, scope_id, session_date, user_id, customer_id,
    source_type, source_id, idempotency_key, expires_at, metadata
  ) VALUES (
    p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.start_date,
    p_user_id, p_customer_id, p_source_type, p_source_id,
    NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), ''),
    now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 1800), 1)),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'applied_price_type', v_price_type,
      'final_price_minor', v_final_price_minor,
      'regular_price_minor', GREATEST(COALESCE(p_regular_price_minor, 0), 0),
      'access_product_id', v_product.id,
      'scarcity_mode', v_product.scarcity_mode,
      'early_bird_price_minor', v_product.early_bird_price_minor,
      'early_bird_slots', v_product.early_bird_slots,
      'early_bird_remaining', COALESCE(early_bird_remaining, -1),
      'early_bird_allocated_count', early_bird_allocated_count,
      'series_fill_count', series_fill_count
    )
  ) RETURNING id INTO hold_id;

  ok := true;
  available_count := CASE
    WHEN v_capacity IS NULL THEN NULL
    ELSE GREATEST(v_capacity - series_fill_count, 0)
  END;
  reason := 'held';
  applied_price_type := v_price_type;
  final_price_minor := v_final_price_minor;
  quote_changed := p_quoted_price_minor IS NOT NULL AND p_quoted_price_minor <> v_final_price_minor;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.series_early_bird_fill(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.series_early_bird_fill(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.acquire_series_pricing_hold(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_series_pricing_hold(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.series_early_bird_fill(UUID, UUID) IS
  'Counts only paid/reserved Series places where Early Bird won; House Comp and lower member prices do not consume the first N allocations.';
COMMENT ON FUNCTION public.acquire_series_pricing_hold(
  UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, INTEGER, TEXT, INTEGER, JSONB, INTEGER
) IS
  'Atomically reserves Series capacity and freezes the winning base/member/Early-Bird price under one Series lock.';
