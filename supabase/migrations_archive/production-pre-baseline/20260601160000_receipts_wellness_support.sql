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

ALTER TABLE public.booking_receipts
  ADD COLUMN IF NOT EXISTS purchase_type TEXT NOT NULL DEFAULT 'booking',
  ADD COLUMN IF NOT EXISTS product_description TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS total_inc_vat_sek NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_ex_vat_sek NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount_sek NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS wellness_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_identity_number TEXT,
  ADD COLUMN IF NOT EXISTS employer_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.booking_receipts
SET
  total_inc_vat_sek = COALESCE(total_inc_vat_sek, total_inc_vat::NUMERIC),
  vat_amount_sek = COALESCE(vat_amount_sek, round((total_inc_vat::NUMERIC * vat_rate / (100 + vat_rate))::NUMERIC, 2)),
  total_ex_vat_sek = COALESCE(total_ex_vat_sek, round((total_inc_vat::NUMERIC - (total_inc_vat::NUMERIC * vat_rate / (100 + vat_rate)))::NUMERIC, 2)),
  product_description = COALESCE(product_description, metadata->>'product_type', 'Pickla')
WHERE total_inc_vat_sek IS NULL
   OR vat_amount_sek IS NULL
   OR total_ex_vat_sek IS NULL
   OR product_description IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_receipts_user_issued
  ON public.booking_receipts (user_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_receipts_purchase_type
  ON public.booking_receipts (purchase_type);

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

DROP TRIGGER IF EXISTS update_booking_receipts_updated_at ON public.booking_receipts;
CREATE TRIGGER update_booking_receipts_updated_at
BEFORE UPDATE ON public.booking_receipts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.wellness_receipt_profiles (
  auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_identity_number TEXT,
  employer_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_wellness_receipt_profiles_updated_at ON public.wellness_receipt_profiles;
CREATE TRIGGER update_wellness_receipt_profiles_updated_at
BEFORE UPDATE ON public.wellness_receipt_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wellness_receipt_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own wellness receipt profile" ON public.wellness_receipt_profiles;
CREATE POLICY "Users manage own wellness receipt profile"
  ON public.wellness_receipt_profiles
  FOR ALL
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Super admins read wellness receipt profiles" ON public.wellness_receipt_profiles;
CREATE POLICY "Super admins read wellness receipt profiles"
  ON public.wellness_receipt_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());
