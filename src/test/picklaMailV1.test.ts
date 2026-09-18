import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { renderPicklaMailSignup } from "../../public-web/renderMailSignup";
import { htmlResponse } from "../../supabase/functions/_shared/cors";
import {
  createOpaqueConfirmationToken,
  createOpaqueUnsubscribeToken,
  hmacScopeHashes,
  isCanonicallyMarketingEligible,
  isTransactionalEmailAllowed,
  PICKLA_MAIL_POLICY_VERSION,
  PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT,
  publicSendModeAllows,
  proxyCredentialIsAuthorized,
  renderPicklaConfirmationEmail,
  resendWebhookAction,
  sha256Hex,
  verifyOpaqueConfirmationToken,
  verifyOpaqueUnsubscribeToken,
} from "../../supabase/functions/_shared/communications";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260918120000_pickla_mail_v1.sql");
const api = read("supabase/functions/api-communications/index.ts");
const publicCapture = read("public-web/renderMailSignup.ts");
const accountPreference = read("src/components/my/CommunicationPreference.tsx");
const admin = read("src/components/admin/AdminCommunications.tsx");
const vercel = JSON.parse(read("vercel.json"));
const testCurrentSecret = "current-key:test-only-confirmation-secret-000000000000";
const testOldSecret = "old-key:test-only-previous-secret-0000000000000000";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }
});

