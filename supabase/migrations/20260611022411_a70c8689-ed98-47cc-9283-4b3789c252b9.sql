
CREATE TABLE IF NOT EXISTS public.event_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('package','resource')),
  name text NOT NULL,
  slug text,
  short_description text,
  long_description text,
  category text,
  price_from_sek numeric,
  price_sek numeric,
  price_unit text,
  min_people integer,
  max_people integer,
  duration_minutes integer,
  included_items jsonb DEFAULT '[]'::jsonb,
  recommended_for jsonb DEFAULT '[]'::jsonb,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  included_by_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_products_venue_type ON public.event_products(venue_id, type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_products_venue_slug ON public.event_products(venue_id, slug) WHERE slug IS NOT NULL;

GRANT SELECT ON public.event_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_products TO authenticated;
GRANT ALL ON public.event_products TO service_role;

ALTER TABLE public.event_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active event products"
ON public.event_products FOR SELECT
USING (is_active = true);

CREATE POLICY "Venue admins manage event products"
ON public.event_products FOR ALL
TO authenticated
USING (
  public.is_super_admin()
  OR (venue_id IS NOT NULL AND public.is_venue_admin(auth.uid(), venue_id))
)
WITH CHECK (
  public.is_super_admin()
  OR (venue_id IS NOT NULL AND public.is_venue_admin(auth.uid(), venue_id))
);

CREATE TRIGGER trg_event_products_updated_at
BEFORE UPDATE ON public.event_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
