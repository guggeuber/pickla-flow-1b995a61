-- Course V1 operator UX: reusable Format content and atomic draft editing.
--
-- Format owns reusable customer-facing content. Series owns the concrete run.
-- Draft Series may be changed only before publication and before any commercial
-- or operational commitment exists. Schedule regeneration and product updates
-- are deliberately kept in one database transaction.

ALTER TABLE public.activity_formats
  ADD COLUMN full_description TEXT;

COMMENT ON COLUMN public.activity_formats.description IS
  'Short reusable Course description for compact discovery surfaces.';
COMMENT ON COLUMN public.activity_formats.full_description IS
  'Full reusable Course content for the customer detail and purchase surface. Plain text; rendered without HTML interpretation.';

CREATE OR REPLACE FUNCTION public.update_course_draft_series(
  p_series_id UUID,
  p_name TEXT,
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
  v_requires_instructor BOOLEAN := false;
  v_occurrence_count INTEGER := 0;
  v_valid_court_count INTEGER := 0;
  v_conflicts JSONB;
  v_sessions JSONB;
BEGIN
  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF v_series.id IS NULL OR v_series.series_type <> 'course' THEN
    RAISE EXCEPTION 'course_series_not_found';
  END IF;
  IF v_series.status <> 'draft' THEN
    RAISE EXCEPTION 'course_series_not_draft';
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
     OR COALESCE(cardinality(p_court_ids), 0) = 0 THEN
    RAISE EXCEPTION 'course_draft_edit_invalid';
  END IF;

  -- A published/commercially touched Course is outside V1 amendment scope.
  IF EXISTS (SELECT 1 FROM public.series_commitments WHERE activity_series_id = v_series.id)
     OR EXISTS (SELECT 1 FROM public.commerce_order_lines WHERE activity_series_id = v_series.id)
     OR EXISTS (
       SELECT 1 FROM public.capacity_holds
       WHERE scope_type = 'activity_series' AND scope_id = v_series.id::TEXT
     )
     OR EXISTS (
       SELECT 1
       FROM public.session_registrations registration
       JOIN public.activity_sessions session ON session.id = registration.activity_session_id
       WHERE session.series_id = v_series.id
     ) THEN
    RAISE EXCEPTION 'course_draft_has_commercial_state';
  END IF;

  -- Staffing assignments are operational commitments. Staff must be unassigned
  -- before a draft schedule can be regenerated, so no source reference is lost.
  IF EXISTS (
    SELECT 1
    FROM public.operational_staff_assignments assignment
    JOIN public.activity_sessions session ON session.id = assignment.source_id
    WHERE assignment.source_type = 'activity_session'
      AND assignment.status = 'active'
      AND session.series_id = v_series.id
  ) THEN
    RAISE EXCEPTION 'course_draft_has_staffing';
  END IF;

  SELECT COUNT(*) INTO v_valid_court_count
  FROM public.venue_courts court
  WHERE court.venue_id = v_series.venue_id
    AND court.is_available = true
    AND court.id = ANY(p_court_ids);
  IF v_valid_court_count <> cardinality(p_court_ids) THEN
    RAISE EXCEPTION 'course_series_resources_invalid';
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
    RAISE EXCEPTION 'course_series_schedule_incomplete';
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

  SELECT requires_instructor INTO v_requires_instructor
  FROM public.activity_formats
  WHERE id = v_series.format_id;

  UPDATE public.activity_series
  SET name = BTRIM(p_name),
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
  WHERE id = v_series.access_product_id;

  -- Temporarily deactivate the old projection so changed occurrences do not
  -- conflict with themselves. The whole function is one transaction.
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

  SELECT COALESCE(jsonb_agg(to_jsonb(session) ORDER BY session.series_occurrence_index), '[]'::JSONB)
  INTO v_sessions
  FROM public.activity_sessions session
  WHERE session.series_id = v_series.id;

  RETURN jsonb_build_object('series_id', v_series.id, 'sessions', v_sessions);
END;
$$;

REVOKE ALL ON FUNCTION public.update_course_draft_series(
  UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_course_draft_series(
  UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) TO service_role;

COMMENT ON FUNCTION public.update_course_draft_series(
  UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER,
  INTEGER[], TIME, TIME, INTEGER, UUID[]
) IS 'Atomically edits a commercially untouched draft Course Series, its product and generated Session projection after canonical resource validation.';
