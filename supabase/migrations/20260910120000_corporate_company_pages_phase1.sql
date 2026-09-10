-- Corporate company pages Phase 1.
--
-- Existing corporate accounts remain the external-company identity and
-- corporate orders remain the B2B commercial record. Corporate schedules are
-- fulfilled by Activity Series/Sessions; no second corporate domain is added.
-- This migration intentionally runs after Physical Availability Foundation V1
-- (20260909120000). Its Corporate-specific RPCs are compatibility workflows
-- over check_physical_availability/lock_physical_resources; they do not define
-- another physical-capacity decision or claim boundary.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

ALTER TABLE public.corporate_accounts
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS public_visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS public_intro TEXT;

ALTER TABLE public.corporate_accounts
  DROP CONSTRAINT IF EXISTS corporate_accounts_public_visibility_check,
  DROP CONSTRAINT IF EXISTS corporate_accounts_slug_check,
  DROP CONSTRAINT IF EXISTS corporate_accounts_public_intro_length_check;

ALTER TABLE public.corporate_accounts
  ADD CONSTRAINT corporate_accounts_public_visibility_check
    CHECK (public_visibility IN ('private', 'unlisted', 'listed')) NOT VALID,
  ADD CONSTRAINT corporate_accounts_slug_check
    CHECK (
      slug IS NULL OR (
        slug = LOWER(BTRIM(slug))
        AND char_length(slug) BETWEEN 1 AND 120
        AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      )
    ) NOT VALID,
  ADD CONSTRAINT corporate_accounts_public_intro_length_check
    CHECK (public_intro IS NULL OR char_length(public_intro) <= 1200) NOT VALID;

ALTER TABLE public.corporate_accounts
  VALIDATE CONSTRAINT corporate_accounts_public_visibility_check;
ALTER TABLE public.corporate_accounts
  VALIDATE CONSTRAINT corporate_accounts_slug_check;
ALTER TABLE public.corporate_accounts
  VALIDATE CONSTRAINT corporate_accounts_public_intro_length_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_accounts_slug_ci
  ON public.corporate_accounts (LOWER(slug))
  WHERE slug IS NOT NULL;

ALTER TABLE public.corporate_orders
  ADD COLUMN IF NOT EXISTS purchaser_name TEXT,
  ADD COLUMN IF NOT EXISTS price_includes_vat BOOLEAN,
  ADD COLUMN IF NOT EXISTS included_items TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.corporate_orders
  DROP CONSTRAINT IF EXISTS corporate_orders_purchaser_name_length_check,
  DROP CONSTRAINT IF EXISTS corporate_orders_included_items_check;

ALTER TABLE public.corporate_orders
  ADD CONSTRAINT corporate_orders_purchaser_name_length_check
    CHECK (purchaser_name IS NULL OR char_length(BTRIM(purchaser_name)) BETWEEN 1 AND 200) NOT VALID,
  ADD CONSTRAINT corporate_orders_included_items_check
    CHECK (
      cardinality(included_items) <= 20
      AND array_position(included_items, NULL) IS NULL
    ) NOT VALID;

ALTER TABLE public.corporate_orders
  VALIDATE CONSTRAINT corporate_orders_purchaser_name_length_check;
ALTER TABLE public.corporate_orders
  VALIDATE CONSTRAINT corporate_orders_included_items_check;

ALTER TABLE public.activity_series
  ADD COLUMN IF NOT EXISTS corporate_order_id UUID REFERENCES public.corporate_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS participation_management_mode TEXT NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS external_booking_url TEXT,
  ADD COLUMN IF NOT EXISTS external_booking_label TEXT;

ALTER TABLE public.activity_series
  DROP CONSTRAINT IF EXISTS activity_series_participation_management_mode_check,
  DROP CONSTRAINT IF EXISTS activity_series_external_booking_url_check,
  DROP CONSTRAINT IF EXISTS activity_series_external_booking_label_check;

