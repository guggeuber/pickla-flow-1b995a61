
-- Add time-of-day and day-of-week support to pricing_rules
ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS days_of_week integer[] DEFAULT '{0,1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS time_from time DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS time_to time DEFAULT '23:59';

-- Add comment for clarity
COMMENT ON COLUMN public.pricing_rules.days_of_week IS 'Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)';
COMMENT ON COLUMN public.pricing_rules.time_from IS 'Start of time window this price applies to';
COMMENT ON COLUMN public.pricing_rules.time_to IS 'End of time window this price applies to';
