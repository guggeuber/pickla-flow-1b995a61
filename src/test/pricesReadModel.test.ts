import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  loadPublicPrices,
  type PublicPricesRpcClient,
} from "../../supabase/functions/_shared/public_prices";

const read = (path: string) => readFileSync(path, "utf8");

function membership(index: number) {
  return {
    id: `membership-${index}`,
    name: `Membership ${index}`,
    description: `Benefit ${index}`,
    monthly_price: 199 + index,
    internal_entitlements: ["must-not-escape"],
  };
}

function product(index: number) {
  return {
    id: `product-${index}`,
    product_key: index === 0 ? "day_access" : `event-${index}`,
    product_kind: "day_access",
    name: `Day pass ${index}`,
    description: "Internal upsell copy",
    commerce_kind: "participation",
    fulfillment_type: "participation",
    fulfillment_presentation: "participation",
    base_price_sek: 199 + index,
    vat_rate: 6,
    status: "active",
    is_active: true,
    standalone_enabled: false,
    activity_addon_enabled: false,
    category: null,
    has_active_relationship: false,
  };
}

function activityFact(overrides: {
  session?: Record<string, unknown>;
  product?: Record<string, unknown> | null;
  capacity_fill?: Record<string, unknown>;
  early_bird_fill?: Record<string, unknown>;
} = {}) {
  return {
    session: {
      id: "session-1",
      venue_id: "venue-1",
      name: "Open Play FM",
      session_type: "open_play",
      session_date: null,
      start_time: "10:00:00",
      end_time: "12:00:00",
      capacity: 40,
      price_sek: 165,
      product_key: "open_play_slot",
      access_policy: {},
      metadata: { online_price_sek: 165, pricing_channel_mode: "standard" },
      early_bird_price_minor: null,
      early_bird_slots: null,
      scarcity_mode: "none",
      first_visit_offer_enabled: false,
      first_visit_price_minor: null,
      first_visit_only: true,
      ...overrides.session,
    },
    session_date: "2026-09-01",
    resolved_product_key: "open_play_slot",
    product: overrides.product === undefined ? {
      id: "activity-product-1",
      venue_id: "venue-1",
      product_key: "open_play_slot",
      product_kind: "session_ticket",
      base_price_sek: 0,
      early_bird_price_minor: null,
      early_bird_slots: null,
      scarcity_mode: "none",
    } : overrides.product,
    capacity_fill: overrides.capacity_fill || { fill_count: 0 },
    early_bird_fill: overrides.early_bird_fill || { fill_count: 0 },
  };
}

function facts(itemCount: number) {
  return {
    input_valid: true,
    venue_found: true,
    venue_id: "venue-1",
    commerce_enabled: true,
    memberships: Array.from({ length: itemCount }, (_, index) => membership(index)),
    court_pricing: [{
      id: "court-1",
      name: "Förmiddag låg",
      type: "hourly",
      price: 295,
      days_of_week: [1, 2, 3, 4, 5],
      time_from: "10:00:00",
      time_to: "12:00:00",
    }],
    commerce_candidates: Array.from({ length: itemCount }, (_, index) => product(index)),
    courses: Array.from({ length: itemCount }, (_, index) => ({
      id: `course-${index}`,
      name: `Course ${index}`,
      description: `Course copy ${index}`,
      base_price_sek: 795 + index,
      coach: { display_name: "Must not escape" },
    })),
    has_configured_first_visit_offer: false,
    first_visit_fallback_occurrence: activityFact(),
    first_visit_occurrences: [],
  };
}

function rpcClient(payload: unknown) {
  const rpc = vi.fn(async () => ({ data: payload, error: null }));
  return { client: { rpc } as unknown as PublicPricesRpcClient, rpc };
}

