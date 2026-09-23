\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug, legal_name, org_number)
VALUES ('c2d00000-0000-4000-8000-000000000001', 'Storefront V1 Test', 'storefront-v1-test', 'Storefront V1 Test AB', '559999-3000');

INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES
  ('c2d00000-0000-4000-8000-000000000002', 'c2d00000-0000-4000-8000-000000000001', 'Storefront Venue', 'storefront-venue', true),
  ('c2d00000-0000-4000-8000-000000000003', 'c2d00000-0000-4000-8000-000000000001', 'Other Venue', 'storefront-other', true);

INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek, vat_rate,
  commerce_kind, fulfillment_type, fulfillment_presentation, status,
  commerce_enabled, standalone_enabled, activity_addon_enabled, inventory_policy,
  catalog_owner_organization_id
) VALUES
  ('c2d00000-0000-4000-8000-000000000010', 'c2d00000-0000-4000-8000-000000000002',
   'storefront_tee', 'Pickla Classic Tee TEST', 'merchandise', 299, 25,
   'merchandise', 'desk_pickup', 'desk_pickup', 'active', true, true, false, 'tracked',
   'c2d00000-0000-4000-8000-000000000001'),
  ('c2d00000-0000-4000-8000-000000000011', 'c2d00000-0000-4000-8000-000000000002',
   'storefront_cap', 'Pickla Cap TEST', 'merchandise', 249, 25,
   'merchandise', 'desk_pickup', 'desk_pickup', 'active', true, true, false, 'tracked',
   'c2d00000-0000-4000-8000-000000000001');

INSERT INTO public.product_options (id, product_id, code, label, sort_order) VALUES
  ('c2d00000-0000-4000-8000-000000000020', 'c2d00000-0000-4000-8000-000000000010', 'color', 'Färg', 10),
  ('c2d00000-0000-4000-8000-000000000021', 'c2d00000-0000-4000-8000-000000000011', 'color', 'Färg', 10);
INSERT INTO public.product_option_values (id, option_id, code, label, swatch, sort_order) VALUES
  ('c2d00000-0000-4000-8000-000000000022', 'c2d00000-0000-4000-8000-000000000020', 'black', 'Black', '#111111', 10),
  ('c2d00000-0000-4000-8000-000000000023', 'c2d00000-0000-4000-8000-000000000021', 'blue', 'Blue', '#0000ff', 10);

SELECT public.add_product_media(
  'c2d00000-0000-4000-8000-000000000030',
  'c2d00000-0000-4000-8000-000000000002',
  'c2d00000-0000-4000-8000-000000000010',
  'c2d00000-0000-4000-8000-000000000002/c2d00000-0000-4000-8000-000000000010/c2d00000-0000-4000-8000-000000000030.webp',
  'https://example.supabase.co/functions/v1/api-commerce/product-media?id=c2d00000-0000-4000-8000-000000000030',
  'Black tee front',
  NULL
);
UPDATE public.product_media
SET option_value_id = 'c2d00000-0000-4000-8000-000000000022'
WHERE id = 'c2d00000-0000-4000-8000-000000000030';

INSERT INTO public.commerce_product_presentations (
  id, product_id, venue_id, locale, slug, short_description, long_description,
  material, fit, care, publication_state, low_stock_threshold
) VALUES (
  'c2d00000-0000-4000-8000-000000000040',
  'c2d00000-0000-4000-8000-000000000010',
  'c2d00000-0000-4000-8000-000000000002',
  'sv-SE', 'Pickla-Classic-Tee', ' Test short copy ', ' Test long copy ',
  ' Cotton ', ' Regular ', ' 30 C ', 'draft', 2
);

DO $$
BEGIN
  IF (SELECT slug FROM public.commerce_product_presentations WHERE id = 'c2d00000-0000-4000-8000-000000000040') <> 'pickla-classic-tee' THEN
    RAISE EXCEPTION 'presentation slug was not normalized';
  END IF;
  IF (SELECT short_description FROM public.commerce_product_presentations WHERE id = 'c2d00000-0000-4000-8000-000000000040') <> 'Test short copy' THEN
    RAISE EXCEPTION 'presentation text was not normalized';
  END IF;
  IF (SELECT option_value_id FROM public.product_media WHERE id = 'c2d00000-0000-4000-8000-000000000030') <> 'c2d00000-0000-4000-8000-000000000022' THEN
    RAISE EXCEPTION 'color media association was not persisted';
  END IF;

  BEGIN
    UPDATE public.product_media
    SET option_value_id = 'c2d00000-0000-4000-8000-000000000023'
    WHERE id = 'c2d00000-0000-4000-8000-000000000030';
    RAISE EXCEPTION 'cross-product option value was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%product_media_option_value_scope_mismatch%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.commerce_product_presentations (
      product_id, venue_id, locale, slug, publication_state
    ) VALUES (
      'c2d00000-0000-4000-8000-000000000011',
      'c2d00000-0000-4000-8000-000000000003',
      'sv-SE', 'wrong-venue-cap', 'draft'
    );
    RAISE EXCEPTION 'cross-venue presentation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%commerce_product_presentation_scope_mismatch%' THEN RAISE; END IF;
  END;

  IF has_table_privilege('anon', 'public.commerce_product_presentations', 'insert')
     OR has_table_privilege('authenticated', 'public.commerce_product_presentations', 'update')
     OR has_table_privilege('anon', 'public.product_media', 'update') THEN
    RAISE EXCEPTION 'browser roles received storefront mutation privileges';
  END IF;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.commerce_product_presentations
    WHERE product_id = 'c2d00000-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION 'draft presentation leaked to public';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_media
    WHERE product_id = 'c2d00000-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION 'media for enhanced draft product leaked to public';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.commerce_product_presentations
SET publication_state = 'published'
WHERE id = 'c2d00000-0000-4000-8000-000000000040';

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.commerce_product_presentations WHERE product_id = 'c2d00000-0000-4000-8000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'published presentation is not publicly readable';
  END IF;
  IF (SELECT count(*) FROM public.product_media WHERE product_id = 'c2d00000-0000-4000-8000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'published enhanced product media is not publicly readable';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.commerce_product_presentations
SET publication_state = 'archived'
WHERE id = 'c2d00000-0000-4000-8000-000000000040';

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.commerce_product_presentations WHERE product_id = 'c2d00000-0000-4000-8000-000000000010')
     OR EXISTS (SELECT 1 FROM public.product_media WHERE product_id = 'c2d00000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'archived enhanced product presentation/media remained public';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;
