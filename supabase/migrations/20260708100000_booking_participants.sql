-- Booking participants for court bookings.
-- Models "your share of the court" separately from the court booking itself:
-- the booking consumes court inventory and any Founder included hours; each
-- participant carries their own operational/payment/check-in state.

CREATE TABLE IF NOT EXISTS public.booking_participant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  booking_group_key TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_participant_invites_group
  ON public.booking_participant_invites (venue_id, booking_group_key, status);

CREATE TABLE IF NOT EXISTS public.booking_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  booking_group_key TEXT NOT NULL,
  invite_id UUID REFERENCES public.booking_participant_invites(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('booker', 'player')),
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SEK',
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'free', 'cancelled')),
  payment_method TEXT,
  payment_stripe_session_id TEXT,
  booking_receipt_id UUID REFERENCES public.booking_receipts(id) ON DELETE SET NULL,
  checked_in_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_participants_group
  ON public.booking_participants (venue_id, booking_group_key, created_at);

CREATE INDEX IF NOT EXISTS idx_booking_participants_user
  ON public.booking_participants (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_participants_customer
  ON public.booking_participants (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_participants_group_user
  ON public.booking_participants (booking_group_key, user_id)
  WHERE user_id IS NOT NULL AND payment_status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_participants_stripe_session
  ON public.booking_participants (payment_stripe_session_id)
  WHERE payment_stripe_session_id IS NOT NULL;

ALTER TABLE public.booking_participant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read booking participant invites" ON public.booking_participant_invites;
CREATE POLICY "Staff can read booking participant invites"
  ON public.booking_participant_invites
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = booking_participant_invites.venue_id
        AND venue_staff.is_active = true
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Users and staff can read booking participants" ON public.booking_participants;
CREATE POLICY "Users and staff can read booking participants"
  ON public.booking_participants
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.bookings
      WHERE bookings.id = booking_participants.booking_id
        AND bookings.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = booking_participants.venue_id
        AND venue_staff.is_active = true
    )
    OR public.is_super_admin()
  );

DROP TRIGGER IF EXISTS update_booking_participant_invites_updated_at ON public.booking_participant_invites;
CREATE TRIGGER update_booking_participant_invites_updated_at
BEFORE UPDATE ON public.booking_participant_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_booking_participants_updated_at ON public.booking_participants;
CREATE TRIGGER update_booking_participants_updated_at
BEFORE UPDATE ON public.booking_participants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reminder after manual SQL editor execution:
-- NOTIFY pgrst, 'reload schema';
