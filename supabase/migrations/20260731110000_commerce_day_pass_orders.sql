-- Commerce R1: day passes can be owned by an authenticated user or by the
-- canonical customer created for an account-later guest Commerce order.

ALTER TABLE public.day_passes
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.day_passes
  ADD COLUMN IF NOT EXISTS commerce_order_id UUID REFERENCES public.commerce_orders(id) ON DELETE SET NULL;
ALTER TABLE public.day_passes
  DROP CONSTRAINT IF EXISTS day_passes_owner_required;
ALTER TABLE public.day_passes
  ADD CONSTRAINT day_passes_owner_required CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL) NOT VALID;
ALTER TABLE public.day_passes
  VALIDATE CONSTRAINT day_passes_owner_required;

CREATE UNIQUE INDEX IF NOT EXISTS idx_day_passes_commerce_order
  ON public.day_passes (commerce_order_id);
CREATE INDEX IF NOT EXISTS idx_day_passes_customer_date
  ON public.day_passes (customer_id, valid_date, status)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.day_passes.commerce_order_id IS
  'Canonical Commerce order that purchased this configured day_access product.';
