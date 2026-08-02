-- Create storage bucket for event logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-logos', 'event-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Public can read event logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-logos');

-- Authenticated staff can upload
CREATE POLICY "Staff can upload event logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'event-logos'
  AND (auth.role() = 'authenticated')
);

-- Staff can delete event logos
CREATE POLICY "Staff can delete event logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'event-logos'
  AND (auth.role() = 'authenticated')
);

-- Staff can update event logos
CREATE POLICY "Staff can update event logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'event-logos'
  AND (auth.role() = 'authenticated')
);