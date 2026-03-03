
-- Add slug to events for shareable URLs
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slug text;

-- Create unique index on slug (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug_unique ON public.events (slug) WHERE slug IS NOT NULL;
