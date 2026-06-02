-- Event offer catalog and real resource planning for Event Agent OS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.event_offer_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  default_price_per_person INTEGER NOT NULL DEFAULT 0,
  min_price_per_person INTEGER,
  max_price_per_person INTEGER,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, template_key)
);

CREATE TABLE IF NOT EXISTS public.event_offer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.event_offer_templates(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'service',
  title TEXT NOT NULL,
  description TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  included_by_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_resource_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE CASCADE,
  venue_staff_id UUID REFERENCES public.venue_staff(id) ON DELETE SET NULL,
  capacity INTEGER,
  unit TEXT,
  default_unit_price INTEGER NOT NULL DEFAULT 0,
  is_bookable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, resource_type, name)
);

CREATE TABLE IF NOT EXISTS public.event_resource_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  resource_catalog_id UUID REFERENCES public.event_resource_catalog(id) ON DELETE SET NULL,
  venue_court_id UUID REFERENCES public.venue_courts(id) ON DELETE SET NULL,
  venue_staff_id UUID REFERENCES public.venue_staff(id) ON DELETE SET NULL,
  resource_type TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'proposed',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_offer_templates_venue ON public.event_offer_templates(venue_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_offer_items_venue ON public.event_offer_items(venue_id, item_type, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_offer_items_template ON public.event_offer_items(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_resource_catalog_venue ON public.event_resource_catalog(venue_id, resource_type, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_resource_allocations_event ON public.event_resource_allocations(event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_resource_allocations_court ON public.event_resource_allocations(venue_court_id, start_at, end_at) WHERE venue_court_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_resource_allocations_staff ON public.event_resource_allocations(venue_staff_id, start_at, end_at) WHERE venue_staff_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_event_offer_templates_updated_at ON public.event_offer_templates;
CREATE TRIGGER trg_event_offer_templates_updated_at
BEFORE UPDATE ON public.event_offer_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_offer_items_updated_at ON public.event_offer_items;
CREATE TRIGGER trg_event_offer_items_updated_at
BEFORE UPDATE ON public.event_offer_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_resource_catalog_updated_at ON public.event_resource_catalog;
CREATE TRIGGER trg_event_resource_catalog_updated_at
BEFORE UPDATE ON public.event_resource_catalog
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_resource_allocations_updated_at ON public.event_resource_allocations;
CREATE TRIGGER trg_event_resource_allocations_updated_at
BEFORE UPDATE ON public.event_resource_allocations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.event_offer_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_offer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_resource_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_resource_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_offer_templates_staff_read" ON public.event_offer_templates;
CREATE POLICY "event_offer_templates_staff_read" ON public.event_offer_templates
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.venue_staff vs WHERE vs.venue_id = event_offer_templates.venue_id AND vs.user_id = auth.uid() AND vs.is_active = true)
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin')
);

DROP POLICY IF EXISTS "event_offer_items_staff_read" ON public.event_offer_items;
CREATE POLICY "event_offer_items_staff_read" ON public.event_offer_items
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.venue_staff vs WHERE vs.venue_id = event_offer_items.venue_id AND vs.user_id = auth.uid() AND vs.is_active = true)
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin')
);

DROP POLICY IF EXISTS "event_resource_catalog_staff_read" ON public.event_resource_catalog;
CREATE POLICY "event_resource_catalog_staff_read" ON public.event_resource_catalog
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.venue_staff vs WHERE vs.venue_id = event_resource_catalog.venue_id AND vs.user_id = auth.uid() AND vs.is_active = true)
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin')
);

DROP POLICY IF EXISTS "event_resource_allocations_staff_read" ON public.event_resource_allocations;
CREATE POLICY "event_resource_allocations_staff_read" ON public.event_resource_allocations
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.venue_staff vs WHERE vs.venue_id = event_resource_allocations.venue_id AND vs.user_id = auth.uid() AND vs.is_active = true)
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin')
);

DO $$
DECLARE
  v RECORD;
  t_standard UUID;
  t_aw UUID;
  t_conference UUID;
  t_league UUID;
