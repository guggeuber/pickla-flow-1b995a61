\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, slug, legal_name, org_number)
VALUES ('c2b00000-0000-4000-8000-000000000001', 'Product Media Test', 'product-media-test', 'Product Media Test AB', '559999-1000');
INSERT INTO public.venues (id, organization_id, name, slug, commerce_enabled)
VALUES ('c2b00000-0000-4000-8000-000000000002', 'c2b00000-0000-4000-8000-000000000001', 'Product Media Venue', 'product-media-venue', true);
INSERT INTO public.access_products (
  id, venue_id, product_key, name, product_kind, base_price_sek, vat_rate,
  commerce_kind, fulfillment_type, fulfillment_presentation, status,
  standalone_enabled, activity_addon_enabled, inventory_policy
) VALUES (
  'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002',
  'product_media_test', 'Pickla Classic Tee TEST', 'merchandise', 299, 25,
  'merchandise', 'desk_pickup', 'desk_pickup', 'active', true, false, 'stockless'
);

SELECT public.add_product_media(
  'c2b00000-0000-4000-8000-000000000010',
  'c2b00000-0000-4000-8000-000000000002',
  'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002/c2b00000-0000-4000-8000-000000000003/c2b00000-0000-4000-8000-000000000010.webp',
  'https://example.supabase.co/functions/v1/api-commerce/product-media?id=c2b00000-0000-4000-8000-000000000010',
  'Tee front',
  NULL
);
SELECT public.add_product_media(
  'c2b00000-0000-4000-8000-000000000011',
  'c2b00000-0000-4000-8000-000000000002',
  'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002/c2b00000-0000-4000-8000-000000000003/c2b00000-0000-4000-8000-000000000011.webp',
  'https://example.supabase.co/functions/v1/api-commerce/product-media?id=c2b00000-0000-4000-8000-000000000011',
  'Tee back',
  NULL
);
SELECT public.add_product_media(
  'c2b00000-0000-4000-8000-000000000012',
  'c2b00000-0000-4000-8000-000000000002',
  'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000002/c2b00000-0000-4000-8000-000000000003/c2b00000-0000-4000-8000-000000000012.webp',
  'https://example.supabase.co/functions/v1/api-commerce/product-media?id=c2b00000-0000-4000-8000-000000000012',
  'Tee detail',
  NULL
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003' AND status = 'active') <> 3 THEN
    RAISE EXCEPTION 'expected three active product media rows';
  END IF;
  IF (SELECT count(*) FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003' AND is_cover) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one cover';
  END IF;
  IF (SELECT image_url FROM public.access_products WHERE id = 'c2b00000-0000-4000-8000-000000000003') NOT LIKE '%000000000010' THEN
    RAISE EXCEPTION 'first image did not become cover projection';
  END IF;
END;
$$;

SELECT * FROM public.reorder_product_media(
  'c2b00000-0000-4000-8000-000000000002',
  'c2b00000-0000-4000-8000-000000000003',
  ARRAY[
    'c2b00000-0000-4000-8000-000000000012',
    'c2b00000-0000-4000-8000-000000000010',
    'c2b00000-0000-4000-8000-000000000011'
  ]::uuid[],
  'c2b00000-0000-4000-8000-000000000011'
);

DO $$
BEGIN
  IF (SELECT id FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003' AND status = 'active' ORDER BY sort_order LIMIT 1) <> 'c2b00000-0000-4000-8000-000000000012' THEN
    RAISE EXCEPTION 'media order was not persisted';
  END IF;
  IF (SELECT image_url FROM public.access_products WHERE id = 'c2b00000-0000-4000-8000-000000000003') NOT LIKE '%000000000011' THEN
    RAISE EXCEPTION 'chosen cover did not update compatibility projection';
  END IF;
END;
$$;

SELECT * FROM public.archive_product_media(
  'c2b00000-0000-4000-8000-000000000002',
  'c2b00000-0000-4000-8000-000000000003',
  'c2b00000-0000-4000-8000-000000000011'
);

DO $$
BEGIN
  IF (SELECT status FROM public.product_media WHERE id = 'c2b00000-0000-4000-8000-000000000011') <> 'archived' THEN
    RAISE EXCEPTION 'remove must archive the relationship';
  END IF;
  IF (SELECT count(*) FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003' AND status = 'active' AND is_cover) <> 1 THEN
    RAISE EXCEPTION 'archive must elect exactly one next cover';
  END IF;
  IF has_table_privilege('anon', 'public.product_media', 'insert')
     OR has_table_privilege('authenticated', 'public.product_media', 'update')
     OR has_function_privilege('authenticated', 'public.add_product_media(uuid,uuid,uuid,text,text,text,uuid)', 'execute') THEN
    RAISE EXCEPTION 'browser roles received a product media mutation capability';
  END IF;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'anonymous published read did not expose active media only';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.access_products SET status = 'draft' WHERE id = 'c2b00000-0000-4000-8000-000000000003';
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_media WHERE product_id = 'c2b00000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'anonymous draft media read must fail closed';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;
