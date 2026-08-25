-- Pickla League V1 domain.
--
-- A League place is one team place. activity_series remains the managed offer
-- shell and the five activity_sessions remain physical Calendar/attendance
-- truth. Competitive and commercial team truth lives only in the tables below.

ALTER TABLE public.activity_formats
  DROP CONSTRAINT IF EXISTS activity_formats_presentation_type_check,
  ADD CONSTRAINT activity_formats_presentation_type_check CHECK (
    presentation_type IN ('course', 'social_event', 'clinic', 'tournament', 'league')
  );

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_kind_check,
  ADD CONSTRAINT access_products_kind_check CHECK (product_kind IN (
    'day_access', 'session_ticket', 'session_with_day_access', 'voucher',
    'membership', 'rental', 'merchandise', 'series_access', 'league_team'
  ));

CREATE TABLE public.league_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  activity_series_id UUID NOT NULL UNIQUE REFERENCES public.activity_series(id) ON DELETE RESTRICT,
  team_capacity INTEGER NOT NULL DEFAULT 6,
  players_per_team INTEGER NOT NULL DEFAULT 2,
  league_night_count INTEGER NOT NULL DEFAULT 5,
  matches_per_team_per_night INTEGER NOT NULL DEFAULT 2,
  blocks_per_night INTEGER NOT NULL DEFAULT 2,
  match_duration_minutes INTEGER NOT NULL DEFAULT 50,
  block_start_offsets_minutes INTEGER[] NOT NULL DEFAULT ARRAY[0, 60],
  scoring_code TEXT NOT NULL DEFAULT 'rally_three_sets_11_cap_13',
  scoring_version INTEGER NOT NULL DEFAULT 1,
  schedule_version INTEGER NOT NULL DEFAULT 1,
  generated_team_fingerprint TEXT,
  fixtures_published_at TIMESTAMPTZ,
  fixture_publication_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_seasons_locked_v1_shape CHECK (
    team_capacity = 6
    AND players_per_team = 2
    AND league_night_count = 5
    AND matches_per_team_per_night = 2
    AND blocks_per_night = 2
    AND match_duration_minutes = 50
    AND block_start_offsets_minutes = ARRAY[0, 60]
    AND scoring_code = 'rally_three_sets_11_cap_13'
    AND scoring_version = 1
    AND schedule_version = 1
  )
);

CREATE INDEX idx_league_seasons_venue
  ON public.league_seasons (venue_id, fixture_publication_deadline);

CREATE TABLE public.league_team_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id UUID NOT NULL REFERENCES public.league_seasons(id) ON DELETE RESTRICT,
  team_name TEXT NOT NULL,
  team_name_key TEXT NOT NULL,
  team_name_reserved BOOLEAN NOT NULL DEFAULT true,
  captain_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  payer_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  capacity_hold_id UUID REFERENCES public.capacity_holds(id) ON DELETE SET NULL,
  commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE RESTRICT,
  commerce_order_line_id UUID REFERENCES public.commerce_order_lines(id) ON DELETE RESTRICT,
  registration_request_id TEXT NOT NULL,
  purchase_provenance JSONB NOT NULL DEFAULT '{}'::JSONB,
  pricing_reason TEXT,
  base_price_minor INTEGER,
  final_price_minor INTEGER,
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_team_entries_status_check CHECK (status IN ('pending', 'active', 'cancelled', 'withdrawn')),
  CONSTRAINT league_team_entries_name_length CHECK (char_length(team_name) BETWEEN 3 AND 40),
  CONSTRAINT league_team_entries_price_check CHECK (
    (base_price_minor IS NULL OR base_price_minor >= 0)
    AND (final_price_minor IS NULL OR final_price_minor >= 0)
  ),
  CONSTRAINT league_team_entries_activation_check CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CONSTRAINT league_team_entries_captain_is_payer CHECK (captain_customer_id = payer_customer_id)
);

-- Team names remain reserved after cancellation/withdrawal during Season 01.
CREATE UNIQUE INDEX idx_league_team_entries_name
  ON public.league_team_entries (league_season_id, team_name_key)
  WHERE team_name_reserved = true;
