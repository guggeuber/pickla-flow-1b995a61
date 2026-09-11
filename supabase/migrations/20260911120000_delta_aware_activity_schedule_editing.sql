-- Delta-aware recurring Activity schedule editing.
--
-- activity_sessions remains the current/prospective template. This compact
-- version table preserves prior template intervals without materializing every
-- occurrence. activity_session_overrides remains the per-occurrence exception
-- mechanism, so a future one-occurrence editor can build on the same model.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS schedule_effective_from DATE;

COMMENT ON COLUMN public.activity_sessions.schedule_effective_from IS
  'Local venue date from which the current recurring schedule fields apply. NULL means the legacy unversioned definition applies for all dates.';

CREATE TABLE IF NOT EXISTS public.activity_session_schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_until DATE,
  series_id UUID REFERENCES public.activity_series(id) ON DELETE SET NULL,
  series_start_date DATE,
  series_end_date DATE,
  series_total_sessions INTEGER,
  session_date DATE,
  recurrence_days INTEGER[],
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  court_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  publish_status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT activity_session_schedule_versions_window
    CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT activity_session_schedule_versions_shape
    CHECK (recurrence_days IS NOT NULL OR session_date IS NOT NULL),
  CONSTRAINT activity_session_schedule_versions_time_order
    CHECK (end_time > start_time OR (end_time = TIME '00:00' AND start_time > TIME '00:00')),
  UNIQUE (activity_session_id, effective_from)
);

-- Keep this migration safely repeatable in local verification databases where
-- an earlier draft may already have created the additive table.
ALTER TABLE public.activity_session_schedule_versions
  ADD COLUMN IF NOT EXISTS series_start_date DATE,
  ADD COLUMN IF NOT EXISTS series_end_date DATE,
  ADD COLUMN IF NOT EXISTS series_total_sessions INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_session_schedule_versions_open
  ON public.activity_session_schedule_versions(activity_session_id)
  WHERE effective_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_activity_session_schedule_versions_venue_window
  ON public.activity_session_schedule_versions(venue_id, effective_from, effective_until);

ALTER TABLE public.activity_session_schedule_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_session_schedule_versions_read ON public.activity_session_schedule_versions;
CREATE POLICY activity_session_schedule_versions_read
ON public.activity_session_schedule_versions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.venues venue
    JOIN public.activity_sessions session
      ON session.id = activity_session_schedule_versions.activity_session_id
     AND session.venue_id = venue.id
    WHERE venue.id = activity_session_schedule_versions.venue_id
      AND venue.is_public = true
      AND session.closed_to_public = false
  )
  OR EXISTS (
    SELECT 1 FROM public.venue_staff staff
    WHERE staff.venue_id = activity_session_schedule_versions.venue_id
      AND staff.user_id = auth.uid()
      AND staff.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles role
    WHERE role.user_id = auth.uid() AND role.role = 'super_admin'
  )
);

REVOKE ALL ON TABLE public.activity_session_schedule_versions FROM PUBLIC;
GRANT SELECT ON TABLE public.activity_session_schedule_versions TO anon, authenticated;
GRANT ALL ON TABLE public.activity_session_schedule_versions TO service_role;

CREATE OR REPLACE FUNCTION public.activity_schedule_definition_occurs(
  p_venue_id UUID,
  p_series_id UUID,
  p_session_date DATE,
  p_recurrence_days INTEGER[],
  p_occurrence_date DATE
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_occurrence_date IS NULL THEN false
    WHEN p_session_date IS NOT NULL THEN p_session_date = p_occurrence_date
    WHEN NOT (EXTRACT(DOW FROM p_occurrence_date)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))) THEN false
    ELSE COALESCE((
      SELECT
        (series.start_date IS NULL OR p_occurrence_date >= series.start_date)
        AND (series.end_date IS NULL OR p_occurrence_date <= series.end_date)
        AND (
          series.total_sessions IS NULL
          OR series.start_date IS NULL
          OR (
            SELECT count(*)
            FROM generate_series(series.start_date, p_occurrence_date, interval '1 day') candidate(day)
            WHERE EXTRACT(DOW FROM candidate.day)::INTEGER = ANY(COALESCE(p_recurrence_days, '{}'::INTEGER[]))
          ) <= series.total_sessions
        )
      FROM public.activity_series series
      WHERE series.id = p_series_id AND series.venue_id = p_venue_id
    ), p_series_id IS NULL)
  END;
$$;

