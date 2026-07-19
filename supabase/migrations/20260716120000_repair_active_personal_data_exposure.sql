-- Repair A: remove anonymous row access to active personal-data tables.
-- Replacement public projections are served by api-event-public and api-checkins.

DROP POLICY IF EXISTS "Public can read players" ON public.players;

DROP POLICY IF EXISTS "Anon can read recent venue_checkins" ON public.venue_checkins;
DROP POLICY IF EXISTS "Public can count checkins" ON public.venue_checkins;

-- Existing authenticated staff/admin policies remain unchanged.
-- Do not add an unrestricted public or anonymous replacement.