CREATE UNIQUE INDEX idx_league_team_entries_request
  ON public.league_team_entries (league_season_id, registration_request_id);
CREATE UNIQUE INDEX idx_league_team_entries_order_line
  ON public.league_team_entries (commerce_order_line_id)
  WHERE commerce_order_line_id IS NOT NULL;
CREATE INDEX idx_league_team_entries_status
  ON public.league_team_entries (league_season_id, status, created_at);

CREATE TABLE public.league_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id UUID NOT NULL REFERENCES public.league_seasons(id) ON DELETE RESTRICT,
  team_entry_id UUID NOT NULL REFERENCES public.league_team_entries(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_team_members_role_check CHECK (role IN ('captain', 'player')),
  CONSTRAINT league_team_members_status_check CHECK (status IN ('pending', 'active', 'inactive')),
  CONSTRAINT league_team_members_effective_order CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  UNIQUE (team_entry_id, customer_id)
);

CREATE UNIQUE INDEX idx_league_team_members_one_current_captain
  ON public.league_team_members (team_entry_id)
  WHERE role = 'captain' AND status IN ('pending', 'active');
CREATE UNIQUE INDEX idx_league_team_members_one_active_team
  ON public.league_team_members (league_season_id, customer_id)
  WHERE status = 'active';
CREATE INDEX idx_league_team_members_team
  ON public.league_team_members (team_entry_id, status, role);

CREATE TABLE public.league_fixtures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id UUID NOT NULL REFERENCES public.league_seasons(id) ON DELETE RESTRICT,
  league_night_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE RESTRICT,
  round_number INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  venue_court_id UUID NOT NULL REFERENCES public.venue_courts(id) ON DELETE RESTRICT,
  team_a_entry_id UUID NOT NULL REFERENCES public.league_team_entries(id) ON DELETE RESTRICT,
  team_b_entry_id UUID NOT NULL REFERENCES public.league_team_entries(id) ON DELETE RESTRICT,
  leg_number INTEGER NOT NULL,
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  scheduled_end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  generation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_fixtures_round_check CHECK (round_number BETWEEN 1 AND 5),
  CONSTRAINT league_fixtures_block_check CHECK (block_number BETWEEN 1 AND 2),
  CONSTRAINT league_fixtures_leg_check CHECK (leg_number BETWEEN 1 AND 2),
  CONSTRAINT league_fixtures_teams_distinct CHECK (team_a_entry_id <> team_b_entry_id),
  CONSTRAINT league_fixtures_time_order CHECK (scheduled_end_at > scheduled_start_at),
  CONSTRAINT league_fixtures_status_check CHECK (status IN ('scheduled', 'completed', 'postponed', 'cancelled')),
  UNIQUE (league_season_id, generation_key),
  UNIQUE (league_night_session_id, block_number, venue_court_id)
);

CREATE UNIQUE INDEX idx_league_fixture_pair_leg
  ON public.league_fixtures (
    league_season_id,
    LEAST(team_a_entry_id, team_b_entry_id),
    GREATEST(team_a_entry_id, team_b_entry_id),
    leg_number
  );
CREATE UNIQUE INDEX idx_league_fixture_pair_night
  ON public.league_fixtures (
    league_night_session_id,
    LEAST(team_a_entry_id, team_b_entry_id),
    GREATEST(team_a_entry_id, team_b_entry_id)
  );
CREATE INDEX idx_league_fixtures_schedule
  ON public.league_fixtures (league_season_id, round_number, block_number, venue_court_id);