ALTER TABLE public.activity_series
  ADD CONSTRAINT activity_series_participation_management_mode_check
    CHECK (participation_management_mode IN ('unconfigured', 'external', 'pickla')) NOT VALID,
  ADD CONSTRAINT activity_series_external_booking_url_check
    CHECK (
      external_booking_url IS NULL OR (
        external_booking_url = BTRIM(external_booking_url)
        AND char_length(external_booking_url) BETWEEN 9 AND 2048
        AND external_booking_url ~ '^https://[^[:space:]/?#]+(:[0-9]+)?([/?#].*)?$'
        AND external_booking_url !~ '^https://[^/]*@'
      )
    ) NOT VALID,
  ADD CONSTRAINT activity_series_external_booking_label_check
    CHECK (
      external_booking_label IS NULL OR (
        external_booking_label = BTRIM(external_booking_label)
        AND char_length(external_booking_label) BETWEEN 1 AND 80
      )
    ) NOT VALID;

ALTER TABLE public.activity_series
  VALIDATE CONSTRAINT activity_series_participation_management_mode_check;
ALTER TABLE public.activity_series
  VALIDATE CONSTRAINT activity_series_external_booking_url_check;
ALTER TABLE public.activity_series
  VALIDATE CONSTRAINT activity_series_external_booking_label_check;

CREATE INDEX IF NOT EXISTS idx_activity_series_corporate_order
  ON public.activity_series (corporate_order_id, status)
  WHERE corporate_order_id IS NOT NULL;

COMMENT ON COLUMN public.corporate_accounts.slug IS
  'Public route locator only. corporate_accounts.id remains canonical identity.';
COMMENT ON COLUMN public.corporate_accounts.public_visibility IS
  'private is not public; unlisted resolves by slug; listed also appears in company discovery.';
COMMENT ON COLUMN public.activity_series.corporate_order_id IS
  'B2B commercial source for a corporate Series. Schedule truth remains in Series/Sessions.';
COMMENT ON COLUMN public.activity_series.participation_management_mode IS
  'Who manages participant registration. This does not itself prove checkout readiness.';
COMMENT ON COLUMN public.activity_series.court_ids IS
  'Default/setup resources. Concrete activity_sessions.court_ids remain actual occurrence allocation.';

-- A linked corporate Series is a venue-owned schedule for capacity already
-- purchased by the corporate client. Its occurrences must never become normal
-- public activity tickets, including when staff later add a Session through
-- the existing schedule editor.
CREATE OR REPLACE FUNCTION public.enforce_corporate_series_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_order_venue_id UUID;
BEGIN
  IF NEW.corporate_order_id IS NULL THEN RETURN NEW; END IF;
  SELECT venue_id INTO v_order_venue_id
  FROM public.corporate_orders
  WHERE id = NEW.corporate_order_id;
  IF v_order_venue_id IS NULL OR v_order_venue_id IS DISTINCT FROM NEW.venue_id THEN
    RAISE EXCEPTION 'corporate_series_order_venue_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_corporate_series_boundary ON public.activity_series;
CREATE TRIGGER trg_enforce_corporate_series_boundary
BEFORE INSERT OR UPDATE OF venue_id, corporate_order_id
ON public.activity_series
FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_series_boundary();

CREATE OR REPLACE FUNCTION public.close_linked_corporate_series_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.corporate_order_id IS NOT NULL
     AND NEW.corporate_order_id IS DISTINCT FROM OLD.corporate_order_id THEN
    UPDATE public.activity_sessions
    SET closed_to_public = true,
        capacity = NULL
    WHERE series_id = NEW.id
      AND (closed_to_public = false OR capacity IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_linked_corporate_series_sessions ON public.activity_series;
CREATE TRIGGER trg_close_linked_corporate_series_sessions
AFTER UPDATE OF corporate_order_id
ON public.activity_series
FOR EACH ROW EXECUTE FUNCTION public.close_linked_corporate_series_sessions();

CREATE OR REPLACE FUNCTION public.enforce_corporate_session_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.series_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.activity_series series
    WHERE series.id = NEW.series_id
      AND series.corporate_order_id IS NOT NULL
  ) THEN
    NEW.closed_to_public := true;
    NEW.capacity := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_corporate_session_boundary ON public.activity_sessions;
CREATE TRIGGER trg_enforce_corporate_session_boundary
BEFORE INSERT OR UPDATE OF series_id, closed_to_public, capacity
ON public.activity_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_corporate_session_boundary();

REVOKE ALL ON FUNCTION public.enforce_corporate_series_boundary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_linked_corporate_series_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_corporate_session_boundary() FROM PUBLIC, anon, authenticated;

