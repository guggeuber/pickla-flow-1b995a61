ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS event_plan_share_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_event_plan_share_token
  ON public.venues(event_plan_share_token)
  WHERE event_plan_share_token IS NOT NULL;