CREATE TABLE public.league_fixture_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id UUID NOT NULL UNIQUE REFERENCES public.league_fixtures(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'incomplete',
  outcome_type TEXT NOT NULL DEFAULT 'played',
  sets JSONB NOT NULL DEFAULT '[]'::JSONB,
  walkover_winner_team_id UUID REFERENCES public.league_team_entries(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT,
  entered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  corrected_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_fixture_results_state_check CHECK (state IN ('incomplete', 'final')),
  CONSTRAINT league_fixture_results_outcome_check CHECK (outcome_type IN ('played', 'walkover')),
  CONSTRAINT league_fixture_results_version_check CHECK (version > 0),
  CONSTRAINT league_fixture_results_shape_check CHECK (
    (outcome_type = 'played' AND walkover_winner_team_id IS NULL)
    OR (outcome_type = 'walkover' AND sets = '[]'::JSONB AND walkover_winner_team_id IS NOT NULL)
  ),
  CONSTRAINT league_fixture_results_completion_check CHECK (state <> 'final' OR completed_at IS NOT NULL)
);

ALTER TABLE public.commerce_order_lines
  ADD COLUMN league_team_entry_id UUID REFERENCES public.league_team_entries(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_commerce_order_lines_league_team
  ON public.commerce_order_lines (league_team_entry_id)
  WHERE league_team_entry_id IS NOT NULL;

ALTER TABLE public.session_registrations
  ADD COLUMN league_team_member_id UUID REFERENCES public.league_team_members(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX idx_session_registrations_league_member
  ON public.session_registrations (activity_session_id, league_team_member_id)
  WHERE league_team_member_id IS NOT NULL;

ALTER TABLE public.capacity_holds
  DROP CONSTRAINT IF EXISTS capacity_holds_scope_type_check,
  ADD CONSTRAINT capacity_holds_scope_type_check CHECK (
    scope_type IN ('activity_session', 'booking_group', 'activity_series', 'league_season')
  );

CREATE OR REPLACE FUNCTION public.normalize_league_team_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(BTRIM(COALESCE(p_name, '')), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.enforce_league_season_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_series RECORD;
BEGIN
  SELECT series.venue_id, venue.organization_id, series.series_type, series.capacity,
         series.total_sessions, series.start_time, series.end_time
  INTO v_series
  FROM public.activity_series series
  JOIN public.venues venue ON venue.id = series.venue_id
  WHERE series.id = NEW.activity_series_id;
  IF v_series.venue_id IS NULL OR v_series.series_type <> 'league' THEN
    RAISE EXCEPTION 'league_series_not_found';
  END IF;
  IF NEW.venue_id <> v_series.venue_id OR NEW.organization_id <> v_series.organization_id THEN
    RAISE EXCEPTION 'league_season_scope_mismatch';
  END IF;
  IF v_series.capacity IS NOT NULL THEN
    RAISE EXCEPTION 'league_activity_series_capacity_must_be_null';
  END IF;
  IF v_series.total_sessions <> 5 OR v_series.start_time <> TIME '18:00' OR v_series.end_time <> TIME '20:00' THEN
    RAISE EXCEPTION 'league_v1_series_shape_invalid';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_season_boundary
BEFORE INSERT OR UPDATE ON public.league_seasons
FOR EACH ROW EXECUTE FUNCTION public.enforce_league_season_boundary();

CREATE OR REPLACE FUNCTION public.enforce_league_team_entry_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season RECORD;
  v_captain RECORD;
  v_payer RECORD;
BEGIN
  SELECT season.organization_id, season.venue_id
  INTO v_season
  FROM public.league_seasons season
  WHERE season.id = NEW.league_season_id;
  IF v_season.venue_id IS NULL THEN RAISE EXCEPTION 'league_season_not_found'; END IF;

  SELECT organization_id, status, merged_into_id INTO v_captain
  FROM public.customers WHERE id = NEW.captain_customer_id;
  SELECT organization_id, status, merged_into_id INTO v_payer
  FROM public.customers WHERE id = NEW.payer_customer_id;
  IF v_captain.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_payer.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_captain.status <> 'active' OR v_payer.status <> 'active'
     OR v_captain.merged_into_id IS NOT NULL OR v_payer.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'league_team_customer_scope_invalid';
  END IF;

  NEW.team_name := public.normalize_league_team_name(NEW.team_name);
  IF NEW.team_name ~ '[<>]' THEN RAISE EXCEPTION 'league_team_name_plain_text_required'; END IF;
  NEW.team_name_key := lower(NEW.team_name);
  NEW.registration_request_id := BTRIM(NEW.registration_request_id);
  IF NEW.registration_request_id = '' THEN RAISE EXCEPTION 'league_registration_request_required'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_team_entry_boundary
BEFORE INSERT OR UPDATE ON public.league_team_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_league_team_entry_boundary();

CREATE OR REPLACE FUNCTION public.enforce_league_team_member_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_entry RECORD; v_customer RECORD; v_season RECORD;
BEGIN
  SELECT entry.league_season_id, entry.captain_customer_id
  INTO v_entry FROM public.league_team_entries entry WHERE entry.id = NEW.team_entry_id;
  IF v_entry.league_season_id IS NULL OR v_entry.league_season_id <> NEW.league_season_id THEN
    RAISE EXCEPTION 'league_member_team_scope_mismatch';
  END IF;
  SELECT organization_id INTO v_season FROM public.league_seasons WHERE id = NEW.league_season_id;
  SELECT organization_id, status, merged_into_id INTO v_customer FROM public.customers WHERE id = NEW.customer_id;
  IF v_customer.organization_id IS DISTINCT FROM v_season.organization_id
     OR v_customer.status <> 'active' OR v_customer.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'league_member_customer_not_canonical';
  END IF;
  IF (NEW.role = 'captain') <> (NEW.customer_id = v_entry.captain_customer_id) THEN
    RAISE EXCEPTION 'league_member_captain_mismatch';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_team_member_boundary
BEFORE INSERT OR UPDATE ON public.league_team_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_league_team_member_boundary();

CREATE OR REPLACE FUNCTION public.enforce_league_fixture_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_session RECORD; v_season RECORD; v_team_count INTEGER; v_overlap INTEGER;
BEGIN
  SELECT season.venue_id, season.activity_series_id, season.match_duration_minutes
  INTO v_season FROM public.league_seasons season WHERE season.id = NEW.league_season_id;
  SELECT session.venue_id, session.series_id, session.session_date, session.start_time,
         session.end_time, session.court_ids, session.series_occurrence_index,
         session.session_type, session.metadata
  INTO v_session FROM public.activity_sessions session WHERE session.id = NEW.league_night_session_id;
  IF v_session.venue_id IS NULL OR v_session.venue_id <> v_season.venue_id
     OR v_session.series_id <> v_season.activity_series_id
     OR v_session.session_date IS NULL
     OR NEW.venue_court_id <> ALL(v_session.court_ids)
     OR NOT (
       (v_session.session_type = 'league' AND NEW.round_number = v_session.series_occurrence_index)
       OR (
         v_session.session_type = 'league_reschedule'
         AND v_session.metadata->>'league_fixture_id' = NEW.id::TEXT
       )
     ) THEN
    RAISE EXCEPTION 'league_fixture_session_scope_invalid';
  END IF;
  SELECT COUNT(*) INTO v_team_count FROM public.league_team_entries entry
  WHERE entry.id IN (NEW.team_a_entry_id, NEW.team_b_entry_id)
    AND entry.league_season_id = NEW.league_season_id
    AND (
      entry.status = 'active'
      OR (
        TG_OP = 'UPDATE'
        AND NEW.league_season_id = OLD.league_season_id
        AND NEW.team_a_entry_id = OLD.team_a_entry_id
        AND NEW.team_b_entry_id = OLD.team_b_entry_id
        AND entry.status IN ('cancelled', 'withdrawn')
      )
    );
  IF v_team_count <> 2 THEN RAISE EXCEPTION 'league_fixture_team_scope_invalid'; END IF;
  IF NEW.scheduled_start_at < ((v_session.session_date + v_session.start_time) AT TIME ZONE 'Europe/Stockholm')
     OR NEW.scheduled_end_at > ((v_session.session_date + v_session.end_time) AT TIME ZONE 'Europe/Stockholm')
     OR EXTRACT(EPOCH FROM (NEW.scheduled_end_at - NEW.scheduled_start_at)) / 60 <> v_season.match_duration_minutes THEN
    RAISE EXCEPTION 'league_fixture_outside_session';
  END IF;
  SELECT COUNT(*) INTO v_overlap
  FROM public.league_fixtures fixture
  WHERE fixture.league_night_session_id = NEW.league_night_session_id
    AND fixture.block_number = NEW.block_number
    AND fixture.id <> NEW.id
    AND (fixture.team_a_entry_id IN (NEW.team_a_entry_id, NEW.team_b_entry_id)
      OR fixture.team_b_entry_id IN (NEW.team_a_entry_id, NEW.team_b_entry_id));
  IF v_overlap > 0 THEN RAISE EXCEPTION 'league_team_double_booked_in_block'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_league_fixture_boundary
BEFORE INSERT OR UPDATE ON public.league_fixtures
FOR EACH ROW EXECUTE FUNCTION public.enforce_league_fixture_boundary();

CREATE TRIGGER trg_league_seasons_updated_at
BEFORE UPDATE ON public.league_seasons
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_league_fixture_results_updated_at
BEFORE UPDATE ON public.league_fixture_results
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reuse the canonical Course/managed-Series resource conflict boundary for
-- League-night Sessions as well. The function name is legacy; the calendar
-- and occupancy sources are generic and canonical.
CREATE OR REPLACE FUNCTION public.guard_course_session_resource_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_conflicts JSONB;
BEGIN
  IF NEW.session_type NOT IN ('course', 'league', 'league_reschedule')
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
    NEW.venue_id, NEW.session_date, NEW.session_date,
    ARRAY[EXTRACT(DOW FROM NEW.session_date)::INTEGER],
    NEW.start_time, NEW.end_time, 1, NEW.court_ids, NULL, NEW.id
  ) preview
  WHERE preview.is_available = false;
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'managed_series_resource_conflict', DETAIL = v_conflicts::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.league_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_team_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_fixture_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads active league seasons"
  ON public.league_seasons FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.activity_series series WHERE series.id = activity_series_id AND series.status = 'active')
    OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin()
  );
CREATE POLICY "Staff manage league seasons"
  ON public.league_seasons TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Members and staff read league teams"
  ON public.league_team_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.league_team_members member
      JOIN public.customers customer ON customer.id = member.customer_id
      WHERE member.team_entry_id = league_team_entries.id AND customer.auth_user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.league_seasons season WHERE season.id = league_season_id AND public.is_venue_member(auth.uid(), season.venue_id))
    OR public.is_super_admin()
  );