BEGIN
  FOR v IN SELECT id FROM public.venues LOOP
    INSERT INTO public.event_offer_templates (venue_id, template_key, title, subtitle, description, default_price_per_person, min_price_per_person, max_price_per_person, sort_order, payload)
    VALUES
      (v.id, 'standard', 'Företagsevent Standard', '75 min aktivitet med coach och lagspel', 'Tryggt första eventpaket för företag och mindre grupper.', 295, 295, 395, 10, '{"agenda":["Välkomstintro","Regler och lagindelning","Coachad aktivitet","Final och prisutdelning"],"included":["75 min aktivitet","Coach","Bana","Rack och bollar","Lagtävling","Score och upplägg"]}'::jsonb),
      (v.id, 'aw_social', 'AW Social Games', 'Pickleball + dart + pizza + dryck', 'Socialt AW-upplägg med spel, mat, dryck och häng.', 595, 495, 695, 20, '{"agenda":["Ankomst och dryck","Pickleball intro","Dart challenge","Pizza/AW","Finalmoment"],"included":["Pickleball","Dart","Pizza","Dryck","Social turnering","Värdskap"]}'::jsonb),
      (v.id, 'conference', 'Konferens + aktivitet', 'Möte, lunch och social sport', 'Heldags- eller halvdagsupplägg med möte, mat och aktivitet.', 845, 695, 995, 30, '{"agenda":["Morgonmöte","Lunch","Aktivitetsblock","Samling och nästa steg"],"included":["Mötesyta","Lunch","Pickleball eller dart","Coach/värd","Utrustning","Enkelt körschema"]}'::jsonb),
      (v.id, 'league', 'Företagsliga', 'Återkommande liga under 6 veckor', 'Återkommande företagsliga med tabell, final och kommunikation.', 0, NULL, NULL, 40, '{"agenda":["Kickoff","Veckomatcher","Tabelluppdatering","Final och AW"],"included":["6 veckor","Spelschema","Tabell","Finalkväll","Kommunikation","Pris till vinnare"]}'::jsonb)
    ON CONFLICT (venue_id, template_key) DO UPDATE
      SET title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          description = EXCLUDED.description,
          default_price_per_person = EXCLUDED.default_price_per_person,
          min_price_per_person = EXCLUDED.min_price_per_person,
          max_price_per_person = EXCLUDED.max_price_per_person,
          sort_order = EXCLUDED.sort_order,
          payload = EXCLUDED.payload,
          is_active = true;

    SELECT id INTO t_standard FROM public.event_offer_templates WHERE venue_id = v.id AND template_key = 'standard';
    SELECT id INTO t_aw FROM public.event_offer_templates WHERE venue_id = v.id AND template_key = 'aw_social';
    SELECT id INTO t_conference FROM public.event_offer_templates WHERE venue_id = v.id AND template_key = 'conference';
    SELECT id INTO t_league FROM public.event_offer_templates WHERE venue_id = v.id AND template_key = 'league';

    INSERT INTO public.event_offer_items (venue_id, template_id, item_type, title, description, unit_price, unit, included_by_default, sort_order)
    VALUES
      (v.id, t_standard, 'activity', 'Pickleball med coach', 'Coachad introduktion, lagspel och finalmoment.', 0, 'event', true, 10),
      (v.id, t_aw, 'activity', 'Dart challenge', 'Social dartdel som fungerar bra för grupper.', 0, 'event', true, 20),
      (v.id, t_aw, 'food_drink', 'Pizza + dryck', 'Enkel AW-servering med pizza och dryck.', 0, 'person', true, 30),
      (v.id, t_conference, 'space', 'Mötesyta', 'Yta för konferens, presentation eller workshop.', 0, 'event', true, 40),
      (v.id, t_conference, 'food_drink', 'Lunch', 'Lunchupplägg för konferensgrupper.', 0, 'person', true, 50),
      (v.id, NULL, 'staff', 'Eventvärd', 'Värd som håller ihop gruppen på plats.', 0, 'timme', false, 60),
      (v.id, NULL, 'staff', 'Coach', 'Instruktör för pickleball, regler och tempo.', 0, 'timme', false, 70),
      (v.id, NULL, 'service', 'Prisutdelning', 'Final, vinnare och enkel prisceremoni.', 0, 'event', false, 80)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.event_resource_catalog (venue_id, resource_type, name, description, venue_court_id, capacity, unit, is_bookable, sort_order)
    SELECT v.id, 'court', vc.name, vc.sport_type, vc.id, NULL, 'event', true, COALESCE(vc.court_number, 100)
    FROM public.venue_courts vc
    WHERE vc.venue_id = v.id
    ON CONFLICT (venue_id, resource_type, name) DO UPDATE
      SET venue_court_id = EXCLUDED.venue_court_id,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          is_active = true;

    INSERT INTO public.event_resource_catalog (venue_id, resource_type, name, description, unit, is_bookable, sort_order)
    VALUES
      (v.id, 'space', 'Lounge', 'Social yta för häng, mat och dryck.', 'event', true, 200),
      (v.id, 'space', 'Restaurang', 'Serveringsyta för mat och dryck.', 'event', true, 210),
      (v.id, 'space', 'Bar', 'Bar/servering.', 'event', true, 220),
      (v.id, 'equipment', 'AV/ljud', 'Ljud eller enklare presentationsteknik.', 'event', true, 300),
      (v.id, 'staff', 'Eventvärd', 'Personal som håller ihop eventet.', 'timme', true, 400),
      (v.id, 'staff', 'Coach', 'Pickleballinstruktör/coach.', 'timme', true, 410),
      (v.id, 'staff', 'Bar/reception', 'Bemanning för bar eller reception.', 'timme', true, 420),
      (v.id, 'food_drink', 'Pizza + dryck', 'Mat- och dryckespaket.', 'person', true, 500)
    ON CONFLICT (venue_id, resource_type, name) DO UPDATE
      SET description = EXCLUDED.description,
          unit = EXCLUDED.unit,
          sort_order = EXCLUDED.sort_order,
          is_active = true;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
