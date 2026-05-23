-- Temporary mobile-to-padda account linking for Pickla Score match setup.

CREATE TABLE IF NOT EXISTS public.score_player_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setup_id TEXT NOT NULL,
  display_device_id UUID NOT NULL REFERENCES public.display_devices(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 0 AND 7),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (setup_id, display_device_id, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_score_player_links_setup
  ON public.score_player_links(display_device_id, setup_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_score_player_links_user
  ON public.score_player_links(auth_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_score_player_links_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_player_links_updated_at ON public.score_player_links;
CREATE TRIGGER trg_score_player_links_updated_at
  BEFORE UPDATE ON public.score_player_links
  FOR EACH ROW EXECUTE FUNCTION public.fn_score_player_links_updated_at();

ALTER TABLE public.score_player_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own score player links"
  ON public.score_player_links FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Venue staff read score player links"
  ON public.score_player_links FOR SELECT TO authenticated
  USING (public.is_venue_member(auth.uid(), venue_id) OR public.is_super_admin());

CREATE POLICY "Service role manages score player links"
  ON public.score_player_links FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
