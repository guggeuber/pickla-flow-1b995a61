-- Managed Series must be editable through the canonical Program & Event
-- boundary without opening the generic Schedule write paths. This function
-- extends the existing atomic draft reconciliation to published/paused Series,
-- while locking schedule truth as soon as commercial or operational history
-- exists. Historical Order/receipt/ledger snapshots are never rewritten.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.update_managed_series_run(
  p_series_id UUID,
  p_name TEXT,
  p_image_urls TEXT[],
  p_start_date DATE,
  p_end_date DATE,
  p_registration_opens_at TIMESTAMPTZ,
  p_registration_closes_at TIMESTAMPTZ,
  p_capacity INTEGER,
  p_price_sek INTEGER,
  p_recurrence_days INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_total_sessions INTEGER,
  p_court_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_product public.access_products%ROWTYPE;
  v_requires_instructor BOOLEAN := false;
  v_occurrence_count INTEGER := 0;
  v_valid_court_count INTEGER := 0;
  v_committed_count INTEGER := 0;
  v_active_holds_count INTEGER := 0;
  v_schedule_changed BOOLEAN := false;
  v_has_started BOOLEAN := false;
  v_has_commitment_history BOOLEAN := false;
  v_has_order_history BOOLEAN := false;
  v_has_registration_history BOOLEAN := false;
  v_has_staffing BOOLEAN := false;
  v_conflicts JSONB;
  v_sessions JSONB;
BEGIN
  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF v_series.id IS NULL
     OR v_series.series_type <> 'course'
     OR v_series.format_id IS NULL
     OR v_series.access_product_id IS NULL THEN
    RAISE EXCEPTION 'managed_series_not_found';
  END IF;
  IF v_series.status NOT IN ('draft', 'active', 'paused') THEN
    RAISE EXCEPTION 'managed_series_lifecycle_locked';
  END IF;

  SELECT * INTO v_product
  FROM public.access_products
  WHERE id = v_series.access_product_id
    AND venue_id = v_series.venue_id
    AND product_kind = 'series_access'
    AND status = 'active'
    AND is_active = true
  FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'managed_series_product_invalid';
  END IF;
  IF NULLIF(BTRIM(p_name), '') IS NULL
     OR p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date
     OR p_registration_opens_at IS NULL OR p_registration_closes_at IS NULL
     OR p_registration_closes_at <= p_registration_opens_at
     OR p_capacity IS NULL OR p_capacity <= 0
     OR p_price_sek IS NULL OR p_price_sek <= 0
     OR p_start_time IS NULL OR p_end_time IS NULL OR p_start_time = p_end_time
     OR p_total_sessions IS NULL OR p_total_sessions <= 0
     OR COALESCE(cardinality(p_recurrence_days), 0) = 0
     OR COALESCE(cardinality(p_court_ids), 0) = 0
     OR COALESCE(cardinality(p_image_urls), 0) > 3 THEN
    RAISE EXCEPTION 'managed_series_edit_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_image_urls, '{}'::TEXT[])) image_url
    WHERE image_url NOT LIKE 'https://%/storage/v1/object/public/event-logos/activity-series/' || v_series.id::TEXT || '/%'
  ) THEN
    RAISE EXCEPTION 'managed_series_images_invalid';
  END IF;

  PERFORM public.capacity_lock_scope(
    v_series.venue_id,
    'activity_series',
    v_series.id::TEXT,
    v_series.start_date
  );

  v_committed_count := public.capacity_committed_count(
    v_series.venue_id,
    'activity_series',
    v_series.id::TEXT,
    v_series.start_date
  );
  v_active_holds_count := public.capacity_active_holds_count(
    v_series.venue_id,
    'activity_series',
    v_series.id::TEXT,
    v_series.start_date
  );
  IF p_capacity < (v_committed_count + v_active_holds_count) THEN
    RAISE EXCEPTION 'managed_series_capacity_below_fill';
  END IF;
  IF v_product.scarcity_mode = 'early_bird'
     AND COALESCE(v_product.early_bird_slots, 0) > p_capacity THEN
    RAISE EXCEPTION 'managed_series_capacity_below_early_bird_slots';
  END IF;
  IF v_product.scarcity_mode = 'early_bird'
     AND COALESCE(v_product.early_bird_price_minor, 0) >= p_price_sek * 100 THEN
    RAISE EXCEPTION 'managed_series_price_below_early_bird';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.membership_tier_pricing pricing
    WHERE pricing.product_type = v_product.product_key
      AND pricing.fixed_price IS NOT NULL
      AND pricing.fixed_price > p_price_sek
  ) THEN
    RAISE EXCEPTION 'managed_series_price_below_member_price';
  END IF;

  v_schedule_changed :=
    v_series.start_date IS DISTINCT FROM p_start_date
    OR v_series.end_date IS DISTINCT FROM p_end_date
    OR v_series.start_time IS DISTINCT FROM p_start_time
    OR v_series.end_time IS DISTINCT FROM p_end_time
    OR v_series.total_sessions IS DISTINCT FROM p_total_sessions
    OR v_series.recurrence_days IS DISTINCT FROM p_recurrence_days
    OR v_series.court_ids IS DISTINCT FROM p_court_ids;

  SELECT EXISTS (
    SELECT 1
    FROM public.activity_sessions session
    WHERE session.series_id = v_series.id
      AND session.is_active = true
      AND session.session_date IS NOT NULL
      AND (session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm' <= now()
  ) INTO v_has_started;

  SELECT EXISTS (
    SELECT 1 FROM public.series_commitments commitment
    WHERE commitment.activity_series_id = v_series.id
  ) INTO v_has_commitment_history;

  SELECT EXISTS (
    SELECT 1
    FROM public.commerce_order_lines line
    JOIN public.commerce_orders order_row ON order_row.id = line.commerce_order_id
    WHERE line.activity_series_id = v_series.id
      AND order_row.status IN ('checkout_pending', 'paid', 'attention', 'cancelled')
  ) INTO v_has_order_history;

  SELECT EXISTS (
    SELECT 1
    FROM public.session_registrations registration
    JOIN public.activity_sessions session ON session.id = registration.activity_session_id
    WHERE session.series_id = v_series.id
  ) INTO v_has_registration_history;

  SELECT EXISTS (
    SELECT 1
    FROM public.operational_staff_assignments assignment
    JOIN public.activity_sessions session ON session.id = assignment.source_id
    WHERE assignment.source_type = 'activity_session'
      AND assignment.status = 'active'
      AND session.series_id = v_series.id
  ) INTO v_has_staffing;

  IF v_schedule_changed AND v_has_started THEN
    RAISE EXCEPTION 'managed_series_schedule_started';
  END IF;
  IF v_schedule_changed AND (
    v_has_commitment_history
    OR v_has_order_history
    OR v_has_registration_history
    OR v_active_holds_count > 0
  ) THEN
    RAISE EXCEPTION 'managed_series_schedule_has_participants';
  END IF;
  IF v_schedule_changed AND v_has_staffing THEN
    RAISE EXCEPTION 'managed_series_schedule_has_staffing';
  END IF;

  IF v_schedule_changed THEN
    SELECT COUNT(*) INTO v_valid_court_count
    FROM public.venue_courts court
    WHERE court.venue_id = v_series.venue_id
      AND court.is_available = true
      AND court.id = ANY(p_court_ids);
    IF v_valid_court_count <> cardinality(p_court_ids) THEN
      RAISE EXCEPTION 'managed_series_resources_invalid';
    END IF;

    SELECT COUNT(*) INTO v_occurrence_count
    FROM (
      SELECT day
      FROM generate_series(p_start_date, p_end_date, interval '1 day') day
      WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(p_recurrence_days)
      ORDER BY day
      LIMIT p_total_sessions
    ) dates;
    IF v_occurrence_count <> p_total_sessions THEN
      RAISE EXCEPTION 'managed_series_schedule_incomplete';
    END IF;

    PERFORM public.lock_course_resources(
      v_series.venue_id,
      ARRAY(
        SELECT DISTINCT court_id
        FROM unnest(COALESCE(v_series.court_ids, '{}'::UUID[]) || p_court_ids) court_id
        ORDER BY court_id
      )
    );

    SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.occurrence_index, preview.court_name)
    INTO v_conflicts
    FROM public.preview_course_resource_schedule(
      v_series.venue_id,
      p_start_date,
      p_end_date,
      p_recurrence_days,
      p_start_time,
      p_end_time,
      p_total_sessions,
      p_court_ids,
      v_series.id,
      NULL
    ) preview
    WHERE preview.is_available = false;

    IF v_conflicts IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'course_resource_conflict',
        DETAIL = v_conflicts::TEXT;
    END IF;
  END IF;

  SELECT requires_instructor INTO v_requires_instructor
  FROM public.activity_formats
  WHERE id = v_series.format_id;

  UPDATE public.activity_series
  SET name = BTRIM(p_name),
      image_urls = COALESCE(p_image_urls, '{}'::TEXT[]),
      start_date = p_start_date,
      end_date = p_end_date,
      registration_opens_at = p_registration_opens_at,
      registration_closes_at = p_registration_closes_at,
      capacity = p_capacity,
      recurrence_days = p_recurrence_days,
      start_time = p_start_time,
      end_time = p_end_time,
      total_sessions = p_total_sessions,
      court_ids = p_court_ids
  WHERE id = v_series.id;

  UPDATE public.access_products
  SET name = BTRIM(p_name), base_price_sek = p_price_sek
  WHERE id = v_product.id;

  IF v_schedule_changed THEN
    -- Existing occurrence IDs are preserved by series + occurrence index. New
    -- indices receive new IDs; removed trailing occurrences are deleted only
    -- after the history/staffing guards above have proved that this is safe.
    UPDATE public.activity_sessions
    SET is_active = false
    WHERE series_id = v_series.id;

    WITH dates AS (
      SELECT day::DATE AS session_date,
        row_number() OVER (ORDER BY day)::INTEGER AS occurrence_index
      FROM generate_series(p_start_date, p_end_date, interval '1 day') day
      WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(p_recurrence_days)
      ORDER BY day
      LIMIT p_total_sessions
    )
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, recurrence_days, session_date,
      start_time, end_time, price_sek, capacity, court_ids, access_policy,
      is_active, metadata, series_id, product_key, publish_status, sort_order,
      requires_staffing, closed_to_public, series_occurrence_index
    )
    SELECT
      v_series.venue_id, BTRIM(p_name), 'course', v_series.sport_type, NULL, dates.session_date,
      p_start_time, p_end_time, 0, p_capacity, p_court_ids,
      jsonb_build_object('series_commitment_required', true),
      true, jsonb_build_object('generated_by', 'course_series', 'activity_series_id', v_series.id),
      v_series.id, NULL, 'published', dates.occurrence_index * 10,
      COALESCE(v_requires_instructor, false), true, dates.occurrence_index
    FROM dates
    ON CONFLICT (series_id, series_occurrence_index)
      WHERE series_id IS NOT NULL AND series_occurrence_index IS NOT NULL
    DO UPDATE SET
      venue_id = EXCLUDED.venue_id,
      name = EXCLUDED.name,
      session_type = EXCLUDED.session_type,
      sport_type = EXCLUDED.sport_type,
      recurrence_days = EXCLUDED.recurrence_days,
      session_date = EXCLUDED.session_date,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      price_sek = EXCLUDED.price_sek,
      capacity = EXCLUDED.capacity,
      court_ids = EXCLUDED.court_ids,
      access_policy = EXCLUDED.access_policy,
      is_active = EXCLUDED.is_active,
      metadata = EXCLUDED.metadata,
      product_key = EXCLUDED.product_key,
      publish_status = EXCLUDED.publish_status,
      sort_order = EXCLUDED.sort_order,
      requires_staffing = EXCLUDED.requires_staffing,
      closed_to_public = EXCLUDED.closed_to_public;

    DELETE FROM public.activity_sessions
    WHERE series_id = v_series.id AND is_active = false;
  ELSE
    UPDATE public.activity_sessions
    SET name = BTRIM(p_name),
        capacity = p_capacity,
        requires_staffing = COALESCE(v_requires_instructor, false)
    WHERE series_id = v_series.id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(session) ORDER BY session.series_occurrence_index), '[]'::JSONB)
  INTO v_sessions
  FROM public.activity_sessions session
  WHERE session.series_id = v_series.id;

  RETURN jsonb_build_object(
    'series_id', v_series.id,
    'schedule_reconciled', v_schedule_changed,
    'historical_orders_frozen', v_has_order_history OR v_has_commitment_history,
    'committed_count', v_committed_count,
    'active_holds_count', v_active_holds_count,
    'sessions', v_sessions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_managed_series_run(
  UUID, TEXT, TEXT[], DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_managed_series_run(
  UUID, TEXT, TEXT[], DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) TO service_role;

COMMENT ON FUNCTION public.update_managed_series_run(
  UUID, TEXT, TEXT[], DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) IS 'Atomically edits an identity-led managed Series through Program & Event. Schedule reconciliation is allowed only before start and before participant, payment, hold, registration or staffing state exists.';

CREATE OR REPLACE FUNCTION public.update_managed_series_format(
  p_format_id UUID,
  p_organization_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_full_description TEXT,
  p_image_urls TEXT[],
  p_age_group TEXT,
  p_level TEXT,
  p_requires_instructor BOOLEAN,
  p_presentation_type TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_format public.activity_formats%ROWTYPE;
BEGIN
  UPDATE public.activity_formats
  SET name = BTRIM(p_name),
      description = NULLIF(BTRIM(COALESCE(p_description, '')), ''),
      full_description = NULLIF(BTRIM(COALESCE(p_full_description, '')), ''),
      image_urls = COALESCE(p_image_urls, '{}'::TEXT[]),
      age_group = p_age_group,
      level = p_level,
      requires_instructor = COALESCE(p_requires_instructor, false),
      presentation_type = p_presentation_type
  WHERE id = p_format_id
    AND organization_id = p_organization_id
    AND is_active = true
  RETURNING * INTO v_format;

  IF v_format.id IS NULL THEN
    RAISE EXCEPTION 'managed_series_format_not_found';
  END IF;

  -- Format owns the staffing requirement. Only not-yet-started generated
  -- occurrences inherit a changed default; staffing assignments themselves
  -- remain untouched in Operations.
  UPDATE public.activity_sessions session
  SET requires_staffing = v_format.requires_instructor
  FROM public.activity_series series
  WHERE series.format_id = v_format.id
    AND series.id = session.series_id
    AND series.series_type = 'course'
    AND session.metadata->>'generated_by' = 'course_series'
    AND session.session_date IS NOT NULL
    AND (session.session_date + session.start_time) AT TIME ZONE 'Europe/Stockholm' > now();

  RETURN to_jsonb(v_format);
END;
$$;

REVOKE ALL ON FUNCTION public.update_managed_series_format(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_managed_series_format(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, BOOLEAN, TEXT
) TO service_role;

COMMENT ON FUNCTION public.update_managed_series_format(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, BOOLEAN, TEXT
) IS 'Atomically updates reusable managed-Series Format content and propagates the staffing requirement to future generated occurrences without modifying staffing assignments.';