CREATE POLICY "Members and staff read league membership"
  ON public.league_team_members FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.customers customer WHERE customer.id = customer_id AND customer.auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.league_seasons season WHERE season.id = league_season_id AND public.is_venue_member(auth.uid(), season.venue_id))
    OR public.is_super_admin()
  );
CREATE POLICY "Public reads published league fixtures"
  ON public.league_fixtures FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.league_seasons season WHERE season.id = league_season_id AND season.fixtures_published_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.league_seasons season WHERE season.id = league_season_id AND public.is_venue_member(auth.uid(), season.venue_id))
    OR public.is_super_admin()
  );
CREATE POLICY "Public reads published league results"
  ON public.league_fixture_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_fixtures fixture
      JOIN public.league_seasons season ON season.id = fixture.league_season_id
      WHERE fixture.id = fixture_id AND season.fixtures_published_at IS NOT NULL
    )
    OR public.is_super_admin()
  );

GRANT SELECT ON public.league_seasons, public.league_fixtures, public.league_fixture_results TO anon, authenticated;
GRANT SELECT ON public.league_team_entries, public.league_team_members TO authenticated;
GRANT ALL ON public.league_seasons, public.league_team_entries, public.league_team_members,
  public.league_fixtures, public.league_fixture_results TO service_role;

COMMENT ON TABLE public.league_seasons IS
  'One-to-one competitive extension of activity_series. Season 01 accepts only the proven 6x2, five-night shape.';
COMMENT ON TABLE public.league_team_entries IS
  'Canonical sold League team place. One active entry consumes exactly one League team slot.';
COMMENT ON TABLE public.league_team_members IS
  'Human roster membership. Attendance remains projected into session_registrations and venue_checkins.';
COMMENT ON TABLE public.league_fixtures IS
  'Team-vs-team competitive schedule. Not a Calendar session and not an attendance record.';
COMMENT ON TABLE public.league_fixture_results IS
  'Single versioned result truth per fixture. Standings are derived and never stored.';
