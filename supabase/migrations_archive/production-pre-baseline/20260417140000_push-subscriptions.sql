-- Push notification subscriptions for Web Push API
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,   -- client public key
  auth TEXT NOT NULL,     -- auth secret
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_venue ON push_subscriptions(venue_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage their own subscriptions
CREATE POLICY "Users manage own push subscriptions" ON push_subscriptions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Venue staff can read subscriptions for their venue (for sending notifications)
CREATE POLICY "Staff can read venue push subscriptions" ON push_subscriptions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM venue_staff
    WHERE venue_staff.user_id = auth.uid()
      AND venue_staff.venue_id = push_subscriptions.venue_id
      AND venue_staff.is_active = true
  ));
