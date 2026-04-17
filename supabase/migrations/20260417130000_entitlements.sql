-- Membership entitlements schema
-- membership_entitlements: what each tier provides
-- membership_usage: tracks consumption per user per period

CREATE TABLE IF NOT EXISTS membership_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL REFERENCES membership_tiers(id) ON DELETE CASCADE,
  -- Types: court_hours_per_week | open_play_unlimited | free_day_pass_monthly
  --        court_discount_pct   | day_pass_discount_pct
  entitlement_type TEXT NOT NULL,
  value NUMERIC,        -- hours / count / percent (null for boolean flags)
  period TEXT,          -- 'week' | 'month' | null (unlimited / one-time)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tier_id, entitlement_type)
);

CREATE TABLE IF NOT EXISTS membership_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  used_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, venue_id, entitlement_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_membership_usage_lookup
  ON membership_usage(user_id, venue_id, entitlement_type, period_start);

-- RLS
ALTER TABLE membership_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_usage ENABLE ROW LEVEL SECURITY;

-- Anyone can read entitlements (they're public tier info)
CREATE POLICY "Public read membership_entitlements" ON membership_entitlements
  FOR SELECT TO anon, authenticated USING (true);

-- Users can read/write their own usage; staff can read all
CREATE POLICY "Users read own usage" ON membership_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM venue_staff WHERE user_id = auth.uid() AND venue_id = membership_usage.venue_id AND is_active = true
  ));

-- Only service role can write usage (Edge Functions use service client)
-- No INSERT/UPDATE policies for authenticated — service role bypasses RLS

-- ── Seed entitlements for existing tiers ──────────────────────────────────────
-- Founder: 4h court booking/week + unlimited open play
INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'court_hours_per_week', 4, 'week'
FROM membership_tiers WHERE name = 'Founder'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;

INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'open_play_unlimited', 1, NULL
FROM membership_tiers WHERE name = 'Founder'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;

-- Play+: unlimited open play + 15% discount on court bookings
INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'open_play_unlimited', 1, NULL
FROM membership_tiers WHERE name = 'Play+'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;

INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'court_discount_pct', 15, NULL
FROM membership_tiers WHERE name = 'Play+'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;

-- Play: 1 free day pass/month + 10% discount on day passes
INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'free_day_pass_monthly', 1, 'month'
FROM membership_tiers WHERE name = 'Play'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;

INSERT INTO membership_entitlements (tier_id, entitlement_type, value, period)
SELECT id, 'day_pass_discount_pct', 10, NULL
FROM membership_tiers WHERE name = 'Play'
ON CONFLICT (tier_id, entitlement_type) DO NOTHING;
