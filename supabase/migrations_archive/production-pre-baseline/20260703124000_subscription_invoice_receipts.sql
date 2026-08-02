-- Financial Ops 1B: Stripe subscription invoice evidence.
-- Adds a first-class Stripe invoice id to booking_receipts so recurring
-- membership invoices can be stored idempotently without overloading
-- stripe_session_id.

ALTER TABLE public.booking_receipts
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_receipts_stripe_invoice
  ON public.booking_receipts (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_receipts_stripe_subscription
  ON public.booking_receipts (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- After applying manually, run:
-- NOTIFY pgrst, 'reload schema';
