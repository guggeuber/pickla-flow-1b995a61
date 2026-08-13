-- Course V1 resource safety.
-- Operations Week remains the canonical physical occupancy projection. This
-- patch reuses its sources and half-open interval doctrine for Course preview
-- and enforces the same truth transactionally when Course Sessions are written.

CREATE OR REPLACE FUNCTION public.preview_course_resource_schedule(
  p_venue_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_recurrence_days INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_total_sessions INTEGER,
  p_court_ids UUID[],
  p_exclude_series_id UUID DEFAULT NULL,
  p_exclude_session_id UUID DEFAULT NULL
) RETURNS TABLE (
  occurrence_index INTEGER,
  occurrence_date DATE,
  proposed_starts_at TIMESTAMPTZ,
  proposed_ends_at TIMESTAMPTZ,
  court_id UUID,
  court_name TEXT,
  is_available BOOLEAN,
  conflicts JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH venue_context AS (
  SELECT venue.id, COALESCE(NULLIF(venue.timezone, ''), 'Europe/Stockholm') AS timezone
  FROM public.venues venue
  WHERE venue.id = p_venue_id
), dates AS (
  SELECT generated.day::DATE AS occurrence_date,
         row_number() OVER (ORDER BY generated.day)::INTEGER AS occurrence_index
  FROM generate_series(p_start_date, p_end_date, interval '1 day') generated(day)
  WHERE EXTRACT(DOW FROM generated.day)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
  ORDER BY generated.day
  LIMIT GREATEST(COALESCE(p_total_sessions, 0), 0)
), proposed AS (
  SELECT dates.occurrence_index,
         dates.occurrence_date,
         ((dates.occurrence_date + p_start_time) AT TIME ZONE venue_context.timezone) AS starts_at,
         (((dates.occurrence_date + CASE WHEN p_end_time <= p_start_time THEN 1 ELSE 0 END) + p_end_time)
           AT TIME ZONE venue_context.timezone) AS ends_at,
         court.id AS court_id,
         court.name AS court_name,
         venue_context.timezone
  FROM dates
  CROSS JOIN venue_context
  JOIN public.venue_courts court
    ON court.venue_id = venue_context.id
   AND court.id = ANY(COALESCE(p_court_ids, '{}'::UUID[]))
   AND court.is_available = true
), occupancy AS (
  SELECT proposed.occurrence_index, proposed.court_id,
         'booking'::TEXT AS source_type,
         booking.id AS source_id,
         'Privat bokning'::TEXT AS title,
         booking.start_time AS starts_at,
         booking.end_time AS ends_at
  FROM proposed
  JOIN public.bookings booking
    ON booking.venue_id = p_venue_id
   AND booking.venue_court_id = proposed.court_id
   AND booking.status <> 'cancelled'
   AND booking.start_time < proposed.ends_at
   AND booking.end_time > proposed.starts_at

  UNION ALL

  SELECT proposed.occurrence_index, proposed.court_id,
         'activity_session'::TEXT,
         session.id,
         COALESCE(NULLIF(session.name, ''), 'Aktivitet')::TEXT,
         ((proposed.occurrence_date + session.start_time) AT TIME ZONE proposed.timezone),
         (((proposed.occurrence_date + CASE WHEN session.end_time <= session.start_time THEN 1 ELSE 0 END) + session.end_time)
           AT TIME ZONE proposed.timezone)
  FROM proposed
  JOIN public.activity_sessions session
    ON session.venue_id = p_venue_id
   AND session.is_active = true
   AND session.publish_status = 'published'
   AND proposed.court_id = ANY(COALESCE(session.court_ids, '{}'::UUID[]))
   AND (p_exclude_session_id IS NULL OR session.id <> p_exclude_session_id)
   AND (p_exclude_series_id IS NULL OR session.series_id IS DISTINCT FROM p_exclude_series_id)
   AND (
     session.session_date = proposed.occurrence_date
     OR (
       session.session_date IS NULL
       AND EXTRACT(DOW FROM proposed.occurrence_date)::INTEGER = ANY(COALESCE(session.recurrence_days, '{}'::INTEGER[]))
     )
   )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.activity_session_overrides override
    WHERE override.venue_id = p_venue_id
      AND override.activity_session_id = session.id
      AND override.session_date = proposed.occurrence_date
      AND override.status = 'cancelled'
  )
    AND ((proposed.occurrence_date + session.start_time) AT TIME ZONE proposed.timezone) < proposed.ends_at
    AND (((proposed.occurrence_date + CASE WHEN session.end_time <= session.start_time THEN 1 ELSE 0 END) + session.end_time)
          AT TIME ZONE proposed.timezone) > proposed.starts_at

  UNION ALL

  SELECT proposed.occurrence_index, proposed.court_id,
         CASE
           WHEN block.event_id IS NOT NULL OR block.reason = 'event' THEN 'event_reservation'
           WHEN NULLIF(block.metadata->>'venue_operation_override_id', '') IS NOT NULL THEN 'venue_closure'
           ELSE 'resource_block'
         END::TEXT,
         block.id,
         COALESCE(NULLIF(block.title, ''),
           CASE WHEN block.reason = 'maintenance' THEN 'Underhåll' ELSE 'Resursblockering' END)::TEXT,
         block.starts_at,
         block.ends_at
  FROM proposed
  JOIN public.event_resource_blocks block
    ON block.venue_id = p_venue_id
   AND block.blocks_public_booking = true
   AND block.status IN ('hold', 'confirmed')
   AND block.starts_at < proposed.ends_at
   AND block.ends_at > proposed.starts_at
  LEFT JOIN public.event_resource_catalog resource ON resource.id = block.resource_catalog_id
  WHERE resource.venue_court_id = proposed.court_id
     OR NULLIF(block.metadata->>'venue_court_id', '') = proposed.court_id::TEXT
     OR block.metadata->>'scope' = 'venue'
     OR lower(COALESCE(resource.resource_type, '')) IN ('venue', 'whole_venue')

  UNION ALL

  SELECT proposed.occurrence_index, proposed.court_id,
         'venue_closure'::TEXT,
         override.id,
         COALESCE(NULLIF(override.title, ''),
           CASE WHEN override.override_type = 'maintenance' THEN 'Underhåll' ELSE 'Driftstopp' END)::TEXT,
         override.starts_at,
         override.ends_at
  FROM proposed
  JOIN public.venue_operation_overrides override
    ON override.venue_id = p_venue_id
   AND override.status = 'active'
   AND override.starts_at < proposed.ends_at
   AND override.ends_at > proposed.starts_at
   AND (
     override.affects_entire_venue = true
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(override.metadata->'venue_court_ids') = 'array' THEN override.metadata->'venue_court_ids'
           ELSE '[]'::JSONB
         END
       ) court(value)
       WHERE court.value = proposed.court_id::TEXT
     )
   )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.event_resource_blocks linked
    WHERE linked.venue_id = p_venue_id
      AND linked.metadata->>'venue_operation_override_id' = override.id::TEXT
      AND linked.blocks_public_booking = true
      AND linked.status IN ('hold', 'confirmed')
  )
), grouped AS (
  SELECT proposed.occurrence_index,
         proposed.occurrence_date,
         proposed.starts_at,
         proposed.ends_at,
         proposed.court_id,
         proposed.court_name,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'source_type', occupancy.source_type,
               'source_id', occupancy.source_id,
               'title', occupancy.title,
               'starts_at', occupancy.starts_at,
               'ends_at', occupancy.ends_at
             ) ORDER BY occupancy.starts_at, occupancy.source_type, occupancy.source_id
           ) FILTER (WHERE occupancy.source_id IS NOT NULL),
           '[]'::JSONB
         ) AS conflicts
  FROM proposed
  LEFT JOIN occupancy
    ON occupancy.occurrence_index = proposed.occurrence_index
   AND occupancy.court_id = proposed.court_id
  GROUP BY proposed.occurrence_index, proposed.occurrence_date, proposed.starts_at,
           proposed.ends_at, proposed.court_id, proposed.court_name
)
SELECT grouped.occurrence_index,
       grouped.occurrence_date,
       grouped.starts_at,
       grouped.ends_at,
       grouped.court_id,
       grouped.court_name,
       jsonb_array_length(grouped.conflicts) = 0,
       grouped.conflicts
