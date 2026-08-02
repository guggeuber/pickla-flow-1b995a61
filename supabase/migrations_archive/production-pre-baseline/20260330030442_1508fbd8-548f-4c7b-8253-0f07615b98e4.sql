
INSERT INTO storage.buckets (id, name, public)
VALUES ('forum-images', 'forum-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated can upload forum images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'forum-images');

CREATE POLICY "Public can read forum images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'forum-images');

CREATE POLICY "Users can delete own forum images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'forum-images' AND (storage.foldername(name))[1] = auth.uid()::text);
