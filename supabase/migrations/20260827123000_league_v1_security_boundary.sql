-- League V1 browser-write boundary repair.
--
-- Production migrations are executed as postgres. The production baseline's
-- postgres/public default table ACL grants ALL to anon and authenticated, so
-- the League tables inherited browser DML despite their narrower explicit
-- grants. RLS remains enabled for read scoping, but canonical League writes
-- must cross the reviewed server/API/RPC boundary.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE
  public.league_seasons,
  public.league_team_entries,
  public.league_team_members,
  public.league_fixtures,
  public.league_fixture_results
FROM anon, authenticated;

-- Private team and roster tables were intended to be authenticated-only. The
-- inherited anon SELECT grant was masked by RLS, but is removed as a second
-- privacy boundary. Public League reads remain on seasons, fixtures, results,
-- and the redacted api-leagues projection.
REVOKE SELECT
ON TABLE public.league_team_entries, public.league_team_members
FROM anon;

-- Service-role functions bypass RLS. Keeping a browser mutation policy would
-- be a latent bypass if table DML were accidentally re-granted later. Staff
-- read access is already covered by the existing SELECT policies.
DROP POLICY IF EXISTS "Staff manage league seasons" ON public.league_seasons;

-- Correct the exact default-privilege root that created the League exposure.
-- This is scoped to future public tables created by postgres and does not
-- change any existing unrelated table. service_role defaults are untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;
