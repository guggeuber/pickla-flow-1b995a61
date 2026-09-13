import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import type { BackendActivityPricingDecision, CustomerActivityPricePresentation } from "@/lib/activityPricing";
import { reportClientEvent } from "@/lib/clientObservability";
import { RUNNING_FRONTEND_BUILD } from "@/lib/frontendBuild";

export const PERSONALIZED_PRICING_QUERY_ROOT = "personalized-pricing";
export const PERSONALIZED_PRICING_GENERATION_KEY = ["personalized-pricing-generation"] as const;
export const PERSONALIZED_PRICING_FRESH_MS = 15_000;

export type PersonalizedPricingContext = {
  userId: string;
  venueId: string;
  venueSlug: string;
  activitySessionId: string;
  sessionDate: string;
  productKey: string;
  salesChannel?: "online";
  generation: number;
};

export type PricingDecisionIdentity = {
  schema_version: 1;
  decision_id: string;
  identity_context: "authenticated";
  identity_fingerprint: string;
  currency: "SEK";
  price_minor: number;
  list_price_minor: number;
  reason: string;
  resolved_at: string;
  fresh_until: string;
  context: {
    venue_id: string;
    activity_session_id: string;
    session_date: string;
    product_key: string;
    purchase_kind: "activity_ticket" | "day_pass";
    sales_channel: "online";
  };
};

export type ReusableActivityPricingDecision = BackendActivityPricingDecision & {
  activitySessionId: string;
  sessionDate: string;
  productKey: string;
  productKind?: string | null;
  pricingReason: string;
  checkoutLabel: string;
  membershipTierName?: string | null;
  customerPresentation: CustomerActivityPricePresentation;
  decision: PricingDecisionIdentity;
};

export type PersonalizedPricingEntry = {
  activitySessionId: string;
  sessionDate: string;
  activityTicketPricing: ReusableActivityPricingDecision;
  dayPassPricing: ReusableActivityPricingDecision;
  resolvedAt: string;
  freshUntil: string;
  preview?: Record<string, unknown>;
};

export type PersonalizedPricingBatchResponse = {
  is_first_time: boolean;
  has_configured_offer: boolean;
  pricing: Array<{
    activity_session_id: string;
    session_date: string;
    effective_price_sek: number;
    requires_checkout: boolean;
    pricing_reason: string;
    customer_presentation: CustomerActivityPricePresentation;
    activity_ticket_pricing: ReusableActivityPricingDecision;
    day_pass_pricing: ReusableActivityPricingDecision;
  }>;
  occurrences: Array<{
    activity_session_id: string;
    session_date: string;
    applied: boolean;
    price_sek: number;
    regular_price_sek: number;
  }>;
  items: Array<{ route: string }>;
  resolved_at: string;
  diagnostics?: {
    occurrence_count?: number;
    resolver_count?: number;
    timings?: Record<string, number>;
    cache_hits?: Record<string, number>;
    cache_misses?: Record<string, number>;
    backend_read_ms?: Record<string, number>;
  };
};

export type PersonalizedTodayReadModel<T> = T & {
  personalized_pricing: PersonalizedPricingBatchResponse;
  diagnostics?: {
    edge_request_count?: number;
    today_projection_query_count?: number;
    bounded_occurrence_count?: number;
    bounded_occurrence_limit?: number;
    access_snapshot_query_count?: number;
    customer_identity_db_query_count?: number;
    first_visit_eligibility_query_count?: number;
    expiry_reconciliation_scan_count?: number;
    membership_lookup_count?: number;
    day_access_lookup_count?: number;
    entitlement_batch_lookup_count?: number;
    database_roundtrip_count_without_expired_checkout_recovery?: number;
    pricing_resolver_count?: number;
    timings?: Record<string, number>;
  };
};

export function selectTodayPricingForAccount<T>(input: {
  accountState: "session_hydrating" | "anonymous" | "remote_validating" | "verified" | "validation_error" | "terminal_failure";
  personalized?: T;
  publicPricing?: T;
}) {
  if (input.accountState === "verified") return input.personalized;
  if (input.accountState === "anonymous") return input.publicPricing;
  return undefined;
}

export function usePersonalizedPricingGeneration() {
  const { data = 0 } = useQuery({
    queryKey: PERSONALIZED_PRICING_GENERATION_KEY,
    queryFn: async () => 0,
    initialData: 0,
    staleTime: Infinity,
  });
  return data;
}

export function personalizedPricingQueryKey(context: PersonalizedPricingContext) {
  return [
    PERSONALIZED_PRICING_QUERY_ROOT,
    "activity",
    context.userId,
    context.venueId,
    context.venueSlug,
    context.activitySessionId,
    context.sessionDate,
    context.productKey,
    context.salesChannel || "online",
    context.generation,
    RUNNING_FRONTEND_BUILD.sha,
  ] as const;
}

export function personalizedTodayQueryKey(input: {
  userId: string;
  venueSlug: string;
  startDate: string;
  endDate: string;
  generation: number;
}) {
  return [
    PERSONALIZED_PRICING_QUERY_ROOT,
    "today-read-model",
    input.userId,
    input.venueSlug,
    input.startDate,
    input.endDate,
    input.generation,
    RUNNING_FRONTEND_BUILD.sha,
  ] as const;
}

function reportPricingMetric(eventType: string, message: string, metadata: Record<string, unknown>) {
  void reportClientEvent({
    event_type: eventType,
    severity: eventType.includes("failure") ? "warning" : "info",
    message,
    fingerprint: `${eventType}:${message}`,
    metadata,
    privacy_safe: true,
  });
}

