
-- Poll options table for forum posts
CREATE TABLE public.forum_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.forum_poll_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read poll options" ON public.forum_poll_options
  FOR SELECT TO public USING (true);

CREATE POLICY "Post author can create poll options" ON public.forum_poll_options
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.forum_posts fp 
    WHERE fp.id = post_id AND fp.author_profile_id = public.get_player_profile_id(auth.uid())
  ));

-- Poll votes table
CREATE TABLE public.forum_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id UUID NOT NULL REFERENCES public.forum_poll_options(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(option_id, auth_user_id)
);

-- Unique constraint: one vote per user per poll (enforced via trigger)
CREATE OR REPLACE FUNCTION public.enforce_one_vote_per_poll()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete any existing vote by this user on ANY option of the same poll
  DELETE FROM public.forum_poll_votes fpv
  WHERE fpv.auth_user_id = NEW.auth_user_id
    AND fpv.option_id IN (
      SELECT fpo.id FROM public.forum_poll_options fpo
      WHERE fpo.post_id = (SELECT post_id FROM public.forum_poll_options WHERE id = NEW.option_id)
    )
    AND fpv.id IS DISTINCT FROM NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_one_vote_per_poll
  AFTER INSERT ON public.forum_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_vote_per_poll();

ALTER TABLE public.forum_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read poll votes" ON public.forum_poll_votes
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated can vote" ON public.forum_poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can change vote" ON public.forum_poll_votes
  FOR DELETE TO authenticated
  USING (auth_user_id = auth.uid());
