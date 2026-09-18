import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { renderPicklaMailSignup } from "../../public-web/renderMailSignup";
import {
  createOpaqueUnsubscribeToken,
  isCanonicallyMarketingEligible,
  isTransactionalEmailAllowed,
  PICKLA_MAIL_CONSENT_STATEMENT,
  PICKLA_MAIL_POLICY_VERSION,
  resendWebhookAction,
  verifyOpaqueUnsubscribeToken,
} from "../../supabase/functions/_shared/communications";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260918120000_pickla_mail_v1.sql");
const api = read("supabase/functions/api-communications/index.ts");
const publicCapture = read("public-web/renderMailSignup.ts");
const admin = read("src/components/admin/AdminCommunications.tsx");

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

describe("Pickla Mail V1 permanent contract A–T", () => {
  it("A/R: renders an anonymous, explicit, accessible, mobile-safe signup without mounting it globally", () => {
    const html = renderPicklaMailSignup({ source: "public_web_paper", apiOrigin: "https://api.example.test" });
    const document = new DOMParser().parseFromString(html, "text/html");
    const form = document.querySelector("form");
    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    const consent = document.querySelector<HTMLInputElement>('input[name="consent"]');
    expect(form).not.toBeNull();
    expect(email?.type).toBe("email");
    expect(email?.required).toBe(true);
    expect(consent?.type).toBe("checkbox");
    expect(consent?.required).toBe(true);
    expect(consent?.checked).toBe(false);
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(html).toContain("@media(max-width:760px)");
    expect(html).toContain("https://api.example.test/api-communications/subscribe");
    expect(read("public-web/renderPage.ts")).not.toContain("renderPicklaMailSignup");
  });

  it("B/C: requires consent evidence and keeps one idempotent identity/preference projection", () => {
    expect(PICKLA_MAIL_POLICY_VERSION).toBe("pickla-mail-v1-2026-09-18");
    expect(PICKLA_MAIL_CONSENT_STATEMENT).toContain("avsluta när som helst");
    expect(migration).toContain("communication_preferences_consent_evidence_check");
    expect(migration).toContain("consent_source IS NOT NULL");
    expect(migration).toContain("consent_statement IS NOT NULL");
    expect(migration).toContain("UNIQUE (organization_id, email_normalized)");
    expect(migration).toContain("UNIQUE (subscriber_id, topic_key)");
    expect(migration).toContain("v_previous_preference IS DISTINCT FROM p_status");
    expect(migration).toContain("GRANT SELECT, INSERT ON public.communication_consent_events TO service_role");
  });

  it("D/E/Q: supports verified-account subscription and safe same-tenant linking without duplication", () => {
    expect(api).toContain("authenticatedIdentity(req)");
    expect(api).toContain("matchingCustomerId(admin, organizationId, identity.userId, identity.email)");
    expect(api).toContain("email_confirmed_at");
    expect(migration).toContain("Customer identity does not match subscriber email");
    expect(migration).toContain("c.organization_id = p_organization_id");
    expect(migration).toContain("'identity_link'");
    expect(api).toContain("requireSuperAdmin(admin, auth.userId)");
    expect(migration).toContain("REVOKE ALL ON public.communication_subscribers FROM anon, authenticated");
  });

  it("F/G/O: verifies opaque no-login unsubscribe tokens and returns non-enumerating confirmation", async () => {
    const subscriberId = "74c5749e-b108-4c0a-9fb1-522ce949650b";
    const secret = "test-only-secret-that-is-at-least-thirty-two-characters";
    const token = await createOpaqueUnsubscribeToken(subscriberId, secret);
    expect(token).not.toContain(subscriberId);
    expect(token).not.toContain("@");
    expect(await verifyOpaqueUnsubscribeToken(token, secret)).toBe(subscriberId);
    expect(await verifyOpaqueUnsubscribeToken(`${token}x`, secret)).toBeNull();
    expect(api).toContain("['GET', 'POST'].includes(req.method) && path === 'unsubscribe'");
    expect(api).toContain("Om länken hör till en prenumeration");
    const recordPreferenceBody = api.slice(
      api.indexOf("async function recordPreference"),
      api.indexOf("async function publicSubscribe"),
    );
    expect(recordPreferenceBody.indexOf("admin.rpc('record_communication_preference'")).toBeLessThan(
      recordPreferenceBody.indexOf("await synchronizeSubscriber(admin"),
    );
  });

  it("H/I/S: calculates marketing eligibility from Pickla truth while transactional email remains independent", () => {
    expect(isCanonicallyMarketingEligible({ marketingStatus: "active", preferenceStatus: "subscribed" })).toBe(true);
    expect(isCanonicallyMarketingEligible({ marketingStatus: "unsubscribed", preferenceStatus: "subscribed" })).toBe(false);
    expect(isCanonicallyMarketingEligible({ marketingStatus: "active", preferenceStatus: "unsubscribed" })).toBe(false);
    expect(isCanonicallyMarketingEligible({ marketingStatus: "active", preferenceStatus: "subscribed", suppressedAt: "2026-09-18T10:00:00Z" })).toBe(false);
    expect(isTransactionalEmailAllowed()).toBe(true);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.communication_is_marketing_eligible");
    expect(migration).toContain("s.suppressed_at IS NULL");
    expect(migration).toContain("cp.status = 'subscribed'");
  });

  it("J: commits canonical truth first and records provider-sync failure without rolling it back", () => {
    const canonicalWrite = api.indexOf("admin.rpc('record_communication_preference'");
    const providerSync = api.indexOf("await synchronizeSubscriber(admin, result.subscriber_id");
    expect(canonicalWrite).toBeGreaterThan(-1);
    expect(providerSync).toBeGreaterThan(canonicalWrite);
    expect(api).toContain("status: 'failed'");
    expect(api).toContain("resend_sync_error");
    expect(api).not.toContain("delete().eq('id', subscriberId)");
  });

  it("K/L/M: maps negative Resend signals fail-closed and makes webhook delivery idempotent", () => {
    expect(resendWebhookAction({ type: "contact.updated", data: { email: "a@example.com", unsubscribed: true } })).toMatchObject({ kind: "unsubscribe", email: "a@example.com" });
    expect(resendWebhookAction({ type: "contact.updated", data: { email: "a@example.com", unsubscribed: false } }).kind).toBe("ignore");
    expect(resendWebhookAction({ type: "email.bounced", data: { to: ["a@example.com"] } })).toMatchObject({ kind: "suppress", reason: "hard_bounce" });
    expect(resendWebhookAction({ type: "email.complained", data: { to: ["a@example.com"] } })).toMatchObject({ kind: "suppress", reason: "spam_complaint" });
    expect(resendWebhookAction({ type: "suppression.removed", data: { email: "a@example.com" } }).kind).toBe("ignore");
    expect(api).toContain("RESEND_COMMUNICATIONS_WEBHOOK_SECRET");
    expect(api).toContain("Math.abs(Date.now() / 1000 - timestampSeconds) > 300");
    expect(migration).toContain("UNIQUE (provider, provider_event_id)");
    expect(api).toContain("duplicate: true");
  });

  it("N: never converts the existing customer base or legacy boolean into subscribers", () => {
    expect(migration).toContain("does not copy customers.marketing_consent");
    expect(migration).not.toMatch(/INSERT INTO public\.communication_subscribers[\s\S]{0,500}FROM public\.customers/i);
    expect(migration).not.toContain("marketing_consent = true");
  });

  it("O/P: exposes no subscriber PII or provider secret in public artifacts/responses", () => {
    expect(api).toContain("return jsonResponse({ accepted: true })");
    expect(api).not.toContain("return jsonResponse({ accepted: true, email");
    expect(publicCapture).not.toContain("RESEND_API_KEY");
    expect(publicCapture).not.toContain("COMMUNICATION_UNSUBSCRIBE_SECRET");
    expect(migration).toContain("payload_sha256");
    expect(migration).not.toContain("raw_payload");
  });

  it("T: has no autonomous or UI mass-send capability", () => {
    expect(api).not.toContain("/broadcasts");
    expect(api).not.toContain("send: true");
    expect(admin).toContain("Broadcast är låst i Pickla V1");
    expect(admin).toContain("Inget massutskick kan startas här");
    expect(api).toContain("broadcast_send_available: false");
  });
});
