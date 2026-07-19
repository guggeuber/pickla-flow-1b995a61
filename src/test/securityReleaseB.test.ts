import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  "supabase/migrations/20260716121000_repair_dormant_token_privilege_exposure.sql",
  "utf8",
);
const corporateApiSource = readFileSync("supabase/functions/api-corporate/index.ts", "utf8");
const dayPassApiSource = readFileSync("supabase/functions/api-day-passes/index.ts", "utf8");

function routeSource(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Security Release B — dormant token and privilege exposure", () => {
  it("drops exactly the three unsafe policies without broader schema or grant changes", () => {
    const statements = migrationSource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));

    expect(statements).toEqual([
      'DROP POLICY IF EXISTS "Anon read by invite token" ON public.corporate_accounts;',
      'DROP POLICY IF EXISTS "Public read by token" ON public.day_pass_shares;',
      'DROP POLICY IF EXISTS "Members can join via invite" ON public.corporate_members;',
    ]);
    expect(migrationSource).not.toMatch(/\b(?:GRANT|REVOKE|ALTER|CREATE|INSERT|UPDATE|DELETE)\b/i);
  });

  it("keeps public corporate invite lookup token-scoped and server-side", () => {
    const inviteRoute = routeSource(corporateApiSource, "path === 'invite-info'", "path === 'register'");

    expect(inviteRoute).toContain("getServiceClient()");
    expect(inviteRoute).toContain("const token = url.searchParams.get('token')");
    expect(inviteRoute).toContain(".eq('invite_token', token)");
    expect(inviteRoute).toContain(".eq('is_active', true)");
    expect(inviteRoute).toContain("Invalid or expired invite link");
  });

  it("keeps corporate join authenticated, token-validated, idempotent, and server-role-controlled", () => {
    const authGate = corporateApiSource.indexOf("getAuthenticatedClient(req)");
    const joinStart = corporateApiSource.indexOf("path === 'join'");
    const joinRoute = routeSource(corporateApiSource, "path === 'join'", "path === 'my'");

    expect(authGate).toBeGreaterThan(-1);
    expect(authGate).toBeLessThan(joinStart);
    expect(joinRoute).toContain("const { token } = body");
    expect(joinRoute).toContain(".eq('invite_token', token)");
    expect(joinRoute).toContain(".eq('is_active', true)");
    expect(joinRoute).toContain(".eq('user_id', userId)");
    expect(joinRoute).toContain("if (existing)");
    expect(joinRoute).toContain("const role = (count === 0) ? 'admin' : 'member'");
    expect(joinRoute).toContain(".insert({ corporate_account_id: account.id, user_id: userId, role })");
    expect(joinRoute).not.toMatch(/const\s*\{[^}]*role[^}]*\}\s*=\s*body/);
    expect(joinRoute).not.toMatch(/const\s*\{[^}]*corporate_account_id[^}]*\}\s*=\s*body/);
  });

  it("keeps day-pass share lookup token-scoped and server-side", () => {
    const shareInfoRoute = routeSource(
      dayPassApiSource,
      "path === 'share-info'",
      "const { client, userId, error } = await getAuthenticatedClient(req)",
    );

    expect(shareInfoRoute).toContain("getServiceClient()");
    expect(shareInfoRoute).toContain("const token = url.searchParams.get('token')");
    expect(shareInfoRoute).toContain(".eq('token', token)");
    expect(shareInfoRoute).toContain("if (!voucher) return errorResponse('Not found', 404)");
  });

  it("keeps day-pass claim authenticated, token-validated, and bound to the caller", () => {
    const claimRoute = routeSource(dayPassApiSource, "path === 'claim'", "const now = DateTime.now()");

    expect(claimRoute).toContain("const { token } = body");
    expect(claimRoute).toContain("getUserIdFromRequest(req, adminClient)");
    expect(claimRoute).toContain("if (!claimUserId) return errorResponse('Must be logged in to claim', 401)");
    expect(claimRoute).toContain(".eq('token', token)");
    expect(claimRoute).toContain("share.claimed_by === claimUserId");
    expect(claimRoute).toContain("claimed_by: claimUserId");
    expect(claimRoute).toContain(".eq('id', share.id)");
  });
});
