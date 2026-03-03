
-- Event templates: franchise-level event definitions managed by super_admin
CREATE TABLE public.event_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  event_type public.event_type NOT NULL,
  format public.event_format NOT NULL,
  category TEXT NOT NULL DEFAULT 'tournament',
  
  -- Pricing (per participant, centrally set)
  entry_fee NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'SEK',
  vat_rate NUMERIC DEFAULT 6,
  
  -- Branding
  logo_url TEXT,
  background_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  
  -- Scoring config
  scoring_type TEXT,
  scoring_format TEXT,
  points_to_win INTEGER,
  best_of INTEGER,
  win_by_two BOOLEAN DEFAULT false,
  match_duration_default INTEGER,
  competition_type TEXT,
  
  -- Event settings
  is_drop_in BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  registration_fields JSONB NOT NULL DEFAULT '["name","phone"]'::jsonb,
  
  -- WhatsApp / community
  whatsapp_url TEXT,
  
  -- Meta
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;

-- Only super_admin can manage templates
CREATE POLICY "Super admin manages templates"
  ON public.event_templates FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Everyone can read active templates
CREATE POLICY "Public can read active templates"
  ON public.event_templates FOR SELECT
  USING (is_active = true OR is_super_admin());

-- Timestamp trigger
CREATE TRIGGER update_event_templates_updated_at
  BEFORE UPDATE ON public.event_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add template_id to events
ALTER TABLE public.events
  ADD COLUMN template_id UUID REFERENCES public.event_templates(id);

-- Index for lookup
CREATE INDEX idx_events_template_id ON public.events(template_id);
