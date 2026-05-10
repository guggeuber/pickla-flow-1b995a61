ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS planning_status TEXT NOT NULL DEFAULT 'booked',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS expected_participants INTEGER,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS partner_notes TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_planning_status_check,
  ADD CONSTRAINT events_planning_status_check
    CHECK (planning_status IN ('inquiry', 'tentative', 'booked', 'ready', 'published', 'done', 'cancelled'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_visibility_check,
  ADD CONSTRAINT events_visibility_check
    CHECK (visibility IN ('internal', 'partners', 'public'));

UPDATE public.events
SET
  planning_status = CASE
    WHEN status IN ('completed') THEN 'done'
    WHEN is_public IS TRUE THEN 'published'
    ELSE 'booked'
  END,
  visibility = CASE
    WHEN is_public IS TRUE THEN 'public'
    ELSE 'internal'
  END
WHERE planning_status = 'booked'
  AND visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_events_planning_status ON public.events(planning_status);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON public.events(visibility);
