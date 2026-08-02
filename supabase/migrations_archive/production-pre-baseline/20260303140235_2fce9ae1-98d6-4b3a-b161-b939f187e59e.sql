
-- Add new columns to events table for richer event pages
ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS whatsapp_url text,
  ADD COLUMN IF NOT EXISTS is_drop_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_fields jsonb NOT NULL DEFAULT '["name", "phone"]'::jsonb,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'tournament';

-- Add index for category filtering
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events (category);
