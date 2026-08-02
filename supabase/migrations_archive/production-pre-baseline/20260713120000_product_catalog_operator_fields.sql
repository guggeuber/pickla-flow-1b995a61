-- Product Catalog operator model.
-- Additive presentation and availability fields over the existing Product Engine.
-- Existing internal classifications, order lines, receipts and relationships remain intact.

ALTER TABLE public.access_products
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS standalone_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activity_addon_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fulfillment_presentation TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS sport TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_status_check;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_status_check
  CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE public.access_products
  DROP CONSTRAINT IF EXISTS access_products_fulfillment_presentation_check;
ALTER TABLE public.access_products
  ADD CONSTRAINT access_products_fulfillment_presentation_check
  CHECK (
    fulfillment_presentation IS NULL
    OR fulfillment_presentation IN ('desk_pickup', 'digital', 'participation')
  );

-- Preserve legacy activity/access behavior. Products already active stay active in
-- the operator catalog, while inactive products remain unavailable and historical.
UPDATE public.access_products
SET status = COALESCE(status, CASE WHEN is_active THEN 'active' ELSE 'archived' END),
    fulfillment_presentation = COALESCE(
      fulfillment_presentation,
      CASE fulfillment_type
        WHEN 'desk_pickup' THEN 'desk_pickup'
        WHEN 'participation' THEN 'participation'
        ELSE NULL
      END
    )
WHERE status IS NULL
   OR fulfillment_presentation IS NULL;

ALTER TABLE public.access_products
  ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.access_products
  ALTER COLUMN status SET NOT NULL;

-- Match the storefront behavior that existed before this migration. This never
-- enables Commerce for a product whose rollout flag is currently false.
UPDATE public.access_products
SET standalone_enabled = true
WHERE commerce_enabled = true
  AND commerce_kind = 'merchandise'
  AND standalone_enabled = false;

-- Existing explicit relationships are the only safe source for activity add-ons.
UPDATE public.access_products product
SET activity_addon_enabled = true
WHERE product.commerce_enabled = true
  AND product.commerce_kind IN ('rental', 'merchandise')
  AND product.activity_addon_enabled = false
  AND EXISTS (
    SELECT 1
    FROM public.product_relationships relationship
    WHERE relationship.venue_id = product.venue_id
      AND relationship.target_product_id = product.id
      AND relationship.relationship_type = 'offered_with'
      AND relationship.is_active = true
  );

CREATE INDEX IF NOT EXISTS idx_access_products_catalog
  ON public.access_products (venue_id, status, standalone_enabled, activity_addon_enabled, sort_order);

COMMENT ON COLUMN public.access_products.status IS
  'Operator-facing lifecycle: draft, active or archived.';
COMMENT ON COLUMN public.access_products.standalone_enabled IS
  'Business intent: product may be purchased without a participation parent.';
COMMENT ON COLUMN public.access_products.activity_addon_enabled IS
  'Business intent: product may be added to explicitly related participation products.';
COMMENT ON COLUMN public.access_products.fulfillment_presentation IS
  'Operator/customer wording for delivery; internal fulfillment_type remains checkout compatibility truth.';

-- Manual SQL Editor reminder: NOTIFY pgrst, 'reload schema';
