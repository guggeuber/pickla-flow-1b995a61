-- Canonical non-financial staff grants for any sellable managed Series.
-- A grant owns one scarce Series place without fabricating Commerce, payment,
-- receipt or ledger truth.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- Staff previously had a broad ALL policy plus direct INSERT/UPDATE grants.
-- Canonical paid and grant/cancel writers already use service-role functions.
DROP POLICY IF EXISTS "Venue staff manage series commitments"
  ON public.series_commitments;

REVOKE INSERT, UPDATE, DELETE ON public.series_commitments FROM anon, authenticated;
GRANT SELECT ON public.series_commitments TO authenticated;
GRANT ALL ON public.series_commitments TO service_role;

-- One request key represents one immutable grant intent across the organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_series_staff_grant_request
  ON public.series_commitments ((metadata->>'grant_request_id'))
  WHERE metadata->>'funding_source' = 'series_staff_grant'
    AND NULLIF(BTRIM(metadata->>'grant_request_id'), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_staff_grant_audit_request
  ON public.audit_log (action, request_id)
  WHERE action IN ('series.staff_grant.created', 'series.staff_grant.cancelled')
    AND request_id IS NOT NULL;

-- The historical function name is retained for deployed callers. Its behavior
-- is now based on the canonical sellable-Series product boundary, not customer
-- presentation or a Course label.
CREATE OR REPLACE FUNCTION public.reconcile_course_series_participation(p_series_id UUID)
RETURNS TABLE(inserted_count INTEGER, updated_count INTEGER, cancelled_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
BEGIN
  inserted_count := 0;
  updated_count := 0;
  cancelled_count := 0;

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id;

  IF v_series.id IS NULL THEN
    RAISE EXCEPTION 'series_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.id = v_series.access_product_id
      AND product.venue_id = v_series.venue_id
      AND product.product_kind = 'series_access'
  ) THEN
    RETURN NEXT;
    RETURN;
  END IF;

  WITH projected AS (
    SELECT
      gen_random_uuid() AS id,
      session.venue_id,
      session.id AS activity_session_id,
      session.session_date,
      customer.auth_user_id AS user_id,
      commitment.participant_customer_id AS customer_id,
      commitment.dependent_participant_id,
      commitment.id AS series_commitment_id,
      jsonb_build_object(
        'series_commitment_id', commitment.id,
        'activity_series_id', commitment.activity_series_id,
        'access_reason', COALESCE(entitlement.access_reason, 'Programplats'),
        'participant_kind', CASE WHEN commitment.dependent_participant_id IS NULL THEN 'customer' ELSE 'dependent' END
      ) AS metadata
    FROM public.series_commitments commitment
    JOIN public.activity_sessions session
      ON session.series_id = commitment.activity_series_id
     AND session.closed_to_public = true
     AND session.is_active = true
     AND session.session_date IS NOT NULL
    LEFT JOIN public.customers customer
      ON customer.id = commitment.participant_customer_id
    LEFT JOIN public.access_entitlements entitlement
      ON entitlement.id = commitment.access_entitlement_id
    WHERE commitment.activity_series_id = p_series_id
      AND commitment.commitment_type = 'participant'
      AND commitment.status = 'active'
  ), inserted AS (
    INSERT INTO public.session_registrations (
      id, venue_id, activity_session_id, session_date, user_id, customer_id,
      dependent_participant_id, series_commitment_id, status, price_paid_sek,
      source_type, source_id, metadata
    )
    SELECT id, venue_id, activity_session_id, session_date, user_id, customer_id,
      dependent_participant_id, series_commitment_id, 'confirmed', 0,
      'series_commitment', series_commitment_id, metadata
    FROM projected
    ON CONFLICT (activity_session_id, series_commitment_id)
      WHERE series_commitment_id IS NOT NULL
    DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO inserted_count FROM inserted;

  WITH updated AS (
    UPDATE public.session_registrations registration
    SET session_date = session.session_date,
        venue_id = session.venue_id,
        user_id = customer.auth_user_id,
        customer_id = commitment.participant_customer_id,
        dependent_participant_id = commitment.dependent_participant_id,
        status = CASE
          WHEN registration.status IN ('checked_in', 'no_show') THEN registration.status
          ELSE 'confirmed'
        END,
        metadata = COALESCE(registration.metadata, '{}'::JSONB) || jsonb_build_object(
          'series_commitment_id', commitment.id,
          'activity_series_id', commitment.activity_series_id,
          'access_reason', COALESCE(entitlement.access_reason, 'Programplats')
        ),
        updated_at = now()
    FROM public.series_commitments commitment
    JOIN public.activity_sessions session
      ON session.series_id = commitment.activity_series_id
     AND session.closed_to_public = true
     AND session.is_active = true
     AND session.session_date IS NOT NULL
    LEFT JOIN public.customers customer
      ON customer.id = commitment.participant_customer_id
    LEFT JOIN public.access_entitlements entitlement
      ON entitlement.id = commitment.access_entitlement_id
    WHERE registration.series_commitment_id = commitment.id
      AND registration.activity_session_id = session.id
      AND commitment.activity_series_id = p_series_id
      AND commitment.status = 'active'
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO updated_count FROM updated;

  WITH cancelled AS (
    UPDATE public.session_registrations registration
    SET status = 'cancelled', updated_at = now()
    FROM public.series_commitments commitment
    WHERE registration.series_commitment_id = commitment.id
      AND commitment.activity_series_id = p_series_id
      AND registration.status = 'confirmed'
      AND (
        commitment.status <> 'active'
        OR NOT EXISTS (
          SELECT 1
          FROM public.activity_sessions session
          WHERE session.id = registration.activity_session_id
            AND session.is_active = true
        )
      )
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO cancelled_count FROM cancelled;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_course_series_participation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_course_series_participation(UUID)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_course_series_participation(UUID) IS
  'Compatibility name for the generic sellable-Series commitment-to-Session projection. Presentation type never controls participation truth.';

CREATE OR REPLACE FUNCTION public.grant_series_staff_place(
  p_venue_id UUID,
  p_activity_series_id UUID,
  p_actor_user_id UUID,
  p_participant_customer_id UUID DEFAULT NULL,
  p_dependent_participant_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
) RETURNS TABLE(
  ok BOOLEAN,
  commitment_id UUID,
  entitlement_id UUID,
  available_count INTEGER,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_product public.access_products%ROWTYPE;
  v_organization_id UUID;
  v_customer public.customers%ROWTYPE;
  v_dependent public.dependent_participants%ROWTYPE;
  v_existing public.series_commitments%ROWTYPE;
  v_commitment public.series_commitments%ROWTYPE;
  v_entitlement public.access_entitlements%ROWTYPE;
  v_capacity INTEGER;
  v_committed INTEGER;
  v_holds INTEGER;
  v_anchor_date DATE;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_request_id TEXT := NULLIF(BTRIM(COALESCE(p_request_id, '')), '');
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'series_staff_grant_actor_required';
  END IF;
  IF num_nonnulls(p_participant_customer_id, p_dependent_participant_id) <> 1 THEN
    RAISE EXCEPTION 'series_staff_grant_participant_required';
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'series_staff_grant_reason_required';
  END IF;
  IF v_request_id IS NULL OR length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'series_staff_grant_request_id_required';
  END IF;

  SELECT series.*
  INTO v_series
  FROM public.activity_series series
  WHERE series.id = p_activity_series_id
    AND series.venue_id = p_venue_id;

  IF v_series.id IS NULL THEN
    RAISE EXCEPTION 'series_staff_grant_series_not_found';
  END IF;

  SELECT venue.organization_id
  INTO v_organization_id
  FROM public.venues venue
  WHERE venue.id = p_venue_id;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id = p_actor_user_id
        AND staff.venue_id = p_venue_id
        AND staff.role = 'venue_admin'
        AND staff.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles role
      WHERE role.user_id = p_actor_user_id
        AND role.role = 'super_admin'
    )
  ) THEN
    RAISE EXCEPTION 'series_staff_grant_forbidden';
  END IF;

  SELECT * INTO v_product
  FROM public.access_products product
  WHERE product.id = v_series.access_product_id
    AND product.venue_id = p_venue_id;

  IF v_series.status <> 'active'
     OR v_series.format_id IS NULL
     OR v_series.start_date IS NULL
     OR v_series.end_date IS NULL
     OR COALESCE(v_series.capacity, 0) <= 0
     OR v_product.id IS NULL
     OR v_product.product_kind <> 'series_access'
     OR v_product.status <> 'active'
     OR NOT COALESCE(v_product.is_active, true) THEN
    RAISE EXCEPTION 'series_staff_grant_series_ineligible';
  END IF;

  IF p_participant_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
    FROM public.customers customer
    WHERE customer.id = p_participant_customer_id
      AND customer.organization_id = v_organization_id
      AND customer.status = 'active'
      AND customer.merged_into_id IS NULL;
    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'series_staff_grant_customer_not_found';
    END IF;
  ELSE
    SELECT * INTO v_dependent
    FROM public.dependent_participants dependent
    WHERE dependent.id = p_dependent_participant_id
      AND dependent.organization_id = v_organization_id
      AND dependent.status = 'active';
    IF v_dependent.id IS NULL THEN
      RAISE EXCEPTION 'series_staff_grant_dependent_not_found';
    END IF;
  END IF;

  -- The request lock makes retries deterministic even if a caller accidentally
  -- sends the same request key for different Series.
  PERFORM pg_advisory_xact_lock(
    hashtext('series_staff_grant_request'),
    hashtext(v_request_id)
  );

  SELECT * INTO v_existing
  FROM public.series_commitments commitment
  WHERE commitment.metadata->>'funding_source' = 'series_staff_grant'
    AND commitment.metadata->>'grant_request_id' = v_request_id
  ORDER BY commitment.created_at
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.activity_series_id <> p_activity_series_id
       OR v_existing.venue_id <> p_venue_id
       OR v_existing.participant_customer_id IS DISTINCT FROM p_participant_customer_id
       OR v_existing.dependent_participant_id IS DISTINCT FROM p_dependent_participant_id THEN
      RAISE EXCEPTION 'series_staff_grant_idempotency_key_reused';
    END IF;
    ok := true;
    commitment_id := v_existing.id;
    entitlement_id := v_existing.access_entitlement_id;
    available_count := GREATEST(
      COALESCE(v_series.capacity, 0)
      - public.capacity_committed_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.start_date)
      - public.capacity_active_holds_count(p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.start_date),
      0
    );
    reason := 'existing_grant';
    RETURN NEXT;
    RETURN;
  END IF;

  v_anchor_date := v_series.start_date;
  PERFORM public.capacity_lock_scope(
    p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date
  );

  UPDATE public.capacity_holds
  SET status = 'expired',
      released_at = COALESCE(released_at, now()),
      metadata = COALESCE(metadata, '{}'::JSONB)
        || jsonb_build_object('release_reason', 'lazy_expired_before_series_staff_grant')
  WHERE venue_id = p_venue_id
    AND scope_type = 'activity_series'
    AND scope_id = p_activity_series_id::TEXT
    AND session_date = v_anchor_date
    AND status = 'active'
    AND expires_at <= now();

  SELECT * INTO v_existing
  FROM public.series_commitments commitment
  WHERE commitment.activity_series_id = p_activity_series_id
    AND commitment.commitment_type = 'participant'
    AND commitment.status = 'active'
    AND (
      (p_participant_customer_id IS NOT NULL AND commitment.participant_customer_id = p_participant_customer_id)
      OR (p_dependent_participant_id IS NOT NULL AND commitment.dependent_participant_id = p_dependent_participant_id)
    )
  ORDER BY commitment.created_at
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    ok := false;
    commitment_id := v_existing.id;
    entitlement_id := v_existing.access_entitlement_id;
    available_count := NULL;
    reason := 'duplicate_active_place';
    RETURN NEXT;
    RETURN;
  END IF;

  v_capacity := public.capacity_scope_capacity(
    p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_series.capacity
  );
  v_committed := public.capacity_committed_count(
    p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date
  );
  v_holds := public.capacity_active_holds_count(
    p_venue_id, 'activity_series', p_activity_series_id::TEXT, v_anchor_date
  );

  IF v_capacity IS NULL OR (v_committed + v_holds) >= v_capacity THEN
    ok := false;
    commitment_id := NULL;
    entitlement_id := NULL;
    available_count := 0;
    reason := 'capacity_full';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.series_commitments (
    organization_id, venue_id, activity_series_id, commitment_type,
    participant_customer_id, dependent_participant_id, payer_customer_id,
    commerce_order_id, commerce_order_line_id, status, activated_at, metadata
  ) VALUES (
    v_organization_id, p_venue_id, p_activity_series_id, 'participant',
    p_participant_customer_id, p_dependent_participant_id, NULL,
    NULL, NULL, 'active', now(),
    jsonb_build_object(
      'funding_source', 'series_staff_grant',
      'funding_type', 'house_granted',
      'funder', 'house_comped',
      'occurrence_origin', 'house_comped',
      'access_reason', 'Friplats · Pickla',
      'grant_reason', v_reason,
      'grant_request_id', v_request_id,
      'granted_by_user_id', p_actor_user_id,
      'granted_at', now()
    )
  )
  RETURNING * INTO v_commitment;

  INSERT INTO public.access_entitlements (
    organization_id, venue_id, customer_id, user_id, dependent_participant_id,
    entitlement_type, status, source_type, source_id, metadata, model_version,
    scope_type, meter_type, starts_at, expires_at, funding_type, funder,
    access_reason, requires_consumption, consumption_trigger, no_show_policy,
    occurrence_origin, constitution_version, scope_schema_version,
    resolution_priority, scarcity_class, resolution_origin_priority, issuance_key
  ) VALUES (
    v_organization_id, p_venue_id, p_participant_customer_id, v_customer.auth_user_id,
    p_dependent_participant_id, 'series_access', 'active',
    'series_staff_grant', v_commitment.id,
    jsonb_build_object(
      'activity_series_id', p_activity_series_id,
      'funding_source', 'series_staff_grant',
      'grant_request_id', v_request_id,
      'granted_by_user_id', p_actor_user_id
    ),
    2, 'activity_series', 'unlimited',
    (v_series.start_date::TIMESTAMP AT TIME ZONE 'Europe/Stockholm'),
    ((v_series.end_date + 1)::TIMESTAMP AT TIME ZONE 'Europe/Stockholm'),
    'house_granted', 'house_comped', 'Friplats · Pickla', false,
    'on_commitment', 'do_not_consume', 'house_comped', 1, 1, 10,
    'scarce', 0, 'series_staff_grant:' || v_commitment.id::TEXT
  )
  RETURNING * INTO v_entitlement;

  INSERT INTO public.access_entitlement_scopes (
    entitlement_id, organization_id, scope_kind, activity_series_id,
    valid_from, valid_until
  ) VALUES (
    v_entitlement.id, v_organization_id, 'activity_series', p_activity_series_id,
    v_entitlement.starts_at, v_entitlement.expires_at
  );

  UPDATE public.series_commitments
  SET access_entitlement_id = v_entitlement.id
  WHERE id = v_commitment.id;

  PERFORM public.reconcile_course_series_participation(p_activity_series_id);

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_organization_id, p_venue_id, p_actor_user_id, 'user',
    'series.staff_grant.created', 'series_commitments', v_commitment.id::TEXT,
    v_request_id, NULL,
    jsonb_build_object(
      'commitment_id', v_commitment.id,
      'entitlement_id', v_entitlement.id,
      'status', 'active'
    ),
    jsonb_build_object(
      'activity_series_id', p_activity_series_id,
      'participant_kind', CASE WHEN p_dependent_participant_id IS NULL THEN 'customer' ELSE 'dependent' END,
      'participant_id', COALESCE(p_participant_customer_id, p_dependent_participant_id),
      'reason', v_reason,
      'funding_type', 'house_granted',
      'funder', 'house_comped',
      'occurrence_origin', 'house_comped'
    )
  );

  ok := true;
  commitment_id := v_commitment.id;
  entitlement_id := v_entitlement.id;
  available_count := GREATEST(v_capacity - v_committed - v_holds - 1, 0);
  reason := 'granted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_series_staff_place(
  UUID, UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_series_staff_place(
  UUID, UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.grant_series_staff_place(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT) IS
  'Atomically grants one identified participant a non-financial, house-funded place in any eligible managed sellable Series.';

CREATE OR REPLACE FUNCTION public.cancel_series_staff_place(
  p_venue_id UUID,
  p_commitment_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
) RETURNS TABLE(
  ok BOOLEAN,
  commitment_id UUID,
  entitlement_id UUID,
  available_count INTEGER,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_commitment public.series_commitments%ROWTYPE;
  v_series public.activity_series%ROWTYPE;
  v_entitlement public.access_entitlements%ROWTYPE;
  v_organization_id UUID;
  v_capacity INTEGER;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_request_id TEXT := NULLIF(BTRIM(COALESCE(p_request_id, '')), '');
  v_before JSONB;
  v_existing_cancel_entity TEXT;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'series_staff_grant_actor_required';
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'series_staff_grant_cancel_reason_required';
  END IF;
  IF v_request_id IS NULL OR length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'series_staff_grant_request_id_required';
  END IF;

  SELECT commitment.*
  INTO v_commitment
  FROM public.series_commitments commitment
  WHERE commitment.id = p_commitment_id
    AND commitment.venue_id = p_venue_id;

  IF v_commitment.id IS NULL THEN
    RAISE EXCEPTION 'series_staff_grant_commitment_not_found';
  END IF;

  SELECT series.*
  INTO v_series
  FROM public.activity_series series
  WHERE series.id = v_commitment.activity_series_id;

  SELECT venue.organization_id INTO v_organization_id
  FROM public.venues venue
  WHERE venue.id = p_venue_id;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.venue_staff staff
      WHERE staff.user_id = p_actor_user_id
        AND staff.venue_id = p_venue_id
        AND staff.role = 'venue_admin'
        AND staff.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles role
      WHERE role.user_id = p_actor_user_id
        AND role.role = 'super_admin'
    )
  ) THEN
    RAISE EXCEPTION 'series_staff_grant_forbidden';
  END IF;

  IF v_commitment.metadata->>'funding_source' <> 'series_staff_grant' THEN
    RAISE EXCEPTION 'series_staff_grant_cancellation_only';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('series_staff_grant_cancel_request'),
    hashtext(v_request_id)
  );

  SELECT audit.entity_id
  INTO v_existing_cancel_entity
  FROM public.audit_log audit
  WHERE audit.action = 'series.staff_grant.cancelled'
    AND audit.request_id = v_request_id
  LIMIT 1;

  IF v_existing_cancel_entity IS NOT NULL
     AND v_existing_cancel_entity <> p_commitment_id::TEXT THEN
    RAISE EXCEPTION 'series_staff_grant_idempotency_key_reused';
  END IF;

  IF v_existing_cancel_entity = p_commitment_id::TEXT THEN
    ok := true;
    commitment_id := v_commitment.id;
    entitlement_id := v_commitment.access_entitlement_id;
    available_count := GREATEST(
      COALESCE(v_series.capacity, 0)
      - public.capacity_committed_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date)
      - public.capacity_active_holds_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date),
      0
    );
    reason := 'existing_cancellation';
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM public.capacity_lock_scope(
    p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date
  );

  SELECT * INTO v_commitment
  FROM public.series_commitments commitment
  WHERE commitment.id = p_commitment_id
  FOR UPDATE;

  IF v_commitment.status = 'cancelled' THEN
    ok := true;
    commitment_id := v_commitment.id;
    entitlement_id := v_commitment.access_entitlement_id;
    available_count := GREATEST(
      COALESCE(v_series.capacity, 0)
      - public.capacity_committed_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date)
      - public.capacity_active_holds_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date),
      0
    );
    reason := 'already_cancelled';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_commitment.status <> 'active' THEN
    RAISE EXCEPTION 'series_staff_grant_commitment_not_active';
  END IF;

  v_before := jsonb_build_object(
    'commitment_id', v_commitment.id,
    'entitlement_id', v_commitment.access_entitlement_id,
    'status', v_commitment.status,
    'metadata', v_commitment.metadata
  );

  UPDATE public.series_commitments
  SET status = 'cancelled',
      cancelled_at = now(),
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'cancel_reason', v_reason,
        'cancel_request_id', v_request_id,
        'cancelled_by_user_id', p_actor_user_id,
        'cancelled_at', now()
      )
  WHERE id = v_commitment.id
  RETURNING * INTO v_commitment;

  UPDATE public.access_entitlements
  SET status = 'revoked',
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'revocation_source', 'series_staff_grant_cancel',
        'cancel_request_id', v_request_id,
        'cancelled_by_user_id', p_actor_user_id,
        'cancelled_at', now()
      )
  WHERE id = v_commitment.access_entitlement_id
    AND source_type = 'series_staff_grant'
  RETURNING * INTO v_entitlement;

  IF v_entitlement.id IS NULL THEN
    RAISE EXCEPTION 'series_staff_grant_entitlement_missing';
  END IF;

  PERFORM public.reconcile_course_series_participation(v_commitment.activity_series_id);

  INSERT INTO public.audit_log (
    organization_id, venue_id, actor_user_id, actor_type, action,
    entity_table, entity_id, request_id, before, after, metadata
  ) VALUES (
    v_organization_id, p_venue_id, p_actor_user_id, 'user',
    'series.staff_grant.cancelled', 'series_commitments', v_commitment.id::TEXT,
    v_request_id, v_before,
    jsonb_build_object(
      'commitment_id', v_commitment.id,
      'entitlement_id', v_entitlement.id,
      'status', v_commitment.status,
      'metadata', v_commitment.metadata
    ),
    jsonb_build_object(
      'activity_series_id', v_commitment.activity_series_id,
      'participant_kind', CASE WHEN v_commitment.dependent_participant_id IS NULL THEN 'customer' ELSE 'dependent' END,
      'participant_id', COALESCE(v_commitment.participant_customer_id, v_commitment.dependent_participant_id),
      'reason', v_reason
    )
  );

  v_capacity := public.capacity_scope_capacity(
    p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.capacity
  );
  ok := true;
  commitment_id := v_commitment.id;
  entitlement_id := v_entitlement.id;
  available_count := GREATEST(
    COALESCE(v_capacity, 0)
    - public.capacity_committed_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date)
    - public.capacity_active_holds_count(p_venue_id, 'activity_series', v_commitment.activity_series_id::TEXT, v_series.start_date),
    0
  );
  reason := 'cancelled';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_series_staff_place(
  UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_series_staff_place(
  UUID, UUID, UUID, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.cancel_series_staff_place(UUID, UUID, UUID, TEXT, TEXT) IS
  'Atomically cancels only a house-comped Series place, revokes its entitlement, preserves attendance and appends audit history.';
