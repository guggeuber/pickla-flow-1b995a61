-- Series Commerce R2: make direct product-specific membership pricing a
-- canonical API-owned write path. Existing zero-value legacy entitlement rows
-- remain untouched; api-memberships rejects new/changed non-positive prices.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.membership_tier_pricing
    WHERE pricing_rule_id IS NULL
    GROUP BY tier_id, product_type
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'membership_tier_pricing_duplicate_direct_product_rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.membership_tier_pricing
    WHERE (fixed_price IS NULL) = (discount_percent IS NULL)
  ) THEN
    RAISE EXCEPTION 'membership_tier_pricing_invalid_mode';
  END IF;
END
$$;

ALTER TABLE public.membership_tier_pricing
  DROP CONSTRAINT IF EXISTS check_price_or_discount;

ALTER TABLE public.membership_tier_pricing
  ADD CONSTRAINT membership_tier_pricing_exactly_one_mode
  CHECK (
    (fixed_price IS NOT NULL AND discount_percent IS NULL)
    OR
    (fixed_price IS NULL AND discount_percent IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_tier_pricing_direct_product
  ON public.membership_tier_pricing (tier_id, product_type)
  WHERE pricing_rule_id IS NULL;

REVOKE INSERT, UPDATE, DELETE ON public.membership_tier_pricing FROM anon, authenticated;
GRANT SELECT ON public.membership_tier_pricing TO anon, authenticated;
GRANT ALL ON public.membership_tier_pricing TO service_role;

COMMENT ON INDEX public.uq_membership_tier_pricing_direct_product IS
  'One active direct member-price rule per membership tier and access-product key. Row absence means inactive.';
