-- Allow one Stripe Checkout session to create one booking row per selected court.
--
-- The original idempotency index only allowed a single bookings row per
-- stripe_session_id, which broke multi-court bookings: the first court was
-- inserted and the second court failed on the unique constraint.
DROP INDEX IF EXISTS public.idx_bookings_stripe_session;
DROP INDEX IF EXISTS idx_bookings_stripe_session;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_stripe_session_court
  ON public.bookings (stripe_session_id, venue_court_id)
  WHERE stripe_session_id IS NOT NULL;
