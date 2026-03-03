
-- Add discount_percent to membership_tier_pricing for per-product percentage discounts
ALTER TABLE public.membership_tier_pricing 
ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT NULL;

-- Add vat_rate to membership_tier_pricing (default 6% for sports)
ALTER TABLE public.membership_tier_pricing 
ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 6;

-- Add label column for display name
ALTER TABLE public.membership_tier_pricing 
ADD COLUMN IF NOT EXISTS label text DEFAULT NULL;

-- Update product_type to use clear keys, ensure we have all product types
-- Existing data uses 'court_hourly', 'day_pass', 'event' - keep those and add guest_pass

-- Add vat_rate to pricing_rules for general pricing
ALTER TABLE public.pricing_rules
ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 6;

-- Add constraint: either fixed_price or discount_percent must be set (not both)
ALTER TABLE public.membership_tier_pricing
ADD CONSTRAINT check_price_or_discount 
CHECK (
  (fixed_price IS NOT NULL AND discount_percent IS NULL) OR 
  (fixed_price IS NULL AND discount_percent IS NOT NULL) OR
  (fixed_price IS NULL AND discount_percent IS NULL)
);
