-- Desk may invite one known Pickla customer to one concrete activity
-- occurrence.  This table is orchestration/audit state only: canonical
-- capacity_holds, session_registrations, Stripe receipts and ledger entries
-- remain the authorities for capacity, participation and money.

CREATE TABLE IF NOT EXISTS public.activity_participant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  activity_session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'payment_pending', 'confirmed_free', 'confirmed_paid', 'payment_expired', 'action_required', 'cancelled')),
  canonical_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (canonical_price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SEK' CHECK (currency = UPPER(currency)),
  pricing_reason TEXT,
  entitlement_type TEXT,
  access_reason TEXT,
  capacity_hold_id UUID REFERENCES public.capacity_holds(id) ON DELETE SET NULL,
  stripe_session_id TEXT,
  checkout_url TEXT,
  registration_id UUID REFERENCES public.session_registrations(id) ON DELETE SET NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  email_sent_at TIMESTAMPTZ,
  email_send_count INTEGER NOT NULL DEFAULT 0 CHECK (email_send_count >= 0),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_session_id, session_date, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_participant_invitations_stripe
  ON public.activity_participant_invitations (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_participant_invitations_occurrence
  ON public.activity_participant_invitations (venue_id, activity_session_id, session_date, status);

CREATE TRIGGER update_activity_participant_invitations_updated_at
  BEFORE UPDATE ON public.activity_participant_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.activity_participant_invitations ENABLE ROW LEVEL SECURITY;

-- The row contains a capability token and a provider Checkout URL. Keep it
-- behind the explicitly authorized Edge Function instead of granting direct
-- table access to venue JWTs; the protected projection returns only what Desk
-- needs, and the public capability route returns no customer PII.
REVOKE ALL ON public.activity_participant_invitations FROM anon, authenticated;
GRANT ALL ON public.activity_participant_invitations TO service_role;

COMMENT ON TABLE public.activity_participant_invitations IS
  'Idempotent Desk invitation state for one identified person and one activity occurrence; never authoritative for capacity, payment or registration.';
