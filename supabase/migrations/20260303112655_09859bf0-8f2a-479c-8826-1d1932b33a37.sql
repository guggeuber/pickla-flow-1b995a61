
-- Create community_stories table
CREATE TABLE public.community_stories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '24 hours'),
  created_by UUID NOT NULL
);

-- Enable RLS
ALTER TABLE public.community_stories ENABLE ROW LEVEL SECURITY;

-- Everyone can read active stories
CREATE POLICY "Public can read stories"
ON public.community_stories
FOR SELECT
USING (true);

-- Staff/admins can create stories
CREATE POLICY "Staff can create stories"
ON public.community_stories
FOR INSERT
WITH CHECK (
  is_super_admin()
  OR (venue_id IS NOT NULL AND is_venue_member(auth.uid(), venue_id))
);

-- Staff/admins can delete stories
CREATE POLICY "Staff can delete stories"
ON public.community_stories
FOR DELETE
USING (
  created_by = auth.uid()
  OR is_super_admin()
  OR (venue_id IS NOT NULL AND is_venue_member(auth.uid(), venue_id))
);

-- Create storage bucket for story images
INSERT INTO storage.buckets (id, name, public) VALUES ('community-stories', 'community-stories', true);

-- Storage policies
CREATE POLICY "Public can view story images"
ON storage.objects FOR SELECT
USING (bucket_id = 'community-stories');

CREATE POLICY "Staff can upload story images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'community-stories' AND auth.role() = 'authenticated');

CREATE POLICY "Staff can delete story images"
ON storage.objects FOR DELETE
USING (bucket_id = 'community-stories' AND auth.role() = 'authenticated');
