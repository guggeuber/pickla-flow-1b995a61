-- Canonical product media for Admin Commerce.
--
-- Product identity, pricing, variants, inventory and orders remain on their
-- existing canonical tables. This table owns only ordered presentation media.
-- access_products.image_url remains the backwards-compatible cover projection.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'product-media',
  'product-media',
  false,
  8388608,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/avif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.product_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'product-media',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_cover BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_media_bucket_check CHECK (storage_bucket IN ('product-media', 'legacy-external')),
  CONSTRAINT product_media_path_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT product_media_public_url_https CHECK (public_url ~ '^https://')
);

CREATE INDEX idx_product_media_active_product_order
  ON public.product_media(product_id, sort_order, id)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_product_media_active_cover
  ON public.product_media(product_id)
  WHERE status = 'active' AND is_cover = true;

CREATE OR REPLACE FUNCTION public.product_media_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.access_products p
    WHERE p.id = NEW.product_id
      AND p.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'product_media_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'archived' THEN
    NEW.is_cover := false;
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSE
    NEW.archived_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_media_validate_scope
BEFORE INSERT OR UPDATE ON public.product_media
FOR EACH ROW EXECUTE FUNCTION public.product_media_validate_scope();

-- Every existing single-image product becomes an ordered legacy media row.
-- No object is copied and the existing URL remains the exact cover projection.
INSERT INTO public.product_media (
  product_id,
  venue_id,
  storage_bucket,
  storage_path,
  public_url,
  alt_text,
  sort_order,
  is_cover,
  status
)
SELECT
  p.id,
  p.venue_id,
  'legacy-external',
  'legacy/' || p.id::text,
  p.image_url,
  p.name,
  0,
  true,
  'active'
FROM public.access_products p
WHERE p.image_url IS NOT NULL
  AND btrim(p.image_url) <> ''
ON CONFLICT (storage_bucket, storage_path) DO NOTHING;

CREATE OR REPLACE FUNCTION public.add_product_media(
  p_media_id UUID,
  p_venue_id UUID,
  p_product_id UUID,
  p_storage_path TEXT,
  p_public_url TEXT,
  p_alt_text TEXT,
  p_actor_id UUID
)
RETURNS public.product_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.access_products%ROWTYPE;
  v_media public.product_media%ROWTYPE;
  v_sort_order INTEGER;
  v_is_cover BOOLEAN;
BEGIN
  SELECT * INTO v_product
  FROM public.access_products
  WHERE id = p_product_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;

  IF p_storage_path !~ ('^' || p_venue_id::text || '/' || p_product_id::text || '/[0-9a-f-]+\.(png|jpe?g|webp|avif)$') THEN
    RAISE EXCEPTION 'invalid_product_media_path';
  END IF;
  IF p_public_url !~ '^https://' THEN RAISE EXCEPTION 'invalid_product_media_url'; END IF;

  SELECT COALESCE(max(sort_order), -1) + 1,
         NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = p_product_id AND status = 'active')
  INTO v_sort_order, v_is_cover
  FROM public.product_media
  WHERE product_id = p_product_id AND status = 'active';

  INSERT INTO public.product_media (
    id, product_id, venue_id, storage_bucket, storage_path, public_url,
    alt_text, sort_order, is_cover, status, created_by
  ) VALUES (
    p_media_id, p_product_id, p_venue_id, 'product-media', p_storage_path, p_public_url,
    NULLIF(btrim(p_alt_text), ''), v_sort_order, v_is_cover, 'active', p_actor_id
  ) RETURNING * INTO v_media;

  IF v_is_cover THEN
    UPDATE public.access_products SET image_url = v_media.public_url WHERE id = p_product_id;
  END IF;
  RETURN v_media;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_product_media(
  p_venue_id UUID,
  p_product_id UUID,
  p_media_ids UUID[],
  p_cover_id UUID
)
RETURNS SETOF public.product_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_count INTEGER;
  v_input_count INTEGER;
  v_cover_url TEXT;
