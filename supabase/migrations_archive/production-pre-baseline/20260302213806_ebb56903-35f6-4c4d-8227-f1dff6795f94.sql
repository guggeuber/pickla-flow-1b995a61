
CREATE TABLE public.venue_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  url text NOT NULL,
  icon text DEFAULT 'link',
  color text DEFAULT 'primary',
  member_count text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.venue_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active venue links"
  ON public.venue_links FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admin can manage venue links"
  ON public.venue_links FOR ALL
  USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
  WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE TRIGGER update_venue_links_updated_at
  BEFORE UPDATE ON public.venue_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
