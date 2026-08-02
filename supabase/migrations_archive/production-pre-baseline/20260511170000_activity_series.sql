-- Activity series/program structure.
-- A series groups recurring or finite activity sessions, e.g. a 10-week course,
-- Fredagsklubben, or weekly Pickla Open.

CREATE TABLE IF NOT EXISTS public.activity_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  series_type TEXT NOT NULL DEFAULT 'program',
  sport_type TEXT NOT NULL DEFAULT 'pickleball',
  status TEXT NOT NULL DEFAULT 'active',
  product_key TEXT,
  start_date DATE,
  end_date DATE,
  total_sessions INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activity_series_status_check CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_activity_series_venue_status
  ON public.activity_series (venue_id, status, series_type);

ALTER TABLE public.activity_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active activity series"
  ON public.activity_series FOR SELECT
  USING (status = 'active' OR public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Venue staff can manage activity series"
  ON public.activity_series FOR ALL
  TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin())
  WITH CHECK (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.activity_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_key TEXT,
  ADD COLUMN IF NOT EXISTS publish_status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_activity_sessions_series
  ON public.activity_sessions (series_id);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_product_key
  ON public.activity_sessions (venue_id, product_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_series_seed_key
  ON public.activity_series (venue_id, (metadata->>'seed_key'))
  WHERE metadata ? 'seed_key';

DO $$
DECLARE
  v_venue_id UUID;
  v_court_ids UUID[];
  v_open_series UUID;
  v_friday_series UUID;
  v_pickla_open_series UUID;
  v_training_series UUID;
BEGIN
  SELECT id INTO v_venue_id
  FROM public.venues
  WHERE slug = 'pickla-arena-sthlm';

  IF v_venue_id IS NULL THEN
    RAISE NOTICE 'Venue pickla-arena-sthlm not found; skipping activity series seed';
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY court_number)
    INTO v_court_ids
  FROM public.venue_courts
  WHERE venue_id = v_venue_id
    AND court_number IN (5, 6, 7, 8);

  INSERT INTO public.activity_series (venue_id, name, description, series_type, product_key, metadata)
  VALUES
    (v_venue_id, 'Open Play', 'Återkommande Open Play-pass för hallens dagsprogram.', 'program', 'day_access', '{"seed_key": "open_play_program"}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_open_series;

  IF v_open_series IS NULL THEN
    SELECT id INTO v_open_series FROM public.activity_series
    WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'open_play_program'
    LIMIT 1;
  END IF;

  INSERT INTO public.activity_series (venue_id, name, description, series_type, product_key, metadata)
  VALUES
    (v_venue_id, 'Fredagsklubben', 'Återkommande social fredagsspel.', 'club_night', 'day_access', '{"seed_key": "fredagsklubben"}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_friday_series;

  IF v_friday_series IS NULL THEN
    SELECT id INTO v_friday_series FROM public.activity_series
    WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'fredagsklubben'
    LIMIT 1;
  END IF;

  INSERT INTO public.activity_series (venue_id, name, description, series_type, product_key, metadata)
  VALUES
    (v_venue_id, 'Pickla Open', 'Återkommande lördagsformat.', 'competition', 'open_play_slot', '{"seed_key": "pickla_open_weekly"}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_pickla_open_series;

  IF v_pickla_open_series IS NULL THEN
    SELECT id INTO v_pickla_open_series FROM public.activity_series
    WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'pickla_open_weekly'
    LIMIT 1;
  END IF;

  INSERT INTO public.activity_series (venue_id, name, description, series_type, product_key, metadata)
  VALUES
    (v_venue_id, 'Onsdag Gruppträning', 'Återkommande gruppträning med möjlighet till day access.', 'training', 'group_training_day_access', '{"seed_key": "wednesday_training"}'::jsonb)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_training_series;

  IF v_training_series IS NULL THEN
    SELECT id INTO v_training_series FROM public.activity_series
    WHERE venue_id = v_venue_id AND metadata->>'seed_key' = 'wednesday_training'
    LIMIT 1;
  END IF;

  UPDATE public.activity_sessions
    SET series_id = v_open_series,
        product_key = 'day_access'
  WHERE venue_id = v_venue_id
    AND name IN ('Open Play FM', 'Open Play Eftermiddag', 'Open Play Kväll');

  IF NOT EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE venue_id = v_venue_id
      AND metadata->>'seed_key' = 'fredagsklubben_session'
  ) THEN
    INSERT INTO public.activity_sessions
      (venue_id, series_id, product_key, name, session_type, recurrence_days, start_time, end_time, price_sek, capacity, court_ids, access_policy, metadata, sort_order)
    VALUES
      (
        v_venue_id,
        v_friday_series,
        'day_access',
        'Fredagsklubben',
        'open_play',
        ARRAY[5],
        '17:00',
        '20:00',
        195,
        32,
        COALESCE(v_court_ids, '{}'),
        '{"allows_day_access": true, "member_benefit_key": "open_play_unlimited"}'::jsonb,
        '{"seed_key": "fredagsklubben_session"}'::jsonb,
        50
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.activity_sessions
    WHERE venue_id = v_venue_id
      AND metadata->>'seed_key' = 'pickla_open_session'
  ) THEN
    INSERT INTO public.activity_sessions
      (venue_id, series_id, product_key, name, session_type, recurrence_days, start_time, end_time, price_sek, capacity, court_ids, access_policy, metadata, sort_order)
    VALUES
      (
        v_venue_id,
        v_pickla_open_series,
        'open_play_slot',
        'Pickla Open',
        'pickla_open',
        ARRAY[6],
        '12:00',
        '15:00',
        195,
        32,
        COALESCE(v_court_ids, '{}'),
        '{"allows_day_access": false, "member_benefit_key": "pickla_open_discount"}'::jsonb,
        '{"seed_key": "pickla_open_session"}'::jsonb,
        60
      );
  END IF;

  UPDATE public.activity_sessions
    SET series_id = v_training_series,
        product_key = 'group_training_day_access'
  WHERE venue_id = v_venue_id
    AND name = 'Onsdag Gruppträning';
END;
$$;
