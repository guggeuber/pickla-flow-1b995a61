-- Navigation, discovery and named-event identity remain attributes of the
-- canonical Format -> Series -> Session model. No campaign or media domain is
-- introduced here.

ALTER TABLE public.activity_formats
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.activity_series
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.activity_sessions
  ADD COLUMN IF NOT EXISTS first_visit_offer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_visit_price_minor integer,
  ADD COLUMN IF NOT EXISTS first_visit_only boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.valid_named_event_image_urls(p_urls text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp AS $$
  SELECT cardinality(COALESCE(p_urls, '{}'::text[])) <= 3
     AND array_position(COALESCE(p_urls, '{}'::text[]), NULL) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(p_urls, '{}'::text[])) AS image_url
       WHERE image_url !~ '^https://'
     );
$$;

ALTER TABLE public.activity_formats
  DROP CONSTRAINT IF EXISTS activity_formats_image_urls_check,
  ADD CONSTRAINT activity_formats_image_urls_check CHECK (public.valid_named_event_image_urls(image_urls));

ALTER TABLE public.activity_series
  DROP CONSTRAINT IF EXISTS activity_series_image_urls_check,
  ADD CONSTRAINT activity_series_image_urls_check CHECK (public.valid_named_event_image_urls(image_urls));

ALTER TABLE public.activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_first_visit_offer_check,
  ADD CONSTRAINT activity_sessions_first_visit_offer_check CHECK (
    (first_visit_offer_enabled = false AND first_visit_price_minor IS NULL)
    OR (first_visit_offer_enabled = true AND first_visit_only = true AND first_visit_price_minor = 9900)
  );

CREATE INDEX IF NOT EXISTS idx_activity_sessions_first_visit_offer
  ON public.activity_sessions (venue_id, publish_status, is_active)
  WHERE first_visit_offer_enabled = true;

COMMENT ON COLUMN public.activity_formats.image_urls IS
  'Up to three operator-owned images for a reusable named Format. Sessions inherit through Series.';
COMMENT ON COLUMN public.activity_series.image_urls IS
  'Optional named-Series image override. Sessions inherit Series images before Format images.';
COMMENT ON COLUMN public.activity_sessions.first_visit_offer_enabled IS
  'Operator-controlled per-session first-visit offer. It has no campaign period and remains active until removed.';
COMMENT ON COLUMN public.activity_sessions.first_visit_price_minor IS
  'First-visit participation price in minor currency units. V1 is fixed at 9900 (99 SEK).';
COMMENT ON COLUMN public.activity_sessions.first_visit_only IS
  'V1 is always limited to customers without a prior paid participation.';

-- Extend the existing event-logos Storage authorization rather than creating
-- a parallel bucket or image engine.
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
  'Authorizes canonical venue event assets plus Format/Series images in the existing event-logos bucket.';
