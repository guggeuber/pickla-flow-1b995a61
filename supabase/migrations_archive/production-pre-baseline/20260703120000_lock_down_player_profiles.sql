-- Security hardening: stop exposing full player_profiles publicly.

DROP POLICY IF EXISTS "Anyone can read player profiles" ON public.player_profiles;
DROP POLICY IF EXISTS "Users and staff can read player profiles" ON public.player_profiles;

CREATE OR REPLACE FUNCTION public.is_any_active_venue_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_staff vs
    WHERE vs.user_id = _user_id
      AND vs.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_any_active_venue_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_any_active_venue_staff(uuid) TO authenticated;

CREATE POLICY "Users and staff can read player profiles"
  ON public.player_profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = auth_user_id
    OR public.is_super_admin()
    OR public.is_any_active_venue_staff(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.get_public_profile(profile_id uuid)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.player_profiles p
  WHERE p.id = profile_id
     OR p.auth_user_id = profile_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;

-- After applying manually, run:
-- NOTIFY pgrst, 'reload schema';
