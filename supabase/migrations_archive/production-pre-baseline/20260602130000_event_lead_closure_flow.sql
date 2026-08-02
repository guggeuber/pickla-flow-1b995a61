-- Pickla Event Agent OS: lead-first closure + deposit confirmation

ALTER TABLE public.event_offers
  ADD COLUMN IF NOT EXISTS booking_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS deposit_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_offers_deposit_session
  ON public.event_offers(deposit_stripe_session_id)
  WHERE deposit_stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_communications_event_lead
  ON public.event_communications ((metadata->>'event_lead_id'), created_at DESC)
  WHERE metadata ? 'event_lead_id';
