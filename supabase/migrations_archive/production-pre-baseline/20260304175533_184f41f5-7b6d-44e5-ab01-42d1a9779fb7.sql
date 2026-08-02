
CREATE TABLE public.venue_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID,
  player_name TEXT,
  player_phone TEXT,
  entry_type TEXT NOT NULL DEFAULT 'manual',
  entitlement_id UUID,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_out_at TIMESTAMPTZ,
  checked_in_by UUID,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.venue_checkins ENABLE ROW LEVEL SECURITY;

-- Staff can manage checkins for their venue
CREATE POLICY "Staff manages venue checkins"
  ON public.venue_checkins FOR ALL
  TO authenticated
  USING (is_super_admin() OR is_venue_member(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_member(auth.uid(), venue_id));

-- Public can count checkins (for player counter)
CREATE POLICY "Public can count checkins"
  ON public.venue_checkins FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX idx_venue_checkins_venue_date ON public.venue_checkins(venue_id, session_date);
CREATE INDEX idx_venue_checkins_user ON public.venue_checkins(user_id);
