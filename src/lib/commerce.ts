import { apiGet, apiPost, type ApiRequestOptions } from "@/lib/api";

export type CommerceKind = "participation" | "rental" | "merchandise";

export interface CommerceProduct {
  id: string;
  venue_id: string;
  product_key: string;
  name: string;
  description: string | null;
  commerce_kind: CommerceKind;
  fulfillment_type: "participation" | "desk_pickup";
  fulfillment_presentation: "participation" | "desk_pickup" | "digital" | null;
  base_price_sek: number;
  vat_rate: number;
  sort_order: number;
  status: "draft" | "active" | "archived";
  standalone_enabled: boolean;
  activity_addon_enabled: boolean;
  category: string | null;
  sport: string | null;
  image_url: string | null;
  store_eligible?: boolean;
  resolver_rules?: Record<string, unknown> | null;
  max_quantity?: number;
}

export function commerceProductMaxQuantity(product: Pick<CommerceProduct, "max_quantity" | "resolver_rules">) {
  const configured = Number(product.max_quantity ?? product.resolver_rules?.max_quantity ?? 20);
  return Math.max(1, Math.min(100, Number.isFinite(configured) ? Math.floor(configured) : 20));
}

export interface CommerceRelationship {
  id: string;
  source_product_id: string;
  target_product_id: string;
  relationship_type: "offered_with";
  sort_order: number;
}

export interface CommerceCartItemInput {
  product_id: string;
  quantity: number;
  activity_session_id?: string;
  session_date?: string;
  parent_product_id?: string;
}

export interface CommerceOrderLine {
  id: string;
  product_id: string | null;
  product_key: string;
  product_name: string;
  commerce_kind: CommerceKind;
  quantity: number;
  unit_price_minor: number;
  discount_minor?: number;
  line_total_inc_vat_minor: number;
  line_total_ex_vat_minor?: number;
  vat_rate: number;
  vat_amount_minor: number;
  fulfillment_type: string;
  fulfillment_status: string;
  session_registration_id?: string | null;
  parent_line_id?: string | null;
  activity_session_id?: string | null;
  session_date?: string | null;
  product_snapshot?: Record<string, unknown> | null;
  resolver_snapshot?: Record<string, unknown> | null;
}

export interface CommerceOrderResponse {
  order: {
    id: string;
    venue_id: string;
    status: string;
    version: number;
    currency: string;
    total_inc_vat_minor: number;
    total_ex_vat_minor: number;
    vat_amount_minor: number;
    draft_scope?: string | null;
    contact_email_present?: boolean;
    guest_claimed?: boolean;
    requires_guest_claim?: boolean;
    account_claimed?: boolean;
    claim_expires_at?: string | null;
    cancellation_pending?: boolean;
    paid_at?: string | null;
    booking_receipt_id?: string | null;
    customer_name?: string | null;
  };
  lines: CommerceOrderLine[];
  receipt?: Record<string, unknown> | null;
  receipt_lines?: CommerceOrderLine[];
  cart_token?: string;
  activity_access?: {
    activity_session_id: string;
    session_date: string;
    name: string;
    start_time: string;
    end_time: string;
    venue_name?: string | null;
    venue_slug?: string | null;
    registration_id?: string | null;
    registration_status?: string | null;
  } | null;
}

export const RACKET_PICKUP_INSTRUCTION_CODE = "desk_pickup_racket_by_name";

function isRacketPickupLine(line: CommerceOrderLine) {
  const snapshot = line.product_snapshot && typeof line.product_snapshot === "object"
    ? line.product_snapshot
    : {};
  const instructionCode = String(snapshot.customer_instruction_code || "");
  if (instructionCode === RACKET_PICKUP_INSTRUCTION_CODE) return true;
  const identity = `${line.product_key} ${line.product_name}`.toLowerCase();
  return line.commerce_kind === "rental"
    && line.fulfillment_type === "desk_pickup"
    && /racket|hyrrack/.test(identity);
}

export function commerceRacketPickupQuantity(
  lines: CommerceOrderLine[],
  options: { confirmed?: boolean } = {},
) {
  return lines.reduce((sum, line) => {
    if (!isRacketPickupLine(line)) return sum;
    if (options.confirmed && line.fulfillment_status !== "pending_pickup") return sum;
    return sum + Math.max(0, Number(line.quantity || 0));
  }, 0);
}

export function commerceRacketOrderSummaryInstruction(quantity: number) {
  if (quantity <= 0) return null;
  return "Uppge ditt namn i desken så hjälper vi dig.";
}

