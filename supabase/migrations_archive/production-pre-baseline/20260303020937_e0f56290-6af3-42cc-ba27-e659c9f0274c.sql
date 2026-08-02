
-- Community feed table for cross-venue activity stream
CREATE TABLE public.community_feed (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  player_profile_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  feed_type TEXT NOT NULL, -- 'match_result', 'checkin', 'achievement', 'event_created'
  title TEXT NOT NULL,
  content JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Feed likes table for social interaction
CREATE TABLE public.feed_likes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_item_id UUID NOT NULL REFERENCES public.community_feed(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(feed_item_id, auth_user_id)
);

-- Enable RLS
ALTER TABLE public.community_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_likes ENABLE ROW LEVEL SECURITY;

-- Community feed: publicly readable, only service role can write (via triggers/edge functions)
CREATE POLICY "Public can read community feed"
  ON public.community_feed FOR SELECT
  USING (true);

CREATE POLICY "Service role inserts feed"
  ON public.community_feed FOR INSERT
  WITH CHECK (false); -- only service role bypasses RLS

-- Feed likes: public read, authenticated users manage own
CREATE POLICY "Public can read feed likes"
  ON public.feed_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can like posts"
  ON public.feed_likes FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Users can unlike own likes"
  ON public.feed_likes FOR DELETE
  USING (auth_user_id = auth.uid());

-- Index for fast feed queries
CREATE INDEX idx_community_feed_created ON public.community_feed(created_at DESC);
CREATE INDEX idx_community_feed_venue ON public.community_feed(venue_id);
CREATE INDEX idx_feed_likes_item ON public.feed_likes(feed_item_id);

-- Trigger function to auto-create feed post when a match is completed
CREATE OR REPLACE FUNCTION public.on_match_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _venue_id UUID;
  _event_name TEXT;
  _team1_name TEXT;
  _team2_name TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT venue_id, name INTO _venue_id, _event_name FROM public.events WHERE id = NEW.event_id;
    SELECT name INTO _team1_name FROM public.teams WHERE id = NEW.team1_id;
    SELECT name INTO _team2_name FROM public.teams WHERE id = NEW.team2_id;

    INSERT INTO public.community_feed (venue_id, event_id, feed_type, title, content)
    VALUES (
      _venue_id,
      NEW.event_id,
      'match_result',
      COALESCE(_team1_name, 'Team 1') || ' vs ' || COALESCE(_team2_name, 'Team 2'),
      jsonb_build_object(
        'match_id', NEW.id,
        'team1_name', COALESCE(_team1_name, 'Team 1'),
        'team2_name', COALESCE(_team2_name, 'Team 2'),
        'team1_score', COALESCE(NEW.team1_score, 0),
        'team2_score', COALESCE(NEW.team2_score, 0),
        'event_name', COALESCE(_event_name, '')
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_match_completed
  AFTER UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.on_match_completed();

-- Trigger for new event created
CREATE OR REPLACE FUNCTION public.on_event_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_public = true THEN
    INSERT INTO public.community_feed (venue_id, event_id, feed_type, title, content)
    VALUES (
      NEW.venue_id,
      NEW.id,
      'event_created',
      COALESCE(NEW.display_name, NEW.name),
      jsonb_build_object(
        'event_type', NEW.event_type,
        'format', NEW.format,
        'start_date', NEW.start_date
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_event_created
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.on_event_created();
