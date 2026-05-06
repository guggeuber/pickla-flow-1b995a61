-- Scope pricing rules to a sport and/or court type.
ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS sport_type TEXT,
  ADD COLUMN IF NOT EXISTS court_type TEXT;

CREATE INDEX IF NOT EXISTS idx_pricing_rules_sport_type
  ON public.pricing_rules (venue_id, sport_type)
  WHERE sport_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_rules_court_type
  ON public.pricing_rules (venue_id, court_type)
  WHERE court_type IS NOT NULL;
