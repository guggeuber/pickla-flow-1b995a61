-- Pickla Score MVP
-- Native scoring layer for darts walk-ins, event scoring, and broadcast displays.

CREATE TABLE IF NOT EXISTS public.score_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  session_type TEXT NOT NULL DEFAULT 'walk_in',
  sport_type TEXT NOT NULL DEFAULT 'dart',
  name TEXT NOT NULL DEFAULT 'Pickla Score',
  status TEXT NOT NULL DEFAULT 'live',
  game_type TEXT NOT NULL DEFAULT '501',
  best_of_legs INTEGER NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_from_device_id UUID REFERENCES public.display_devices(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT score_sessions_type_check CHECK (session_type IN ('walk_in', 'event')),
  CONSTRAINT score_sessions_status_check CHECK (status IN ('draft', 'live', 'completed', 'cancelled')),
  CONSTRAINT score_sessions_game_check CHECK (game_type IN ('501')),
  CONSTRAINT score_sessions_best_of_check CHECK (best_of_legs IN (1, 3, 5))
);

CREATE TABLE IF NOT EXISTS public.score_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_session_id UUID NOT NULL REFERENCES public.score_sessions(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  seed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.score_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_session_id UUID NOT NULL REFERENCES public.score_sessions(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE SET NULL,
  display_device_id UUID REFERENCES public.display_devices(id) ON DELETE SET NULL,
  match_type TEXT NOT NULL DEFAULT 'walk_in',
  status TEXT NOT NULL DEFAULT 'in_progress',
  round_label TEXT,
  match_number INTEGER NOT NULL DEFAULT 1,
  player1_id UUID REFERENCES public.score_players(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES public.score_players(id) ON DELETE SET NULL,
  player1_name TEXT NOT NULL,
  player2_name TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT '501',
  best_of_legs INTEGER NOT NULL DEFAULT 1,
  current_leg INTEGER NOT NULL DEFAULT 1,
  player1_legs INTEGER NOT NULL DEFAULT 0,
  player2_legs INTEGER NOT NULL DEFAULT 0,
  player1_remaining INTEGER NOT NULL DEFAULT 501,
  player2_remaining INTEGER NOT NULL DEFAULT 501,
  current_player INTEGER NOT NULL DEFAULT 1,
  starting_player INTEGER NOT NULL DEFAULT 1,
  leg_starting_player INTEGER NOT NULL DEFAULT 1,
  winner_player_id UUID REFERENCES public.score_players(id) ON DELETE SET NULL,
  winner_name TEXT,
  last_score INTEGER,
  last_event_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT score_matches_type_check CHECK (match_type IN ('walk_in', 'event')),
  CONSTRAINT score_matches_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT score_matches_current_player_check CHECK (current_player IN (1, 2)),
  CONSTRAINT score_matches_starting_player_check CHECK (starting_player IN (1, 2)),
  CONSTRAINT score_matches_leg_starting_player_check CHECK (leg_starting_player IN (1, 2)),
  CONSTRAINT score_matches_best_of_check CHECK (best_of_legs IN (1, 3, 5))
);

CREATE TABLE IF NOT EXISTS public.score_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_session_id UUID NOT NULL REFERENCES public.score_sessions(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.score_matches(id) ON DELETE CASCADE,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE SET NULL,
  leg_number INTEGER NOT NULL,
  player_number INTEGER NOT NULL CHECK (player_number IN (1, 2)),
  player_id UUID REFERENCES public.score_players(id) ON DELETE SET NULL,
  score INTEGER NOT NULL,
  remaining_before INTEGER NOT NULL,
  remaining_after INTEGER NOT NULL,
  is_bust BOOLEAN NOT NULL DEFAULT false,
  is_checkout BOOLEAN NOT NULL DEFAULT false,
  darts_used INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.score_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_session_id UUID NOT NULL REFERENCES public.score_sessions(id) ON DELETE CASCADE,
  match_id UUID REFERENCES public.score_matches(id) ON DELETE CASCADE,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_sessions_venue_status
  ON public.score_sessions(venue_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_sessions_event
  ON public.score_sessions(event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_score_matches_session_status
  ON public.score_matches(score_session_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_matches_court_live
  ON public.score_matches(venue_court_id, status, updated_at DESC)
  WHERE venue_court_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_score_turns_match_created
  ON public.score_turns(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_events_session_created
  ON public.score_events(score_session_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_score_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_sessions_updated_at ON public.score_sessions;
CREATE TRIGGER trg_score_sessions_updated_at
  BEFORE UPDATE ON public.score_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_score_updated_at();

DROP TRIGGER IF EXISTS trg_score_matches_updated_at ON public.score_matches;
CREATE TRIGGER trg_score_matches_updated_at
  BEFORE UPDATE ON public.score_matches
  FOR EACH ROW EXECUTE FUNCTION public.fn_score_updated_at();

ALTER TABLE public.score_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read score sessions"
  ON public.score_sessions FOR SELECT
  USING (status IN ('draft', 'live', 'completed'));

CREATE POLICY "Public read score players"
  ON public.score_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_players.score_session_id
        AND s.status IN ('draft', 'live', 'completed')
    )
  );

CREATE POLICY "Public read score matches"
  ON public.score_matches FOR SELECT
  USING (status IN ('pending', 'in_progress', 'completed'));

CREATE POLICY "Public read score turns"
  ON public.score_turns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.score_matches m
      WHERE m.id = score_turns.match_id
        AND m.status IN ('pending', 'in_progress', 'completed')
    )
  );

CREATE POLICY "Public read score events"
  ON public.score_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_events.score_session_id
        AND s.status IN ('draft', 'live', 'completed')
    )
  );

CREATE POLICY "Venue staff manage score sessions"
  ON public.score_sessions FOR ALL TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff manage score players"
  ON public.score_players FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_players.score_session_id
        AND (public.is_venue_member(auth.uid(), s.venue_id) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_players.score_session_id
        AND (public.is_venue_member(auth.uid(), s.venue_id) OR public.is_super_admin())
    )
  );

CREATE POLICY "Venue staff manage score matches"
  ON public.score_matches FOR ALL TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff manage score turns"
  ON public.score_turns FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.score_matches m
      WHERE m.id = score_turns.match_id
        AND (public.is_venue_member(auth.uid(), m.venue_id) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.score_matches m
      WHERE m.id = score_turns.match_id
        AND (public.is_venue_member(auth.uid(), m.venue_id) OR public.is_super_admin())
    )
  );

CREATE POLICY "Venue staff manage score events"
  ON public.score_events FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_events.score_session_id
        AND (public.is_venue_member(auth.uid(), s.venue_id) OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.score_sessions s
      WHERE s.id = score_events.score_session_id
        AND (public.is_venue_member(auth.uid(), s.venue_id) OR public.is_super_admin())
    )
  );

CREATE POLICY "Service role manages score sessions"
  ON public.score_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manages score players"
  ON public.score_players FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manages score matches"
  ON public.score_matches FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manages score turns"
  ON public.score_turns FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role manages score events"
  ON public.score_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.score_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.score_matches;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.score_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
