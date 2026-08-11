-- Booking participation: make base-resource funding explicit before deciding
-- whether a joining player owes an individual participation amount.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS participation_funding_mode TEXT,
  ADD COLUMN IF NOT EXISTS participation_funding_source_type TEXT,
  ADD COLUMN IF NOT EXISTS participation_funding_source_id TEXT,
  ADD COLUMN IF NOT EXISTS participation_funder TEXT;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_participation_funding_mode_check,
  ADD CONSTRAINT bookings_participation_funding_mode_check
    CHECK (participation_funding_mode IS NULL OR participation_funding_mode IN (
      'individual_participation', 'resource_funded', 'unresolved'
    )) NOT VALID,
  DROP CONSTRAINT IF EXISTS bookings_participation_funder_check,
  ADD CONSTRAINT bookings_participation_funder_check
    CHECK (participation_funder IS NULL OR participation_funder IN (
      'self_prepaid', 'subscription', 'house_comped', 'partner', 'employer', 'sponsor'
    )) NOT VALID,
  DROP CONSTRAINT IF EXISTS bookings_participation_funding_provenance_check,
  ADD CONSTRAINT bookings_participation_funding_provenance_check
    CHECK (
      participation_funding_mode IS NULL OR
      participation_funding_mode = 'unresolved' OR
      (
        NULLIF(BTRIM(participation_funding_source_type), '') IS NOT NULL AND
        participation_funder IS NOT NULL
      )
    ) NOT VALID;

-- Included/Founder-funded courts retain individual participant economics.
UPDATE public.bookings
SET participation_funding_mode = 'individual_participation',
    participation_funding_source_type = 'membership_entitlement',
    participation_funding_source_id = membership_id::TEXT,
    participation_funder = 'subscription'
WHERE participation_funding_mode IS NULL
  AND (
    included_court_hours > 0 OR
    membership_usage_entitlement_type = 'court_hours_per_week'
  );

-- Corporate hours fund the physical resource for every attached participant.
UPDATE public.bookings
SET participation_funding_mode = 'resource_funded',
    participation_funding_source_type = 'corporate_package',
    participation_funding_source_id = corporate_package_id::TEXT,
    participation_funder = 'employer'
WHERE participation_funding_mode IS NULL
  AND corporate_package_id IS NOT NULL;

-- A completed Stripe court purchase funds the whole booked resource. The
-- Founder/partial-inclusion case was intentionally classified above first.
UPDATE public.bookings
SET participation_funding_mode = 'resource_funded',
    participation_funding_source_type = 'stripe_payment',
    participation_funding_source_id = stripe_session_id,
    participation_funder = 'self_prepaid'
WHERE participation_funding_mode IS NULL
  AND NULLIF(BTRIM(stripe_session_id), '') IS NOT NULL;

-- Preserve legacy zero-price membership bookings as individually resolved.
UPDATE public.bookings
SET participation_funding_mode = 'individual_participation',
    participation_funding_source_type = 'membership_entitlement',
    participation_funding_source_id = membership_id::TEXT,
    participation_funder = 'subscription'
WHERE participation_funding_mode IS NULL
  AND membership_id IS NOT NULL
  AND COALESCE(total_price, 0) = 0;

-- Do not guess whether an old confirmed row without Stripe/entitlement proof
-- was cash-paid, promotional or house-granted. Those groups must be resolved
-- explicitly before they can create a new individual payment obligation.
UPDATE public.bookings
SET participation_funding_mode = 'unresolved',
    participation_funding_source_type = NULL,
    participation_funding_source_id = NULL,
    participation_funder = NULL
WHERE participation_funding_mode IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN participation_funding_mode SET DEFAULT 'unresolved',
  ALTER COLUMN participation_funding_mode SET NOT NULL;

ALTER TABLE public.bookings
  VALIDATE CONSTRAINT bookings_participation_funding_mode_check;
ALTER TABLE public.bookings
  VALIDATE CONSTRAINT bookings_participation_funder_check;
ALTER TABLE public.bookings
  VALIDATE CONSTRAINT bookings_participation_funding_provenance_check;

CREATE INDEX IF NOT EXISTS idx_bookings_participation_funding_review
  ON public.bookings (venue_id, participation_funding_mode, start_time)
  WHERE participation_funding_mode = 'unresolved' AND status <> 'cancelled';

COMMENT ON COLUMN public.bookings.participation_funding_mode IS
  'Canonical answer to whether joiners resolve individual economics or are covered by an already-funded physical resource.';
COMMENT ON COLUMN public.bookings.participation_funding_source_type IS
  'Canonical provenance for the base resource funding decision; never derived from UI labels.';
COMMENT ON COLUMN public.bookings.participation_funding_source_id IS
  'Immutable external/internal source reference supporting participation_funding_source_type.';
COMMENT ON COLUMN public.bookings.participation_funder IS
  'Canonical funder for the base resource, using the Entitlement Foundation funder vocabulary.';
