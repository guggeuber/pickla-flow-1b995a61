
-- Trigger function for crew challenge feed posts
CREATE OR REPLACE FUNCTION public.on_crew_challenge_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _challenger_name TEXT;
  _challenged_name TEXT;
  _feed_type TEXT;
  _title TEXT;
BEGIN
  SELECT name INTO _challenger_name FROM public.crews WHERE id = NEW.challenger_crew_id;
  SELECT name INTO _challenged_name FROM public.crews WHERE id = NEW.challenged_crew_id;

  IF TG_OP = 'INSERT' THEN
    _feed_type := 'crew_challenge_created';
    _title := COALESCE(_challenger_name, 'Crew') || ' utmanade ' || COALESCE(_challenged_name, 'Crew');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    _feed_type := 'crew_challenge_accepted';
    _title := COALESCE(_challenged_name, 'Crew') || ' accepterade clash från ' || COALESCE(_challenger_name, 'Crew');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    _feed_type := 'crew_challenge_completed';
    _title := 'Clash avslutad: ' || COALESCE(_challenger_name, 'Crew') || ' vs ' || COALESCE(_challenged_name, 'Crew');
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.community_feed (feed_type, title, content)
  VALUES (
    _feed_type,
    _title,
    jsonb_build_object(
      'challenge_id', NEW.id,
      'challenger_crew_id', NEW.challenger_crew_id,
      'challenger_name', COALESCE(_challenger_name, ''),
      'challenged_crew_id', NEW.challenged_crew_id,
      'challenged_name', COALESCE(_challenged_name, ''),
      'status', NEW.status,
      'message', COALESCE(NEW.message, ''),
      'result', COALESCE(NEW.result, '{}'::jsonb)
    )
  );

  RETURN NEW;
END;
$$;

-- Create trigger on crew_challenges
CREATE TRIGGER on_crew_challenge_change
AFTER INSERT OR UPDATE ON public.crew_challenges
FOR EACH ROW
EXECUTE FUNCTION public.on_crew_challenge_change();
