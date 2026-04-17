-- Fix RLS policies on corporate_accounts: remove anon read-all access,
-- restrict to authenticated users who are venue staff or the account owner.

-- Drop any existing overly-permissive anon/public policy
DROP POLICY IF EXISTS "Public read corporate_accounts" ON corporate_accounts;
DROP POLICY IF EXISTS "Allow public read" ON corporate_accounts;
DROP POLICY IF EXISTS "Enable read access for all users" ON corporate_accounts;

-- Venue staff (authenticated) can read accounts for their venues
CREATE POLICY "Venue staff can read corporate accounts"
  ON corporate_accounts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = corporate_accounts.venue_id
        AND venue_staff.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'super_admin'
    )
  );

-- Drop any existing overly-permissive anon/public policy on corporate_orders
DROP POLICY IF EXISTS "Public read corporate_orders" ON corporate_orders;
DROP POLICY IF EXISTS "Allow public read" ON corporate_orders;
DROP POLICY IF EXISTS "Enable read access for all users" ON corporate_orders;

-- Venue staff can read orders for their venues
CREATE POLICY "Venue staff can read corporate orders"
  ON corporate_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = corporate_orders.venue_id
        AND venue_staff.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'super_admin'
    )
  );
