-- Add missing columns to customer_transactions
ALTER TABLE public.customer_transactions
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS source_payment_id text,
  ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SEK',
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS activity_session_id uuid REFERENCES public.activity_sessions(id),
  ADD COLUMN IF NOT EXISTS session_registration_id uuid REFERENCES public.session_registrations(id),
  ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES public.memberships(id),
  ADD COLUMN IF NOT EXISTS day_pass_id uuid REFERENCES public.day_passes(id);

-- Add useful indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_customer_transactions_source_event_id ON public.customer_transactions (source_event_id);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_source_payment_id ON public.customer_transactions (source_payment_id);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_product_type ON public.customer_transactions (product_type);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_activity_session_id ON public.customer_transactions (activity_session_id);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_session_registration_id ON public.customer_transactions (session_registration_id);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_membership_id ON public.customer_transactions (membership_id);
CREATE INDEX IF NOT EXISTS idx_customer_transactions_day_pass_id ON public.customer_transactions (day_pass_id);
