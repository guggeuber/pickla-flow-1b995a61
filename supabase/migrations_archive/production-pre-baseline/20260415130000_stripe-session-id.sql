-- Add stripe_session_id to bookings for idempotent webhook processing
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE UNIQUE INDEX idx_bookings_stripe_session
  ON public.bookings (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- Add stripe_session_id to day_passes
ALTER TABLE public.day_passes
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE UNIQUE INDEX idx_day_passes_stripe_session
  ON public.day_passes (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
