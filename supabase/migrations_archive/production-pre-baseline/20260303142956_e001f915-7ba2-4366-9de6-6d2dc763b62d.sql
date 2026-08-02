-- Event category config per venue (logo + whatsapp per category)
CREATE TABLE public.venue_event_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL, -- open_play, social, training, tournament
  display_name TEXT NOT NULL, -- "Pickla Open", "Fredagsklubben"
  logo_url TEXT,
  whatsapp_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id, category_key)
);

ALTER TABLE public.venue_event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read venue event categories"
ON public.venue_event_categories FOR SELECT
USING (true);

CREATE POLICY "Admin can manage venue event categories"
ON public.venue_event_categories FOR ALL
USING (is_super_admin() OR is_venue_admin(auth.uid(), venue_id))
WITH CHECK (is_super_admin() OR is_venue_admin(auth.uid(), venue_id));

CREATE TRIGGER update_venue_event_categories_updated_at
BEFORE UPDATE ON public.venue_event_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();