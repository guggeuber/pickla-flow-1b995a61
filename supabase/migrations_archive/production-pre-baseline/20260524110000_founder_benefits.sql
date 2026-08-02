-- Founder benefits: court-hours, unlimited open play, and monthly guest vouchers.

ALTER TABLE public.access_vouchers
  ADD COLUMN IF NOT EXISTS recipient_name TEXT;

-- A created Founder guest voucher can only be redeemed once, and each receiver
-- can redeem at most one Founder guest voucher per venue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_entitlements_one_founder_guest_per_user_venue
  ON public.access_entitlements (venue_id, user_id)
  WHERE source_type = 'founder_guest_voucher'
    AND entitlement_type = 'day_access';

-- Lazy monthly generation must be idempotent per membership/month/slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_vouchers_membership_month_slot
  ON public.access_vouchers (
    source_id,
    (metadata ->> 'period_start'),
    (metadata ->> 'slot')
  )
  WHERE source_type = 'membership_guest_voucher';

-- Extend the membership benefit vocabulary. There is no CHECK constraint on
-- membership_entitlements.entitlement_type, so this is data-only.
INSERT INTO public.membership_entitlements (tier_id, entitlement_type, value, period, sport_type)
SELECT id, 'court_hours_per_week', 4, 'week', 'pickleball'
FROM public.membership_tiers
WHERE lower(name) = 'founder'
ON CONFLICT (tier_id, entitlement_type, sport_type) DO UPDATE
  SET value = EXCLUDED.value,
      period = EXCLUDED.period;

INSERT INTO public.membership_entitlements (tier_id, entitlement_type, value, period, sport_type)
SELECT id, 'open_play_unlimited', 1, NULL, 'pickleball'
FROM public.membership_tiers
WHERE lower(name) = 'founder'
ON CONFLICT (tier_id, entitlement_type, sport_type) DO UPDATE
  SET value = EXCLUDED.value,
      period = EXCLUDED.period;

INSERT INTO public.membership_entitlements (tier_id, entitlement_type, value, period, sport_type)
SELECT id, 'guest_day_vouchers_monthly', 4, 'month', 'pickleball'
FROM public.membership_tiers
WHERE lower(name) = 'founder'
ON CONFLICT (tier_id, entitlement_type, sport_type) DO UPDATE
  SET value = EXCLUDED.value,
      period = EXCLUDED.period;

NOTIFY pgrst, 'reload schema';