describe("public Prices read model", () => {
  it.each([1, 5, 20])("uses exactly one remote RPC for %i catalog items", async (count) => {
    const { client, rpc } = rpcClient(facts(count));

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
      asOf: "2026-08-31T08:00:00.000Z",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected Prices result");
    expect(result.data.memberships).toHaveLength(count);
    expect(result.data.day_passes).toHaveLength(count);
    expect(result.data.courses).toHaveLength(count);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("public_customer_prices_facts", {
      p_venue_slug: "pickla-arena-sthlm",
      p_start_date: "2026-08-31",
      p_end_date: "2026-09-06",
      p_as_of: "2026-08-31T08:00:00.000Z",
    });
  });

  it("returns the exact minimal public presentation and strips internal fields", async () => {
    const { client } = rpcClient(facts(1));

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        memberships: [{
          id: "membership-0",
          name: "Membership 0",
          description: "Benefit 0",
          monthly_price: 199,
        }],
        court_pricing: [{ price: 295, type: "hourly" }],
        day_passes: [{
          id: "product-0",
          name: "Day pass 0",
          description: "Spela Open Play hela dagen.",
          base_price_sek: 199,
        }],
        punch_cards: [],
        courses: [{
          id: "course-0",
          name: "Course 0",
          description: "Course copy 0",
          base_price_sek: 795,
        }],
        first_visit: {
          available: true,
          title: "Första gången? 165 kr, racket ingår — kom på Open Play ikväll.",
          description: null,
          public_price_sek: 165,
          route: "/today?v=pickla-arena-sthlm",
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/internal_entitlements|coach|auth|customer|payer|stripe|order|membership_id/i);
  });

  it("uses the standard occurrence price when the product template is zero", async () => {
    const { client } = rpcClient(facts(1));

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: { first_visit: { available: true, public_price_sek: 165 } },
    });
  });

  it("preserves an authoritative free standard occurrence as zero", async () => {
    const payload = {
      ...facts(1),
      first_visit_fallback_occurrence: activityFact({
        session: { price_sek: 0, metadata: { online_price_sek: 0, pricing_channel_mode: "standard" } },
      }),
    };
    const { client } = rpcClient(payload);

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        first_visit: {
          available: true,
          title: "Första gången? 0 kr, racket ingår — kom på Open Play ikväll.",
          public_price_sek: 0,
        },
      },
    });
  });

  it("uses the canonical First Visit resolver for configured public presentation", async () => {
    const payload = {
      ...facts(1),
      has_configured_first_visit_offer: true,
      first_visit_occurrences: [activityFact({
        session: {
          name: "Open Play",
          first_visit_offer_enabled: true,
          first_visit_price_minor: 9900,
          first_visit_only: false,
        },
      })],
    };
    const { client, rpc } = rpcClient(payload);

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
      asOf: "2026-08-31T08:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        first_visit: {
          available: true,
          title: "Första gången? Spela för 99 kr.",
          description: "Racket finns att låna.",
          public_price_sek: 99,
          route: "/program/session-1?date=2026-09-01&v=pickla-arena-sthlm",
        },
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves Early Bird precedence over a configured First Visit offer", async () => {
    const payload = {
      ...facts(1),
      has_configured_first_visit_offer: true,
      first_visit_occurrences: [activityFact({
        session: {
          first_visit_offer_enabled: true,
          first_visit_price_minor: 9900,
          scarcity_mode: "early_bird",
          early_bird_price_minor: 7900,
          early_bird_slots: 2,
        },
      })],
    };
    const { client } = rpcClient(payload);

    const result = await loadPublicPrices(client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: { first_visit: { available: false, public_price_sek: null } },
    });
  });

  it("uses a session price without a product and does not invent a missing fallback", async () => {
    const missingProduct = rpcClient({
      ...facts(1),
      first_visit_fallback_occurrence: activityFact({ product: null }),
    });
    const missingFallback = rpcClient({
      ...facts(1),
      first_visit_fallback_occurrence: null,
    });
    const input = {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    };

    await expect(loadPublicPrices(missingProduct.client, input)).resolves.toMatchObject({
      kind: "ok",
      data: { first_visit: { available: true, public_price_sek: 165 } },
    });
    await expect(loadPublicPrices(missingFallback.client, input)).resolves.toMatchObject({
      kind: "ok",
      data: { first_visit: { available: false, public_price_sek: null } },
    });
  });

  it("fails closed on malformed facts and distinguishes invalid input from unknown venue", async () => {
    const invalid = rpcClient({ input_valid: false });
    const missing = rpcClient({ input_valid: true, venue_found: false });
    const malformed = rpcClient({ ...facts(1), memberships: [{ id: "bad" }] });
    const malformedFallback = rpcClient({ ...facts(1), first_visit_fallback_occurrence: {} });

    await expect(loadPublicPrices(invalid.client, {
      venueSlug: "bad",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    })).resolves.toEqual({ kind: "invalid_input" });
    await expect(loadPublicPrices(missing.client, {
      venueSlug: "missing",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    })).resolves.toEqual({ kind: "venue_not_found" });
    await expect(loadPublicPrices(malformed.client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    })).rejects.toThrow("Prices projection unavailable");
    await expect(loadPublicPrices(malformedFallback.client, {
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    })).rejects.toThrow("Prices projection unavailable");
  });
});

