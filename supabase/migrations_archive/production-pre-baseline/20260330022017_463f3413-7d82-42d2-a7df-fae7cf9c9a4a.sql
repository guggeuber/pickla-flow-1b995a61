
-- Forum posts (threads) table
CREATE TABLE public.forum_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  author_profile_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE NOT NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT 'general',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read forum posts" ON public.forum_posts
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated can create posts" ON public.forum_posts
  FOR INSERT TO authenticated
  WITH CHECK (author_profile_id = public.get_player_profile_id(auth.uid()));

CREATE POLICY "Authors can update own posts" ON public.forum_posts
  FOR UPDATE TO authenticated
  USING (author_profile_id = public.get_player_profile_id(auth.uid()));

CREATE POLICY "Authors can delete own posts" ON public.forum_posts
  FOR DELETE TO authenticated
  USING (author_profile_id = public.get_player_profile_id(auth.uid()) OR public.is_super_admin());

-- Post votes (upvote/downvote)
CREATE TABLE public.post_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE NOT NULL,
  auth_user_id UUID NOT NULL,
  vote_value INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(post_id, auth_user_id)
);

ALTER TABLE public.post_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read votes" ON public.post_votes
  FOR SELECT TO public USING (true);

CREATE POLICY "Users can vote" ON public.post_votes
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can change vote" ON public.post_votes
  FOR UPDATE TO authenticated USING (auth_user_id = auth.uid());

CREATE POLICY "Users can remove vote" ON public.post_votes
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());

-- Post comments
CREATE TABLE public.post_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE NOT NULL,
  author_profile_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE NOT NULL,
  parent_comment_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read comments" ON public.post_comments
  FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated can comment" ON public.post_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_profile_id = public.get_player_profile_id(auth.uid()));

CREATE POLICY "Authors can update own comments" ON public.post_comments
  FOR UPDATE TO authenticated
  USING (author_profile_id = public.get_player_profile_id(auth.uid()));

CREATE POLICY "Authors can delete own comments" ON public.post_comments
  FOR DELETE TO authenticated
  USING (author_profile_id = public.get_player_profile_id(auth.uid()) OR public.is_super_admin());

-- Comment votes
CREATE TABLE public.comment_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE NOT NULL,
  auth_user_id UUID NOT NULL,
  vote_value INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(comment_id, auth_user_id)
);

ALTER TABLE public.comment_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read comment votes" ON public.comment_votes
  FOR SELECT TO public USING (true);

CREATE POLICY "Users can vote on comments" ON public.comment_votes
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can change comment vote" ON public.comment_votes
  FOR UPDATE TO authenticated USING (auth_user_id = auth.uid());

CREATE POLICY "Users can remove comment vote" ON public.comment_votes
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());

-- Function to sync vote counts
CREATE OR REPLACE FUNCTION public.update_post_vote_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.forum_posts SET upvote_count = (
      SELECT COALESCE(SUM(vote_value), 0) FROM public.post_votes WHERE post_id = OLD.post_id
    ) WHERE id = OLD.post_id;
    RETURN OLD;
  ELSE
    UPDATE public.forum_posts SET upvote_count = (
      SELECT COALESCE(SUM(vote_value), 0) FROM public.post_votes WHERE post_id = NEW.post_id
    ) WHERE id = NEW.post_id;
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER on_post_vote_change
  AFTER INSERT OR UPDATE OR DELETE ON public.post_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_vote_count();

-- Function to sync comment counts
CREATE OR REPLACE FUNCTION public.update_post_comment_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.forum_posts SET comment_count = (
      SELECT COUNT(*) FROM public.post_comments WHERE post_id = OLD.post_id
    ) WHERE id = OLD.post_id;
    RETURN OLD;
  ELSE
    UPDATE public.forum_posts SET comment_count = (
      SELECT COUNT(*) FROM public.post_comments WHERE post_id = NEW.post_id
    ) WHERE id = NEW.post_id;
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER on_post_comment_change
  AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comment_count();

-- Auto-generate activity feed from venue checkins
CREATE OR REPLACE FUNCTION public.on_venue_checkin_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _venue_name TEXT;
  _player_name TEXT;
  _profile_id UUID;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  
  SELECT name INTO _venue_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT id, display_name INTO _profile_id, _player_name 
    FROM public.player_profiles WHERE auth_user_id = NEW.user_id;
  
  IF _profile_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.community_feed (venue_id, player_profile_id, feed_type, title, content)
  VALUES (
    NEW.venue_id,
    _profile_id,
    'checkin',
    COALESCE(_player_name, 'Someone') || ' checked in at ' || COALESCE(_venue_name, 'the venue') || ' 🏓',
    jsonb_build_object(
      'checkin_id', NEW.id,
      'player_name', COALESCE(_player_name, ''),
      'venue_name', COALESCE(_venue_name, ''),
      'entry_type', NEW.entry_type
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_venue_checkin_insert
  AFTER INSERT ON public.venue_checkins
  FOR EACH ROW EXECUTE FUNCTION public.on_venue_checkin_created();

-- Indexes for performance
CREATE INDEX idx_forum_posts_tag ON public.forum_posts(tag);
CREATE INDEX idx_forum_posts_created ON public.forum_posts(created_at DESC);
CREATE INDEX idx_forum_posts_upvotes ON public.forum_posts(upvote_count DESC);
CREATE INDEX idx_post_comments_post ON public.post_comments(post_id);
CREATE INDEX idx_post_votes_post ON public.post_votes(post_id);
