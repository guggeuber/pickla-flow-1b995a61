ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS included_court_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_court_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS membership_usage_entitlement_type text,
  ADD COLUMN IF NOT EXISTS membership_usage_period_start date,
  ADD COLUMN IF NOT EXISTS membership_usage_period_end date;

CREATE INDEX IF NOT EXISTS idx_bookings_membership_usage
  ON public.bookings (membership_id, membership_usage_entitlement_type, membership_usage_period_start)
  WHERE membership_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
