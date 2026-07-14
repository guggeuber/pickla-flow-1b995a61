import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("supabase/functions/api-investor/index.ts", "utf8");

describe("private investor memo API contract", () => {
  it("keeps private memo creation behind the existing super-admin guard", () => {
    const guard = source.indexOf("const adminCheck = await isSuperAdmin(req)");
    const route = source.indexOf("path === 'create-private-memo'");

    expect(guard).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(guard);
  });

  it("reuses the existing token contract and does not send email", () => {
    const start = source.indexOf("path === 'create-private-memo'");
    const end = source.indexOf("path === 'save-settings'", start);
    const routeSource = source.slice(start, end);

    expect(routeSource).toContain("const token = randomToken()");
    expect(routeSource).toContain("const hash = await sha256Hex(token)");
    expect(routeSource).toContain("TOKEN_TTL_DAYS * 86400_000");
    expect(routeSource).toContain("source: 'private_invite'");
    expect(routeSource).toContain("canonicalPublicUrl(`/invest/memo/");
    expect(routeSource).not.toMatch(/resend|send.*email|email.*send/i);
  });

  it("preserves the production public, approval, open, interest, and revoke contracts", () => {
    expect(source).toContain(".eq('email', email)\n        .maybeSingle()");
    expect(source).toContain("if (!['approved', 'opened', 'interested'].includes(lead.status))");
    expect(source).toContain("status: lead.status === 'approved' ? 'opened' : lead.status");
    expect(source).toContain("return jsonResponse({ ok: true, token, expires_at: expires, email: data?.email, name: data?.name })");
    expect(source).toContain("access_token_hash: null,\n        token_expires_at: null,\n        status: 'rejected'");
  });
});
