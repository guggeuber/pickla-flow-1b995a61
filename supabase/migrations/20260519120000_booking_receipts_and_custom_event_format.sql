ALTER TYPE public.event_format ADD VALUE IF NOT EXISTS 'custom';

CREATE SEQUENCE IF NOT EXISTS public.booking_receipt_number_seq;

CREATE OR REPLACE FUNCTION public.fn_generate_booking_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('public.booking_receipt_number_seq');
  RETURN 'PICKLA-' || to_char(now(), 'YYYY') || '-' || lpad(n::TEXT, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.booking_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE DEFAULT public.fn_generate_booking_receipt_number(),
  booking_refs TEXT[] NOT NULL DEFAULT '{}',
  stripe_session_id TEXT UNIQUE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  total_inc_vat INTEGER NOT NULL DEFAULT 0,
  total_ex_vat INTEGER NOT NULL DEFAULT 0,
  vat_amount INTEGER NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 6,
  currency TEXT NOT NULL DEFAULT 'SEK',
  payment_provider TEXT,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_receipts_booking_refs
  ON public.booking_receipts USING GIN (booking_refs);

CREATE INDEX IF NOT EXISTS idx_booking_receipts_venue_issued
  ON public.booking_receipts (venue_id, issued_at DESC);

ALTER TABLE public.booking_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages booking receipts" ON public.booking_receipts;
CREATE POLICY "Service role manages booking receipts"
  ON public.booking_receipts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