export function commerceRacketSuccessInstruction(quantity: number) {
  if (quantity <= 0) return null;
  return {
    summary: `Du har hyrt ${quantity} rack.`,
    pickup: quantity === 1
      ? "Hämta ut det i desken genom att uppge ditt namn."
      : "Hämta ut dem i desken genom att uppge ditt namn.",
  };
}

export function formatCommerceMoney(minor: number, currency = "SEK") {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(Number(minor || 0) / 100);
}

export function fetchCommerceCatalog(venueId: string) {
  return apiGet<{
    commerce_available: boolean;
    message: string | null;
    products: CommerceProduct[];
    relationships: CommerceRelationship[];
  }>("api-commerce", "catalog", { venueId });
}

export function createCommerceCart(input: {
  venueId: string;
  items: CommerceCartItemInput[];
  source: string;
  draftScope?: string;
  guestName?: string;
  guestEmail?: string;
  journeyId?: string;
}, options: ApiRequestOptions = {}) {
  const body = {
    venue_id: input.venueId,
    items: input.items,
    source: input.source,
    ...(input.draftScope ? { draft_scope: input.draftScope } : {}),
    guest_name: input.guestName || null,
    guest_email: input.guestEmail || null,
    ...(input.journeyId ? { journey_id: input.journeyId } : {}),
  };
  return Object.keys(options).length > 0
    ? apiPost<CommerceOrderResponse>("api-commerce", "cart", body, options)
    : apiPost<CommerceOrderResponse>("api-commerce", "cart", body);
}

const COMMERCE_JOURNEY_KEY = "pickla:commerce:journey";

export function commerceJourneyId() {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(COMMERCE_JOURNEY_KEY);
  if (existing) return existing;
  const next = typeof crypto?.randomUUID === "function"
    ? `${crypto.randomUUID()}${crypto.randomUUID()}`
    : `${Date.now()}-${Math.random()}-${Math.random()}`;
  window.sessionStorage.setItem(COMMERCE_JOURNEY_KEY, next);
  return next;
}

export function trackCommerceFunnelEvent(input: {
  eventName: "activity_sheet_opened" | "logged_out_cta_clicked";
  venueId: string;
  activitySessionId: string;
}) {
  return apiPost("api-commerce", "event", {
    event_name: input.eventName,
    venue_id: input.venueId,
    activity_session_id: input.activitySessionId,
    journey_id: commerceJourneyId(),
  }).catch(() => undefined);
}

export function fetchCommerceOrder(token: string, options: ApiRequestOptions = {}) {
  return apiGet<CommerceOrderResponse>("api-commerce", "order", { token }, options);
}

export function confirmCommerceGuestIdentity(token: string, displayName: string) {
  return apiPost<CommerceOrderResponse>("api-commerce", "claim", {
    token,
    display_name: displayName,
  }, { auth: "omit" });
}

export function claimCommerceOrderAccount(token: string) {
  return apiPost<CommerceOrderResponse>("api-commerce", "claim-account", { token });
}

export function checkInCommerceGuest(token: string) {
  return apiPost<{ checked_in: boolean; registration_id: string }>("api-commerce", "guest-checkin", { token }, { auth: "omit" });
}

export function cancelCommerceActivityOrder(token: string, options: ApiRequestOptions = {}) {
  return apiPost<CommerceOrderResponse & { cancellation_pending?: boolean }>("api-commerce", "cancel", { token }, options);
}

export async function resumeCommerceActivityDraft(
  venueId: string,
  scope: string,
  options: ApiRequestOptions = {},
) {
  try {
    return await apiGet<CommerceOrderResponse>("api-commerce", "draft", {
      venueId,
      scope,
    }, options);
  } catch (error) {
    if (Number((error as { status?: unknown })?.status || 0) === 404) return null;
    throw error;
  }
}

export function isCommerceOrderIdReference(reference: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
}

const ACTIVITY_SELECTION_PREFIX = "pickla:commerce:r1:activity";

export function activityCommerceDraftScope(sessionId: string, sessionDate: string) {
  return `activity:${sessionId}:${sessionDate}`;
}

export function activityCommerceSelectionKey(sessionId: string, sessionDate: string) {
  return `${ACTIVITY_SELECTION_PREFIX}:${sessionId}:${sessionDate}`;
}

export function readActivityCommerceSelection(key: string) {
  if (typeof window === "undefined") return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([productId, value]) => {
      const quantity = Math.max(0, Math.min(20, Math.floor(Number(value) || 0)));
      return quantity > 0 ? [[productId, quantity]] : [];
    }));
  } catch {
    return {};
  }
}

export function writeActivityCommerceSelection(key: string, quantities: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(quantities));
  } catch {
    // The active page remains usable when browser storage is unavailable.
  }
}
