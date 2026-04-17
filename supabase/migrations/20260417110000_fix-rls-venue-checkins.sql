-- Restrict venue_checkins anonymous access:
-- - Anon can only see rows checked in within the last 24 hours (prevents bulk historical enumeration)
-- - Authenticated venue staff retain full access to all rows
--
-- Note: RLS is row-level; column-level restriction (hiding user_id from anon) requires
-- a security-definer view (future improvement). The kiosk display already only selects
-- non-PII columns (entry_type, entitlement_id, player_name, checked_in_at).

-- Drop any existing overly-permissive anon policies
DROP POLICY IF EXISTS "Public read venue_checkins" ON venue_checkins;
DROP POLICY IF EXISTS "Allow public read" ON venue_checkins;
DROP POLICY IF EXISTS "Enable read access for all users" ON venue_checkins;
DROP POLICY IF EXISTS "Anon can read venue_checkins" ON venue_checkins;

-- Anon/public: only today's and yesterday's check-ins (kiosk display use case)
CREATE POLICY "Anon can read recent venue_checkins"
  ON venue_checkins
  FOR SELECT
  TO anon
  USING (
    checked_in_at >= (now() - interval '24 hours')
  );

-- Authenticated staff: full access to their venue's check-ins
CREATE POLICY "Venue staff can read all checkins"
  ON venue_checkins
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM venue_staff
      WHERE venue_staff.user_id = auth.uid()
        AND venue_staff.venue_id = venue_checkins.venue_id
        AND venue_staff.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'super_admin'
    )
  );
