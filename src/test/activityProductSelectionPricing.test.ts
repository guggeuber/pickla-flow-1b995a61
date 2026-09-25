import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityInclusionPolicy } from "../../supabase/functions/_shared/activity_inclusion_policy";
import { activityPricingProductKey, resolveActivityPricingDecision } from "../../supabase/functions/_shared/activity_pricing";
import { activityPriceLabels, mergeBackendActivityPricing } from "../lib/activityPricing";

const venueId = "venue-1";
const sessionDate = "2026-10-02";

function pricingClient({ dayAccess = false, membership = false, unlimited = false, explicitPrice, tierName }: {
  dayAccess?: boolean;
  membership?: boolean;
  unlimited?: boolean;
  explicitPrice?: number;
  tierName?: string;
} = {}) {
  const rows: Record<string, unknown> = {
    activity_session_hosts: { data: null, error: null },
    access_entitlements: { data: dayAccess ? { id: "day-access-1", funder: "customer" } : null, error: null },
    memberships: { data: membership ? { id: "membership-1", tier_id: "tier-1", venue_id: venueId } : null, error: null },
    membership_entitlements: { data: unlimited ? [{ entitlement_type: "open_play_unlimited", value: 1, sport_type: "pickleball" }] : [], error: null },
    membership_tiers: { data: { name: tierName || (unlimited ? "Play+" : "Play"), discount_percent: 40 }, error: null },
    membership_tier_pricing: { data: explicitPrice == null ? [] : [{ product_type: "studentpris", fixed_price: explicitPrice }], error: null },
  };
  return {
    from(table: string) {
      const result = rows[table] || { data: null, error: null };
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) query[method] = () => query;
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return query;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

function session(productKey: string, policy: Record<string, unknown>, metadata: Record<string, unknown>) {
  return {
    id: "session-1", venue_id: venueId, session_type: "open_play", product_key: productKey,
    session_date: sessionDate, start_time: "18:00", end_time: "19:00", price_sek: productKey === "studentpris" ? 59 : 165,
    capacity: 16, access_policy: policy, metadata, scarcity_mode: "none", first_visit_offer_enabled: false,
  };
}

async function priceFor(savedSession: ReturnType<typeof session>, options: Parameters<typeof pricingClient>[0] = {}) {
  const productKey = savedSession.product_key;
  const productCache = new Map([[`${venueId}:${productKey}`, Promise.resolve({
    product_key: productKey, product_kind: "session_ticket", base_price_sek: savedSession.price_sek,
    session_type: "open_play",
  })]]);
  return resolveActivityPricingDecision({
    client: pricingClient(options), venueId, userId: options?.membership || options?.dayAccess ? "user-1" : null,
    customerId: options?.membership || options?.dayAccess ? "customer-1" : null,
    activitySessionId: savedSession.id, sessionDate, requestedProductKey: productKey,
    session: savedSession, productCache,
  });
}

describe("canonical activity product pricing", () => {
  it("preserves Studentpris on Admin save and reload instead of substituting the Open Play product", () => {
    const admin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
    const schedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");
    const commerce = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
    expect(admin).toContain(": next.product_key || productKeyForActivityTicket(sessionType)");
    expect(admin).toContain("validateActivitySessionProduct(admin, venueId, draft)");
    expect(schedule).toContain("product_key: config.product_key");
    expect(schedule).toContain("online_price_sek: nextBasePrice");
    expect(schedule).toContain("setPrice(selectedBasePrice)");
    expect(schedule).toContain("day_pass_included: includedInDayPass");
    expect(schedule).toContain("membership_included: includedInUnlimited");
    expect(commerce).toContain("const decision = await resolveScopeAwarePricingDecision({");
    expect(commerce).toContain("unitPriceMinor = Math.round(Number(decision.finalAmountSek || 0) * 100)");
    const reloaded = session("studentpris", { allows_day_access: false, member_benefit_key: null }, {
      online_price_sek: 59, day_pass_included: true, membership_included: true,
    });
    expect(activityPricingProductKey({ session: reloaded })).toBe("studentpris");
    expect(activityInclusionPolicy(reloaded)).toEqual({ dayPassIncluded: false, membershipIncluded: false });
    expect(activityInclusionPolicy({ ...reloaded, access_policy: {} })).toEqual({ dayPassIncluded: false, membershipIncluded: false });
  });

  it("charges 59 SEK for non-member, Play, Play+ and Founder with both inclusions OFF", async () => {
    const saved = session("studentpris", { allows_day_access: false, member_benefit_key: null }, {
      online_price_sek: 59, day_pass_included: true, membership_included: true,
    });
    for (const [name, options] of Object.entries({
      nonMember: {}, Play: { membership: true, tierName: "Play" }, PlayPlus: { membership: true, unlimited: true, tierName: "Play+" },
      Founder: { membership: true, unlimited: true, dayAccess: true, tierName: "Founder" },
    })) {
      const decision = await priceFor(saved, options);
      expect(decision.productKey, name).toBe("studentpris");
      expect(decision.finalAmountSek, name).toBe(59);
      expect(decision.requiresCheckout, name).toBe(true);
      if (options.membership) expect(decision.membershipTierName, name).toBe(options.tierName);
      expect(decision.debug.day_pass_included, name).toBe(false);
      expect(decision.debug.membership_included, name).toBe(false);
      const labels = mergeBackendActivityPricing(activityPriceLabels({
        basePrice: 59, productKey: "studentpris", sessionType: "open_play",
        membership: options.membership ? { id: "membership-1", membership_tiers: { name } } : null,
        hasDayAccess: Boolean(options.dayAccess), dayPassIncluded: false, membershipIncluded: false,
      }), decision);
      expect(labels.finalPrice, name).toBe(59);
      expect(labels.checkoutLabel, name).toBe("59 kr");
      expect(labels.includedLabel, name).toBeNull();
    }
  });

  it("allows only an explicit Studentpris product pricing rule to change a member price", async () => {
    const saved = session("studentpris", { allows_day_access: false, member_benefit_key: null }, { online_price_sek: 59 });
    const decision = await priceFor(saved, { membership: true, explicitPrice: 49 });
    expect(decision.finalAmountSek).toBe(49);
    expect(decision.pricingReason).toBe("membership_tier_pricing");
    const labels = mergeBackendActivityPricing(activityPriceLabels({
      basePrice: 59, productKey: "studentpris", sessionType: "open_play",
      membership: { id: "membership-1", tier_pricing: [{ product_type: "studentpris", fixed_price: 49 }] },
      dayPassIncluded: false, membershipIncluded: false,
    }), decision);
    expect(labels.checkoutLabel).toBe("49 kr");
  });

  it("keeps normal Open Play inclusion for its canonical product", async () => {
    const saved = session("open_play_slot", { allows_day_access: true, member_benefit_key: "open_play_unlimited" }, {
      online_price_sek: 165, day_pass_included: false, membership_included: false,
    });
    expect(activityInclusionPolicy(saved)).toEqual({ dayPassIncluded: true, membershipIncluded: true });
    const playPlus = await priceFor(saved, { membership: true, unlimited: true });
    expect(playPlus.finalAmountSek).toBe(0);
    expect(playPlus.accessDecision).toBe("membership_included");
    const play = await priceFor(saved, { membership: true });
    expect(play.finalAmountSek).toBe(99);
    expect(play.pricingReason).toBe("membership_tier_discount_percent");
    const dayPass = await priceFor(saved, { dayAccess: true });
    expect(dayPass.finalAmountSek).toBe(0);
    expect(dayPass.accessDecision).toBe("day_access_included");
  });
});