describe("Prices SQL and API contracts", () => {
  const appliedMigration = read("supabase/migrations/20260831120000_public_customer_prices_facts.sql");
  const migration = read("supabase/migrations/20260831130000_public_customer_prices_first_visit_parity.sql");
  const projection = read("supabase/functions/_shared/public_prices.ts");
  const endpoint = read("supabase/functions/api-event-public/index.ts");
  const browser = read("src/lib/publicPrices.ts");
  const page = read("src/pages/PricesMembershipPage.tsx");

  it("is bounded, set-based, stable, invoker-secured and SELECT-only", () => {
    expect(migration).toContain("LANGUAGE sql");
    expect(migration).toContain("STABLE");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path = public, pg_temp");
    expect(migration).toContain("LIMIT 20");
    expect(migration).toContain("LIMIT 24");
    expect(migration).toContain("LIMIT 64");
    expect(migration).toContain("LIMIT 256");
    expect(migration).toContain("p_end_date <= p_start_date + 13");
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("first_visit_fallback_occurrence");
    expect(migration).toContain("pricing_channel_mode");
    expect(migration).not.toMatch(/fallback[^\n]*165|165[^\n]*fallback/i);
    expect(appliedMigration).toContain("'first_visit_fallback_price_sek'");
    expect(appliedMigration).not.toContain("first_visit_fallback_occurrence");
  });

  it("performs one RPC with no remote table loop and retains canonical shared pricing", () => {
    expect(projection.match(/client\.rpc\(/g)).toHaveLength(1);
    expect(projection).toContain("resolveActivityPricingDecision");
    expect(projection).toContain("evaluateCommerceAvailability");
    expect(projection).not.toContain("client.from(");
    expect(projection).not.toContain("STRIPE");
    expect(projection).not.toContain("?? 165");
  });

  it("keeps public first paint auth-free and private eligibility after verification", () => {
    const publicRoute = endpoint.slice(
      endpoint.indexOf("path === 'public-prices'"),
      endpoint.indexOf("path === 'prices-first-visit-eligibility'"),
    );
    expect(publicRoute).toContain("loadPublicPrices");
    expect(publicRoute).toContain("measurePublicReadStage");
    expect(publicRoute).not.toContain("getAuthenticatedClient");
    expect(publicRoute).not.toContain("resolveCustomerIdForUser");
    expect(publicRoute).not.toContain("reconcileExpiredFirstVisitCheckouts");
    expect(browser).toContain('auth: "omit"');
    expect(page).toContain("verifiedAccount.isVerified && prices.data?.first_visit.available === true");

    const privateRoute = endpoint.slice(
      endpoint.indexOf("path === 'prices-first-visit-eligibility'"),
      endpoint.indexOf("path === 'today-secondary'"),
    );
    expect(privateRoute).toContain("getAuthenticatedClient");
    expect(privateRoute).toContain("firstVisitEligibilityForCustomer(client, null, userId)");
    expect(privateRoute).not.toContain("resolveCustomerIdForUser");
    expect(privateRoute).not.toContain("reconcileExpiredFirstVisitCheckouts");
    expect(privateRoute).not.toContain("STRIPE");
  });

  it("eliminates every old Prices domain reconstruction request", () => {
    expect(page).toContain("fetchPublicPrices(slug)");
    for (const oldRead of [
      "useVenueWithHours",
      "fetchCommerceCatalog",
      "fetchCoursePricingCatalog",
      '"api-memberships", "tiers"',
      '"api-bookings", "pricing"',
      '"first-visit-offers"',
    ]) expect(page).not.toContain(oldRead);
  });
});
