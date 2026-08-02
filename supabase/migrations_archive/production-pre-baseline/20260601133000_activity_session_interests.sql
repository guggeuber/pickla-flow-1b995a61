CREATE TABLE IF NOT EXISTS public.activity_session_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'interested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activity_session_interests_status_check CHECK (status IN ('interested'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_activity_session_interests_user_session_date
  ON public.activity_session_interests (user_id, activity_session_id, session_date);

CREATE INDEX IF NOT EXISTS idx_activity_session_interests_session_date
  ON public.activity_session_interests (activity_session_id, session_date, status);

CREATE INDEX IF NOT EXISTS idx_activity_session_interests_venue_created
  ON public.activity_session_interests (venue_id, created_at DESC);

DROP TRIGGER IF EXISTS update_activity_session_interests_updated_at ON public.activity_session_interests;
CREATE TRIGGER update_activity_session_interests_updated_at
BEFORE UPDATE ON public.activity_session_interests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.activity_session_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own activity interests" ON public.activity_session_interests;
CREATE POLICY "Users read own activity interests"
  ON public.activity_session_interests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Users create own activity interests" ON public.activity_session_interests;
CREATE POLICY "Users create own activity interests"
  ON public.activity_session_interests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own activity interests" ON public.activity_session_interests;
CREATE POLICY "Users delete own activity interests"
  ON public.activity_session_interests FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Venue staff update activity interests" ON public.activity_session_interests;
CREATE POLICY "Venue staff update activity interests"
  ON public.activity_session_interests FOR UPDATE
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());
