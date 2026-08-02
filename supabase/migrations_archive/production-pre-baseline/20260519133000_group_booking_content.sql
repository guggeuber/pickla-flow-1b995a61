ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS group_booking_title TEXT,
  ADD COLUMN IF NOT EXISTS group_booking_intro TEXT,
  ADD COLUMN IF NOT EXISTS group_booking_notes TEXT,
  ADD COLUMN IF NOT EXISTS group_booking_image_url TEXT;
