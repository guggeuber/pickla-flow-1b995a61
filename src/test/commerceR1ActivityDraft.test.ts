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
  activityCommerceDraftScope,
  activityCommerceSelectionKey,
  createCommerceCart,
  isCommerceOrderIdReference,
  readActivityCommerceSelection,
  resumeCommerceActivityDraft,
  writeActivityCommerceSelection,
} from "@/lib/commerce";

const programSource = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const drawerSource = readFileSync("src/components/session/SessionDrawerShell.tsx", "utf8");
const commerceApiSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const migrationSource = readFileSync(
  "supabase/migrations/20260728190000_commerce_r1_activity_drafts.sql",
  "utf8",
);

describe("Commerce R1 activity draft", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    window.sessionStorage.clear();
  });

  it("keeps activity quantities across navigation without storing prices or personal data", () => {
    const key = activityCommerceSelectionKey("session-1", "2026-07-29");

    writeActivityCommerceSelection(key, {
      racket: 1,
      balls: 2,
      removed: 0,
      excessive: 99,
    });

    expect(readActivityCommerceSelection(key)).toEqual({
      racket: 1,
      balls: 2,
      excessive: 20,
    });
    expect(window.sessionStorage.getItem(key)).not.toMatch(/price|total|email|name/i);
  });

  it("sends the canonical scope and product quantities without client totals", async () => {
    api.post.mockResolvedValue({ cart_token: "order-reference" });
    const scope = activityCommerceDraftScope("session-1", "2026-07-29");

    await createCommerceCart({
      venueId: "venue-1",
      source: "activity_drawer",
      draftScope: scope,
      items: [
        { product_id: "participation", quantity: 1, activity_session_id: "session-1", session_date: "2026-07-29" },
        { product_id: "racket", quantity: 2, parent_product_id: "participation" },
      ],
    });

    expect(api.post).toHaveBeenCalledWith("api-commerce", "cart", expect.objectContaining({
      draft_scope: scope,
      items: expect.arrayContaining([expect.objectContaining({ product_id: "racket", quantity: 2 })]),
    }));
    expect(JSON.stringify(api.post.mock.calls[0])).not.toMatch(/client_total|expected_total|amount_minor/);
  });

  it("treats a missing draft as an empty state but preserves other failures", async () => {
    api.get.mockRejectedValueOnce(Object.assign(new Error("Cart not found"), { status: 404 }));
    await expect(resumeCommerceActivityDraft("venue-1", "activity:session-1:2026-07-29")).resolves.toBeNull();

    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    api.get.mockRejectedValueOnce(authError);
    await expect(resumeCommerceActivityDraft("venue-1", "activity:session-1:2026-07-29")).rejects.toBe(authError);
  });

  it("distinguishes authenticated order references from possession tokens", () => {
    expect(isCommerceOrderIdReference("258e1eaf-765c-4c40-be4b-ab02bebca2e8")).toBe(true);
    expect(isCommerceOrderIdReference("opaque-cart-token-that-is-long-enough")).toBe(false);
  });

  it("keeps server pricing authority while adding one authenticated activity draft", () => {
    expect(commerceApiSource).toContain("if (req.method === 'GET' && path === 'draft')");
    expect(commerceApiSource).toContain("suppliedDraftScope !== canonicalDraftScope");
    expect(commerceApiSource).toContain("resolveOrCreateGuestCustomerByEmail");
    expect(commerceApiSource).toContain("if (suppliedDraftScope && !userId)");
    expect(commerceApiSource).toContain("resolveActivityPricingDecision");
    expect(migrationSource).toContain("idx_commerce_orders_active_activity_draft");
    expect(migrationSource).toContain("draft_scope LIKE 'activity:%'");
    expect(migrationSource).not.toContain("ALTER COLUMN user_id DROP NOT NULL");
    expect(migrationSource).not.toContain("access_entitlements");
  });

  it("uses purchase-first controls without an empty or competing social container", () => {
    expect(programSource).toContain('data-testid="commerce-addons"');
    expect(programSource).toContain('aria-label={`Öka ${product.name}`}');
    expect(programSource).toContain('data-testid="commerce-live-total"');
    expect(programSource).toContain("commerceCatalog.isSuccess && commerceExtras.length > 0");
    expect(programSource).not.toContain('label: "Intresserad"');
    expect(programSource).toContain("Chatt");
    expect(programSource).toContain("Dela");
    expect(programSource).toContain('aria-label="Chatt"');
    expect(programSource).toContain('aria-label="Dela"');
    expect(programSource).toContain('headerActions={');
    expect(programSource).toContain("fixedFooter");
    expect(programSource).not.toContain('aria-label="Aktivitetsalternativ"');
    expect(programSource).toContain('showInvitation={purchaseMode}');
    expect(programSource).toContain("authLoading || loading || queueLoading || checkinLoading || pricingPending");
    expect(programSource).toContain('Medlem? Logga in för ditt pris');
    expect(programSource).toContain('Gäller detta pass.');
    expect(programSource).toContain('Alla Open Play-pass idag.');
    expect(programSource).toContain('`Fortsätt · ${formatCommerceMoney(commerceTotalMinor)}`');
    expect(programSource).not.toContain('"Häng på"');
    expect(programSource).not.toContain('"Köp plats"');
  });

  it("keeps the pinned controls outside the scroll viewport with iOS safe-area padding", () => {
    expect(drawerSource).toContain('data-testid="session-fixed-action"');
    expect(drawerSource).toContain('fixedFooter ? "absolute inset-x-0 bottom-0"');
    expect(drawerSource).toContain('"z-20 border-t border-neutral-200');
    expect(drawerSource).toContain("overflow-y-auto overscroll-contain");
    expect(drawerSource).toContain("pb-[calc(92px+env(safe-area-inset-bottom,0px)+24px)]");
    expect(drawerSource).toContain("env(safe-area-inset-bottom,0px)");
    expect(drawerSource).toContain('data-testid="session-header-actions"');
    expect(drawerSource).toContain("[&>div:first-child]:hidden");
    expect(drawerSource).toContain("overflow-clip");
  });
});
