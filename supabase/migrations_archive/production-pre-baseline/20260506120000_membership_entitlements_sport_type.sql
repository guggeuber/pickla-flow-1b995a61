-- Scope membership entitlements by sport so pickleball benefits do not apply to dart.
ALTER TABLE public.membership_entitlements
  ADD COLUMN IF NOT EXISTS sport_type TEXT NOT NULL DEFAULT 'pickleball';

UPDATE public.membership_entitlements
SET sport_type = 'pickleball'
WHERE sport_type IS NULL;

ALTER TABLE public.membership_entitlements
  DROP CONSTRAINT IF EXISTS membership_entitlements_tier_id_entitlement_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS membership_entitlements_tier_type_sport_key
  ON public.membership_entitlements (tier_id, entitlement_type, sport_type);

CREATE INDEX IF NOT EXISTS idx_membership_entitlements_sport_type
  ON public.membership_entitlements (sport_type);
