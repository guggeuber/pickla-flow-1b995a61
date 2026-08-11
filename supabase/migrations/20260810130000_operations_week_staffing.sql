-- Operations V1 is a projection over existing canonical schedule objects.
-- This migration stores only the relationship between authorized venue staff
-- and an existing operational occurrence. It deliberately stores no duplicate
-- start/end or resource truth.

ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS requires_staffing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.activity_sessions.requires_staffing IS
  'Explicit operational staffing requirement. False by default to avoid inferring staffing from activity type or title.';

CREATE TABLE IF NOT EXISTS public.operational_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  occurrence_date date NOT NULL,
  venue_staff_id uuid NOT NULL REFERENCES public.venue_staff(id) ON DELETE RESTRICT,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_staff_assignments_source_type_check CHECK (
    source_type IN ('activity_session', 'booking', 'event', 'resource_block', 'operation_override')
  ),
  CONSTRAINT operational_staff_assignments_role_check CHECK (
    role IN ('host', 'instructor', 'service')
  ),
  CONSTRAINT operational_staff_assignments_status_check CHECK (
    status IN ('active', 'cancelled')
  )
);

COMMENT ON TABLE public.operational_staff_assignments IS
  'Audited staffing relation for an existing canonical occurrence. source_id remains owned by the source table; occurrence_date disambiguates recurring activity sessions.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_staff_assignments_active_identity
  ON public.operational_staff_assignments (
    venue_id,
    source_type,
    source_id,
    occurrence_date,
    venue_staff_id,
    role
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_operational_staff_assignments_venue_week
  ON public.operational_staff_assignments (venue_id, occurrence_date, status);

CREATE INDEX IF NOT EXISTS idx_operational_staff_assignments_staff_week
  ON public.operational_staff_assignments (venue_staff_id, occurrence_date, status);

CREATE OR REPLACE FUNCTION public.enforce_operational_staff_assignment_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_exists boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.venue_staff vs
    WHERE vs.id = NEW.venue_staff_id
      AND vs.venue_id = NEW.venue_id
      AND (NEW.status = 'cancelled' OR vs.is_active = true)
  ) THEN
    RAISE EXCEPTION 'operational_staff_must_belong_to_venue';
  END IF;

  IF NEW.status = 'active' THEN
    CASE NEW.source_type
      WHEN 'activity_session' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.activity_sessions source
          WHERE source.id = NEW.source_id
            AND source.venue_id = NEW.venue_id
            AND source.is_active = true
            AND source.publish_status = 'published'
            AND (
              source.session_date = NEW.occurrence_date
              OR (
                source.session_date IS NULL
                AND EXTRACT(DOW FROM NEW.occurrence_date)::integer = ANY(source.recurrence_days)
              )
            )
        ) INTO source_exists;
      WHEN 'booking' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.bookings source
          WHERE source.id = NEW.source_id
            AND source.venue_id = NEW.venue_id
            AND source.status <> 'cancelled'
            AND (source.start_time AT TIME ZONE 'Europe/Stockholm')::date = NEW.occurrence_date
        ) INTO source_exists;
      WHEN 'event' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.events source
          WHERE source.id = NEW.source_id
            AND source.venue_id = NEW.venue_id
            AND source.planning_status IN ('booked', 'ready', 'published', 'done')
            AND (source.start_date AT TIME ZONE 'Europe/Stockholm')::date = NEW.occurrence_date
        ) INTO source_exists;
      WHEN 'resource_block' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.event_resource_blocks source
          WHERE source.id = NEW.source_id
            AND source.venue_id = NEW.venue_id
            AND source.status IN ('hold', 'confirmed')
            AND (source.starts_at AT TIME ZONE 'Europe/Stockholm')::date = NEW.occurrence_date
        ) INTO source_exists;
      WHEN 'operation_override' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.venue_operation_overrides source
          WHERE source.id = NEW.source_id
            AND source.venue_id = NEW.venue_id
            AND source.status = 'active'
            AND (source.starts_at AT TIME ZONE 'Europe/Stockholm')::date = NEW.occurrence_date
        ) INTO source_exists;
    END CASE;

    IF NOT source_exists THEN
      RAISE EXCEPTION 'operational_staff_source_occurrence_not_found';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_staff_assignment_venue
  ON public.operational_staff_assignments;
CREATE TRIGGER trg_operational_staff_assignment_venue
  BEFORE INSERT OR UPDATE OF venue_id, venue_staff_id, source_type, source_id, occurrence_date, status
  ON public.operational_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_staff_assignment_venue();

REVOKE ALL ON FUNCTION public.enforce_operational_staff_assignment_venue() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_operational_staff_assignments_updated_at
  ON public.operational_staff_assignments;
CREATE TRIGGER trg_operational_staff_assignments_updated_at
  BEFORE UPDATE ON public.operational_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.operational_staff_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read operational assignments"
  ON public.operational_staff_assignments;
CREATE POLICY "Venue staff read operational assignments"
  ON public.operational_staff_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.venue_staff vs
      WHERE vs.user_id = auth.uid()
        AND vs.venue_id = operational_staff_assignments.venue_id
        AND vs.is_active = true
    )
  );

DROP POLICY IF EXISTS "Venue admins manage operational assignments"
  ON public.operational_staff_assignments;
CREATE POLICY "Venue admins manage operational assignments"
  ON public.operational_staff_assignments
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_venue_admin(auth.uid(), venue_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_venue_admin(auth.uid(), venue_id)
  );

GRANT SELECT, INSERT, UPDATE ON public.operational_staff_assignments TO authenticated;
GRANT ALL ON public.operational_staff_assignments TO service_role;
