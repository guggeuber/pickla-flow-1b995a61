-- Commerce activation contract.
-- Product lifecycle and sales modes are operator truth. Venue Commerce availability
-- is the platform kill switch. access_products.commerce_enabled remains only as a
-- derived compatibility projection for older code paths.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS commerce_enabled BOOLEAN NOT NULL DEFAULT false;

-- Preserve an explicitly enabled legacy Commerce rollout at venue level.
UPDATE public.venues venue
SET commerce_enabled = true
WHERE venue.commerce_enabled = false
  AND EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.venue_id = venue.id
      AND product.commerce_enabled = true
  );

-- Align legacy compatibility fields with the operator-facing lifecycle without
-- enabling a venue. The venue kill switch remains unchanged by this backfill.
UPDATE public.access_products product
SET is_active = product.status = 'active',
    commerce_enabled = (
      product.status = 'active'
      AND product.commerce_kind IS NOT NULL
      AND product.fulfillment_type IS NOT NULL
      AND (
        product.commerce_kind = 'participation'
        OR product.standalone_enabled = true
        OR product.activity_addon_enabled = true
      )
    )
WHERE product.is_active IS DISTINCT FROM (product.status = 'active')
   OR product.commerce_enabled IS DISTINCT FROM (
      product.status = 'active'
      AND product.commerce_kind IS NOT NULL
      AND product.fulfillment_type IS NOT NULL
      AND (
        product.commerce_kind = 'participation'
        OR product.standalone_enabled = true
        OR product.activity_addon_enabled = true
      )
    );

COMMENT ON COLUMN public.venues.commerce_enabled IS
  'Platform-controlled Commerce kill switch for the venue. Ordinary product editing must not change it.';
COMMENT ON COLUMN public.access_products.commerce_enabled IS
  'Derived compatibility projection. Product sales truth is status plus sales modes plus venue Commerce availability.';

-- Manual SQL Editor reminder:
-- NOTIFY pgrst, 'reload schema';
