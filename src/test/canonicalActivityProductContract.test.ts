import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityTicketProductFields } from "@/lib/adminCommerce";
import { isCanonicalActivityProduct } from "@/lib/adminProductCatalog";

const accessProductsMigration = readFileSync("supabase/migrations_archive/production-pre-baseline/20260511160000_access_products.sql", "utf8");
const cancellationMigration = readFileSync("supabase/migrations/20260922120000_cancellation_policy_v1.sql", "utf8");
const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const membershipsApi = readFileSync("supabase/functions/api-memberships/index.ts", "utf8");
const schedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");
const pricingResolver = readFileSync("supabase/functions/_shared/activity_pricing.ts", "utf8");

describe("canonical activity product contract", () => {
  it("proves Open Play and Gruppträning already share the access_products session-ticket model", () => {
    expect(accessProductsMigration).toMatch(/'open_play_slot'[\s\S]*?'session_ticket'[\s\S]*?'open_play'[\s\S]*?165[\s\S]*?6[\s\S]*?"entitlement_type": "session_ticket"/);
    expect(accessProductsMigration).toMatch(/'group_training'[\s\S]*?'Gruppträning'[\s\S]*?'session_ticket'[\s\S]*?'group_training'[\s\S]*?195[\s\S]*?6/);
  });

  it("builds a new service with the same canonical fields instead of a second product model", () => {
    expect(activityTicketProductFields("group_training")).toEqual({
      product_kind: "session_ticket",
      session_type: "group_training",
      commerce_kind: "participation",
      fulfillment_presentation: "participation",
      inventory_policy: "stockless",
      standalone_enabled: false,
      activity_addon_enabled: false,
      grants: {
        entitlement_type: "session_ticket",
        includes_session_types: ["group_training"],
      },
    });
  });

  it("offers only active canonical participation products for a matching activity type", () => {
    const singeltraning = {
      product_key: "singeltraning",
      product_kind: "session_ticket",
      commerce_kind: "participation",
      fulfillment_type: "participation",
      session_type: "group_training",
      status: "active",
      is_active: true,
    };
    expect(isCanonicalActivityProduct(singeltraning, "group_training")).toBe(true);
    expect(isCanonicalActivityProduct(singeltraning, "open_play")).toBe(false);
    expect(isCanonicalActivityProduct({ ...singeltraning, commerce_kind: "merchandise" }, "group_training")).toBe(false);
    expect(schedule).toContain("isCanonicalActivityProduct(product, sessionType)");
    expect(schedule).not.toContain('["open_play_slot", "group_training", "day_access", "event_fee"].includes');
  });

  it("validates the selected product against access_products and preserves its product_key", () => {
    expect(adminApi).toContain("async function validateActivitySessionProduct");
    expect(adminApi).toContain(".from('access_products')");
    expect(adminApi).toContain(": next.product_key || productKeyForActivityTicket(sessionType)");
    expect(adminApi).not.toContain("!['open_play_slot', 'group_training', 'day_access', 'event_fee'].includes");
  });

  it("reuses canonical membership pricing and the occurrence-ticket Standard 12h authority", () => {
    expect(pricingResolver).toContain(".from('membership_tier_pricing')");
    expect(pricingResolver).toContain(".eq('product_type', productKey)");
    expect(membershipsApi).toContain("allowDraftProduct: allow_draft_product === true");
    expect(cancellationMigration).toContain("('occurrence_ticket', 'occurrence_ticket', 'standard_12h')");
  });
});
