import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiGet: api.get,
  apiPost: api.post,
  apiPut: api.put,
}));

import {
  clearStandaloneCartIdentity,
  createCommerceCart,
  readStandaloneCartIdentity,
  standaloneCartStorageKey,
  updateCommerceCart,
  writeStandaloneCartIdentity,
} from "@/lib/commerce";

const venueId = "c2d00000-0000-4000-8000-000000000001";

describe("Commerce R1B standalone cart", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
  });

  it("persists one guest bearer/idempotency identity and promotes it deterministically after login", () => {
    const guest = readStandaloneCartIdentity(venueId, null);
    expect(guest.owner).toBe("guest");
    expect(guest.idempotencyKey.length).toBeGreaterThanOrEqual(32);

    writeStandaloneCartIdentity(venueId, { ...guest, reference: guest.idempotencyKey });
    expect(readStandaloneCartIdentity(venueId, null)).toEqual({ ...guest, reference: guest.idempotencyKey });
    expect(readStandaloneCartIdentity(venueId, "user-1").reference).toBe(guest.idempotencyKey);

    clearStandaloneCartIdentity(venueId);
    expect(window.localStorage.getItem(standaloneCartStorageKey(venueId))).toBeNull();
  });

  it("sends the explicit shop scope/idempotency key and supports zero-item PUT", async () => {
    api.post.mockResolvedValue({ order: { id: "order-1" }, lines: [] });
    api.put.mockResolvedValue({ order: { id: "order-1", version: 3 }, lines: [] });
    await createCommerceCart({
      venueId,
      source: "commerce_shop",
      draftScope: "shop",
      idempotencyKey: "a".repeat(64),
      items: [],
    }, { auth: "omit" });
    expect(api.post).toHaveBeenCalledWith("api-commerce", "cart", expect.objectContaining({
      venue_id: venueId,
      draft_scope: "shop",
      idempotency_key: "a".repeat(64),
      items: [],
    }), { auth: "omit" });

    await updateCommerceCart({ reference: "a".repeat(64), expectedVersion: 2, items: [] }, { auth: "omit" });
    expect(api.put).toHaveBeenCalledWith("api-commerce", "cart", expect.objectContaining({
      token: "a".repeat(64),
      expected_version: 2,
      items: [],
    }), { auth: "omit" });
  });

  it("keeps the approved UI and backend contracts in their isolated surfaces", () => {
    const shop = readFileSync("src/pages/CommerceShopPage.tsx", "utf8");
    const cart = readFileSync("src/pages/CommerceCartPage.tsx", "utf8");
    const nav = readFileSync("src/components/PicklaTopBar.tsx", "utf8");
    const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");
    const desk = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
    const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
    const migration = readFileSync("supabase/migrations/20260803120000_commerce_r1b_standalone_shop_carts.sql", "utf8");

    expect(nav).toContain("Butik");
    expect(shop).toContain("useStandaloneShopCart");
    expect(cart).toContain("Din varukorg");
    expect(cart).toContain("Till kassan ·");
    expect(cart).not.toMatch(/Varav moms|Moms ingår/);
    expect(myPage).toContain("Hämtas vid disken. · Order");
    expect(myPage).toContain("Visa tidigare bokningar");
    expect(desk).toContain('role="checkbox"');
    expect(desk).toContain("customer_name");
    expect(commerceApi).toContain("product_id: product.id");
    expect(migration).toContain("idx_commerce_orders_active_shop_user_draft");
    expect(migration).toContain("idx_commerce_orders_active_shop_guest_draft");
    expect(migration).toContain("IF v_before.fulfillment_status = 'collected'");
  });
});
