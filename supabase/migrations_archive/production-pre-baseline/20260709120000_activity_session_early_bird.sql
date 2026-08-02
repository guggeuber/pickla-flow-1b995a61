-- Activity session early bird and scarcity display controls.
-- Adds optional per-session/per-product pricing fields without changing checkout flow.

ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS early_bird_price_minor integer,
  ADD COLUMN IF NOT EXISTS early_bird_slots integer,
  ADD COLUMN IF NOT EXISTS scarcity_mode text NOT NULL DEFAULT 'none';

ALTER TABLE public.access_products
  ADD COLUMN IF NOT EXISTS early_bird_price_minor integer,
  ADD COLUMN IF NOT EXISTS early_bird_slots integer,
  ADD COLUMN IF NOT EXISTS scarcity_mode text NOT NULL DEFAULT 'none';

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_early_bird_price_nonnegative;
ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_early_bird_price_nonnegative
  CHECK (early_bird_price_minor IS NULL OR early_bird_price_minor >= 0);

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_early_bird_slots_positive;
ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_early_bird_slots_positive
  CHECK (early_bird_slots IS NULL OR early_bird_slots > 0);

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_scarcity_mode_check;
ALTER TABLE public.activity_sessions
  ADD CONSTRAINT activity_sessions_scarcity_mode_check
  CHECK (scarcity_mode IN ('none', 'early_bird', 'capacity'));

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_early_bird_price_nonnegative;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_early_bird_price_nonnegative
  CHECK (early_bird_price_minor IS NULL OR early_bird_price_minor >= 0);

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_early_bird_slots_positive;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_early_bird_slots_positive
  CHECK (early_bird_slots IS NULL OR early_bird_slots > 0);

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_scarcity_mode_check;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_scarcity_mode_check
  CHECK (scarcity_mode IN ('none', 'early_bird', 'capacity'));

CREATE INDEX IF NOT EXISTS idx_activity_sessions_early_bird
  ON public.activity_sessions (venue_id, early_bird_slots)
  WHERE early_bird_price_minor IS NOT NULL AND early_bird_slots IS NOT NULL;

-- After manual SQL Editor execution: NOTIFY pgrst, 'reload schema';
