
-- Table for LFG/forum post signups
CREATE TABLE public.forum_post_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  player_profile_id UUID NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'confirmed',
  UNIQUE(post_id, player_profile_id)
);

ALTER TABLE public.forum_post_signups ENABLE ROW LEVEL SECURITY;

-- Anyone can read signups
CREATE POLICY "Anyone can read post signups" ON public.forum_post_signups
  FOR SELECT TO public USING (true);

-- Authenticated can sign up (own profile only)
CREATE POLICY "Users can sign up for posts" ON public.forum_post_signups
  FOR INSERT TO authenticated
  WITH CHECK (player_profile_id = public.get_player_profile_id(auth.uid()));

-- Users can cancel own signup
CREATE POLICY "Users can cancel own signup" ON public.forum_post_signups
  FOR DELETE TO authenticated
  USING (player_profile_id = public.get_player_profile_id(auth.uid()));
