import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260827123000_league_v1_security_boundary.sql",
  "utf8",
);
const databaseContract = readFileSync("supabase/tests/league_v1.sql", "utf8");
const leagueApi = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");

const leagueTables = [
  "league_seasons",
  "league_team_entries",
  "league_team_members",
  "league_fixtures",
  "league_fixture_results",
];

describe("League V1 browser-write security boundary", () => {
  it("revokes direct browser DML from every canonical League table", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE");
    expect(migration).toContain("FROM anon, authenticated");
    for (const table of leagueTables) expect(migration).toContain(`public.${table}`);
  });

  it("removes the latent staff table-write policy without changing read policies", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Staff manage league seasons" ON public.league_seasons',
    );
    expect(migration).not.toMatch(/DROP POLICY[^\n]+(?:Public reads|Members and staff read)/);
  });

  it("corrects only the verified postgres/public future-table DML default", () => {
    expect(migration).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public",
    );
    expect(migration).not.toContain("FOR ROLE supabase_admin");
    expect(migration).not.toMatch(/REVOKE[^;]+ON ALL TABLES/);
  });

  it("removes anon table access to private team and roster identity", () => {
    expect(migration).toContain(
      "ON TABLE public.league_team_entries, public.league_team_members",
    );
    expect(migration).toContain("FROM anon;");
    const publicProjection = leagueApi.slice(
      leagueApi.indexOf("async function loadPublicProjection"),
      leagueApi.indexOf("async function createLeagueCart"),
    );
    expect(publicProjection).toContain("select('id, team_name, status')");
    expect(publicProjection).not.toContain("league_team_members').select");
    expect(publicProjection).not.toContain("captain_customer_id");
    expect(publicProjection).not.toContain("payer_customer_id");
    expect(publicProjection).not.toContain("primary_email");
    const returnedPayload = publicProjection.slice(publicProjection.lastIndexOf("return {"));
    for (const privateField of ["customer_id", "payer_customer_id", "auth_user_id", "email"]) {
      expect(returnedPayload).not.toContain(privateField);
    }
  });

  it("executes real anon, user, and staff table mutations and preserves the server path", () => {
    expect(databaseContract).toContain("SET LOCAL ROLE anon");
    expect(databaseContract.match(/SET LOCAL ROLE authenticated/g)).toHaveLength(2);
    expect(databaseContract).toContain("authenticated venue staff");
    expect(databaseContract).toContain("INSERT INTO public.%I DEFAULT VALUES");
    expect(databaseContract).toContain("UPDATE public.%I SET updated_at = updated_at WHERE false");
    expect(databaseContract).toContain("DELETE FROM public.%I WHERE false");
    expect(databaseContract).toContain("TRUNCATE TABLE public.%I");
    expect(databaseContract).toContain("SET LOCAL ROLE service_role");
    expect(databaseContract).toContain("public.rename_league_team(");
  });
});