REVOKE ALL ON FUNCTION public.activity_schedule_definition_occurs(UUID, UUID, DATE, INTEGER[], DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activity_schedule_definition_occurs(UUID, UUID, DATE, INTEGER[], DATE)
  TO service_role;

-- Resolves the immutable schedule definition for one local occurrence date.
-- It deliberately returns schedule/occupancy fields only.
CREATE OR REPLACE FUNCTION public.activity_session_schedule_at(
  p_activity_session_id UUID,
  p_occurrence_date DATE
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_version public.activity_session_schedule_versions%ROWTYPE;
  v_has_version BOOLEAN := false;
  v_series_id UUID;
  v_series_start_date DATE;
  v_series_end_date DATE;
  v_series_total_sessions INTEGER;
  v_session_date DATE;
  v_recurrence_days INTEGER[];
  v_start_time TIME;
  v_end_time TIME;
  v_court_ids UUID[];
  v_is_active BOOLEAN;
  v_publish_status TEXT;
  v_occurs BOOLEAN;
BEGIN
  IF p_activity_session_id IS NULL OR p_occurrence_date IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_session
  FROM public.activity_sessions session
  WHERE session.id = p_activity_session_id;
  IF v_session.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_version
  FROM public.activity_session_schedule_versions version
  WHERE version.activity_session_id = p_activity_session_id
    AND version.effective_from <= p_occurrence_date
    AND (version.effective_until IS NULL OR p_occurrence_date < version.effective_until)
  ORDER BY version.effective_from DESC
  LIMIT 1;
  v_has_version := v_version.id IS NOT NULL;

  IF NOT v_has_version
     AND v_session.schedule_effective_from IS NOT NULL
     AND p_occurrence_date < v_session.schedule_effective_from THEN
    RETURN NULL;
  END IF;

  v_series_id := CASE WHEN v_has_version THEN v_version.series_id ELSE v_session.series_id END;
  IF v_has_version THEN
    v_series_start_date := v_version.series_start_date;
    v_series_end_date := v_version.series_end_date;
    v_series_total_sessions := v_version.series_total_sessions;
  ELSE
    SELECT series.start_date, series.end_date, series.total_sessions
    INTO v_series_start_date, v_series_end_date, v_series_total_sessions
    FROM public.activity_series series
    WHERE series.id = v_session.series_id;
  END IF;
  v_session_date := CASE WHEN v_has_version THEN v_version.session_date ELSE v_session.session_date END;
  v_recurrence_days := CASE WHEN v_has_version THEN v_version.recurrence_days ELSE v_session.recurrence_days END;
  v_start_time := CASE WHEN v_has_version THEN v_version.start_time ELSE v_session.start_time END;
  v_end_time := CASE WHEN v_has_version THEN v_version.end_time ELSE v_session.end_time END;
  v_court_ids := CASE WHEN v_has_version THEN v_version.court_ids ELSE v_session.court_ids END;
  v_is_active := CASE WHEN v_has_version THEN v_version.is_active ELSE v_session.is_active END;
  v_publish_status := CASE WHEN v_has_version THEN v_version.publish_status ELSE v_session.publish_status END;
  v_occurs := CASE
    WHEN v_session_date IS NOT NULL THEN v_session_date = p_occurrence_date
    WHEN NOT (EXTRACT(DOW FROM p_occurrence_date)::INTEGER = ANY(COALESCE(v_recurrence_days, '{}'::INTEGER[]))) THEN false
    WHEN v_series_id IS NULL THEN true
    ELSE
      (v_series_start_date IS NULL OR p_occurrence_date >= v_series_start_date)
      AND (v_series_end_date IS NULL OR p_occurrence_date <= v_series_end_date)
      AND (
        v_series_total_sessions IS NULL
        OR v_series_start_date IS NULL
        OR (
          SELECT count(*)
          FROM generate_series(v_series_start_date, p_occurrence_date, interval '1 day') candidate(day)
          WHERE EXTRACT(DOW FROM candidate.day)::INTEGER = ANY(COALESCE(v_recurrence_days, '{}'::INTEGER[]))
        ) <= v_series_total_sessions
      )
  END;

  RETURN jsonb_build_object(
    'activity_session_id', v_session.id,
    'venue_id', v_session.venue_id,
    'occurrence_date', p_occurrence_date,
    'effective_from', CASE WHEN v_has_version THEN v_version.effective_from ELSE v_session.schedule_effective_from END,
    'effective_until', CASE WHEN v_has_version THEN v_version.effective_until ELSE NULL END,
    'series_id', v_series_id,
    'series_start_date', v_series_start_date,
    'series_end_date', v_series_end_date,
    'series_total_sessions', v_series_total_sessions,
    'session_date', v_session_date,
    'recurrence_days', to_jsonb(v_recurrence_days),
    'start_time', v_start_time,
    'end_time', v_end_time,
    'court_ids', to_jsonb(COALESCE(v_court_ids, '{}'::UUID[])),
    'is_active', v_is_active,
    'publish_status', v_publish_status,
    'occurs', v_occurs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activity_session_schedule_at(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activity_session_schedule_at(UUID, DATE) TO service_role;

-- Compare old and proposed physical identities. The canonical Foundation is
-- called only for set differences: newly added dates/courts/time slices.
CREATE OR REPLACE FUNCTION public.check_physical_activity_schedule_delta(
  p_venue_id UUID,
  p_session_id UUID,
  p_effective_from DATE,
  p_old_series_id UUID,
  p_old_session_date DATE,
  p_old_recurrence_days INTEGER[],
  p_old_start_time TIME,
  p_old_end_time TIME,
  p_old_court_ids UUID[],
  p_old_is_active BOOLEAN,
  p_old_publish_status TEXT,
  p_new_series_id UUID,
  p_new_session_date DATE,
  p_new_recurrence_days INTEGER[],
  p_new_start_time TIME,
  p_new_end_time TIME,
  p_new_court_ids UUID[],
  p_new_is_active BOOLEAN,
  p_new_publish_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone TEXT;
  v_preview JSONB;
  v_occurrence JSONB;
  v_date DATE;
  v_court_id UUID;
  v_old_occurs BOOLEAN;
  v_old_owns_court BOOLEAN;
  v_old_start TIMESTAMPTZ;
  v_old_end TIMESTAMPTZ;
  v_new_start TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
  v_segment_start TIMESTAMPTZ;
  v_segment_end TIMESTAMPTZ;
  v_decision JSONB;
  v_claims JSONB := '[]'::JSONB;
  v_conflicts JSONB := '[]'::JSONB;
  v_available BOOLEAN := true;
BEGIN
  IF p_venue_id IS NULL OR p_session_id IS NULL OR p_effective_from IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_activity_schedule_delta';
  END IF;

  SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm') INTO v_timezone
  FROM public.venues WHERE id = p_venue_id;
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_availability_venue_not_found';
  END IF;

  IF p_new_is_active IS DISTINCT FROM true
     OR p_new_publish_status IS DISTINCT FROM 'published'
     OR cardinality(COALESCE(p_new_court_ids, '{}'::UUID[])) = 0 THEN
    RETURN jsonb_build_object(
      'available', true,
      'effective_from', p_effective_from,
      'interval_semantics', '[start,end)',
      'new_claims', v_claims,
      'conflicts', v_conflicts
    );
  END IF;

  v_preview := public.check_physical_activity_schedule(
    p_venue_id,
    p_new_court_ids,
    p_new_session_date,
    p_new_recurrence_days,
    p_new_start_time,
    p_new_end_time,
    p_new_series_id,
    p_session_id
  );

  FOR v_occurrence IN SELECT value FROM jsonb_array_elements(v_preview->'occurrences')
  LOOP
    v_date := (v_occurrence->>'occurrence_date')::DATE;
    IF v_date < p_effective_from THEN CONTINUE; END IF;

    v_new_start := ((v_date + p_new_start_time) AT TIME ZONE v_timezone);
    v_new_end := (((v_date + CASE WHEN p_new_end_time <= p_new_start_time THEN 1 ELSE 0 END) + p_new_end_time) AT TIME ZONE v_timezone);
    v_old_occurs := p_old_is_active IS TRUE
      AND p_old_publish_status = 'published'
      AND public.activity_schedule_definition_occurs(
        p_venue_id, p_old_series_id, p_old_session_date, p_old_recurrence_days, v_date
      );
    v_old_start := ((v_date + p_old_start_time) AT TIME ZONE v_timezone);
    v_old_end := (((v_date + CASE WHEN p_old_end_time <= p_old_start_time THEN 1 ELSE 0 END) + p_old_end_time) AT TIME ZONE v_timezone);

    FOR v_court_id IN
      SELECT DISTINCT court_id
      FROM unnest(COALESCE(p_new_court_ids, '{}'::UUID[])) requested(court_id)
      WHERE court_id IS NOT NULL
      ORDER BY court_id
    LOOP
      v_old_owns_court := v_old_occurs AND v_court_id = ANY(COALESCE(p_old_court_ids, '{}'::UUID[]));

      FOR v_segment_start, v_segment_end IN
        SELECT segment.starts_at, segment.ends_at
        FROM (
          SELECT v_new_start AS starts_at, v_new_end AS ends_at
          WHERE NOT v_old_owns_court
          UNION ALL
          SELECT v_new_start, LEAST(v_new_end, v_old_start)
          WHERE v_old_owns_court AND v_new_start < v_old_start
          UNION ALL
          SELECT GREATEST(v_new_start, v_old_end), v_new_end
          WHERE v_old_owns_court AND v_new_end > v_old_end
        ) segment
        WHERE segment.ends_at > segment.starts_at
        ORDER BY segment.starts_at
      LOOP
        v_decision := public.check_physical_availability(
          p_venue_id,
          ARRAY[v_court_id],
          v_segment_start,
          v_segment_end,
          '{}'::UUID[],
          p_session_id,
          v_date,
          NULL,
          '{}'::UUID[],
          NULL
        );
        v_claims := v_claims || jsonb_build_array(jsonb_build_object(
          'occurrence_date', v_date,
          'resource_id', v_court_id,
          'starts_at', v_segment_start,
          'ends_at', v_segment_end,
          'available', v_decision->'available',
          'conflicts', v_decision->'conflicts'
        ));
        IF NOT COALESCE((v_decision->>'available')::BOOLEAN, false) THEN
          v_available := false;
          v_conflicts := v_conflicts || COALESCE((
            SELECT jsonb_agg(
              conflict.value || jsonb_build_object(
                'occurrence_date', v_date,
                'claim_starts_at', v_segment_start,
                'claim_ends_at', v_segment_end
              )
            )
            FROM jsonb_array_elements(v_decision->'conflicts') conflict(value)
          ), '[]'::JSONB);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'available', v_available,
    'venue_id', p_venue_id,
    'activity_session_id', p_session_id,
    'effective_from', p_effective_from,
    'interval_semantics', '[start,end)',
    'new_claims', v_claims,
    'conflicts', v_conflicts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_physical_activity_schedule_delta(
  UUID, UUID, DATE, UUID, DATE, INTEGER[], TIME, TIME, UUID[], BOOLEAN, TEXT,
  UUID, DATE, INTEGER[], TIME, TIME, UUID[], BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_physical_activity_schedule_delta(
  UUID, UUID, DATE, UUID, DATE, INTEGER[], TIME, TIME, UUID[], BOOLEAN, TEXT,
  UUID, DATE, INTEGER[], TIME, TIME, UUID[], BOOLEAN, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_activity_session_physical_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_timezone TEXT;
  v_today DATE;
  v_effective_from DATE;
  v_origin DATE;
  v_open_version public.activity_session_schedule_versions%ROWTYPE;
  v_is_recurring_edit BOOLEAN := false;
  v_any_schedule_change BOOLEAN := false;
  v_lock_court_ids UUID[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_any_schedule_change :=
      OLD.venue_id IS DISTINCT FROM NEW.venue_id
      OR OLD.series_id IS DISTINCT FROM NEW.series_id
      OR OLD.session_date IS DISTINCT FROM NEW.session_date
      OR OLD.recurrence_days IS DISTINCT FROM NEW.recurrence_days
      OR OLD.start_time IS DISTINCT FROM NEW.start_time
      OR OLD.end_time IS DISTINCT FROM NEW.end_time
      OR OLD.court_ids IS DISTINCT FROM NEW.court_ids
      OR OLD.is_active IS DISTINCT FROM NEW.is_active
      OR OLD.publish_status IS DISTINCT FROM NEW.publish_status;
    IF NOT v_any_schedule_change THEN RETURN NEW; END IF;
    v_is_recurring_edit := (OLD.session_date IS NULL OR NEW.session_date IS NULL);
  END IF;

  IF TG_OP = 'UPDATE' AND v_is_recurring_edit THEN
    IF OLD.venue_id IS DISTINCT FROM NEW.venue_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity_schedule_venue_immutable';
    END IF;

    SELECT COALESCE(NULLIF(timezone, ''), 'Europe/Stockholm') INTO v_timezone
    FROM public.venues WHERE id = NEW.venue_id;
    IF v_timezone IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'physical_availability_venue_not_found';
    END IF;
    v_today := (now() AT TIME ZONE v_timezone)::DATE;
    v_effective_from := COALESCE(NEW.schedule_effective_from, v_today + 1);
    IF v_effective_from < v_today + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity_schedule_effective_from_must_be_prospective';
    END IF;
    NEW.schedule_effective_from := v_effective_from;

    SELECT ARRAY(
      SELECT DISTINCT court_id
      FROM unnest(COALESCE(OLD.court_ids, '{}'::UUID[]) || COALESCE(NEW.court_ids, '{}'::UUID[])) court_id
      WHERE court_id IS NOT NULL
      ORDER BY court_id
    ) INTO v_lock_court_ids;
    IF cardinality(COALESCE(v_lock_court_ids, '{}'::UUID[])) > 0 THEN
      PERFORM public.lock_physical_resources(NEW.venue_id, v_lock_court_ids);
    END IF;

    v_result := public.check_physical_activity_schedule_delta(
      NEW.venue_id, NEW.id, v_effective_from,
      OLD.series_id, OLD.session_date, OLD.recurrence_days, OLD.start_time, OLD.end_time,
      OLD.court_ids, OLD.is_active, OLD.publish_status,
      NEW.series_id, NEW.session_date, NEW.recurrence_days, NEW.start_time, NEW.end_time,
      NEW.court_ids, NEW.is_active, NEW.publish_status
    );
    IF NOT COALESCE((v_result->>'available')::BOOLEAN, false) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = CASE WHEN NEW.session_type IN ('course', 'league')
          THEN 'managed_series_resource_conflict' ELSE 'physical_availability_conflict' END,
        DETAIL = v_result::TEXT;
    END IF;

    SELECT * INTO v_open_version
    FROM public.activity_session_schedule_versions version
    WHERE version.activity_session_id = OLD.id AND version.effective_until IS NULL
    FOR UPDATE;

    IF v_open_version.id IS NULL THEN
      SELECT LEAST(
        (OLD.created_at AT TIME ZONE v_timezone)::DATE,
        (SELECT min(registration.session_date) FROM public.session_registrations registration
          WHERE registration.activity_session_id = OLD.id),
        (SELECT min(occurrence_override.session_date) FROM public.activity_session_overrides occurrence_override
          WHERE occurrence_override.activity_session_id = OLD.id),
        (SELECT series.start_date FROM public.activity_series series WHERE series.id = OLD.series_id)
      ) INTO v_origin;
      v_origin := COALESCE(v_origin, (OLD.created_at AT TIME ZONE v_timezone)::DATE);
      IF v_origin < v_effective_from THEN
        INSERT INTO public.activity_session_schedule_versions (
          venue_id, activity_session_id, effective_from, effective_until,
          series_id, series_start_date, series_end_date, series_total_sessions,
          session_date, recurrence_days, start_time, end_time,
          court_ids, is_active, publish_status, created_by
        ) VALUES (
          OLD.venue_id, OLD.id, v_origin, v_effective_from,
          OLD.series_id,
          (SELECT series.start_date FROM public.activity_series series WHERE series.id = OLD.series_id),
          (SELECT series.end_date FROM public.activity_series series WHERE series.id = OLD.series_id),
          (SELECT series.total_sessions FROM public.activity_series series WHERE series.id = OLD.series_id),
          OLD.session_date, OLD.recurrence_days, OLD.start_time, OLD.end_time,
          OLD.court_ids, OLD.is_active, OLD.publish_status, auth.uid()
        );
      END IF;
    ELSIF v_effective_from < v_open_version.effective_from THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity_schedule_effective_from_precedes_current_version';
    ELSIF v_effective_from > v_open_version.effective_from THEN
      UPDATE public.activity_session_schedule_versions
      SET effective_until = v_effective_from
      WHERE id = v_open_version.id;
    END IF;

    INSERT INTO public.activity_session_schedule_versions (
      venue_id, activity_session_id, effective_from, effective_until,
      series_id, series_start_date, series_end_date, series_total_sessions,
      session_date, recurrence_days, start_time, end_time,
      court_ids, is_active, publish_status, created_by
    ) VALUES (
      NEW.venue_id, NEW.id, v_effective_from, NULL,
      NEW.series_id,
      (SELECT series.start_date FROM public.activity_series series WHERE series.id = NEW.series_id),
      (SELECT series.end_date FROM public.activity_series series WHERE series.id = NEW.series_id),
      (SELECT series.total_sessions FROM public.activity_series series WHERE series.id = NEW.series_id),
      NEW.session_date, NEW.recurrence_days, NEW.start_time, NEW.end_time,
      NEW.court_ids, NEW.is_active, NEW.publish_status, auth.uid()
    )
    ON CONFLICT (activity_session_id, effective_from) DO UPDATE SET
      venue_id = EXCLUDED.venue_id,
      effective_until = NULL,
      series_id = EXCLUDED.series_id,
      series_start_date = EXCLUDED.series_start_date,
      series_end_date = EXCLUDED.series_end_date,
      series_total_sessions = EXCLUDED.series_total_sessions,
      session_date = EXCLUDED.session_date,
      recurrence_days = EXCLUDED.recurrence_days,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      court_ids = EXCLUDED.court_ids,
      is_active = EXCLUDED.is_active,
      publish_status = EXCLUDED.publish_status,
      created_by = EXCLUDED.created_by;

    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM true
     OR NEW.publish_status IS DISTINCT FROM 'published'
     OR cardinality(COALESCE(NEW.court_ids, '{}'::UUID[])) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public.lock_physical_resources(NEW.venue_id, NEW.court_ids);
  v_result := public.check_physical_activity_schedule(
    NEW.venue_id, NEW.court_ids, NEW.session_date, NEW.recurrence_days,
    NEW.start_time, NEW.end_time, NEW.series_id,
    CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END
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
DROP TRIGGER IF EXISTS trg_guard_activity_session_physical_claim ON public.activity_sessions;
CREATE TRIGGER trg_guard_activity_session_physical_claim
BEFORE INSERT OR UPDATE OF venue_id, series_id, session_date, recurrence_days, start_time, end_time,
  court_ids, is_active, publish_status, schedule_effective_from
ON public.activity_sessions FOR EACH ROW
EXECUTE FUNCTION public.guard_activity_session_physical_claim();

-- Keep the Physical Availability Foundation authoritative on both sides of an
-- effective-from boundary. Only the Activity occurrence source changes here;
-- booking, resource-block, closure and interval semantics are unchanged.
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
      ON court.id = requested.court_id AND court.venue_id = p_venue_id
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
           dates.occurrence_date,
           requested.court_id AS resource_id,
           ((dates.occurrence_date + (schedule.definition->>'start_time')::TIME) AT TIME ZONE v_timezone) AS starts_at,
           (((dates.occurrence_date + CASE
                WHEN (schedule.definition->>'end_time')::TIME <= (schedule.definition->>'start_time')::TIME THEN 1 ELSE 0 END)
              + (schedule.definition->>'end_time')::TIME) AT TIME ZONE v_timezone) AS ends_at,
           NULLIF(schedule.definition->>'series_id', '')::UUID AS series_id
    FROM requested
    JOIN public.activity_sessions session ON session.venue_id = p_venue_id
    CROSS JOIN local_dates dates
    CROSS JOIN LATERAL (
      SELECT public.activity_session_schedule_at(session.id, dates.occurrence_date) AS definition
    ) schedule
    WHERE schedule.definition IS NOT NULL
      AND COALESCE((schedule.definition->>'occurs')::BOOLEAN, false)
      AND COALESCE((schedule.definition->>'is_active')::BOOLEAN, false)
      AND schedule.definition->>'publish_status' = 'published'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(schedule.definition->'court_ids', '[]'::JSONB)) court(value)
        WHERE court.value = requested.court_id::TEXT
      )
      AND (
        p_exclude_activity_session_id IS NULL
        OR session.id <> p_exclude_activity_session_id
        OR (
          p_exclude_activity_occurrence_date IS NOT NULL
          AND dates.occurrence_date <> p_exclude_activity_occurrence_date
        )
      )
      AND (
        p_exclude_activity_series_id IS NULL
        OR NULLIF(schedule.definition->>'series_id', '')::UUID IS DISTINCT FROM p_exclude_activity_series_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.activity_session_overrides occurrence_override
        WHERE occurrence_override.venue_id = p_venue_id
          AND occurrence_override.activity_session_id = session.id
          AND occurrence_override.session_date = dates.occurrence_date
          AND occurrence_override.status IN ('cancelled', 'hidden')
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
      ON resource.id = block.resource_catalog_id AND resource.venue_id = p_venue_id
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
    SELECT operation.id AS source_id,
           requested.court_id AS resource_id,
           operation.starts_at,
           operation.ends_at
    FROM requested
    JOIN public.venue_operation_overrides operation
      ON operation.venue_id = p_venue_id
     AND operation.status = 'active'
     AND operation.id IS DISTINCT FROM p_exclude_operation_override_id
     AND operation.starts_at < p_ends_at
     AND operation.ends_at > p_starts_at
     AND (
       operation.affects_entire_venue = true
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(operation.metadata->'venue_court_ids') = 'array'
             THEN operation.metadata->'venue_court_ids' ELSE '[]'::JSONB END
         ) operation_court(value)
         WHERE operation_court.value = requested.court_id::TEXT
       )
     )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_resource_blocks linked
      WHERE linked.venue_id = p_venue_id
        AND linked.metadata->>'venue_operation_override_id' = operation.id::TEXT
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
    WHERE occurrence.starts_at < p_ends_at AND occurrence.ends_at > p_starts_at

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
  ) INTO v_conflicts
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

-- Historical registration counts resolve against the dated definition rather
-- than today's mutable template.
CREATE OR REPLACE FUNCTION public.get_session_public_context(
  p_session_id UUID,
  p_session_date DATE
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target AS (
    SELECT
      session.id,
      session.venue_id,
      COALESCE(p_session_date, session.session_date) AS occurrence_date
    FROM public.activity_sessions AS session
    JOIN public.venues AS venue ON venue.id = session.venue_id
    CROSS JOIN LATERAL (
      SELECT public.activity_session_schedule_at(
        session.id,
        COALESCE(p_session_date, session.session_date)
      ) AS definition
    ) schedule
    WHERE session.id = p_session_id
      AND COALESCE(p_session_date, session.session_date) IS NOT NULL
      AND schedule.definition IS NOT NULL
      AND COALESCE((schedule.definition->>'occurs')::BOOLEAN, false)
      AND COALESCE((schedule.definition->>'is_active')::BOOLEAN, false)
      AND schedule.definition->>'publish_status' = 'published'
      AND session.closed_to_public = false
      AND venue.is_public = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.activity_session_overrides AS occurrence_override
        WHERE occurrence_override.activity_session_id = session.id
          AND occurrence_override.session_date = COALESCE(p_session_date, session.session_date)
          AND occurrence_override.status IN ('hidden', 'cancelled')
      )
  ), counted AS (
    SELECT
      COUNT(participation.id)::INTEGER AS attendee_count,
      COALESCE(BOOL_OR(participation.role = 'host'), false) AS host_present
    FROM target
    LEFT JOIN public.session_registrations AS participation
      ON participation.activity_session_id = target.id
     AND participation.session_date = target.occurrence_date
     AND participation.status IN ('confirmed', 'checked_in', 'attended')
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM target)
    THEN jsonb_build_object(
      'attendee_count', counted.attendee_count,
      'host_present', counted.host_present
    )
    ELSE NULL
  END
  FROM counted;
$$;

REVOKE EXECUTE ON FUNCTION public.get_session_public_context(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_public_context(UUID, DATE) TO service_role;

-- The authenticated batch projection uses the same dated resolver. Its privacy
-- projection and attendee ordering are otherwise unchanged.
CREATE OR REPLACE FUNCTION public.get_session_social_context_batch(p_occurrences JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_user_id UUID := auth.uid();
  v_caller_person_id UUID;
  v_result JSONB;
BEGIN
  IF v_caller_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_caller_user_id
      AND COALESCE(auth_user.email_confirmed_at, auth_user.phone_confirmed_at) IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'verified_account_required';
  END IF;

  SELECT COALESCE(person.merged_into_id, person.id)
  INTO v_caller_person_id
  FROM public.customers AS person
  WHERE person.auth_user_id = v_caller_user_id
    AND person.status = 'active'
  ORDER BY (person.merged_into_id IS NULL) DESC, person.created_at ASC
  LIMIT 1;

  WITH requested AS MATERIALIZED (
    SELECT
      request.ordinality::INTEGER AS ordinal,
      NULLIF(request.value->>'session_id', '')::UUID AS session_id,
      NULLIF(request.value->>'session_date', '')::DATE AS requested_date
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_occurrences) = 'array' THEN p_occurrences ELSE '[]'::JSONB END
    ) WITH ORDINALITY AS request(value, ordinality)
    LIMIT 32
  ), target AS MATERIALIZED (
    SELECT
      requested.ordinal,
      session.id AS session_id,
      session.venue_id,
      (schedule.definition->>'start_time')::TIME AS start_time,
      COALESCE(requested.requested_date, session.session_date) AS session_date,
      (
        COALESCE((schedule.definition->>'is_active')::BOOLEAN, false)
        AND schedule.definition->>'publish_status' = 'published'
        AND session.closed_to_public = false
        AND venue.is_public = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.activity_session_overrides AS occurrence_override
          WHERE occurrence_override.activity_session_id = session.id
            AND occurrence_override.session_date = COALESCE(requested.requested_date, session.session_date)
            AND occurrence_override.status IN ('hidden', 'cancelled')
        )
      ) AS is_public
    FROM requested
    JOIN public.activity_sessions AS session ON session.id = requested.session_id
    JOIN public.venues AS venue ON venue.id = session.venue_id
    CROSS JOIN LATERAL (
      SELECT public.activity_session_schedule_at(
        session.id,
        COALESCE(requested.requested_date, session.session_date)
      ) AS definition
    ) schedule
    WHERE COALESCE(requested.requested_date, session.session_date) IS NOT NULL
      AND schedule.definition IS NOT NULL
      AND COALESCE((schedule.definition->>'occurs')::BOOLEAN, false)
  ), authorized_target AS MATERIALIZED (
    SELECT target.*
    FROM target
    WHERE target.is_public
      OR EXISTS (
        SELECT 1
        FROM public.session_registrations AS own_participation
        LEFT JOIN public.customers AS own_direct_person
          ON own_direct_person.id = own_participation.customer_id
        LEFT JOIN public.customers AS own_user_person
          ON own_participation.customer_id IS NULL
         AND own_user_person.auth_user_id = own_participation.user_id
         AND own_user_person.status = 'active'
        WHERE own_participation.activity_session_id = target.session_id
          AND own_participation.session_date = target.session_date
          AND own_participation.status IN ('confirmed', 'checked_in', 'attended')
          AND COALESCE(
            own_direct_person.merged_into_id,
            own_direct_person.id,
            own_user_person.merged_into_id,
            own_user_person.id
          ) = v_caller_person_id
      )
  ), occurrence_participations AS MATERIALIZED (
    SELECT
      target.ordinal,
      target.session_id,
      target.session_date,
      target.venue_id,
      target.start_time,
      participation.id AS participation_id,
      participation.role,
      participation.registered_at,
      participation.dependent_participant_id,
      COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id) AS person_id
    FROM authorized_target AS target
    JOIN public.session_registrations AS participation
      ON participation.activity_session_id = target.session_id
     AND participation.session_date = target.session_date
     AND participation.status IN ('confirmed', 'checked_in', 'attended')
    LEFT JOIN public.customers AS direct_person ON direct_person.id = participation.customer_id
    LEFT JOIN public.customers AS user_person
      ON participation.customer_id IS NULL
     AND user_person.auth_user_id = participation.user_id
     AND user_person.status = 'active'
  ), occurrence_people AS MATERIALIZED (
    SELECT
      participation.ordinal,
      participation.session_id,
      participation.session_date,
      participation.venue_id,
      participation.start_time,
      participation.person_id,
      BOOL_OR(participation.role = 'host') AS is_host,
      MIN(participation.registered_at) AS registered_at
    FROM occurrence_participations AS participation
    WHERE participation.dependent_participant_id IS NULL
      AND participation.person_id IS NOT NULL
    GROUP BY
      participation.ordinal,
      participation.session_id,
      participation.session_date,
      participation.venue_id,
      participation.start_time,
      participation.person_id
  ), history_people AS MATERIALIZED (
    SELECT DISTINCT
      target.ordinal,
      history.activity_session_id,
      history.session_date,
      COALESCE(
        history_direct_person.merged_into_id,
        history_direct_person.id,
        history_user_person.merged_into_id,
        history_user_person.id
      ) AS person_id
    FROM authorized_target AS target
    JOIN public.session_registrations AS history
      ON history.venue_id = target.venue_id
     AND history.status IN ('checked_in', 'attended')
     AND history.dependent_participant_id IS NULL
    LEFT JOIN public.customers AS history_direct_person
      ON history_direct_person.id = history.customer_id
    LEFT JOIN public.customers AS history_user_person
      ON history.customer_id IS NULL
     AND history_user_person.auth_user_id = history.user_id
     AND history_user_person.status = 'active'
    JOIN public.activity_sessions AS history_session
      ON history_session.id = history.activity_session_id
    CROSS JOIN LATERAL (
      SELECT public.activity_session_schedule_at(history_session.id, history.session_date) AS definition
    ) history_schedule
    WHERE history.session_date < target.session_date
       OR (
         history.session_date = target.session_date
         AND (history_schedule.definition->>'start_time')::TIME < target.start_time
       )
  ), prior_people AS MATERIALIZED (
    SELECT DISTINCT current_person.ordinal, current_person.person_id
    FROM occurrence_people AS current_person
    JOIN history_people AS history
      ON history.ordinal = current_person.ordinal
     AND history.person_id = current_person.person_id
  ), caller_history AS MATERIALIZED (
    SELECT DISTINCT
      history.ordinal,
      history.activity_session_id,
      history.session_date
    FROM history_people AS history
    WHERE history.person_id = v_caller_person_id
  ), shared_people AS MATERIALIZED (
    SELECT DISTINCT caller_history.ordinal, COALESCE(direct_person.merged_into_id, direct_person.id, user_person.merged_into_id, user_person.id) AS person_id
    FROM caller_history
    JOIN public.session_registrations AS peer_history
      ON peer_history.activity_session_id = caller_history.activity_session_id
     AND peer_history.session_date = caller_history.session_date
     AND peer_history.status IN ('checked_in', 'attended')
     AND peer_history.dependent_participant_id IS NULL
    LEFT JOIN public.customers AS direct_person ON direct_person.id = peer_history.customer_id
    LEFT JOIN public.customers AS user_person
      ON peer_history.customer_id IS NULL
     AND user_person.auth_user_id = peer_history.user_id
     AND user_person.status = 'active'
  ), visible_people AS MATERIALIZED (
    SELECT
      current_person.*,
      person.social_visibility,
      NULLIF(BTRIM(COALESCE(person.first_name, profile.first_name, split_part(COALESCE(person.display_name, profile.display_name, ''), ' ', 1))), '') AS first_name,
      NULLIF(BTRIM(COALESCE(
        person.last_name,
        profile.last_name,
        CASE
          WHEN BTRIM(COALESCE(person.display_name, profile.display_name, '')) LIKE '% %'
          THEN regexp_replace(BTRIM(COALESCE(person.display_name, profile.display_name, '')), '^.*\s+', '')
          ELSE NULL
        END
      )), '') AS last_name,
      profile.avatar_url,
      EXISTS (
        SELECT 1 FROM prior_people
        WHERE prior_people.ordinal = current_person.ordinal
          AND prior_people.person_id = current_person.person_id
      ) AS has_prior_visit,
      (
        current_person.person_id <> v_caller_person_id
        AND EXISTS (
          SELECT 1 FROM shared_people
          WHERE shared_people.ordinal = current_person.ordinal
            AND shared_people.person_id = current_person.person_id
        )
      ) AS has_shared_history
    FROM occurrence_people AS current_person
    JOIN public.customers AS person
      ON person.id = current_person.person_id
     AND person.status = 'active'
     AND person.merged_into_id IS NULL
    LEFT JOIN LATERAL (
      SELECT candidate.first_name, candidate.last_name, candidate.display_name, candidate.avatar_url
      FROM public.player_profiles AS candidate
      WHERE candidate.customer_id = person.id
         OR (person.auth_user_id IS NOT NULL AND candidate.auth_user_id = person.auth_user_id)
      ORDER BY (candidate.customer_id = person.id) DESC, candidate.updated_at DESC NULLS LAST, candidate.id
      LIMIT 1
    ) AS profile ON true
  ), ranked_visible_people AS MATERIALIZED (
    SELECT
      visible_people.*,
      ROW_NUMBER() OVER (
        PARTITION BY visible_people.ordinal
        ORDER BY visible_people.is_host DESC, visible_people.registered_at, visible_people.person_id
      ) AS visible_rank
    FROM visible_people
  ), contexts AS (
    SELECT
      target.ordinal,
      target.session_id,
      target.session_date,
      jsonb_build_object(
        'session_id', target.session_id,
        'session_date', target.session_date,
        'attendee_count', COUNT(participation.participation_id)::INTEGER,
        'hidden_count', COUNT(participation.participation_id) FILTER (
          WHERE participation.dependent_participant_id IS NOT NULL
             OR participation.person_id IS NULL
             OR visible_person.social_visibility IS DISTINCT FROM 'visible'
        )::INTEGER,
        'first_visit_count', COUNT(DISTINCT visible_person.person_id) FILTER (
          WHERE visible_person.social_visibility = 'visible'
            AND visible_person.has_prior_visit = false
        )::INTEGER,
        'shared_history_count', COUNT(DISTINCT visible_person.person_id) FILTER (
          WHERE visible_person.social_visibility = 'visible'
            AND visible_person.has_shared_history
        )::INTEGER,
        'attendees', COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object(
            'person_id', visible_person.person_id,
            'display_name', CASE
              WHEN visible_person.last_name IS NOT NULL
              THEN visible_person.first_name || ' ' || UPPER(LEFT(visible_person.last_name, 1)) || '.'
              ELSE visible_person.first_name
            END,
            'avatar_url', visible_person.avatar_url,
            'is_host', visible_person.is_host,
            'is_first_visit', NOT visible_person.has_prior_visit,
            'has_shared_session_history', visible_person.has_shared_history
          )) FILTER (
            WHERE visible_person.social_visibility = 'visible'
              AND visible_person.first_name IS NOT NULL
              AND visible_person.visible_rank <= 80
          ),
          '[]'::JSONB
        )
      ) AS context
    FROM authorized_target AS target
    LEFT JOIN occurrence_participations AS participation
      ON participation.ordinal = target.ordinal
    LEFT JOIN ranked_visible_people AS visible_person
      ON visible_person.ordinal = target.ordinal
     AND visible_person.person_id = participation.person_id
    GROUP BY target.ordinal, target.session_id, target.session_date
  )
  SELECT COALESCE(jsonb_agg(contexts.context ORDER BY contexts.ordinal), '[]'::JSONB)
  INTO v_result
  FROM contexts;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_session_social_context_batch(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_social_context_batch(JSONB) TO authenticated, service_role;