BEGIN
  PERFORM 1 FROM public.access_products
  WHERE id = p_product_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;

  PERFORM 1 FROM public.product_media
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active'
  FOR UPDATE;

  SELECT count(*) INTO v_active_count
  FROM public.product_media
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active';
  SELECT count(DISTINCT id) INTO v_input_count FROM unnest(COALESCE(p_media_ids, '{}'::uuid[])) AS id;

  IF v_active_count = 0 OR v_input_count <> v_active_count THEN
    RAISE EXCEPTION 'product_media_order_mismatch';
  END IF;
  IF NOT p_cover_id = ANY(p_media_ids) THEN RAISE EXCEPTION 'product_media_cover_missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_media_ids) AS ids(id)
    LEFT JOIN public.product_media m ON m.id = ids.id
      AND m.product_id = p_product_id AND m.venue_id = p_venue_id AND m.status = 'active'
    WHERE m.id IS NULL
  ) THEN
    RAISE EXCEPTION 'product_media_scope_mismatch';
  END IF;

  -- Clear the partial unique cover before assigning the new cover.
  UPDATE public.product_media SET is_cover = false
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active' AND is_cover = true;

  UPDATE public.product_media m
  SET sort_order = ordered.ordinality - 1,
      is_cover = m.id = p_cover_id
  FROM unnest(p_media_ids) WITH ORDINALITY AS ordered(id, ordinality)
  WHERE m.id = ordered.id
    AND m.product_id = p_product_id
    AND m.venue_id = p_venue_id
    AND m.status = 'active';

  SELECT public_url INTO v_cover_url FROM public.product_media WHERE id = p_cover_id;
  UPDATE public.access_products SET image_url = v_cover_url WHERE id = p_product_id;

  RETURN QUERY SELECT * FROM public.product_media
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active'
  ORDER BY sort_order, id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_product_media(
  p_venue_id UUID,
  p_product_id UUID,
  p_media_id UUID
)
RETURNS SETOF public.product_media
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_cover_id UUID;
  v_next_cover_url TEXT;
BEGIN
  PERFORM 1 FROM public.access_products
  WHERE id = p_product_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;

  PERFORM 1 FROM public.product_media
  WHERE id = p_media_id AND product_id = p_product_id AND venue_id = p_venue_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_media_not_found'; END IF;

  UPDATE public.product_media
  SET status = 'archived', is_cover = false, archived_at = now()
  WHERE id = p_media_id;

  SELECT id, public_url INTO v_next_cover_id, v_next_cover_url
  FROM public.product_media
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active'
  ORDER BY is_cover DESC, sort_order, id
  LIMIT 1;

  UPDATE public.product_media SET is_cover = (id = v_next_cover_id)
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active';
  UPDATE public.access_products SET image_url = v_next_cover_url WHERE id = p_product_id;

  RETURN QUERY SELECT * FROM public.product_media
  WHERE product_id = p_product_id AND venue_id = p_venue_id AND status = 'active'
  ORDER BY sort_order, id;
END;
$$;

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.product_media FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_media TO anon, authenticated;

CREATE POLICY "Published product media is publicly readable"
ON public.product_media
FOR SELECT
TO anon, authenticated
USING (
  status = 'active'
  AND EXISTS (
    SELECT 1 FROM public.access_products p
    WHERE p.id = product_media.product_id
      AND p.venue_id = product_media.venue_id
      AND p.status = 'active'
      AND p.is_active = true
  )
);

CREATE POLICY "Venue admins can read product media drafts"
ON public.product_media
FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_venue_admin(auth.uid(), venue_id)
);

-- Product objects are private and are uploaded only through the authenticated
-- api-admin service boundary. Published objects are streamed through the
-- api-commerce product-media read boundary after product publication checks.
-- Public/authenticated clients intentionally receive no storage.objects policy.
DROP POLICY IF EXISTS "Public can list product media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload product media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update product media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete product media" ON storage.objects;

REVOKE ALL ON FUNCTION public.add_product_media(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reorder_product_media(UUID, UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_product_media(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_media(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_product_media(UUID, UUID, UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_product_media(UUID, UUID, UUID) TO service_role;

COMMENT ON TABLE public.product_media IS
  'Ordered canonical presentation media for access_products; commercial and inventory truth remains on existing Commerce tables.';
COMMENT ON COLUMN public.product_media.storage_path IS
  'Stable immutable object identity. Archived relationships retain their object for audit/history safety.';
COMMENT ON COLUMN public.access_products.image_url IS
  'Backwards-compatible cover projection maintained from the active product_media cover; legacy single-image URLs are backfilled.';
