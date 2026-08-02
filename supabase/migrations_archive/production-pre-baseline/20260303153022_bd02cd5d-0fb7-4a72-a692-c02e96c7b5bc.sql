-- Remove overly broad public bookings read policy (PII protection)
DROP POLICY IF EXISTS "Public can read booking by ref" ON public.bookings;

-- Strengthen booking reference entropy for future rows
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
    _ref := 'PK-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    SELECT EXISTS(SELECT 1 FROM public.bookings WHERE booking_ref = _ref) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  NEW.booking_ref := _ref;
  RETURN NEW;
END;
$$;