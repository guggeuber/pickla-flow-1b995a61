
-- Add access_code columns to bookings for dart-board / kiosk check-in
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS access_code TEXT,
  ADD COLUMN IF NOT EXISTS access_code_expires_at TIMESTAMPTZ;

-- Unique code per venue per calendar day (UTC date of start_time)
CREATE UNIQUE INDEX idx_bookings_venue_access_code_day
  ON public.bookings (venue_id, access_code, DATE(start_time AT TIME ZONE 'UTC'))
  WHERE access_code IS NOT NULL;
