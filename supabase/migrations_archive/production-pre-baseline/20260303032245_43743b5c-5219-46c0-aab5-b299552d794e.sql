
-- Add is_private column to crew_sessions
ALTER TABLE public.crew_sessions ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- Create trigger function to post crew session to community feed
CREATE OR REPLACE FUNCTION public.on_crew_session_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _crew_name TEXT;
  _venue_name TEXT;
  _court_name TEXT;
BEGIN
  -- Only post to feed if NOT private
  IF NEW.is_private = true THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _crew_name FROM public.crews WHERE id = NEW.crew_id;
  SELECT name INTO _venue_name FROM public.venues WHERE id = NEW.venue_id;
  SELECT name INTO _court_name FROM public.venue_courts WHERE id = NEW.venue_court_id;

  INSERT INTO public.community_feed (venue_id, feed_type, title, content)
  VALUES (
    NEW.venue_id,
    'crew_session',
    COALESCE(_crew_name, 'Crew') || ': ' || NEW.title,
    jsonb_build_object(
      'session_id', NEW.id,
      'crew_id', NEW.crew_id,
      'crew_name', COALESCE(_crew_name, ''),
      'venue_name', COALESCE(_venue_name, ''),
      'court_name', COALESCE(_court_name, ''),
      'session_date', NEW.session_date,
      'start_time', NEW.start_time,
      'end_time', NEW.end_time,
      'max_participants', NEW.max_participants
    )
  );

  RETURN NEW;
END;
$function$;

-- Create trigger
CREATE TRIGGER on_crew_session_created
AFTER INSERT ON public.crew_sessions
FOR EACH ROW
EXECUTE FUNCTION public.on_crew_session_created();