export async function fetchPersonalizedToday<T>(input: {
  venueSlug: string;
  startDate: string;
  endDate: string;
}) {
  const startedAt = performance.now();
  reportPricingMetric("authenticated_today_requested", "Authenticated Today read model requested", {
    date_count: Math.max(1, Math.round((new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / 86_400_000) + 1),
  });
  try {
    const response = await apiGet<PersonalizedTodayReadModel<T>>(
      "api-event-public",
      "today-personalized",
      {
        venueSlug: input.venueSlug,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    );
    reportPricingMetric("authenticated_today_resolved", "Authenticated Today read model resolved", {
      client_duration_ms: Math.round(performance.now() - startedAt),
      occurrence_count: response.personalized_pricing.pricing.length,
      edge_request_count: response.diagnostics?.edge_request_count || 1,
      backend_timings: response.diagnostics?.timings || null,
      access_snapshot_query_count: response.diagnostics?.access_snapshot_query_count || null,
      database_roundtrip_count: response.diagnostics?.database_roundtrip_count_without_expired_checkout_recovery || null,
      customer_identity_db_query_count: response.diagnostics?.customer_identity_db_query_count || null,
      membership_lookup_count: response.diagnostics?.membership_lookup_count || null,
      day_access_lookup_count: response.diagnostics?.day_access_lookup_count || null,
      entitlement_batch_lookup_count: response.diagnostics?.entitlement_batch_lookup_count || null,
      pricing_resolver_count: response.diagnostics?.pricing_resolver_count || null,
    });
    return response;
  } catch (error) {
    reportPricingMetric("authenticated_today_failure", "Authenticated Today read model failed", {
      client_duration_ms: Math.round(performance.now() - startedAt),
      error_class: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

export function pricingEntryFromBatchRow(
  row: PersonalizedPricingBatchResponse["pricing"][number],
): PersonalizedPricingEntry {
  return {
    activitySessionId: row.activity_session_id,
    sessionDate: row.session_date,
    activityTicketPricing: row.activity_ticket_pricing,
    dayPassPricing: row.day_pass_pricing,
    resolvedAt: row.activity_ticket_pricing.decision.resolved_at,
    freshUntil: row.activity_ticket_pricing.decision.fresh_until,
  };
}

export function pricingEntryFromActivityPreview(preview: Record<string, unknown>): PersonalizedPricingEntry {
  const activityTicketPricing = preview.activityTicketPricing as ReusableActivityPricingDecision;
  const dayPassPricing = preview.dayPassPricing as ReusableActivityPricingDecision;
  return {
    activitySessionId: activityTicketPricing.activitySessionId,
    sessionDate: activityTicketPricing.sessionDate,
    activityTicketPricing,
    dayPassPricing,
    resolvedAt: activityTicketPricing.decision.resolved_at,
    freshUntil: activityTicketPricing.decision.fresh_until,
    preview,
  };
}

export function isFreshPersonalizedPricingEntry(
  entry: PersonalizedPricingEntry | null | undefined,
  context: Omit<PersonalizedPricingContext, "userId" | "venueSlug" | "generation">,
  now = Date.now(),
) {
  if (!entry || new Date(entry.freshUntil).getTime() <= now) return false;
  const activity = entry.activityTicketPricing.decision;
  const dayPass = entry.dayPassPricing.decision;
  return activity.schema_version === 1
    && activity.identity_context === "authenticated"
    && activity.context.venue_id === context.venueId
    && activity.context.activity_session_id === context.activitySessionId
    && activity.context.session_date === context.sessionDate
    && activity.context.product_key === context.productKey
    && activity.context.purchase_kind === "activity_ticket"
    && activity.context.sales_channel === (context.salesChannel || "online")
    && dayPass.context.venue_id === context.venueId
    && dayPass.context.activity_session_id === context.activitySessionId
    && dayPass.context.session_date === context.sessionDate
    && dayPass.context.purchase_kind === "day_pass"
    && dayPass.context.sales_channel === (context.salesChannel || "online");
}

export function primePersonalizedPricingEntries(
  queryClient: QueryClient,
  input: {
    userId: string;
    venueId: string;
    venueSlug: string;
    generation: number;
    response: PersonalizedPricingBatchResponse;
  },
) {
  for (const row of input.response.pricing) {
    const entry = pricingEntryFromBatchRow(row);
    const productKey = entry.activityTicketPricing.decision.context.product_key;
    queryClient.setQueryData(
      personalizedPricingQueryKey({
        userId: input.userId,
        venueId: input.venueId,
        venueSlug: input.venueSlug,
        activitySessionId: entry.activitySessionId,
        sessionDate: entry.sessionDate,
        productKey,
        generation: input.generation,
      }),
      entry,
      { updatedAt: new Date(entry.resolvedAt).getTime() },
    );
  }
}

export function reportPersonalizedPricingReuse(hit: boolean) {
  reportPricingMetric(
    hit ? "pricing_preview_reuse_hit" : "pricing_preview_reuse_miss",
    hit ? "Fresh personalized pricing reused" : "Personalized pricing resolution required",
    { duplicate_suppressed: hit },
  );
}

export function invalidatePersonalizedPricing(queryClient: QueryClient, reason: string) {
  const nextGeneration = (queryClient.getQueryData<number>(PERSONALIZED_PRICING_GENERATION_KEY) || 0) + 1;
  queryClient.setQueryData(PERSONALIZED_PRICING_GENERATION_KEY, nextGeneration);
  queryClient.removeQueries({ queryKey: [PERSONALIZED_PRICING_QUERY_ROOT] });
  void queryClient.invalidateQueries({ queryKey: ["first-visit-offers"] });
  void queryClient.invalidateQueries({ queryKey: ["program-session-entry"] });
  reportPricingMetric("pricing_preview_invalidated", "Personalized pricing invalidated", { reason });
  return nextGeneration;
}
