import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260731100000_atomic_activity_pricing_holds.sql", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const pricingResolver = readFileSync("supabase/functions/_shared/activity_pricing.ts", "utf8");

describe("Commerce Early-Bird atomic allocation contract", () => {
  it("serializes capacity and scarce-price allocation on the activity occurrence", () => {
    expect(migration).toContain("capacity_lock_scope");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("applied_price_type");
    expect(migration).toContain("early_bird_remaining");
    expect(migration).toContain("quote_changed");
  });

  it("counts only committed awards and active non-expired awarded holds", () => {
    expect(migration).toContain("sr.status IN ('confirmed', 'checked_in', 'no_show')");
    expect(migration).toContain("sr.metadata->>'pricing_reason' = 'early_bird'");
    expect(migration).toContain("ch.status = 'active'");
    expect(migration).toContain("ch.expires_at > now()");
    expect(migration).toContain("lazy_expired_before_pricing_acquire");
  });

  it("resolves membership precedence before the atomic scarcity award", () => {
    expect(pricingResolver).toContain("applyEarlyBird = true");
    expect(commerceApi).toContain("{ applyEarlyBird: false }");
    expect(commerceApi).toContain("p_regular_price_minor");
    expect(commerceApi).toContain("p_regular_price_type");
  });

  it("never silently accepts a changed checkout quote", () => {
    expect(commerceApi).toContain("commerce_quote_changed");
    expect(commerceApi).toContain("Priset uppdaterades medan du gick till kassan");
    expect(commerceApi).toContain("quote_changed: true");
  });
});
