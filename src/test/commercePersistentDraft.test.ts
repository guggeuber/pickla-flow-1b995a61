import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiGet: api.get,
  apiPost: api.post,
}));

import {
  clearCommerceDraftReference,
  createCommerceCart,
  readCommerceDraftReference,
  rememberCommerceDraftReference,
  resumeCommerceDraft,
} from "@/lib/commerce";

const apiCommerceSource = readFileSync(
  "supabase/functions/api-commerce/index.ts",
  "utf8",
);
const webhookSource = readFileSync(
  "supabase/functions/api-stripe-webhook/index.ts",
  "utf8",
);
const migrationSource = readFileSync(
  "supabase/migrations/20260720120000_commerce_v2_r1_persistent_order_draft_guest_participation.sql",
  "utf8",
);
const cartPageSource = readFileSync(
  "src/pages/CommerceCartPage.tsx",
  "utf8",
);
const programPageSource = readFileSync(
  "src/pages/ProgramSessionPage.tsx",
  "utf8",
);

describe("Commerce V2 R1 persistent order draft", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("persists only an opaque guest draft reference in session storage", () => {
    const reference = "D5yBrmRkOaG9Fn8cGf1m2D7vQh3sT9xKp4wZ6jL0nE8";

    rememberCommerceDraftReference(reference);

    expect(readCommerceDraftReference()).toBe(reference);
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem("pickla:commerce:draft-ref")).toBe(
      reference,
    );
    expect(JSON.stringify(window.sessionStorage)).not.toMatch(
      /email|phone|name|items|total/i,
    );
    expect(window.localStorage.length).toBe(0);
  });

  it("does not make a guest draft available in a separate browser session", () => {
    rememberCommerceDraftReference("session-one-reference");
    window.sessionStorage.clear();

    expect(readCommerceDraftReference()).toBe("");
  });

  it("sends the opaque reference when updating a guest draft without client totals", async () => {
    api.post.mockResolvedValue({ draft_ref: "same-reference" });

    await createCommerceCart({
      venueId: "venue-1",
      source: "activity_drawer",
      draftScope: "activity:session-1:2026-07-20",
      draftRef: "same-reference",
      items: [{ product_id: "participation-1", quantity: 1 }],
    });

    expect(api.post).toHaveBeenCalledWith("api-commerce", "cart", {
      venue_id: "venue-1",
      items: [{ product_id: "participation-1", quantity: 1 }],
      source: "activity_drawer",
      draft_scope: "activity:session-1:2026-07-20",
      draft_ref: "same-reference",
      guest_name: null,
      guest_email: null,
    });
    expect(JSON.stringify(api.post.mock.calls[0])).not.toMatch(
      /client_total|expected_total|amount_minor/,
    );
  });

  it("resumes authenticated drafts by venue and governed scope", async () => {
    api.get.mockResolvedValue({ order: { id: "order-1" }, lines: [] });

    await resumeCommerceDraft(
      "venue-1",
      "activity:session-1:2026-07-20",
    );

    expect(api.get).toHaveBeenCalledWith("api-commerce", "draft", {
      venueId: "venue-1",
      scope: "activity:session-1:2026-07-20",
    });
  });

  it("enforces non-colliding guest and authenticated ownership", () => {
    expect(apiCommerceSource).toContain(
      "userId\n      ? order.user_id === userId\n      : order.user_id === null",
    );
    expect(apiCommerceSource).toContain(
      "candidate.venue_id === venueId && candidate.draft_scope === draftScope",
    );
    expect(migrationSource).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_orders_active_user_draft",
    );
    expect(migrationSource).toContain(
      "ON public.commerce_orders (venue_id, user_id, draft_scope)",
    );
  });

  it("uses the resolved server total and exposes no private order fields", () => {
    expect(cartPageSource).toContain(
      "resolveQuery.data?.order.total_inc_vat_minor",
    );
    expect(cartPageSource).not.toMatch(
      /lines\.reduce|unit_price_minor \|\| 0\) \* Number\(line\.quantity/,
    );

    const projectionStart = apiCommerceSource.indexOf(
      "function projectCommerceOrder",
    );
    const projectionEnd = apiCommerceSource.indexOf(
      "function resolvedOrderSummary",
      projectionStart,
    );
    const projection = apiCommerceSource.slice(projectionStart, projectionEnd);
    expect(projection).not.toMatch(
      /\bguest_(?:name|email|phone)\s*:|\bmetadata\s*:|auth_user_id|internal_notes/,
    );
    const receiptStart = apiCommerceSource.indexOf("function projectReceipt");
    const receiptEnd = apiCommerceSource.indexOf(
      "function resolvedOrderSummary",
      receiptStart,
    );
    const receiptProjection = apiCommerceSource.slice(
      receiptStart,
      receiptEnd,
    );
    expect(receiptProjection).not.toMatch(
      /customer_(?:name|email|phone)|personal_identity_number|metadata/,
    );
  });

  it("keeps guest participation open while preserving the legacy auth fallback", () => {
    const commerceStart = programPageSource.indexOf(
      "if (commercePilotEnabled && commerceParticipationProduct)",
    );
    const legacyAuthFallback = programPageSource.indexOf(
      "if (!user?.id)",
      commerceStart,
    );
    const commerceReturn = programPageSource.indexOf("return;", commerceStart);

    expect(commerceStart).toBeGreaterThan(-1);
    expect(commerceReturn).toBeGreaterThan(commerceStart);
    expect(legacyAuthFallback).toBeGreaterThan(commerceReturn);
    expect(cartPageSource).not.toMatch(
      /Logga in för att boka plats|preserveIntendedRoute|navigate\("\/auth/,
    );
  });

  it("makes guest registration and ticket replay-safe without public RPC access", () => {
    expect(migrationSource).toContain(
      "ALTER COLUMN user_id DROP NOT NULL",
    );
    expect(migrationSource).toContain(
      "idx_session_registrations_commerce_source_once",
    );
    expect(migrationSource).toContain(
      "idx_access_entitlements_source_customer_once",
    );
    expect(migrationSource).toContain(
      "FROM PUBLIC, anon, authenticated",
    );
    expect(migrationSource).toContain("TO service_role");
    expect(webhookSource).toContain(
      "if (!order.user_id && !customerId) throw new Error('Commerce participation has no owner')",
    );
    expect(webhookSource).toContain("customer_id: customerId");
    expect(webhookSource).toContain(
      "'source_type,source_id,customer_id,entitlement_type'",
    );
  });

  it("supports explicit revocation of an unguessable guest draft", () => {
    expect(apiCommerceSource).toContain(
      "if (req.method === 'DELETE' && path === 'draft')",
    );
    expect(apiCommerceSource).toContain("status: 'expired'");
    expect(apiCommerceSource).toContain("const CART_TOKEN_BYTES = 32");

    rememberCommerceDraftReference("revoked-reference");
    clearCommerceDraftReference();
    expect(readCommerceDraftReference()).toBe("");
  });
});
