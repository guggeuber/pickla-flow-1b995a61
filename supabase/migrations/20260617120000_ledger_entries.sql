CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  accounting_date DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  customer_name TEXT,
  amount_inc_vat_minor INTEGER NOT NULL,
  vat_amount_minor INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  payment_method TEXT,
  stripe_session_id TEXT,
  receipt_number TEXT,
  booking_receipt_id UUID REFERENCES public.booking_receipts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_amount_non_negative CHECK (amount_inc_vat_minor >= 0),
  CONSTRAINT ledger_entries_vat_non_negative CHECK (vat_amount_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_source
  ON public.ledger_entries (source_type, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_stripe_session
  ON public.ledger_entries (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_venue_accounting_date
  ON public.ledger_entries (venue_id, accounting_date DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_booking_receipt
  ON public.ledger_entries (booking_receipt_id);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view venue ledger_entries"
  ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = ledger_entries.venue_id
        AND venue_staff.is_active = true
        AND venue_staff.role IN ('venue_admin', 'desk_staff')
    )
    OR public.is_super_admin()
  );

CREATE OR REPLACE FUNCTION public.prevent_ledger_entries_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only';
END;
$$;

DROP TRIGGER IF EXISTS prevent_ledger_entries_update ON public.ledger_entries;
CREATE TRIGGER prevent_ledger_entries_update
BEFORE UPDATE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_entries_mutation();

DROP TRIGGER IF EXISTS prevent_ledger_entries_delete ON public.ledger_entries;
CREATE TRIGGER prevent_ledger_entries_delete
BEFORE DELETE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_entries_mutation();
