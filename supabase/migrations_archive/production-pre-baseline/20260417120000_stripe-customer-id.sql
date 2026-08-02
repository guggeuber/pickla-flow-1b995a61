-- Add stripe_customer_id to player_profiles for saved payment methods
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_player_profiles_stripe_customer ON player_profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
