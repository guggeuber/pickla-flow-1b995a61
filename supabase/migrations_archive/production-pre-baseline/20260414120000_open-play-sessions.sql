-- ── open_play_sessions ─────────────────────────────────────────────────────
-- Recurring Open Play schedule slots per venue.
-- day_of_week follows JS convention: 0=Sunday … 6=Saturday.
-- court_ids is a UUID array referencing venue_courts.

CREATE TABLE public.open_play_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  day_of_week   INTEGER[]   NOT NULL,           -- e.g. ARRAY[1,2,3,4,6,0]
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  price_sek     INTEGER     NOT NULL DEFAULT 0,
  max_players   INTEGER     NOT NULL DEFAULT 20,
  court_ids     UUID[]      NOT NULL DEFAULT '{}',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_open_play_sessions_venue ON public.open_play_sessions(venue_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.open_play_sessions ENABLE ROW LEVEL SECURITY;

-- Public read: anyone can read active sessions
CREATE POLICY "Public can read open play sessions"
  ON public.open_play_sessions
  FOR SELECT
  USING (is_active = true OR public.is_venue_member(auth.uid(), venue_id));

-- Venue staff (admin role) can manage sessions for their venue
CREATE POLICY "Venue staff can manage open play sessions"
  ON public.open_play_sessions
  FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id))
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id));

-- Super admin full access
CREATE POLICY "Super admin manages open play sessions"
  ON public.open_play_sessions
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── Seed data: Pickla Arena Stockholm ────────────────────────────────────────
-- Bana 5-8 = court_number IN (5,6,7,8) for this venue.

DO $$
DECLARE
  v_venue_id   UUID;
  v_court_ids  UUID[];
BEGIN
  SELECT id INTO v_venue_id
    FROM public.venues
    WHERE slug = 'pickla-arena-sthlm';

  IF v_venue_id IS NULL THEN
    RAISE NOTICE 'Venue pickla-arena-sthlm not found — skipping seed data';
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY court_number)
    INTO v_court_ids
    FROM public.venue_courts
    WHERE venue_id = v_venue_id
      AND court_number IN (5, 6, 7, 8);

  -- Open Play: måndag–torsdag + lördag + söndag, 10:00–22:00, 165 kr
  INSERT INTO public.open_play_sessions
    (venue_id, name, day_of_week, start_time, end_time, price_sek, max_players, court_ids)
  VALUES
    (v_venue_id, 'Open Play', ARRAY[1,2,3,4,6,0], '10:00', '22:00', 165, 20, COALESCE(v_court_ids, '{}'));

  -- Fredagsklubben: fredag, 16:00–22:00, 99 kr
  INSERT INTO public.open_play_sessions
    (venue_id, name, day_of_week, start_time, end_time, price_sek, max_players, court_ids)
  VALUES
    (v_venue_id, 'Fredagsklubben', ARRAY[5], '16:00', '22:00', 99, 20, COALESCE(v_court_ids, '{}'));

  RAISE NOTICE 'Seeded 2 open_play_sessions for venue %', v_venue_id;
END;
$$;
