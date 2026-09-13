import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientObservability", () => ({ reportClientEvent: vi.fn() }));

import {
  PERSONALIZED_PRICING_GENERATION_KEY,
  invalidatePersonalizedPricing,
  isFreshPersonalizedPricingEntry,
  personalizedPricingQueryKey,
  personalizedTodayQueryKey,
  primePersonalizedPricingEntries,
  selectTodayPricingForAccount,
  type PersonalizedPricingBatchResponse,
  type PersonalizedPricingEntry,
  type ReusableActivityPricingDecision,
} from "@/lib/personalizedPricing";
import { RUNNING_FRONTEND_BUILD } from "@/lib/frontendBuild";
import {
  createActivityPricingReadCache,
  primeActivityPricingReadSnapshot,
  resolveActivityPricingDecision,
} from "../../supabase/functions/_shared/activity_pricing.ts";

const USER_PLAY = "11111111-1111-4111-8111-111111111111";
const USER_OTHER = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const DATE = "2026-09-14";
const PRODUCT = "open_play_slot";

function decision({
  price,
  reason,
  purchaseKind = "activity_ticket",
  sessionId = SESSION,
  sessionDate = DATE,
  userLabel = price <= 0 ? "Ingår" : `${price} kr`,
  resolvedAt = new Date().toISOString(),
}: {
  price: number;
  reason: string;
  purchaseKind?: "activity_ticket" | "day_pass";
  sessionId?: string;
  sessionDate?: string;
  userLabel?: string;
  resolvedAt?: string;
}): ReusableActivityPricingDecision {
  return {
    activitySessionId: sessionId,
    sessionDate,
    productKey: purchaseKind === "day_pass" ? "day_access" : PRODUCT,
    baseAmountSek: purchaseKind === "day_pass" ? 199 : 165,
    finalAmountSek: price,
    effectivePriceSek: price,
    requiresCheckout: price > 0,
    checkoutLabel: userLabel,
    pricingReason: reason,
    accessDecision: price > 0 ? "paid" : "membership_included",
    entitlementType: price > 0 ? "" : "open_play_unlimited",
    membershipTierName: reason.includes("membership") ? "Play" : null,
    customerPresentation: {
      identityState: "identified",
      displayPriceSek: price,
      displayLabel: userLabel,
      listPriceSek: purchaseKind === "day_pass" ? 199 : 165,
      offerState: null,
      offerLabel: null,
      offerDetail: null,
    },
    decision: {
      schema_version: 1,
      decision_id: `${purchaseKind}-${price}-${sessionDate}`,
      identity_context: "authenticated",
      identity_fingerprint: "privacy-safe-account-fingerprint",
      currency: "SEK",
      price_minor: price * 100,
      list_price_minor: (purchaseKind === "day_pass" ? 199 : 165) * 100,
      reason,
      resolved_at: resolvedAt,
      fresh_until: new Date(new Date(resolvedAt).getTime() + 15_000).toISOString(),
      context: {
        venue_id: VENUE,
        activity_session_id: sessionId,
        session_date: sessionDate,
        product_key: purchaseKind === "day_pass" ? "day_access" : PRODUCT,
        purchase_kind: purchaseKind,
        sales_channel: "online",
      },
    },
  };
}

function entry(price = 99, reason = "membership_tier_pricing", resolvedAt = new Date().toISOString()): PersonalizedPricingEntry {
  const activityTicketPricing = decision({ price, reason, resolvedAt });
  const dayPassPricing = decision({ price: 119.4, reason, purchaseKind: "day_pass", resolvedAt });
  return {
    activitySessionId: SESSION,
    sessionDate: DATE,
    activityTicketPricing,
    dayPassPricing,
    resolvedAt,
    freshUntil: activityTicketPricing.decision.fresh_until,
  };
}

function batch(value: PersonalizedPricingEntry): PersonalizedPricingBatchResponse {
  return {
    is_first_time: false,
    has_configured_offer: false,
    pricing: [{
      activity_session_id: value.activitySessionId,
      session_date: value.sessionDate,
      effective_price_sek: Number(value.activityTicketPricing.effectivePriceSek),
      requires_checkout: value.activityTicketPricing.requiresCheckout === true,
      pricing_reason: value.activityTicketPricing.pricingReason,
      customer_presentation: value.activityTicketPricing.customerPresentation,
      activity_ticket_pricing: value.activityTicketPricing,
      day_pass_pricing: value.dayPassPricing,
    }],
    occurrences: [],
    items: [],
    resolved_at: value.resolvedAt,
  };
}

