-- Storefront V1 presentation only.
--
-- Commercial truth remains in access_products, product_variants,
-- membership_tier_pricing, inventory_levels, Commerce orders and receipts.
-- This migration adds the minimum localized editorial/routing projection and
-- lets canonical product media belong to one canonical option value (normally
-- a colour). Existing unscoped media and access_products.image_url continue to
-- work unchanged.

CREATE TABLE public.commerce_product_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.access_products(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  locale TEXT NOT NULL DEFAULT 'sv-SE',
  slug TEXT NOT NULL,
  short_description TEXT,
  long_description TEXT,
  material TEXT,
  fit TEXT,
  care TEXT,
  returns_policy TEXT,
  size_guide JSONB NOT NULL DEFAULT '{"body":"","rows":[]}'::jsonb,
  seo_title TEXT,
  seo_description TEXT,
  publication_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_state IN ('draft', 'published', 'archived')),
  low_stock_threshold INTEGER NOT NULL DEFAULT 3
    CHECK (low_stock_threshold BETWEEN 0 AND 100),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commerce_product_presentations_product_locale_unique
    UNIQUE (product_id, locale),
  CONSTRAINT commerce_product_presentations_locale_check
    CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  CONSTRAINT commerce_product_presentations_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 120),
  CONSTRAINT commerce_product_presentations_size_guide_check
    CHECK (jsonb_typeof(size_guide) = 'object')
);

CREATE UNIQUE INDEX uq_commerce_product_presentations_locale_slug
  ON public.commerce_product_presentations(locale, lower(slug));

CREATE INDEX idx_commerce_product_presentations_published_product
  ON public.commerce_product_presentations(product_id, locale)
  WHERE publication_state = 'published';

CREATE OR REPLACE FUNCTION public.commerce_product_presentation_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.id = NEW.product_id
      AND product.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'commerce_product_presentation_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  NEW.slug := lower(btrim(NEW.slug));
  NEW.short_description := NULLIF(btrim(NEW.short_description), '');
  NEW.long_description := NULLIF(btrim(NEW.long_description), '');
  NEW.material := NULLIF(btrim(NEW.material), '');
  NEW.fit := NULLIF(btrim(NEW.fit), '');
  NEW.care := NULLIF(btrim(NEW.care), '');
  NEW.returns_policy := NULLIF(btrim(NEW.returns_policy), '');
  NEW.seo_title := NULLIF(btrim(NEW.seo_title), '');
  NEW.seo_description := NULLIF(btrim(NEW.seo_description), '');
  NEW.updated_at := now();

  IF NEW.publication_state = 'published' THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
  ELSE
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_commerce_product_presentation_validate_scope
BEFORE INSERT OR UPDATE ON public.commerce_product_presentations
FOR EACH ROW EXECUTE FUNCTION public.commerce_product_presentation_validate_scope();

ALTER TABLE public.product_media
  ADD COLUMN option_value_id UUID REFERENCES public.product_option_values(id) ON DELETE RESTRICT;

ALTER TABLE public.commerce_events
  ADD COLUMN product_id UUID REFERENCES public.access_products(id) ON DELETE SET NULL;

ALTER TABLE public.commerce_events
  DROP CONSTRAINT IF EXISTS commerce_events_event_name_check;
ALTER TABLE public.commerce_events
  ADD CONSTRAINT commerce_events_event_name_check CHECK (event_name IN (
    'activity_sheet_opened',
    'logged_out_cta_clicked',
    'product_view',
    'variant_selected',
    'add_to_cart',
    'checkout_started',
    'guest_purchase_succeeded',
    'checkout_abandoned',
    'claim_completed',
    'account_activated'
  ));

CREATE INDEX idx_commerce_events_product
  ON public.commerce_events(product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX idx_product_media_active_option_value
  ON public.product_media(product_id, option_value_id, sort_order, id)
  WHERE status = 'active' AND option_value_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.product_media_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.id = NEW.product_id
      AND product.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'product_media_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.option_value_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.product_option_values option_value
    JOIN public.product_options product_option ON product_option.id = option_value.option_id
    WHERE option_value.id = NEW.option_value_id
      AND option_value.status = 'active'
      AND product_option.product_id = NEW.product_id
      AND product_option.status = 'active'
  ) THEN
    RAISE EXCEPTION 'product_media_option_value_scope_mismatch' USING ERRCODE = '23514';
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

ALTER TABLE public.commerce_product_presentations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.commerce_product_presentations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_product_presentations TO anon, authenticated;
GRANT ALL ON TABLE public.commerce_product_presentations TO service_role;

CREATE POLICY "Published storefront presentation is publicly readable"
ON public.commerce_product_presentations
FOR SELECT
TO anon, authenticated
USING (
  publication_state = 'published'
  AND EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.id = commerce_product_presentations.product_id
      AND product.venue_id = commerce_product_presentations.venue_id
      AND product.status = 'active'
      AND product.is_active = true
  )
);

-- product_media RLS cannot inspect hidden draft presentation rows as anon;
-- otherwise a draft would look indistinguishable from a legacy product with no
-- presentation. This narrowly scoped definer returns only the publication
-- decision and exposes no presentation data.
CREATE OR REPLACE FUNCTION public.storefront_product_media_is_public(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.commerce_product_presentations presentation
      WHERE presentation.product_id = p_product_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.commerce_product_presentations presentation
      WHERE presentation.product_id = p_product_id
        AND presentation.publication_state = 'published'
    );
$$;

REVOKE ALL ON FUNCTION public.storefront_product_media_is_public(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_product_media_is_public(UUID) TO anon, authenticated, service_role;

-- Enhanced product drafts must not leak media through the legacy active-product
-- rule. Products without a Storefront presentation retain the old behaviour.
DROP POLICY IF EXISTS "Published product media is publicly readable" ON public.product_media;
CREATE POLICY "Published product media is publicly readable"
ON public.product_media
FOR SELECT
TO anon, authenticated
USING (
  status = 'active'
  AND EXISTS (
    SELECT 1
    FROM public.access_products product
    WHERE product.id = product_media.product_id
      AND product.venue_id = product_media.venue_id
      AND product.status = 'active'
      AND product.is_active = true
  )
  AND public.storefront_product_media_is_public(product_media.product_id)
);

COMMENT ON TABLE public.commerce_product_presentations IS
  'Localized Storefront editorial and routing presentation. Never authoritative for price, VAT, SKU, inventory, cart or checkout.';
COMMENT ON COLUMN public.product_media.option_value_id IS
  'Optional canonical option value scope, normally colour. NULL keeps existing all-product media behaviour.';
