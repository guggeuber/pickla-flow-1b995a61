
-- Create crew_sessions table
CREATE TABLE public.crew_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_id uuid NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  session_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  venue_id uuid REFERENCES public.venues(id),
  venue_court_id uuid REFERENCES public.venue_courts(id),
  booking_id uuid REFERENCES public.bookings(id),
  max_participants integer,
  status text NOT NULL DEFAULT 'booked',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create crew_session_signups table
CREATE TABLE public.crew_session_signups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_session_id uuid NOT NULL REFERENCES public.crew_sessions(id) ON DELETE CASCADE,
  player_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'signed_up',
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(crew_session_id, player_profile_id)
);

-- Enable RLS
ALTER TABLE public.crew_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_session_signups ENABLE ROW LEVEL SECURITY;

-- crew_sessions RLS
CREATE POLICY "Public can read crew sessions"
  ON public.crew_sessions FOR SELECT USING (true);

CREATE POLICY "Leader/co-leader can create sessions"
  ON public.crew_sessions FOR INSERT
  WITH CHECK (is_crew_leader(auth.uid(), crew_id));

CREATE POLICY "Leader/co-leader can update sessions"
  ON public.crew_sessions FOR UPDATE
  USING (is_crew_leader(auth.uid(), crew_id));

CREATE POLICY "Leader/co-leader can delete sessions"
  ON public.crew_sessions FOR DELETE
  USING (is_crew_leader(auth.uid(), crew_id));

-- crew_session_signups RLS
CREATE POLICY "Public can read signups"
  ON public.crew_session_signups FOR SELECT USING (true);

CREATE POLICY "Members can sign up"
  ON public.crew_session_signups FOR INSERT
  WITH CHECK (player_profile_id = get_player_profile_id(auth.uid()));

CREATE POLICY "Members can cancel own signup"
  ON public.crew_session_signups FOR DELETE
  USING (player_profile_id = get_player_profile_id(auth.uid()));

-- Triggers for updated_at
CREATE TRIGGER update_crew_sessions_updated_at
  BEFORE UPDATE ON public.crew_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