const context = {
  userId: USER_PLAY,
  venueId: VENUE,
  venueSlug: "pickla-arena-sthlm",
  activitySessionId: SESSION,
  sessionDate: DATE,
  productKey: PRODUCT,
  generation: 0,
} as const;

describe("personalized pricing single resolution", () => {
  it("does not expose public 165 as the authenticated Today price while Play is unresolved", () => {
    const publicPricing = batch(entry(165, "regular_price"));
    expect(selectTodayPricingForAccount({ accountState: "remote_validating", publicPricing })).toBeUndefined();
    expect(selectTodayPricingForAccount({ accountState: "verified", publicPricing })).toBeUndefined();
    expect(selectTodayPricingForAccount({ accountState: "verified", personalized: batch(entry(99)), publicPricing })?.pricing[0].effective_price_sek).toBe(99);
  });

  it("keeps reusable price state build-scoped for PWA version convergence", () => {
    expect(personalizedPricingQueryKey(context)).toContain(RUNNING_FRONTEND_BUILD.sha);
    expect(personalizedTodayQueryKey({
      userId: USER_PLAY,
      venueSlug: context.venueSlug,
      startDate: DATE,
      endDate: "2026-09-20",
      generation: 0,
    })).toContain(RUNNING_FRONTEND_BUILD.sha);
  });

  it("shows canonical 165 to an anonymous/non-member context", () => {
    const publicPricing = batch(entry(165, "regular_price"));
    expect(selectTodayPricingForAccount({ accountState: "anonymous", publicPricing })?.pricing[0].effective_price_sek).toBe(165);
  });

  it("preserves Play+ included truth and provenance", () => {
    const included = entry(0, "membership_open_play_unlimited");
    expect(included.activityTicketPricing.requiresCheckout).toBe(false);
    expect(included.activityTicketPricing.customerPresentation.displayLabel).toBe("Ingår");
    expect(included.activityTicketPricing.decision.reason).toBe("membership_open_play_unlimited");
  });

  it("primes Today once and suppresses identical drawer resolution while fresh", async () => {
    const client = new QueryClient();
    const resolved = entry();
    primePersonalizedPricingEntries(client, {
      userId: USER_PLAY,
      venueId: VENUE,
      venueSlug: context.venueSlug,
      generation: 0,
      response: batch(resolved),
    });
    const fetcher = vi.fn(async () => entry());
    const first = await client.fetchQuery({ queryKey: personalizedPricingQueryKey(context), queryFn: fetcher, staleTime: 15_000 });
    const second = await client.fetchQuery({ queryKey: personalizedPricingQueryKey(context), queryFn: fetcher, staleTime: 15_000 });
    expect(first.activityTicketPricing.effectivePriceSek).toBe(99);
    expect(second.activityTicketPricing.effectivePriceSek).toBe(99);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves a direct-linked drawer exactly once when Today has not primed it", async () => {
    const client = new QueryClient();
    const fetcher = vi.fn(async () => entry());
    const resolved = await client.fetchQuery({
      queryKey: personalizedPricingQueryKey(context),
      queryFn: fetcher,
      staleTime: 15_000,
    });
    expect(resolved.activityTicketPricing.effectivePriceSek).toBe(99);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a decision for another occurrence or product context", () => {
    const resolved = entry();
    expect(isFreshPersonalizedPricingEntry(resolved, context)).toBe(true);
    expect(isFreshPersonalizedPricingEntry(resolved, { ...context, sessionDate: "2026-09-15" })).toBe(false);
    expect(isFreshPersonalizedPricingEntry(resolved, { ...context, productKey: "group_training" })).toBe(false);
  });

  it("does not reuse expired decisions", () => {
    const old = entry(99, "membership_tier_pricing", "2026-09-13T10:00:00.000Z");
    expect(isFreshPersonalizedPricingEntry(old, context, Date.parse("2026-09-13T10:00:15.001Z"))).toBe(false);
  });

  it("isolates accounts and invalidates all personalized price state on account/access change", () => {
    const client = new QueryClient();
    const todayKey = personalizedTodayQueryKey({
      userId: USER_PLAY,
      venueSlug: context.venueSlug,
      startDate: DATE,
      endDate: "2026-09-20",
      generation: 0,
    });
    client.setQueryData(todayKey, { personalized_pricing: batch(entry(165, "regular_price")) });
    primePersonalizedPricingEntries(client, {
      userId: USER_PLAY,
      venueId: VENUE,
      venueSlug: context.venueSlug,
      generation: 0,
      response: batch(entry(165, "regular_price")),
    });
    expect(personalizedPricingQueryKey(context)).not.toEqual(personalizedPricingQueryKey({ ...context, userId: USER_OTHER }));
    expect(invalidatePersonalizedPricing(client, "membership_activated")).toBe(1);
    expect(client.getQueryData(personalizedPricingQueryKey(context))).toBeUndefined();
    expect(client.getQueryData(todayKey)).toBeUndefined();
    expect(client.getQueryData(PERSONALIZED_PRICING_GENERATION_KEY)).toBe(1);
  });

  it.each([
    ["Play purchase", 99, "membership_tier_pricing"],
    ["Play+ activation", 0, "membership_open_play_unlimited"],
    ["day access activation", 0, "active_day_access"],
  ] as const)("drops the old 165 after %s", (_scenario, price, reason) => {
    const client = new QueryClient();
    primePersonalizedPricingEntries(client, { userId: USER_PLAY, venueId: VENUE, venueSlug: context.venueSlug, generation: 0, response: batch(entry(165, "regular_price")) });
    const generation = invalidatePersonalizedPricing(client, reason);
    const next = entry(price, reason);
    primePersonalizedPricingEntries(client, { userId: USER_PLAY, venueId: VENUE, venueSlug: context.venueSlug, generation, response: batch(next) });
    const nextKey = personalizedPricingQueryKey({ ...context, generation });
    expect((client.getQueryData(nextKey) as PersonalizedPricingEntry).activityTicketPricing.effectivePriceSek).toBe(price);
    expect((client.getQueryData(nextKey) as PersonalizedPricingEntry).activityTicketPricing.pricingReason).toBe(reason);
  });

  it("wires customer-side entitlement mutations to immediate pricing invalidation", () => {
    const membershipConfirmation = readFileSync("src/pages/MembershipConfirmed.tsx", "utf8");
    const bookingConfirmation = readFileSync("src/pages/BookingConfirmed.tsx", "utf8");
    const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");
    expect(membershipConfirmation).toContain('invalidatePersonalizedPricing(queryClient, "membership_activated")');
    expect(bookingConfirmation).toContain('isDayPass ? "day_access_activated" : "activity_registration_changed"');
    expect(myPage).toContain('invalidatePersonalizedPricing(queryClient, "membership_cancelled")');
  });

  it("keeps batch work bounded and checkout server-authoritative", () => {
    const eventSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
    const snapshotSource = readFileSync("supabase/functions/_shared/activity_pricing.ts", "utf8");
    const todayProjectionSource = readFileSync("supabase/functions/_shared/today_primary_projection.ts", "utf8");
    const migrationSource = readFileSync("supabase/migrations/20260913130000_bounded_activity_pricing_facts.sql", "utf8");
    const commerceSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
    expect(eventSource).toContain("MAX_PERSONALIZED_PRICING_OCCURRENCES = 24");
    expect(eventSource).toContain("path === 'today-personalized'");
    expect(eventSource).toContain("boundedPersonalizedTodayOccurrences(projection.data)");
    expect(snapshotSource).toContain("primeActivityPricingReadSnapshot");
    expect(migrationSource).toContain("jsonb_array_length(COALESCE(p_occurrences, '[]'::jsonb)) > 24");
    expect(migrationSource).toContain("public.resolve_access_entitlement(");
    expect(snapshotSource).toContain(".in('activity_session_id', sessionIds)");
    expect(todayProjectionSource).toContain("activity_session_schedule_versions");
    expect(todayProjectionSource).toContain("activity_session_overrides");
    expect(todayProjectionSource).toContain("effectiveActivityOccurrenceForDate(session, date, scheduleVersions)");
    expect(commerceSource).toContain("const quoted = await resolveLines");
    expect(commerceSource).toContain("const resolved = participation[0]");
    expect(commerceSource).toContain("pricingHold.quote_changed");
    expect(commerceSource).not.toContain("preview_effective_amount_sek");
  });

  it("uses privacy-safe timing diagnostics without customer identifiers", () => {
    const eventSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
    const start = eventSource.indexOf("authenticated-today-personalized-timing");
    const diagnosticBlock = eventSource.slice(start, start + 600);
    expect(diagnosticBlock).toContain("diagnostics");
    expect(diagnosticBlock).not.toContain("userId");
    expect(diagnosticBlock).not.toContain("customerId");
    expect(diagnosticBlock).not.toContain("sessionDate");
  });

  it("single-flights repeated membership/day-access facts across ticket and day-pass decisions", async () => {
    const reads: Record<string, number> = {};
    const resultFor = (table: string, filters: Record<string, unknown>, single: boolean) => {
      if (table === "access_products") {
        const productKey = String(filters.product_key || "");
        return { data: {
          product_key: productKey,
          product_kind: productKey === "day_access" ? "day_access" : "session",
          base_price_sek: productKey === "day_access" ? 199 : 165,
        }, error: null };
      }
      if (table === "activity_session_hosts" || table === "access_entitlements") return { data: null, error: null };
      if (table === "memberships") return { data: { id: "membership-1", tier_id: "tier-1", venue_id: VENUE }, error: null };
      if (table === "membership_entitlements") return { data: [], error: null };
      if (table === "membership_tier_pricing") {
        return { data: [{ product_type: filters.product_type, fixed_price: filters.product_type === PRODUCT ? 99 : 119.4, discount_percent: null }], error: null };
      }
      if (table === "membership_tiers") return { data: { name: "Play", discount_percent: 0 }, error: null };
      return { data: single ? null : [], error: null };
    };
    const client = {
      from(table: string) {
        reads[table] = (reads[table] || 0) + 1;
        const filters: Record<string, unknown> = {};
        // Supabase's fluent query builder is intentionally structural in this focused resolver test.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {
          select() { return builder; },
          eq(key: string, value: unknown) { filters[key] = value; return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle() { return Promise.resolve(resultFor(table, filters, true)); },
          then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve(resultFor(table, filters, false)).then(resolve, reject);
          },
        };
        return builder;
      },
      rpc(name: string) {
        reads[`rpc:${name}`] = (reads[`rpc:${name}`] || 0) + 1;
        return Promise.resolve({ data: name === "resolve_access_entitlement" ? { covered: false } : null, error: null });
      },
    };
    const session = {
      id: SESSION,
      venue_id: VENUE,
      name: "Open Play",
      session_type: "open_play",
      session_date: null,
      start_time: "18:00",
      end_time: "20:00",
      capacity: 16,
      price_sek: 165,
      product_key: PRODUCT,
      access_policy: { allows_day_access: true },
      metadata: {},
      first_visit_offer_enabled: false,
      scarcity_mode: "none",
    };
    const readCache = createActivityPricingReadCache();
    // Matches the shared resolver's existing Supabase product-cache contract.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productCache = new Map<string, Promise<any>>();
    const common = {
      client,
      venueId: VENUE,
      userId: USER_PLAY,
      customerId: "customer-1",
      activitySessionId: SESSION,
      sessionDate: DATE,
      session,
      productCache,
      readCache,
    };
    const [ticket, dayPass] = await Promise.all([
      resolveActivityPricingDecision({ ...common, requestedProductKey: PRODUCT, requestedAmountSek: 165, purchaseKind: "activity_ticket" }),
      resolveActivityPricingDecision({ ...common, requestedProductKey: "day_access", requestedAmountSek: null, purchaseKind: "day_pass" }),
    ]);
    expect(ticket.effectivePriceSek).toBe(99);
    expect(dayPass.effectivePriceSek).toBe(119.4);
    expect(reads.access_entitlements).toBe(1);
    expect(reads.memberships).toBe(1);
    expect(reads.membership_entitlements).toBe(1);
    expect(reads.membership_tiers).toBe(1);
    expect(readCache.diagnostics.cacheHits.day_access).toBe(1);
    expect(readCache.diagnostics.cacheHits.membership).toBe(1);
    expect(readCache.diagnostics.cacheHits.membership_benefits).toBeGreaterThanOrEqual(1);
  });

  it("resolves 12 occurrences from one access snapshot without N+1 access queries", async () => {
    const reads: Record<string, number> = {};
    const dates = Array.from({ length: 12 }, (_, index) => `2026-09-${String(14 + index).padStart(2, "0")}`);
    const session = {
      id: SESSION,
      venue_id: VENUE,
      name: "Open Play",
      session_type: "open_play",
      session_date: null,
      start_time: "18:00",
      end_time: "20:00",
      capacity: 16,
      price_sek: 165,
      product_key: PRODUCT,
      access_policy: { allows_day_access: true },
      metadata: {},
      first_visit_offer_enabled: false,
      scarcity_mode: "none",
    };
    const tableResult = (table: string) => {
      if (table === "access_products") return { data: [
        { product_key: PRODUCT, product_kind: "session", base_price_sek: 165 },
        { product_key: "day_access", product_kind: "day_access", base_price_sek: 199 },
      ], error: null };
      if (table === "memberships") return { data: { id: "membership-1", tier_id: "tier-1", venue_id: VENUE }, error: null };
      if (table === "membership_tiers") return { data: { name: "Play", discount_percent: 0 }, error: null };
      if (table === "membership_tier_pricing") return { data: [
        { product_type: PRODUCT, fixed_price: 99, discount_percent: null },
        { product_type: "day_access", fixed_price: 119.4, discount_percent: null },
      ], error: null };
      return { data: [], error: null };
    };
    const client = {
      from(table: string) {
        reads[table] = (reads[table] || 0) + 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {
          select() { return builder; },
          eq() { return builder; },
          in() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle() { return Promise.resolve(tableResult(table)); },
          then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve(tableResult(table)).then(resolve, reject);
          },
        };
        return builder;
      },
      rpc(name: string) {
        reads[`rpc:${name}`] = (reads[`rpc:${name}`] || 0) + 1;
        if (name !== "resolve_activity_pricing_facts_batch") {
          return Promise.resolve({ data: null, error: new Error(`unexpected ${name}`) });
        }
        return Promise.resolve({
          data: dates.map((sessionDate) => ({
            activity_session_id: SESSION,
            session_date: sessionDate,
            product_key: PRODUCT,
            canonical_access: { covered: false },
            capacity_fill: 0,
            early_bird_fill: 0,
          })),
          error: null,
        });
      },
    };
    const readCache = createActivityPricingReadCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productCache = new Map<string, Promise<any>>();
    const occurrences = dates.map((sessionDate) => ({ activitySessionId: SESSION, sessionDate, session }));
    const snapshot = await primeActivityPricingReadSnapshot({
      client,
      readCache,
      productCache,
      venueId: VENUE,
      userId: USER_PLAY,
      customerId: "customer-1",
      occurrences,
    });
    const queryCountAfterSnapshot = Object.values(reads).reduce((sum, count) => sum + count, 0);
    const decisions = await Promise.all(occurrences.flatMap((occurrence) => [
      resolveActivityPricingDecision({
        client,
        venueId: VENUE,
        userId: USER_PLAY,
        customerId: "customer-1",
        activitySessionId: SESSION,
        sessionDate: occurrence.sessionDate,
        requestedProductKey: PRODUCT,
        requestedAmountSek: 165,
        purchaseKind: "activity_ticket" as const,
        session,
        productCache,
        readCache,
      }),
      resolveActivityPricingDecision({
        client,
        venueId: VENUE,
        userId: USER_PLAY,
        customerId: "customer-1",
        activitySessionId: SESSION,
        sessionDate: occurrence.sessionDate,
        requestedProductKey: "day_access",
        requestedAmountSek: null,
        purchaseKind: "day_pass" as const,
        session,
        productCache,
        readCache,
      }),
    ]));
    expect(Object.values(reads).reduce((sum, count) => sum + count, 0)).toBe(queryCountAfterSnapshot);
    expect(snapshot.queryCount).toBe(8);
    expect(snapshot.occurrenceCount).toBe(12);
    expect(reads.access_products).toBe(1);
    expect(reads.access_entitlements).toBe(1);
    expect(reads.memberships).toBe(1);
    expect(reads.activity_session_hosts).toBe(1);
    expect(reads["rpc:resolve_activity_pricing_facts_batch"]).toBe(1);
    expect(reads["rpc:resolve_access_entitlement"]).toBeUndefined();
    expect(decisions.filter((_, index) => index % 2 === 0).every((value) => value.effectivePriceSek === 99)).toBe(true);
  });
});