FROM grouped
ORDER BY grouped.occurrence_index, grouped.court_name, grouped.court_id;
$$;

REVOKE ALL ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.lock_course_resources(
  p_venue_id UUID,
  p_court_ids UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_court_id UUID;
BEGIN
  FOR v_court_id IN
    SELECT DISTINCT court_id
    FROM unnest(COALESCE(p_court_ids, '{}'::UUID[])) court_id
    ORDER BY court_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext(COALESCE(p_venue_id::TEXT, '')),
      hashtext('course_resource:' || v_court_id::TEXT)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_course_resources(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_course_resources(UUID, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_course_session_resource_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflicts JSONB;
BEGIN
  IF NEW.session_type <> 'course'
     OR NEW.is_active IS DISTINCT FROM true
     OR NEW.publish_status IS DISTINCT FROM 'published'
     OR NEW.session_date IS NULL
     OR COALESCE(cardinality(NEW.court_ids), 0) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public.lock_course_resources(NEW.venue_id, NEW.court_ids);

  SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.occurrence_index, preview.court_name)
  INTO v_conflicts
  FROM public.preview_course_resource_schedule(
    NEW.venue_id,
    NEW.session_date,
    NEW.session_date,
    ARRAY[EXTRACT(DOW FROM NEW.session_date)::INTEGER],
    NEW.start_time,
    NEW.end_time,
    1,
    NEW.court_ids,
    NULL,
    NEW.id
  ) preview
  WHERE preview.is_available = false;

  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'course_resource_conflict',
      DETAIL = v_conflicts::TEXT;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_course_session_resource_conflict() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_course_session_resource_conflict ON public.activity_sessions;
CREATE TRIGGER trg_guard_course_session_resource_conflict
BEFORE INSERT OR UPDATE OF venue_id, session_date, start_time, end_time, court_ids, is_active, publish_status
ON public.activity_sessions
FOR EACH ROW
EXECUTE FUNCTION public.guard_course_session_resource_conflict();

CREATE OR REPLACE FUNCTION public.generate_course_series_sessions(p_series_id UUID)
RETURNS SETOF public.activity_sessions
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
BEGIN
  SELECT * INTO v_series FROM public.activity_series WHERE id = p_series_id FOR UPDATE;
  IF v_series.id IS NULL OR v_series.series_type <> 'course' THEN RAISE EXCEPTION 'course_series_not_found'; END IF;
  IF v_series.start_date IS NULL OR v_series.end_date IS NULL OR v_series.start_time IS NULL OR v_series.end_time IS NULL THEN
    RAISE EXCEPTION 'course_series_schedule_incomplete';
  END IF;
  IF COALESCE(cardinality(v_series.recurrence_days), 0) = 0 THEN RAISE EXCEPTION 'course_series_recurrence_required'; END IF;
  IF v_series.capacity IS NULL OR v_series.capacity <= 0 THEN RAISE EXCEPTION 'course_series_capacity_required'; END IF;
  IF COALESCE(cardinality(v_series.court_ids), 0) = 0 THEN RAISE EXCEPTION 'course_series_resources_required'; END IF;

  SELECT COUNT(*) INTO v_valid_court_count
  FROM public.venue_courts court
  WHERE court.venue_id = v_series.venue_id
    AND court.is_available = true
    AND court.id = ANY(v_series.court_ids);
  IF v_valid_court_count <> cardinality(v_series.court_ids) THEN RAISE EXCEPTION 'course_series_resources_invalid'; END IF;

  SELECT COUNT(*) INTO v_occurrence_count
  FROM (
    SELECT day
    FROM generate_series(v_series.start_date, v_series.end_date, interval '1 day') day
    WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(v_series.recurrence_days)
    ORDER BY day
    LIMIT COALESCE(v_series.total_sessions, 0)
  ) dates;
  IF v_occurrence_count <> v_series.total_sessions THEN RAISE EXCEPTION 'course_series_schedule_incomplete'; END IF;

  SELECT requires_instructor INTO v_requires_instructor FROM public.activity_formats WHERE id = v_series.format_id;
  PERFORM public.lock_course_resources(v_series.venue_id, v_series.court_ids);

  SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.occurrence_index, preview.court_name)
  INTO v_conflicts
  FROM public.preview_course_resource_schedule(
    v_series.venue_id,
    v_series.start_date,
    v_series.end_date,
    v_series.recurrence_days,
    v_series.start_time,
    v_series.end_time,
    v_series.total_sessions,
    v_series.court_ids,
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

  RETURN QUERY
  WITH dates AS (
    SELECT day::DATE AS session_date,
      row_number() OVER (ORDER BY day)::INTEGER AS occurrence_index
    FROM generate_series(v_series.start_date, v_series.end_date, interval '1 day') day
    WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(v_series.recurrence_days)
    ORDER BY day
    LIMIT v_series.total_sessions
  ), inserted AS (
    INSERT INTO public.activity_sessions (
      venue_id, name, session_type, sport_type, recurrence_days, session_date,
      start_time, end_time, price_sek, capacity, court_ids, access_policy,
      is_active, metadata, series_id, product_key, publish_status, sort_order,
      requires_staffing, closed_to_public, series_occurrence_index
    )
    SELECT
      v_series.venue_id, v_series.name, 'course', v_series.sport_type, NULL, dates.session_date,
      v_series.start_time, v_series.end_time, 0, v_series.capacity, v_series.court_ids,
      jsonb_build_object('series_commitment_required', true),
      true, jsonb_build_object('generated_by', 'course_series', 'activity_series_id', v_series.id),
      v_series.id, NULL, 'published', dates.occurrence_index * 10,
      COALESCE(v_requires_instructor, false), true, dates.occurrence_index
    FROM dates
    ON CONFLICT (series_id, series_occurrence_index)
      WHERE series_id IS NOT NULL AND series_occurrence_index IS NOT NULL
    DO NOTHING
    RETURNING *
  ) SELECT * FROM inserted;

  PERFORM public.reconcile_course_series_participation(p_series_id);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_course_series_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_course_series_sessions(UUID) TO service_role;

COMMENT ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) IS 'Read-only Course occurrence/resource preview using the canonical Operations occupancy sources and half-open overlap doctrine.';
COMMENT ON FUNCTION public.guard_course_session_resource_conflict() IS
  'Hard Course-only physical resource guard. It does not alter legacy activity, booking, event or Operations write paths.';