-- Read-only preview of applying one named court to every active concrete
-- Session in a linked corporate Series. Every occurrence delegates directly
-- to the Foundation decision that merges booking, activity, resource-block
-- and venue-operation truth.
CREATE OR REPLACE FUNCTION public.preview_corporate_series_default_court(
  p_series_id UUID,
  p_court_id UUID
) RETURNS TABLE (
  session_id UUID,
  occurrence_index INTEGER,
  session_date DATE,
  start_time TIME,
  end_time TIME,
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
  v_series public.activity_series%ROWTYPE;
  v_session public.activity_sessions%ROWTYPE;
  v_court_name TEXT;
  v_timezone TEXT;
  v_decision JSONB;
  v_canonical_conflicts JSONB;
  v_batch_conflicts JSONB;
  v_conflicts JSONB;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id;

  IF v_series.id IS NULL OR v_series.corporate_order_id IS NULL THEN
    RAISE EXCEPTION 'corporate_series_not_found';
  END IF;

  SELECT court.name, COALESCE(NULLIF(venue.timezone, ''), 'Europe/Stockholm')
  INTO v_court_name, v_timezone
  FROM public.venue_courts court
  JOIN public.venues venue ON venue.id = court.venue_id
  WHERE court.id = p_court_id
    AND court.venue_id = v_series.venue_id
    AND court.is_available = true;

  IF v_court_name IS NULL THEN
    RAISE EXCEPTION 'corporate_series_court_invalid';
  END IF;

  FOR v_session IN
    SELECT session.*
    FROM public.activity_sessions session
    WHERE session.series_id = v_series.id
      AND session.is_active = true
      AND session.session_date IS NOT NULL
    ORDER BY session.session_date, session.start_time, session.id
  LOOP
    v_count := v_count + 1;

    v_starts_at := ((v_session.session_date + v_session.start_time) AT TIME ZONE v_timezone);
    v_ends_at := (((v_session.session_date
      + CASE WHEN v_session.end_time <= v_session.start_time THEN 1 ELSE 0 END)
      + v_session.end_time) AT TIME ZONE v_timezone);

    -- Physical Availability Foundation owns all persisted occupancy truth.
    -- Excluding only this concrete occurrence preserves conflicts from every
    -- other Booking, Activity occurrence, resource block and venue rule.
    v_decision := public.check_physical_availability(
      v_series.venue_id,
      ARRAY[p_court_id],
      v_starts_at,
      v_ends_at,
      '{}'::UUID[],
      v_session.id,
      v_session.session_date,
      NULL,
      '{}'::UUID[],
      NULL
    );

    -- Add display labels without changing the canonical decision or exposing
    -- any customer, payment or booking detail.
    SELECT COALESCE(jsonb_agg(
      conflict || jsonb_build_object(
        'source_type', CASE conflict->>'type'
          WHEN 'activity_occurrence' THEN 'activity_session'
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
    INTO v_canonical_conflicts
    FROM jsonb_array_elements(COALESCE(v_decision->'conflicts', '[]'::JSONB)) conflict;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'activity_occurrence',
      'source_type', 'activity_session',
      'source_id', other.id,
      'resource_id', p_court_id,
      'title', COALESCE(NULLIF(other.name, ''), 'Aktivitet'),
      'starts_at', ((other.session_date + other.start_time) AT TIME ZONE v_timezone),
      'ends_at', (((other.session_date + CASE WHEN other.end_time <= other.start_time THEN 1 ELSE 0 END) + other.end_time) AT TIME ZONE v_timezone)
    ) ORDER BY other.start_time, other.id), '[]'::JSONB)
    INTO v_batch_conflicts
    FROM public.activity_sessions other
    WHERE other.series_id = v_series.id
      AND other.id <> v_session.id
      AND other.is_active = true
      AND other.session_date = v_session.session_date
      AND ((other.session_date + other.start_time) AT TIME ZONE v_timezone)
        < (((v_session.session_date + CASE WHEN v_session.end_time <= v_session.start_time THEN 1 ELSE 0 END) + v_session.end_time) AT TIME ZONE v_timezone)
      AND (((other.session_date + CASE WHEN other.end_time <= other.start_time THEN 1 ELSE 0 END) + other.end_time) AT TIME ZONE v_timezone)
        > ((v_session.session_date + v_session.start_time) AT TIME ZONE v_timezone);

    -- Batch collisions are prospective rows in this same atomic assignment,
    -- not a second persisted-occupancy engine.
    v_conflicts := COALESCE(v_canonical_conflicts, '[]'::JSONB)
      || COALESCE(v_batch_conflicts, '[]'::JSONB);

    session_id := v_session.id;
    occurrence_index := v_session.series_occurrence_index;
    session_date := v_session.session_date;
    start_time := v_session.start_time;
    end_time := v_session.end_time;
    court_id := p_court_id;
    court_name := v_court_name;
    is_available := COALESCE((v_decision->>'available')::BOOLEAN, false)
      AND jsonb_array_length(v_batch_conflicts) = 0;
    conflicts := v_conflicts;
    RETURN NEXT;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'corporate_series_sessions_required';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_corporate_series_default_court(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_corporate_series_default_court(UUID, UUID)
  TO service_role;

-- The Foundation's trg_guard_activity_session_physical_claim is the only
-- physical Session write guard. Explicitly remove the pre-Foundation Corporate
-- guard if this migration is replayed over an earlier review environment.
DROP TRIGGER IF EXISTS trg_guard_corporate_session_resource_conflict ON public.activity_sessions;
DROP FUNCTION IF EXISTS public.guard_corporate_session_resource_conflict();

-- One transaction performs the final conflict preview and, only when every
-- occurrence is available, updates the Series default and every Session.
CREATE OR REPLACE FUNCTION public.apply_corporate_series_default_court(
  p_series_id UUID,
  p_court_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series public.activity_series%ROWTYPE;
  v_preview JSONB;
  v_conflicts JSONB;
  v_session_count INTEGER;
BEGIN
  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF v_series.id IS NULL OR v_series.corporate_order_id IS NULL THEN
    RAISE EXCEPTION 'corporate_series_not_found';
  END IF;

  PERFORM public.lock_physical_resources(
    v_series.venue_id,
    ARRAY(
      SELECT DISTINCT selected.selected_court
      FROM unnest(
        COALESCE(v_series.court_ids, '{}'::UUID[])
        || COALESCE((
          SELECT array_agg(DISTINCT current_court)
          FROM public.activity_sessions current_session
          CROSS JOIN LATERAL unnest(COALESCE(current_session.court_ids, '{}'::UUID[])) current_court
          WHERE current_session.series_id = v_series.id
            AND current_session.is_active = true
            AND current_session.session_date IS NOT NULL
        ), '{}'::UUID[])
        || ARRAY[p_court_id]
      ) AS selected(selected_court)
      ORDER BY selected.selected_court
    )
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(preview) ORDER BY preview.session_date, preview.start_time), '[]'::JSONB),
         COALESCE(jsonb_agg(to_jsonb(preview) ORDER BY preview.session_date, preview.start_time)
           FILTER (WHERE preview.is_available = false), '[]'::JSONB),
         COUNT(*)::INTEGER
  INTO v_preview, v_conflicts, v_session_count
  FROM public.preview_corporate_series_default_court(p_series_id, p_court_id) preview;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object(
      'applied', false,
      'series_id', p_series_id,
      'court_id', p_court_id,
      'session_count', v_session_count,
      'conflicts', v_conflicts,
      'preview', v_preview
    );
  END IF;

  UPDATE public.activity_series
  SET court_ids = ARRAY[p_court_id]
  WHERE id = p_series_id;

  UPDATE public.activity_sessions
  SET court_ids = ARRAY[p_court_id]
  WHERE series_id = p_series_id
    AND is_active = true
    AND session_date IS NOT NULL;

  RETURN jsonb_build_object(
    'applied', true,
    'series_id', p_series_id,
    'court_id', p_court_id,
    'session_count', v_session_count,
    'using_default_count', v_session_count,
    'exception_count', 0,
    'conflicts', '[]'::JSONB,
    'preview', v_preview
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_corporate_series_default_court(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_corporate_series_default_court(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.preview_corporate_session_court(
  p_session_id UUID,
  p_court_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_series public.activity_series%ROWTYPE;
  v_court_name TEXT;
  v_timezone TEXT;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
  v_decision JSONB;
  v_conflicts JSONB;
BEGIN
  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE id = p_session_id
    AND is_active = true
    AND session_date IS NOT NULL;

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = v_session.series_id
    AND corporate_order_id IS NOT NULL;

  IF v_session.id IS NULL OR v_series.id IS NULL THEN
    RAISE EXCEPTION 'corporate_session_not_found';
  END IF;

  SELECT court.name, COALESCE(NULLIF(venue.timezone, ''), 'Europe/Stockholm')
  INTO v_court_name, v_timezone
  FROM public.venue_courts court
  JOIN public.venues venue ON venue.id = court.venue_id
  WHERE court.id = p_court_id
    AND court.venue_id = v_session.venue_id
    AND court.is_available = true;

  IF v_court_name IS NULL THEN
    RAISE EXCEPTION 'corporate_session_court_invalid';
  END IF;

  v_starts_at := ((v_session.session_date + v_session.start_time) AT TIME ZONE v_timezone);
  v_ends_at := (((v_session.session_date
    + CASE WHEN v_session.end_time <= v_session.start_time THEN 1 ELSE 0 END)
    + v_session.end_time) AT TIME ZONE v_timezone);

  v_decision := public.check_physical_availability(
    v_session.venue_id,
    ARRAY[p_court_id],
    v_starts_at,
    v_ends_at,
    '{}'::UUID[],
    v_session.id,
    v_session.session_date,
    NULL,
    '{}'::UUID[],
    NULL
  );

  SELECT COALESCE(jsonb_agg(
    conflict || jsonb_build_object(
      'source_type', CASE conflict->>'type'
        WHEN 'activity_occurrence' THEN 'activity_session'
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
  INTO v_conflicts
  FROM jsonb_array_elements(COALESCE(v_decision->'conflicts', '[]'::JSONB)) conflict;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'series_id', v_series.id,
    'session_date', v_session.session_date,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'court_id', p_court_id,
    'court_name', v_court_name,
    'is_available', COALESCE((v_decision->>'available')::BOOLEAN, false),
    'conflicts', v_conflicts,
    'is_exception', ARRAY[p_court_id] IS DISTINCT FROM v_series.court_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_corporate_session_court(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_corporate_session_court(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_corporate_session_court(
  p_session_id UUID,
  p_court_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.activity_sessions%ROWTYPE;
  v_series public.activity_series%ROWTYPE;
  v_preview JSONB;
BEGIN
  SELECT * INTO v_session
  FROM public.activity_sessions
  WHERE id = p_session_id
    AND is_active = true
    AND session_date IS NOT NULL
  FOR UPDATE;

  SELECT * INTO v_series
  FROM public.activity_series
  WHERE id = v_session.series_id
    AND corporate_order_id IS NOT NULL
  FOR UPDATE;

  IF v_session.id IS NULL OR v_series.id IS NULL THEN
    RAISE EXCEPTION 'corporate_session_not_found';
  END IF;

  PERFORM public.lock_physical_resources(
    v_session.venue_id,
    ARRAY(
      SELECT DISTINCT selected.selected_court
      FROM unnest(COALESCE(v_session.court_ids, '{}'::UUID[]) || ARRAY[p_court_id]) AS selected(selected_court)
      ORDER BY selected.selected_court
    )
  );

  v_preview := public.preview_corporate_session_court(p_session_id, p_court_id);
  IF COALESCE((v_preview->>'is_available')::BOOLEAN, false) IS DISTINCT FROM true THEN
    RETURN v_preview || jsonb_build_object('applied', false);
  END IF;

  UPDATE public.activity_sessions
  SET court_ids = ARRAY[p_court_id]
  WHERE id = p_session_id;

  RETURN v_preview || jsonb_build_object(
    'applied', true,
    'is_exception', ARRAY[p_court_id] IS DISTINCT FROM v_series.court_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_corporate_session_court(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_corporate_session_court(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.preview_corporate_series_default_court(UUID, UUID) IS
  'Read-only canonical conflict preview for applying exactly one court to every concrete corporate Session.';
COMMENT ON FUNCTION public.apply_corporate_series_default_court(UUID, UUID) IS
  'Atomically applies one default court to a corporate Series and all active concrete Sessions, or changes nothing when any conflict exists.';
COMMENT ON FUNCTION public.apply_corporate_session_court(UUID, UUID) IS
  'Changes one concrete corporate Session court without changing its Series default.';
