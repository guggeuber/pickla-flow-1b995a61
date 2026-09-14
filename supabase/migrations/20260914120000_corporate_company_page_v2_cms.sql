-- Employee-facing Corporate company pages V2.
-- Editorial content is deliberately separate from Corporate identity,
-- commercial orders, Series, Sessions and participation truth.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.corporate_public_page_content (
  corporate_account_id UUID PRIMARY KEY REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  hero_headline TEXT,
  short_intro TEXT,
  hero_image_path TEXT,
  gallery_image_paths TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  pickleball_heading TEXT,
  pickleball_body TEXT,
  pickla_heading TEXT,
  pickla_body TEXT,
  practical_information TEXT,
  help_contact_text TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corporate_public_page_hero_headline_length CHECK (hero_headline IS NULL OR char_length(hero_headline) <= 160),
  CONSTRAINT corporate_public_page_short_intro_length CHECK (short_intro IS NULL OR char_length(short_intro) <= 600),
  CONSTRAINT corporate_public_page_pickleball_heading_length CHECK (pickleball_heading IS NULL OR char_length(pickleball_heading) <= 160),
  CONSTRAINT corporate_public_page_pickleball_body_length CHECK (pickleball_body IS NULL OR char_length(pickleball_body) <= 1600),
  CONSTRAINT corporate_public_page_pickla_heading_length CHECK (pickla_heading IS NULL OR char_length(pickla_heading) <= 160),
  CONSTRAINT corporate_public_page_pickla_body_length CHECK (pickla_body IS NULL OR char_length(pickla_body) <= 1600),
  CONSTRAINT corporate_public_page_practical_length CHECK (practical_information IS NULL OR char_length(practical_information) <= 1600),
  CONSTRAINT corporate_public_page_help_length CHECK (help_contact_text IS NULL OR char_length(help_contact_text) <= 1200),
  CONSTRAINT corporate_public_page_gallery_limit CHECK (cardinality(gallery_image_paths) <= 6 AND array_position(gallery_image_paths, NULL) IS NULL)
);

ALTER TABLE public.corporate_public_page_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corporate_public_page_content FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.corporate_public_page_content TO service_role;

DROP TRIGGER IF EXISTS trg_corporate_public_page_content_updated_at ON public.corporate_public_page_content;
CREATE TRIGGER trg_corporate_public_page_content_updated_at
BEFORE UPDATE ON public.corporate_public_page_content
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.corporate_public_page_content IS
  'Structured editorial content only. Corporate, Series and Sessions remain the business and schedule source of truth.';
COMMENT ON COLUMN public.corporate_public_page_content.hero_image_path IS
  'Object path in the existing public event-logos bucket; never a user-provided arbitrary URL.';

-- Extend the existing event-logos authorization with one account-owned path.
-- Existing venue, event, template, Format and Series image paths are preserved.
CREATE OR REPLACE FUNCTION public.can_manage_event_logo_object(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_parts text[];
  v_part_count integer;
  v_venue_id uuid;
  v_resource_id uuid;
  v_organization_id uuid;
  v_is_canonical boolean := false;
BEGIN
  IF auth.uid() IS NULL OR p_name IS NULL OR p_name = '' OR p_name LIKE '/%'
     OR p_name LIKE '%//%' OR p_name LIKE '%..%' THEN RETURN false; END IF;

  v_parts := string_to_array(p_name, '/');
  v_part_count := cardinality(v_parts);

  IF v_part_count = 3 AND v_parts[1] = 'categories'
     AND lower(v_parts[3]) ~ '^[a-z0-9_-]+\.(png|jpe?g|webp|svg)$' THEN
    v_venue_id := v_parts[2]::uuid; v_is_canonical := true;
  ELSIF v_part_count = 3 AND v_parts[1] IN ('venue-home', 'group-booking')
     AND lower(v_parts[3]) ~ '^hero\.(png|jpe?g|webp|svg)$' THEN
    v_venue_id := v_parts[2]::uuid; v_is_canonical := true;
  ELSIF v_part_count = 2 AND lower(v_parts[2]) ~ '^logo\.(png|jpe?g|webp|svg)$' THEN
    v_resource_id := v_parts[1]::uuid;
    SELECT e.venue_id INTO v_venue_id FROM public.events e WHERE e.id = v_resource_id;
    v_is_canonical := v_venue_id IS NOT NULL;
  ELSIF v_part_count = 3 AND v_parts[1] = 'templates'
     AND lower(v_parts[3]) ~ '^logo\.(png|jpe?g|webp|svg)$' THEN
    v_resource_id := v_parts[2]::uuid;
    v_is_canonical := EXISTS (SELECT 1 FROM public.event_templates t WHERE t.id = v_resource_id);
    RETURN v_is_canonical AND public.is_super_admin();
  ELSIF v_part_count = 3 AND v_parts[1] = 'activity-formats'
     AND lower(v_parts[3]) ~ '^[1-3]\.(png|jpe?g|webp)$' THEN
    v_resource_id := v_parts[2]::uuid;
    SELECT f.organization_id INTO v_organization_id FROM public.activity_formats f WHERE f.id = v_resource_id;
    IF v_organization_id IS NULL THEN RETURN false; END IF;
    RETURN public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.organization_id = v_organization_id AND public.is_venue_admin(auth.uid(), v.id)
    );
  ELSIF v_part_count = 3 AND v_parts[1] = 'activity-series'
     AND lower(v_parts[3]) ~ '^[1-3]\.(png|jpe?g|webp)$' THEN
    v_resource_id := v_parts[2]::uuid;
    SELECT s.venue_id INTO v_venue_id FROM public.activity_series s WHERE s.id = v_resource_id;
    v_is_canonical := v_venue_id IS NOT NULL;
  ELSIF v_part_count = 3 AND v_parts[1] = 'corporate-accounts'
     AND lower(v_parts[3]) ~ '^(hero|gallery-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$' THEN
    v_resource_id := v_parts[2]::uuid;
    SELECT account.venue_id INTO v_venue_id
    FROM public.corporate_accounts account
    WHERE account.id = v_resource_id;
    v_is_canonical := v_venue_id IS NOT NULL;
  END IF;

  IF NOT v_is_canonical OR v_venue_id IS NULL THEN RETURN false; END IF;
  RETURN public.is_super_admin() OR public.is_venue_admin(auth.uid(), v_venue_id);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_logo_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_logo_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_logo_object(text) TO service_role;

COMMENT ON FUNCTION public.can_manage_event_logo_object(text) IS
  'Authorizes canonical venue/event/Format/Series assets plus account-owned Corporate page images in event-logos.';

-- The canonical venue already has the correct address model. Fill only the
-- missing postcode for the exact known Pickla Stockholm address.
UPDATE public.venues
SET postal_code = '171 41'
WHERE slug = 'pickla-arena-sthlm'
  AND address = 'Svetsarvägen 22'
  AND COALESCE(BTRIM(postal_code), '') = '';
