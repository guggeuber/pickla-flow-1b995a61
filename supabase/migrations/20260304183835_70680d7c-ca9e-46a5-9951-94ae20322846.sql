
-- Add time fields and entry fee to events
ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS start_time time without time zone,
  ADD COLUMN IF NOT EXISTS end_time time without time zone,
  ADD COLUMN IF NOT EXISTS entry_fee numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_fee_type text NOT NULL DEFAULT 'fixed';

-- Create event_courts join table
CREATE TABLE IF NOT EXISTS public.event_courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_court_id uuid NOT NULL REFERENCES public.venue_courts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, venue_court_id)
);

ALTER TABLE public.event_courts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read event courts"
  ON public.event_courts FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage event courts"
  ON public.event_courts FOR ALL
  USING (is_super_admin() OR is_venue_admin(auth.uid(), get_venue_id_for_event(event_id)))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), get_venue_id_for_event(event_id)));