describe("Pickla Mail V1 double opt-in release contract", () => {
  it("renders the approved anonymous signup copy with unchecked explicit adult consent", () => {
    const html = renderPicklaMailSignup({ source: "public_web_root", endpoint: "/mail/subscribe" });
    const document = new DOMParser().parseFromString(html, "text/html");
    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    const consent = document.querySelector<HTMLInputElement>('input[name="consent"]');
    expect(html).toContain("STAY IN THE PICKLA LOOP");
    expect(html).not.toContain("Pickla Paper");
    expect(html).toContain("Events, community, new things we're building and the occasional story worth reading.");
    expect(html).toContain("JOIN PICKLA");
    expect(html).toContain("Check your inbox to confirm.");
    expect(html).toContain("For adults 18+");
    expect(email?.required).toBe(true);
    expect(consent?.required).toBe(true);
    expect(consent?.checked).toBe(false);
    expect(consent?.parentElement?.textContent).toContain(PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT);
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(html).toContain("@media(max-width:760px)");
    expect(html).toContain('audience:"adult_or_parent_guardian"');
    expect(html).toContain('fetch("/mail/subscribe"');
    expect(read("public-web/renderPage.ts")).toContain('renderPicklaMailSignup({ source: "public_web" })');
  });

  it("models pending, subscribed, unsubscribed, and suppressed as distinct canonical states", () => {
    expect(migration).toContain("'pending_confirmation', 'subscribed', 'unsubscribed', 'suppressed'");
    expect(migration).toContain("status IN ('pending_confirmation', 'subscribed', 'unsubscribed')");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.begin_communication_confirmation");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.confirm_communication_preference");
    expect(isCanonicallyMarketingEligible({
      marketingStatus: "pending_confirmation",
      preferenceStatus: "pending_confirmation",
      confirmedAt: null,
    })).toBe(false);
    expect(isCanonicallyMarketingEligible({
      marketingStatus: "subscribed",
      preferenceStatus: "subscribed",
      confirmedAt: "2026-09-18T12:00:00Z",
    })).toBe(true);
    expect(isCanonicallyMarketingEligible({
      marketingStatus: "suppressed",
      preferenceStatus: "subscribed",
      confirmedAt: "2026-09-18T12:00:00Z",
      suppressedAt: "2026-09-18T13:00:00Z",
    })).toBe(false);
  });

  it("keeps public submission pending and synchronizes Resend only after canonical confirmation", () => {
    const publicFlow = api.slice(api.indexOf("async function publicSubscribe"), api.indexOf("function confirmationHtml"));
    const confirmationFlow = api.slice(api.indexOf("async function confirmWithToken"), api.indexOf("async function matchingCustomerId"));
    expect(publicFlow).toContain("begin_communication_confirmation");
    expect(publicFlow).not.toContain("synchronizeSubscriber");
    expect(migration).toContain("'eligibility', 'pending_confirmation'");
    expect(api).toContain(".eq('confirmation_token_hash', tokenHash)");
    expect(confirmationFlow.indexOf("confirm_communication_preference")).toBeLessThan(
      confirmationFlow.indexOf("await synchronizeSubscriber"),
    );
    expect(migration).toContain("cp.confirmed_at IS NOT NULL");
  });

  it("uses an expiring opaque HMAC confirmation token with active/previous-key rotation", async () => {
    const oldRing = `${testOldSecret},${testCurrentSecret}`;
    const rotatedRing = `${testCurrentSecret},${testOldSecret}`;
    const nonce = new Uint8Array(32).fill(7);
    const created = await createOpaqueConfirmationToken(oldRing, { nowSeconds: 1_700_000_000, ttlSeconds: 900, nonce });
    expect(created.token).not.toContain("@");
    expect(created.token).not.toContain("customer");
    expect(await verifyOpaqueConfirmationToken(created.token, rotatedRing, 1_700_000_100)).toMatchObject({ kid: "old-key" });
    expect(await verifyOpaqueConfirmationToken(created.token, rotatedRing, 1_700_001_000)).toBeNull();
    expect(await verifyOpaqueConfirmationToken(`${created.token}x`, rotatedRing, 1_700_000_100)).toBeNull();
    expect(await sha256Hex(created.token)).toMatch(/^[0-9a-f]{64}$/);
    expect(migration).toContain("confirmation_token_hash");
    expect(migration).not.toContain("confirmation_token text");
  });

  it("encrypts unsubscribe identity and supports key rotation without login", async () => {
    const subscriberId = "74c5749e-b108-4c0a-9fb1-522ce949650b";
    const oldRing = `${testOldSecret},${testCurrentSecret}`;
    const rotatedRing = `${testCurrentSecret},${testOldSecret}`;
    const token = await createOpaqueUnsubscribeToken(subscriberId, oldRing, new Uint8Array(12).fill(9));
    expect(token).not.toContain(subscriberId);
    expect(token).not.toContain("@");
    expect(await verifyOpaqueUnsubscribeToken(token, rotatedRing)).toBe(subscriberId);
    expect(await verifyOpaqueUnsubscribeToken(`${token}x`, rotatedRing)).toBeNull();
    expect(await verifyOpaqueUnsubscribeToken(token, testCurrentSecret)).toBeNull();
    expect(api).toContain("COMMUNICATION_UNSUBSCRIBE_SECRETS");
    expect(api).toContain("['GET', 'POST'].includes(req.method) && path === 'unsubscribe'");
  });

  it("generates the approved concise confirmation email with plain text and HTML", () => {
    const email = renderPicklaConfirmationEmail("https://playpickla.com/mail/confirm?token=opaque");
    expect(email.subject).toBe("One more click and you're in 🥒");
    expect(email.text).toContain("Confirm that you want to hear from Pickla.");
    expect(email.text).toContain("YES, I'M IN");
    expect(email.html).toContain("YES, I'M IN");
    expect(email.html).not.toContain("tracking");
    expect(api).toContain("'Idempotency-Key': `pickla-confirm-");
    expect(api).toContain("tags: [{ name: 'category', value: 'confirm_email' }]");
  });

  it("serves confirmation HTML with the required actual response Content-Type", () => {
    const response = htmlResponse("<!doctype html><title>Pickla Mail</title>");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps canary mode fail-closed and requires server-side abuse controls", () => {
    expect(publicSendModeAllows("canary@example.test", "canary", "canary@example.test")).toBe(true);
    expect(publicSendModeAllows("other@example.test", "canary", "canary@example.test")).toBe(false);
    expect(publicSendModeAllows("other@example.test", "live", "")).toBe(true);
    expect(publicSendModeAllows("other@example.test", "unexpected", "")).toBe(false);
    expect(api).toContain("COMMUNICATION_SEND_MODE");
    expect(api).toContain("COMMUNICATION_CANARY_EMAILS");
    expect(api).toContain("COMMUNICATION_RATE_LIMIT_SECRETS");
    expect(api).toContain("sendMode === 'live' && !liveProxyGateIsReady(req)");
    expect(api).toContain("COMMUNICATION_PROXY_SECRETS");
    expect(api).toContain("public_subscribe_email");
    expect(api).toContain("public_subscribe_network");
    expect(api).toContain("confirm_network");
    expect(migration).toContain("CREATE TABLE public.communication_rate_limits");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.check_communication_rate_limit");
    expect(migration).toContain("raw email and IP values are never stored");
    expect(api).toContain("from: 'Pickla <hello@playpickla.com>'");
  });

  it("uses rotating rate-limit and origin-proxy key rings", async () => {
    const ring = `${testCurrentSecret},${testOldSecret}`;
    const hashes = await hmacScopeHashes("public_subscribe_network:203.0.113.7", ring);
    expect(hashes).toHaveLength(2);
    expect(new Set(hashes).size).toBe(2);
    expect(proxyCredentialIsAuthorized(testCurrentSecret, ring)).toBe(true);
    expect(proxyCredentialIsAuthorized(testOldSecret, ring)).toBe(true);
    expect(proxyCredentialIsAuthorized("retired-key:test-only-retired-secret-000000000000000", ring)).toBe(false);
    expect(proxyCredentialIsAuthorized(`${testCurrentSecret}x`, ring)).toBe(false);
  });

  it("requires verified account identity for My Page direct confirmation and surfaces pending state", () => {
    expect(api).toContain("email_confirmed_at");
    expect(api).toContain("matchingCustomerId(admin, organizationId, identity.userId, identity.email)");
    expect(migration).toContain("Customer identity does not match subscriber email");
    expect(migration).toContain("c.organization_id = p_organization_id");
    expect(accountPreference).toContain('"pending_confirmation"');
    expect(accountPreference).toContain('audience: "adult_or_parent_guardian"');
    expect(accountPreference).toContain("Väntar på bekräftelse via e-post");
    expect(api).toContain("PICKLA_MAIL_ACCOUNT_CONSENT_STATEMENT");
    expect(migration).toContain("'verified_account_preference'");
  });

  it("proves exact request and confirmation evidence before eligibility", () => {
    expect(PICKLA_MAIL_POLICY_VERSION).toBe("pickla-mail-v1-doi-2026-09-18");
    expect(PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT).toBe("Yes, send me Pickla news & community.");
    expect(migration).toContain("request_source");
    expect(migration).toContain("requested_at");
    expect(migration).toContain("request_policy_version");
    expect(migration).toContain("request_statement");
    expect(migration).toContain("request_notice");
    expect(migration).toContain("confirmation_source");
    expect(migration).toContain("confirmed_at");
    expect(migration).toContain("'confirmation_method', 'email_link'");
    expect(migration).toContain("GRANT SELECT, INSERT ON public.communication_consent_events TO service_role");
  });

  it("verifies Resend topic/domain/tracking safety before confirmation delivery or Contact sync", () => {
    expect(api).toContain("domain.open_tracking === false && domain.click_tracking === false");
    expect(api).toContain("topic.name === EXPECTED_RESEND_TOPIC_NAME");
    expect(api).toContain("topic.default_subscription === 'opt_out'");
    expect(api).toContain("topic.visibility === 'public'");
    expect(api).toContain("domain.status === 'verified'");
    expect(api).toContain("if (!setup.ready) throw new ResendSyncError");
    expect(api).toContain("Pickla <hello@playpickla.com>");
    expect(admin).toContain("Open/click tracking avstängt");
    expect(admin).toContain("Topic är publikt och default opt_out");
  });

  it("handles verified negative webhooks idempotently and distinguishes transient from permanent bounce", () => {
    expect(resendWebhookAction({ type: "contact.updated", data: { email: "a@example.com", unsubscribed: true } })).toMatchObject({ kind: "unsubscribe" });
    expect(resendWebhookAction({ type: "email.bounced", data: { to: ["a@example.com"], bounce: { type: "Transient" } } }).kind).toBe("observe");
    expect(resendWebhookAction({ type: "email.bounced", data: { to: ["a@example.com"], bounce: { type: "Permanent" } } })).toMatchObject({ kind: "suppress", reason: "hard_bounce" });
    expect(resendWebhookAction({ type: "email.complained", data: { to: ["a@example.com"] } })).toMatchObject({ kind: "suppress", reason: "spam_complaint" });
    expect(resendWebhookAction({ type: "suppression.removed", data: { email: "a@example.com" } }).kind).toBe("ignore");
    expect(api).toContain("RESEND_COMMUNICATIONS_WEBHOOK_SECRET");
    expect(api).toContain("Math.abs(Date.now() / 1000 - timestampSeconds) > 300");
    expect(migration).toContain("UNIQUE (provider, provider_event_id)");
    expect(migration).toContain("SET status = 'unsubscribed',\n          confirmation_token_hash = NULL");
    expect(api).toContain("duplicate: true");
  });

  it("shows pending, delivery, bounce, complaint, sync, tracking, and gate health to Pickla Admin", () => {
    expect(admin).toContain("pending_confirmations");
    expect(admin).toContain("confirmation_delivery_failures");
    expect(admin).toContain("bounces");
    expect(admin).toContain("complaints");
    expect(admin).toContain("sync_failures");
    expect(admin).toContain("WAF/rate-limit verifierad");
    expect(api).toContain("requireSuperAdmin(admin, auth.userId)");
    expect(api).toContain("waf_verified");
  });

  it("keeps minors outside direct marketing signup and migrates no existing customer", () => {
    expect(PICKLA_MAIL_PUBLIC_CONSENT_STATEMENT).not.toContain("child");
    expect(publicCapture).toContain("For adults 18+");
    expect(publicCapture).toContain("parent or guardian");
    expect(migration).toContain("does not copy customers.marketing_consent");
    expect(migration).not.toMatch(/INSERT INTO public\.communication_subscribers[\s\S]{0,500}FROM public\.customers/i);
    expect(migration).not.toContain("marketing_consent = true");
  });

  it("keeps necessary transactional email independent and exposes no public PII or provider secret", () => {
    expect(isTransactionalEmailAllowed()).toBe(true);
    expect(api).toContain("return jsonResponse({ accepted: true, confirmation_required: true }, 202)");
    expect(api).not.toContain("accepted: true, email");
    expect(publicCapture).not.toContain("RESEND_API_KEY");
    expect(publicCapture).not.toContain("COMMUNICATION_CONFIRMATION_SECRETS");
    expect(migration).toContain("payload_sha256");
    expect(migration).not.toContain("raw_payload");
  });

  it("routes branded confirmation safely and keeps all broadcast/autonomous send capability locked", () => {
    expect(vercel.headers).toContainEqual({
      source: "/mail/confirm",
      headers: [
        { key: "Content-Type", value: "text/html; charset=utf-8" },
        {
          key: "Content-Security-Policy",
          value: "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    });
    expect(vercel.rewrites).toContainEqual({
      source: "/mail/:action",
      destination: "/api/mail?action=:action",
    });
    expect(api).not.toContain("/broadcasts");
    expect(api).not.toContain("send: true");
    expect(admin).toContain("Broadcast är låst i Pickla V1");
    expect(api).toContain("broadcast_send_available: false");
  });
});
