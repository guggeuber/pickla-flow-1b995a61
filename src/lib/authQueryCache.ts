import type { QueryClient, QueryKey } from "@tanstack/react-query";

const PRIVATE_QUERY_PREFIXES = [
  "admin-",
  "chat-",
  "customer-",
  "desk-",
  "event-agent-",
  "hub-",
  "my-",
  "ops-",
  "player-profile",
  "staff-",
] as const;

const PRIVATE_QUERY_KEYS = new Set([
  "access-snapshot",
  "active-events",
  "activity-badge",
  "authenticated-account-bootstrap",
  "booking",
  "booking-by-session",
  "booking-drawer-manual-customer-search",
  "booking-member-passes",
  "booking-membership",
  "booking-participant-manual-customer-search",
  "commerce-activity-draft",
  "commerce-fulfillment",
  "commerce-my-orders",
  "commerce-order",
  "commerce-participation-items",
  "commerce-registration-order",
  "community-feed",
  "current-identity",
  "date-bookings",
  "event-checkins",
  "event-courts",
  "event-matches",
  "event-offer-catalog",
  "event-players",
  "event-templates",
  "forum-badge",
  "payment-methods",
  "receipt",
  "recent-customers",
  "today-bookings",
  "today-featured-preview",
  "today-feed",
  "today-revenue",
  "user-membership-event",
  "venue-memberships",
  "wellness-certificate",
]);

function containsUserId(value: unknown, userId: string): boolean {
  if (value === userId) return true;
  if (Array.isArray(value)) return value.some((item) => containsUserId(item, userId));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsUserId(item, userId));
  }
  return false;
}

export function isCustomerSpecificQueryKey(queryKey: QueryKey, userId?: string | null) {
  if (userId && containsUserId(queryKey, userId)) return true;
  const root = queryKey[0];
  if (typeof root !== "string") return false;
  return PRIVATE_QUERY_KEYS.has(root) || PRIVATE_QUERY_PREFIXES.some((prefix) => root.startsWith(prefix));
}

/**
 * Removes authenticated/customer data while retaining public venue, course,
 * price and storefront queries for the signed-out experience.
 */
export function clearCustomerQueryCache(
  queryClient: QueryClient,
  userId?: string | null,
  options: { preserveAccountBootstrap?: boolean } = {},
) {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => {
      if (options.preserveAccountBootstrap && query.queryKey[0] === "authenticated-account-bootstrap") return false;
      return isCustomerSpecificQueryKey(query.queryKey, userId);
    },
  };
  const cancellation = queryClient.cancelQueries(filters);
  queryClient.removeQueries(filters);
  return cancellation;
}
