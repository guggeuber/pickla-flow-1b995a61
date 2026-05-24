-- Separate public visibility from staff assignment, and make benefit edits first-class.

ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT true;

UPDATE public.membership_tiers
SET is_assignable = true
WHERE is_assignable IS NULL;

CREATE INDEX IF NOT EXISTS idx_membership_tiers_assignable
  ON public.membership_tiers (venue_id, is_assignable, sort_order);

NOTIFY pgrst, 'reload schema';
