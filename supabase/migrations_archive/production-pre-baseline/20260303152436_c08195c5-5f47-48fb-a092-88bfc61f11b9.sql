
-- Add booking reference column
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_ref TEXT UNIQUE;

-- Create a function to generate short booking refs like "PK-A3X7"
CREATE OR REPLACE FUNCTION public.generate_booking_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _ref TEXT;
  _exists BOOLEAN;
BEGIN
  LOOP
    _ref := 'PK-' || upper(substr(md5(random()::text), 1, 4));
    SELECT EXISTS(SELECT 1 FROM public.bookings WHERE booking_ref = _ref) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  NEW.booking_ref := _ref;
  RETURN NEW;
END;
$$;

-- Auto-generate booking_ref on insert
CREATE TRIGGER set_booking_ref
BEFORE INSERT ON public.bookings
FOR EACH ROW
WHEN (NEW.booking_ref IS NULL)
EXECUTE FUNCTION public.generate_booking_ref();

-- Allow public read access to bookings by booking_ref (for the shareable page)
CREATE POLICY "Public can read booking by ref"
ON public.bookings
FOR SELECT
USING (booking_ref IS NOT NULL);
