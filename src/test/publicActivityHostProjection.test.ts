import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const eventApiSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const migrationSource = readFileSync("supabase/migrations/20260904120000_session_social_context.sql", "utf8");
const programSource = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");

describe("Session host identity boundary", () => {
  it("removes named hosts from every anonymous activity projection", () => {
    expect(eventApiSource).not.toContain("projectPublicActivitySessionHosts");
    expect(eventApiSource).not.toContain("get_public_activity_session_hosts");
    expect(eventApiSource).not.toContain("hosts: hostsBySessionId");
    expect(eventApiSource).toContain("get_session_public_context");
  });

  it("revokes the legacy anonymous host RPC and derives host from Participation", () => {
    expect(migrationSource).toContain("REVOKE EXECUTE ON FUNCTION public.get_public_activity_session_hosts(UUID[]) FROM PUBLIC, anon, authenticated");
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participant'");
    expect(migrationSource).toContain("participation.role = 'host'");
    expect(migrationSource).not.toContain("host_person_id");
  });

  it("never lets a later template assignment rewrite historical Participation", () => {
    expect(migrationSource).toContain("GREATEST(host_assignment.created_at, host_assignment.updated_at)");
    expect(migrationSource).toContain("participation.session_date + session.start_time");
    expect(migrationSource).toContain("GREATEST(NEW.created_at, NEW.updated_at)");
    expect(migrationSource).toContain("current template administration from inventing past facts");
  });

  it("loads identity only through verified server-side social context", () => {
    expect(eventApiSource).toContain("path === 'activity-social-context'");
    expect(eventApiSource).toContain("authClient.rpc('get_session_social_context'");
    expect(programSource).toContain("verifiedAccount.isVerified");
    expect(programSource).toContain("fetchSessionSocialContext");
    expect(programSource).not.toContain("getPublicProfileMap");
  });
});
