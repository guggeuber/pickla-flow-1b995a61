-- Physical Availability Foundation V1.
--
-- venue_courts remains the resource identity. bookings, expanded
-- activity_sessions and active event_resource_blocks remain the occupancy
-- sources. All overlaps use half-open [start, end) intervals.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.check_physical_availability(
  p_venue_id UUID,
  p_court_ids UUID[],
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_exclude_booking_ids UUID[] DEFAULT '{}'::UUID[],
  p_exclude_activity_session_id UUID DEFAULT NULL,
  p_exclude_activity_occurrence_date DATE DEFAULT NULL,
  p_exclude_activity_series_id UUID DEFAULT NULL,
  p_exclude_resource_block_ids UUID[] DEFAULT '{}'::UUID[],
  p_exclude_operation_override_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_court_ids UUID[];
  v_conflicts JSONB;
BEGIN
  IF p_venue_id IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_physical_availability_request';
  END IF;

  SELECT COALESCE(NULLIF(venue.timezone, ''), 'Europe/Stockholm')
  INTO v_timezone
  FROM public.venues venue
  WHERE venue.id = p_venue_id;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_availability_venue_not_found';
  END IF;

  SELECT COALESCE(array_agg(court_id ORDER BY court_id), '{}'::UUID[])
  INTO v_court_ids
  FROM (
    SELECT DISTINCT court_id
    FROM unnest(COALESCE(p_court_ids, '{}'::UUID[])) court_id
    WHERE court_id IS NOT NULL
  ) requested;

  IF cardinality(v_court_ids) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_availability_resources_required';
  END IF;

  WITH requested AS (
    SELECT requested.court_id,
           court.id IS NOT NULL AS belongs_to_venue,
           COALESCE(court.is_available, false) AS is_available
    FROM unnest(v_court_ids) requested(court_id)
    LEFT JOIN public.venue_courts court
      ON court.id = requested.court_id
     AND court.venue_id = p_venue_id
  ), local_dates AS (
    SELECT generated.day::DATE AS occurrence_date
    FROM generate_series(
      (p_starts_at AT TIME ZONE v_timezone)::DATE - 1,
      (p_ends_at AT TIME ZONE v_timezone)::DATE,
      interval '1 day'
    ) generated(day)
  ), opening_windows AS (
    SELECT hours.id,
           dates.occurrence_date,
           ((dates.occurrence_date + hours.open_time) AT TIME ZONE v_timezone) AS starts_at,
           (((dates.occurrence_date + CASE WHEN hours.close_time <= hours.open_time THEN 1 ELSE 0 END) + hours.close_time)
             AT TIME ZONE v_timezone) AS ends_at
    FROM local_dates dates
    JOIN public.opening_hours hours
      ON hours.venue_id = p_venue_id
     AND hours.day_of_week = EXTRACT(DOW FROM dates.occurrence_date)::INTEGER
     AND COALESCE(hours.is_closed, false) = false
  ), activity_occurrences AS (
    SELECT DISTINCT session.id AS source_id,
           occurrence.occurrence_date,
           requested.court_id AS resource_id,
           ((occurrence.occurrence_date + session.start_time) AT TIME ZONE v_timezone) AS starts_at,
           (((occurrence.occurrence_date + CASE WHEN session.end_time <= session.start_time THEN 1 ELSE 0 END) + session.end_time)
             AT TIME ZONE v_timezone) AS ends_at
    FROM requested
    JOIN public.activity_sessions session
      ON session.venue_id = p_venue_id
     AND session.is_active = true
     AND session.publish_status = 'published'
     AND requested.court_id = ANY(COALESCE(session.court_ids, '{}'::UUID[]))
    CROSS JOIN LATERAL (
      SELECT dates.occurrence_date
      FROM local_dates dates
      LEFT JOIN public.activity_series series ON series.id = session.series_id
      WHERE (
        session.session_date = dates.occurrence_date
        OR (
          session.session_date IS NULL
          AND EXTRACT(DOW FROM dates.occurrence_date)::INTEGER = ANY(COALESCE(session.recurrence_days, '{}'::INTEGER[]))
          AND (series.start_date IS NULL OR dates.occurrence_date >= series.start_date)
          AND (series.end_date IS NULL OR dates.occurrence_date <= series.end_date)
          AND (
            series.total_sessions IS NULL
            OR series.start_date IS NULL
            OR (
              SELECT count(*)
              FROM generate_series(series.start_date, dates.occurrence_date, interval '1 day') candidate(day)
              WHERE EXTRACT(DOW FROM candidate.day)::INTEGER = ANY(COALESCE(session.recurrence_days, '{}'::INTEGER[]))
            ) <= series.total_sessions
          )
        )
      )
    ) occurrence
    WHERE (
      p_exclude_activity_session_id IS NULL
      OR session.id <> p_exclude_activity_session_id
      OR (
        p_exclude_activity_occurrence_date IS NOT NULL
        AND occurrence.occurrence_date <> p_exclude_activity_occurrence_date
      )
    )
      AND (p_exclude_activity_series_id IS NULL OR session.series_id IS DISTINCT FROM p_exclude_activity_series_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.activity_session_overrides override
        WHERE override.venue_id = p_venue_id
          AND override.activity_session_id = session.id
          AND override.session_date = occurrence.occurrence_date
          AND override.status IN ('cancelled', 'hidden')
      )
  ), block_targets AS (
    SELECT block.id AS source_id,
           requested.court_id AS resource_id,
           block.starts_at,
           block.ends_at
    FROM requested
    JOIN public.event_resource_blocks block
      ON block.venue_id = p_venue_id
     AND block.blocks_public_booking = true
     AND block.status IN ('hold', 'confirmed')
     AND block.starts_at < p_ends_at
     AND block.ends_at > p_starts_at
     AND NOT (block.id = ANY(COALESCE(p_exclude_resource_block_ids, '{}'::UUID[])))
    LEFT JOIN public.event_resource_catalog resource
      ON resource.id = block.resource_catalog_id
     AND resource.venue_id = p_venue_id
    WHERE resource.venue_court_id = requested.court_id
       OR NULLIF(block.metadata->>'venue_court_id', '') = requested.court_id::TEXT
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(block.metadata->'venue_court_ids') = 'array'
             THEN block.metadata->'venue_court_ids' ELSE '[]'::JSONB END
         ) metadata_court(value)
         WHERE metadata_court.value = requested.court_id::TEXT
       )
       OR block.metadata->>'scope' = 'venue'
       OR lower(COALESCE(resource.resource_type, '')) IN ('venue', 'whole_venue')
  ), operation_targets AS (
    SELECT override.id AS source_id,
           requested.court_id AS resource_id,
           override.starts_at,
           override.ends_at
    FROM requested
    JOIN public.venue_operation_overrides override
      ON override.venue_id = p_venue_id
     AND override.status = 'active'
     AND override.id IS DISTINCT FROM p_exclude_operation_override_id
     AND override.starts_at < p_ends_at
     AND override.ends_at > p_starts_at
     AND (
       override.affects_entire_venue = true
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(override.metadata->'venue_court_ids') = 'array'
             THEN override.metadata->'venue_court_ids' ELSE '[]'::JSONB END
         ) override_court(value)
         WHERE override_court.value = requested.court_id::TEXT
       )
     )
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_resource_blocks linked
      WHERE linked.venue_id = p_venue_id
        AND linked.metadata->>'venue_operation_override_id' = override.id::TEXT
        AND linked.blocks_public_booking = true
        AND linked.status IN ('hold', 'confirmed')
        AND linked.id <> ALL(COALESCE(p_exclude_resource_block_ids, '{}'::UUID[]))
    )
  ), conflicts AS (
    SELECT 'court_unavailable'::TEXT AS type,
           requested.court_id AS resource_id,
           NULL::UUID AS source_id,
           NULL::DATE AS occurrence_date,
           p_starts_at AS starts_at,
           p_ends_at AS ends_at,
           10 AS sort_order
    FROM requested
    WHERE NOT requested.belongs_to_venue OR NOT requested.is_available

    UNION ALL

    SELECT 'venue_closed', requested.court_id, NULL::UUID,
           (p_starts_at AT TIME ZONE v_timezone)::DATE, p_starts_at, p_ends_at, 20
    FROM requested
    WHERE requested.belongs_to_venue
      AND EXISTS (SELECT 1 FROM public.opening_hours configured WHERE configured.venue_id = p_venue_id)
      AND NOT EXISTS (
        SELECT 1 FROM opening_windows opening_window
        WHERE p_starts_at >= opening_window.starts_at AND p_ends_at <= opening_window.ends_at
      )

    UNION ALL

    SELECT 'booking', booking.venue_court_id, booking.id, NULL::DATE,
           booking.start_time, booking.end_time, 30
    FROM public.bookings booking
    WHERE booking.venue_id = p_venue_id
      AND booking.venue_court_id = ANY(v_court_ids)
      AND booking.status <> 'cancelled'
      AND NOT (booking.id = ANY(COALESCE(p_exclude_booking_ids, '{}'::UUID[])))
      AND booking.start_time < p_ends_at
      AND booking.end_time > p_starts_at

    UNION ALL

    SELECT 'activity_occurrence', occurrence.resource_id, occurrence.source_id,
           occurrence.occurrence_date, occurrence.starts_at, occurrence.ends_at, 40
    FROM activity_occurrences occurrence
    WHERE occurrence.starts_at < p_ends_at
      AND occurrence.ends_at > p_starts_at

    UNION ALL

    SELECT 'resource_block', block.resource_id, block.source_id, NULL::DATE,
           block.starts_at, block.ends_at, 50
    FROM block_targets block

    UNION ALL

    SELECT 'venue_closed', operation.resource_id, operation.source_id, NULL::DATE,
           operation.starts_at, operation.ends_at, 21
    FROM operation_targets operation
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'type', conflicts.type,
        'resource_id', conflicts.resource_id,
        'source_id', conflicts.source_id,
        'occurrence_date', conflicts.occurrence_date,
        'starts_at', conflicts.starts_at,
        'ends_at', conflicts.ends_at
      )) ORDER BY conflicts.sort_order, conflicts.resource_id, conflicts.starts_at, conflicts.source_id
    ),
    '[]'::JSONB
  )
  INTO v_conflicts
  FROM conflicts;

  RETURN jsonb_build_object(
    'available', jsonb_array_length(v_conflicts) = 0,
    'venue_id', p_venue_id,
    'resource_ids', to_jsonb(v_court_ids),
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'interval_semantics', '[start,end)',
    'conflicts', v_conflicts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_physical_availability(
  UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID, DATE, UUID, UUID[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_physical_availability(
  UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID, DATE, UUID, UUID[], UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.lock_physical_resources(
  p_venue_id UUID,
  p_court_ids UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_court_id UUID;
BEGIN
  IF p_venue_id IS NULL OR cardinality(COALESCE(p_court_ids, '{}'::UUID[])) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_resource_lock_identity_required';
  END IF;

  FOR v_court_id IN
    SELECT DISTINCT court_id
    FROM unnest(p_court_ids) court_id
    WHERE court_id IS NOT NULL
    ORDER BY court_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext(p_venue_id::TEXT),
      hashtext('physical_resource:' || v_court_id::TEXT)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_physical_resources(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_physical_resources(UUID, UUID[]) TO service_role;

-- Course, League and the reviewed Corporate candidate already call this
-- primitive. Repoint it to the one global lock namespace.
CREATE OR REPLACE FUNCTION public.lock_course_resources(
  p_venue_id UUID,
  p_court_ids UUID[]
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.lock_physical_resources(p_venue_id, p_court_ids);
$$;

REVOKE ALL ON FUNCTION public.lock_course_resources(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_course_resources(UUID, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_physical_bookings(
  p_venue_id UUID,
  p_claims JSONB
) RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim JSONB;
  v_result JSONB;
  v_booking public.bookings%ROWTYPE;
  v_court_ids UUID[];
BEGIN
  IF p_venue_id IS NULL OR jsonb_typeof(p_claims) <> 'array'
     OR jsonb_array_length(p_claims) = 0 OR jsonb_array_length(p_claims) > 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_physical_booking_claim';
  END IF;

  SELECT array_agg(DISTINCT (claim->>'venue_court_id')::UUID ORDER BY (claim->>'venue_court_id')::UUID)
  INTO v_court_ids
  FROM jsonb_array_elements(p_claims) claim
  WHERE NULLIF(claim->>'venue_court_id', '') IS NOT NULL;

  IF cardinality(COALESCE(v_court_ids, '{}'::UUID[])) = 0
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_claims) claim
       WHERE NULLIF(claim->>'venue_id', '')::UUID IS DISTINCT FROM p_venue_id
          OR NULLIF(claim->>'venue_court_id', '') IS NULL
          OR NULLIF(claim->>'user_id', '') IS NULL
          OR NULLIF(claim->>'start_time', '') IS NULL
          OR NULLIF(claim->>'end_time', '') IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_booking_claim_identity_invalid';
  END IF;

  PERFORM public.lock_physical_resources(p_venue_id, v_court_ids);

  FOR v_claim IN SELECT value FROM jsonb_array_elements(p_claims)
  LOOP
    v_result := public.check_physical_availability(
      p_venue_id,
      ARRAY[(v_claim->>'venue_court_id')::UUID],
      (v_claim->>'start_time')::TIMESTAMPTZ,
      (v_claim->>'end_time')::TIMESTAMPTZ
    );
    IF NOT COALESCE((v_result->>'available')::BOOLEAN, false) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'physical_availability_conflict',
        DETAIL = v_result::TEXT;
    END IF;

    INSERT INTO public.bookings (
      venue_id, venue_court_id, user_id, start_time, end_time, status,
      total_price, currency, notes, booked_by, booking_ref,
      corporate_package_id, access_code, access_code_expires_at,
      stripe_session_id, membership_id, included_court_hours,
      paid_court_hours, membership_usage_entitlement_type,
      membership_usage_period_start, membership_usage_period_end, customer_id,
      participation_funding_mode, participation_funding_source_type,
      participation_funding_source_id, participation_funder
    ) VALUES (
      p_venue_id,
      (v_claim->>'venue_court_id')::UUID,
      (v_claim->>'user_id')::UUID,
      (v_claim->>'start_time')::TIMESTAMPTZ,
      (v_claim->>'end_time')::TIMESTAMPTZ,
      COALESCE(NULLIF(v_claim->>'status', ''), 'confirmed')::public.booking_status,
      NULLIF(v_claim->>'total_price', '')::NUMERIC,
      COALESCE(NULLIF(v_claim->>'currency', ''), 'SEK'),
      v_claim->>'notes',
      NULLIF(v_claim->>'booked_by', '')::UUID,
      NULLIF(v_claim->>'booking_ref', ''),
      NULLIF(v_claim->>'corporate_package_id', '')::UUID,
      NULLIF(v_claim->>'access_code', ''),
      NULLIF(v_claim->>'access_code_expires_at', '')::TIMESTAMPTZ,
      NULLIF(v_claim->>'stripe_session_id', ''),
      NULLIF(v_claim->>'membership_id', '')::UUID,
      COALESCE(NULLIF(v_claim->>'included_court_hours', '')::NUMERIC, 0),
      COALESCE(NULLIF(v_claim->>'paid_court_hours', '')::NUMERIC, 0),
      NULLIF(v_claim->>'membership_usage_entitlement_type', ''),
      NULLIF(v_claim->>'membership_usage_period_start', '')::DATE,
      NULLIF(v_claim->>'membership_usage_period_end', '')::DATE,
      NULLIF(v_claim->>'customer_id', '')::UUID,
      COALESCE(NULLIF(v_claim->>'participation_funding_mode', ''), 'unresolved'),
      NULLIF(v_claim->>'participation_funding_source_type', ''),
      NULLIF(v_claim->>'participation_funding_source_id', ''),
      NULLIF(v_claim->>'participation_funder', '')
    ) RETURNING * INTO v_booking;

    RETURN NEXT v_booking;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_physical_bookings(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_physical_bookings(UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_booking_physical_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  PERFORM public.lock_physical_resources(NEW.venue_id, ARRAY[NEW.venue_court_id]);
  v_result := public.check_physical_availability(
    NEW.venue_id,
    ARRAY[NEW.venue_court_id],
    NEW.start_time,
    NEW.end_time,
    ARRAY[NEW.id]
  );
  IF NOT COALESCE((v_result->>'available')::BOOLEAN, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'physical_availability_conflict', DETAIL = v_result::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_booking_physical_claim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_booking_physical_claim ON public.bookings;
CREATE TRIGGER trg_guard_booking_physical_claim
BEFORE INSERT OR UPDATE OF venue_id, venue_court_id, start_time, end_time, status
ON public.bookings FOR EACH ROW
EXECUTE FUNCTION public.guard_booking_physical_claim();

CREATE OR REPLACE FUNCTION public.check_physical_activity_schedule(
  p_venue_id UUID,
  p_court_ids UUID[],
  p_session_date DATE,
  p_recurrence_days INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_series_id UUID DEFAULT NULL,
  p_exclude_session_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_today DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_total_sessions INTEGER;
  v_date DATE;
  v_decision JSONB;
  v_occurrences JSONB := '[]'::JSONB;
  v_available BOOLEAN := true;
BEGIN
  IF p_venue_id IS NULL OR cardinality(COALESCE(p_court_ids, '{}'::UUID[])) = 0
     OR p_start_time IS NULL OR p_end_time IS NULL
     OR (p_session_date IS NULL AND cardinality(COALESCE(p_recurrence_days, '{}'::INTEGER[])) = 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_physical_activity_schedule';
  END IF;

  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm') INTO v_timezone
  FROM public.venues WHERE id = p_venue_id;
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'physical_availability_venue_not_found'; END IF;
  v_today := (now() AT TIME ZONE v_timezone)::DATE;

  IF p_session_date IS NOT NULL THEN
    v_start_date := p_session_date;
    v_end_date := p_session_date;
  ELSE
    SELECT COALESCE(series.start_date, v_today),
           COALESCE(series.end_date, v_today + 13),
           series.total_sessions
    INTO v_start_date, v_end_date, v_total_sessions
    FROM (SELECT 1) seed
    LEFT JOIN public.activity_series series ON series.id = p_series_id AND series.venue_id = p_venue_id;
    v_start_date := GREATEST(v_start_date, v_today);
    v_end_date := GREATEST(v_start_date, LEAST(v_end_date, v_start_date + 3660));
  END IF;

  FOR v_date IN
    WITH raw_dates AS (
      SELECT p_session_date AS occurrence_date WHERE p_session_date IS NOT NULL
      UNION
      SELECT day::DATE
      FROM generate_series(v_start_date, LEAST(v_end_date, v_start_date + 13), interval '1 day') day
      WHERE p_session_date IS NULL
      UNION
      SELECT (booking.start_time AT TIME ZONE v_timezone)::DATE + date_offset.day
      FROM public.bookings booking CROSS JOIN (VALUES (0), (-1)) date_offset(day)
      WHERE p_session_date IS NULL
        AND booking.venue_id = p_venue_id AND booking.status <> 'cancelled'
        AND booking.venue_court_id = ANY(p_court_ids)
        AND booking.start_time < ((v_end_date + 2)::TIMESTAMP AT TIME ZONE v_timezone)
        AND booking.end_time > ((v_start_date - 1)::TIMESTAMP AT TIME ZONE v_timezone)
      UNION
      SELECT (block.starts_at AT TIME ZONE v_timezone)::DATE + date_offset.day
      FROM public.event_resource_blocks block
      LEFT JOIN public.event_resource_catalog resource ON resource.id = block.resource_catalog_id
      CROSS JOIN (VALUES (0), (-1)) date_offset(day)
      WHERE p_session_date IS NULL
        AND block.venue_id = p_venue_id AND block.status IN ('hold', 'confirmed')
        AND block.blocks_public_booking = true
        AND block.starts_at < ((v_end_date + 2)::TIMESTAMP AT TIME ZONE v_timezone)
        AND block.ends_at > ((v_start_date - 1)::TIMESTAMP AT TIME ZONE v_timezone)
        AND (
          resource.venue_court_id = ANY(p_court_ids)
          OR block.metadata->>'scope' = 'venue'
          OR lower(COALESCE(resource.resource_type, '')) IN ('venue', 'whole_venue')
        )
      UNION
      SELECT session.session_date
      FROM public.activity_sessions session
      WHERE p_session_date IS NULL
        AND session.venue_id = p_venue_id AND session.session_date IS NOT NULL
        AND session.session_date BETWEEN v_start_date - 1 AND v_end_date + 1
        AND session.is_active = true AND session.publish_status = 'published'
        AND session.court_ids && p_court_ids
      UNION
      -- A recurring owner may begin well after the candidate's initial sample
      -- window. Add its first real, non-hidden intersecting occurrence so
      -- Series bounds cannot conceal a later Activity-vs-Activity conflict.
      SELECT owner_occurrence.occurrence_date
      FROM public.activity_sessions owner
      LEFT JOIN public.activity_series owner_series ON owner_series.id = owner.series_id
      CROSS JOIN LATERAL (
        SELECT day::DATE AS occurrence_date
        FROM generate_series(
          GREATEST(v_start_date, COALESCE(owner_series.start_date, v_start_date)),
          LEAST(v_end_date, COALESCE(owner_series.end_date, v_end_date)),
          interval '1 day'
        ) day
        WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
          AND EXTRACT(DOW FROM day)::INTEGER = ANY(COALESCE(owner.recurrence_days, '{}'::INTEGER[]))
          AND (
            owner_series.total_sessions IS NULL
            OR owner_series.start_date IS NULL
            OR (
              SELECT count(*)
              FROM generate_series(owner_series.start_date, day, interval '1 day') owner_candidate(owner_day)
              WHERE EXTRACT(DOW FROM owner_candidate.owner_day)::INTEGER = ANY(COALESCE(owner.recurrence_days, '{}'::INTEGER[]))
            ) <= owner_series.total_sessions
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.activity_session_overrides occurrence_override
            WHERE occurrence_override.venue_id = p_venue_id
              AND occurrence_override.activity_session_id = owner.id
              AND occurrence_override.session_date = day::DATE
              AND occurrence_override.status IN ('cancelled', 'hidden')
          )
        ORDER BY day
        LIMIT 1
      ) owner_occurrence
      WHERE p_session_date IS NULL
        AND owner.venue_id = p_venue_id
        AND owner.session_date IS NULL
        AND owner.is_active = true AND owner.publish_status = 'published'
        AND owner.court_ids && p_court_ids
        AND owner.id IS DISTINCT FROM p_exclude_session_id
        AND (p_series_id IS NULL OR owner.series_id IS DISTINCT FROM p_series_id)
      UNION
      SELECT (override.starts_at AT TIME ZONE v_timezone)::DATE + date_offset.day
      FROM public.venue_operation_overrides override CROSS JOIN (VALUES (0), (-1)) date_offset(day)
      WHERE p_session_date IS NULL
        AND override.venue_id = p_venue_id AND override.status = 'active'
        AND override.starts_at < ((v_end_date + 2)::TIMESTAMP AT TIME ZONE v_timezone)
        AND override.ends_at > ((v_start_date - 1)::TIMESTAMP AT TIME ZONE v_timezone)
    ), matching_dates AS (
      SELECT DISTINCT occurrence_date
      FROM raw_dates
      WHERE occurrence_date BETWEEN v_start_date AND v_end_date
        AND (
          p_session_date IS NOT NULL
          OR EXTRACT(DOW FROM occurrence_date)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
        )
        AND (
          p_session_date IS NOT NULL OR v_total_sessions IS NULL OR (
            SELECT count(*)
            FROM generate_series(v_start_date, occurrence_date, interval '1 day') candidate(day)
            WHERE EXTRACT(DOW FROM candidate.day)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
          ) <= v_total_sessions
        )
    )
    SELECT occurrence_date FROM matching_dates ORDER BY occurrence_date
  LOOP
    v_decision := public.check_physical_availability(
      p_venue_id,
      p_court_ids,
      ((v_date + p_start_time) AT TIME ZONE v_timezone),
      (((v_date + CASE WHEN p_end_time <= p_start_time THEN 1 ELSE 0 END) + p_end_time) AT TIME ZONE v_timezone),
      '{}'::UUID[], p_exclude_session_id, v_date, NULL, '{}'::UUID[], NULL
    );
    v_available := v_available AND COALESCE((v_decision->>'available')::BOOLEAN, false);
    v_occurrences := v_occurrences || jsonb_build_array(jsonb_build_object(
      'occurrence_date', v_date,
      'starts_at', v_decision->'starts_at',
      'ends_at', v_decision->'ends_at',
      'available', v_decision->'available',
      'conflicts', v_decision->'conflicts'
    ));
  END LOOP;

  IF jsonb_array_length(v_occurrences) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_activity_schedule_has_no_occurrences';
  END IF;

  RETURN jsonb_build_object(
    'available', v_available,
    'venue_id', p_venue_id,
    'resource_ids', to_jsonb(p_court_ids),
    'interval_semantics', '[start,end)',
    'occurrences', v_occurrences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_physical_activity_schedule(
  UUID, UUID[], DATE, INTEGER[], TIME, TIME, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_physical_activity_schedule(
  UUID, UUID[], DATE, INTEGER[], TIME, TIME, UUID, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_activity_session_physical_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true
     OR NEW.publish_status IS DISTINCT FROM 'published'
     OR cardinality(COALESCE(NEW.court_ids, '{}'::UUID[])) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public.lock_physical_resources(NEW.venue_id, NEW.court_ids);
  v_result := public.check_physical_activity_schedule(
    NEW.venue_id, NEW.court_ids, NEW.session_date, NEW.recurrence_days,
    NEW.start_time, NEW.end_time, NEW.series_id, NEW.id
  );
  IF NOT COALESCE((v_result->>'available')::BOOLEAN, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = CASE WHEN NEW.session_type IN ('course', 'league')
        THEN 'managed_series_resource_conflict' ELSE 'physical_availability_conflict' END,
      DETAIL = v_result::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_activity_session_physical_claim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_course_session_resource_conflict ON public.activity_sessions;
DROP TRIGGER IF EXISTS trg_guard_activity_session_physical_claim ON public.activity_sessions;
CREATE TRIGGER trg_guard_activity_session_physical_claim
BEFORE INSERT OR UPDATE OF venue_id, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status
ON public.activity_sessions FOR EACH ROW
EXECUTE FUNCTION public.guard_activity_session_physical_claim();

CREATE OR REPLACE FUNCTION public.guard_resource_block_physical_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_court_ids UUID[];
  v_result JSONB;
  v_override_id UUID;
BEGIN
  IF NEW.status NOT IN ('hold', 'confirmed') OR NEW.blocks_public_booking IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT court_id ORDER BY court_id), '{}'::UUID[])
  INTO v_court_ids
  FROM (
    SELECT resource.venue_court_id AS court_id
    FROM public.event_resource_catalog resource
    WHERE resource.id = NEW.resource_catalog_id AND resource.venue_id = NEW.venue_id
    UNION ALL
    SELECT NULLIF(NEW.metadata->>'venue_court_id', '')::UUID
    UNION ALL
    SELECT value::UUID
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.metadata->'venue_court_ids') = 'array'
        THEN NEW.metadata->'venue_court_ids' ELSE '[]'::JSONB END
    ) value
    UNION ALL
    SELECT court.id
    FROM public.venue_courts court
    LEFT JOIN public.event_resource_catalog resource ON resource.id = NEW.resource_catalog_id
    WHERE court.venue_id = NEW.venue_id
      AND (
        NEW.metadata->>'scope' = 'venue'
        OR lower(COALESCE(resource.resource_type, '')) IN ('venue', 'whole_venue')
      )
  ) targets
  WHERE court_id IS NOT NULL;

  IF cardinality(v_court_ids) = 0 THEN RETURN NEW; END IF;
  BEGIN
    v_override_id := NULLIF(NEW.metadata->>'venue_operation_override_id', '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_operation_override_identity';
  END;

  PERFORM public.lock_physical_resources(NEW.venue_id, v_court_ids);
  v_result := public.check_physical_availability(
    NEW.venue_id, v_court_ids, NEW.starts_at, NEW.ends_at,
    '{}'::UUID[], NULL, NULL, NULL, ARRAY[NEW.id], v_override_id
  );
  IF NOT COALESCE((v_result->>'available')::BOOLEAN, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'physical_availability_conflict', DETAIL = v_result::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_resource_block_physical_claim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_resource_block_physical_claim ON public.event_resource_blocks;
CREATE TRIGGER trg_guard_resource_block_physical_claim
BEFORE INSERT OR UPDATE OF venue_id, resource_catalog_id, starts_at, ends_at, status, blocks_public_booking, metadata
ON public.event_resource_blocks FOR EACH ROW
EXECUTE FUNCTION public.guard_resource_block_physical_claim();

CREATE OR REPLACE FUNCTION public.claim_physical_resource_blocks(
  p_venue_id UUID,
  p_claims JSONB
) RETURNS SETOF public.event_resource_blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim JSONB;
  v_block public.event_resource_blocks%ROWTYPE;
  v_court_ids UUID[];
BEGIN
  IF p_venue_id IS NULL OR jsonb_typeof(p_claims) <> 'array'
     OR jsonb_array_length(p_claims) = 0 OR jsonb_array_length(p_claims) > 128 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_physical_resource_block_claim';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_claims) claim
    WHERE NULLIF(claim->>'venue_id', '')::UUID IS DISTINCT FROM p_venue_id
       OR NULLIF(claim->>'starts_at', '') IS NULL
       OR NULLIF(claim->>'ends_at', '') IS NULL
       OR NULLIF(claim->>'title', '') IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_resource_block_claim_identity_invalid';
  END IF;

  WITH claims AS (
    SELECT claim,
           NULLIF(claim->>'resource_catalog_id', '')::UUID AS resource_catalog_id,
           COALESCE(claim->'metadata', '{}'::JSONB) AS metadata
    FROM jsonb_array_elements(p_claims) claim
  ), targets AS (
    SELECT resource.venue_court_id AS court_id
    FROM claims JOIN public.event_resource_catalog resource
      ON resource.id = claims.resource_catalog_id AND resource.venue_id = p_venue_id
    UNION
    SELECT NULLIF(claims.metadata->>'venue_court_id', '')::UUID FROM claims
    UNION
    SELECT metadata_court.value::UUID
    FROM claims
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(claims.metadata->'venue_court_ids') = 'array'
        THEN claims.metadata->'venue_court_ids' ELSE '[]'::JSONB END
    ) metadata_court(value)
    UNION
    SELECT court.id
    FROM claims
    LEFT JOIN public.event_resource_catalog resource ON resource.id = claims.resource_catalog_id
    JOIN public.venue_courts court ON court.venue_id = p_venue_id
    WHERE claims.metadata->>'scope' = 'venue'
       OR lower(COALESCE(resource.resource_type, '')) IN ('venue', 'whole_venue')
  )
  SELECT COALESCE(array_agg(DISTINCT court_id ORDER BY court_id), '{}'::UUID[])
  INTO v_court_ids
  FROM targets WHERE court_id IS NOT NULL;

  IF cardinality(v_court_ids) > 0 THEN
    PERFORM public.lock_physical_resources(p_venue_id, v_court_ids);
  END IF;

  FOR v_claim IN SELECT value FROM jsonb_array_elements(p_claims)
  LOOP
    INSERT INTO public.event_resource_blocks (
      venue_id, resource_catalog_id, event_id, event_lead_id, event_offer_id,
      title, reason, status, starts_at, ends_at, blocks_public_booking,
      created_by, metadata
    ) VALUES (
      p_venue_id,
      NULLIF(v_claim->>'resource_catalog_id', '')::UUID,
      NULLIF(v_claim->>'event_id', '')::UUID,
      NULLIF(v_claim->>'event_lead_id', '')::UUID,
      NULLIF(v_claim->>'event_offer_id', '')::UUID,
      v_claim->>'title',
      COALESCE(NULLIF(v_claim->>'reason', ''), 'manual'),
      COALESCE(NULLIF(v_claim->>'status', ''), 'hold'),
      (v_claim->>'starts_at')::TIMESTAMPTZ,
      (v_claim->>'ends_at')::TIMESTAMPTZ,
      COALESCE((v_claim->>'blocks_public_booking')::BOOLEAN, true),
      NULLIF(v_claim->>'created_by', '')::UUID,
      COALESCE(v_claim->'metadata', '{}'::JSONB)
    ) RETURNING * INTO v_block;
    RETURN NEXT v_block;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_physical_resource_blocks(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_physical_resource_blocks(UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_physical_resource_blocks(
  p_venue_id UUID,
  p_update_ids UUID[],
  p_release_ids UUID[],
  p_event_lead_id UUID,
  p_title TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_claims JSONB DEFAULT '[]'::JSONB
) RETURNS SETOF public.event_resource_blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_court_ids UUID[];
BEGIN
  IF p_venue_id IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_physical_resource_block_reconciliation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_resource_blocks block
    WHERE block.id = ANY(COALESCE(p_update_ids, '{}'::UUID[]) || COALESCE(p_release_ids, '{}'::UUID[]))
      AND block.venue_id <> p_venue_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cross_venue_physical_resource_block';
  END IF;

  WITH claim_rows AS (
    SELECT NULLIF(claim->>'resource_catalog_id', '')::UUID AS resource_catalog_id,
           COALESCE(claim->'metadata', '{}'::JSONB) AS metadata
    FROM jsonb_array_elements(COALESCE(p_claims, '[]'::JSONB)) claim
  ), targets AS (
    SELECT resource.venue_court_id AS court_id
    FROM public.event_resource_blocks block
    JOIN public.event_resource_catalog resource ON resource.id = block.resource_catalog_id
    WHERE block.venue_id = p_venue_id
      AND block.id = ANY(COALESCE(p_update_ids, '{}'::UUID[]) || COALESCE(p_release_ids, '{}'::UUID[]))
    UNION
    SELECT resource.venue_court_id
    FROM claim_rows JOIN public.event_resource_catalog resource
      ON resource.id = claim_rows.resource_catalog_id AND resource.venue_id = p_venue_id
    UNION
    SELECT NULLIF(claim_rows.metadata->>'venue_court_id', '')::UUID FROM claim_rows
  )
  SELECT COALESCE(array_agg(DISTINCT court_id ORDER BY court_id), '{}'::UUID[])
  INTO v_court_ids FROM targets WHERE court_id IS NOT NULL;
  IF cardinality(v_court_ids) > 0 THEN
    PERFORM public.lock_physical_resources(p_venue_id, v_court_ids);
  END IF;

  UPDATE public.event_resource_blocks
  SET status = 'released', blocks_public_booking = false
  WHERE venue_id = p_venue_id AND id = ANY(COALESCE(p_release_ids, '{}'::UUID[]));

  UPDATE public.event_resource_blocks
  SET event_lead_id = p_event_lead_id,
      title = p_title,
      reason = 'event',
      status = 'confirmed',
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      blocks_public_booking = true
  WHERE venue_id = p_venue_id AND id = ANY(COALESCE(p_update_ids, '{}'::UUID[]));

  IF jsonb_array_length(COALESCE(p_claims, '[]'::JSONB)) > 0 THEN
    PERFORM public.claim_physical_resource_blocks(p_venue_id, p_claims);
  END IF;

  RETURN QUERY
  SELECT block.*
  FROM public.event_resource_blocks block
  WHERE block.venue_id = p_venue_id
    AND block.id = ANY(COALESCE(p_update_ids, '{}'::UUID[]) || COALESCE(p_release_ids, '{}'::UUID[]))
  UNION ALL
  SELECT block.*
  FROM public.event_resource_blocks block
  WHERE block.venue_id = p_venue_id
    AND block.event_lead_id = p_event_lead_id
    AND block.starts_at = p_starts_at
    AND block.ends_at = p_ends_at
    AND block.status IN ('hold', 'confirmed');
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_physical_resource_blocks(
  UUID, UUID[], UUID[], UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_physical_resource_blocks(
  UUID, UUID[], UUID[], UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) TO service_role;

-- Preserve the established Course/League/Corporate preview signature while
-- making it a compatibility projection over the canonical decision.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_occurrence RECORD;
  v_court RECORD;
  v_decision JSONB;
BEGIN
  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm') INTO v_timezone
  FROM public.venues WHERE id = p_venue_id;
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'physical_availability_venue_not_found'; END IF;

  FOR v_occurrence IN
    SELECT row_number() OVER (ORDER BY day)::INTEGER AS occurrence_index, day::DATE AS occurrence_date
    FROM generate_series(p_start_date, p_end_date, interval '1 day') day
    WHERE EXTRACT(DOW FROM day)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
    ORDER BY day
    LIMIT GREATEST(COALESCE(p_total_sessions, 0), 0)
  LOOP
    FOR v_court IN
      SELECT requested.court_id, COALESCE(court.name, 'Okänd resurs') AS court_name
      FROM unnest(COALESCE(p_court_ids, '{}'::UUID[])) requested(court_id)
      LEFT JOIN public.venue_courts court
        ON court.id = requested.court_id AND court.venue_id = p_venue_id
      ORDER BY requested.court_id
    LOOP
      occurrence_index := v_occurrence.occurrence_index;
      occurrence_date := v_occurrence.occurrence_date;
      proposed_starts_at := ((occurrence_date + p_start_time) AT TIME ZONE v_timezone);
      proposed_ends_at := (((occurrence_date + CASE WHEN p_end_time <= p_start_time THEN 1 ELSE 0 END) + p_end_time) AT TIME ZONE v_timezone);
      court_id := v_court.court_id;
      court_name := v_court.court_name;
      v_decision := public.check_physical_availability(
        p_venue_id, ARRAY[court_id], proposed_starts_at, proposed_ends_at,
        '{}'::UUID[], p_exclude_session_id, occurrence_date,
        p_exclude_series_id, '{}'::UUID[], NULL
      );
      is_available := COALESCE((v_decision->>'available')::BOOLEAN, false);
      SELECT COALESCE(jsonb_agg(
        conflict || jsonb_build_object(
          -- Keep the established managed-Series compatibility label while the
          -- canonical `type` remains `activity_occurrence`.
          'source_type', CASE conflict->>'type'
            WHEN 'activity_occurrence' THEN 'activity_session'
            WHEN 'resource_block' THEN CASE WHEN EXISTS (
              SELECT 1 FROM public.event_resource_blocks legacy_block
              WHERE legacy_block.id = NULLIF(conflict->>'source_id', '')::UUID
                AND (legacy_block.event_id IS NOT NULL OR legacy_block.reason = 'event')
            ) THEN 'event_reservation' ELSE 'resource_block' END
            ELSE conflict->>'type'
          END,
          'title', CASE conflict->>'type'
            WHEN 'booking' THEN 'Bokning'
            WHEN 'activity_occurrence' THEN 'Aktivitet'
            WHEN 'resource_block' THEN 'Resursblockering'
            WHEN 'venue_closed' THEN 'Stängt'
            ELSE 'Bana ej tillgänglig'
          END
        ) ORDER BY conflict->>'starts_at', conflict->>'type', conflict->>'source_id'
      ), '[]'::JSONB)
      INTO conflicts
      FROM jsonb_array_elements(v_decision->'conflicts') conflict;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) TO service_role;

COMMENT ON FUNCTION public.check_physical_availability(
  UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID, DATE, UUID, UUID[], UUID
) IS 'Canonical PII-free physical court decision. Expands local activity occurrences and uses half-open [start,end) overlap semantics.';
COMMENT ON FUNCTION public.claim_physical_bookings(UUID, JSONB) IS
  'Atomic multi-court booking claim: deterministic physical locks, canonical recheck, then all-or-nothing inserts.';
COMMENT ON FUNCTION public.guard_activity_session_physical_claim() IS
  'Fail-closed physical guard for concrete and recurring Activity/Session court claims.';
COMMENT ON FUNCTION public.guard_resource_block_physical_claim() IS
  'Fail-closed physical guard for court-linked or venue-wide hold/confirmed resource blocks.';
COMMENT ON FUNCTION public.claim_physical_resource_blocks(UUID, JSONB) IS
  'Atomic B2B/operational court-block claim using the global physical lock namespace and guard.';
COMMENT ON FUNCTION public.reconcile_physical_resource_blocks(
  UUID, UUID[], UUID[], UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) IS 'Atomic B2B reschedule/release/claim boundary. One conflict rolls back the complete physical block change.';
COMMENT ON FUNCTION public.preview_course_resource_schedule(
  UUID, DATE, DATE, INTEGER[], TIME, TIME, INTEGER, UUID[], UUID, UUID
) IS 'Compatibility preview for Course, League and Corporate; every occurrence delegates to canonical physical availability.';
