import { apiGet, apiPatch, apiPost, apiPut, type ApiRequestOptions } from "@/lib/api";

export type CommerceKind = "participation" | "rental" | "merchandise";

export interface CommerceProduct {
  id: string;
  venue_id: string;
  product_key: string;
  product_kind?: string | null;
  name: string;
  description: string | null;
  commerce_kind: CommerceKind;
  fulfillment_type: "participation" | "desk_pickup";
  fulfillment_presentation: "participation" | "desk_pickup" | "digital" | null;
  base_price_sek: number;
  vat_rate: number;
  sort_order: number;
  status: "draft" | "active" | "archived";
  is_active?: boolean;
  standalone_enabled: boolean;
  activity_addon_enabled: boolean;
  category: string | null;
  sport: string | null;
  image_url: string | null;
  media?: CommerceProductMedia[];
  presentation?: CommerceProductPresentation | null;
  pricing?: CommerceResolvedPrice;
  store_eligible?: boolean;
  resolver_rules?: Record<string, unknown> | null;
  max_quantity?: number;
  inventory_policy?: "stockless" | "tracked";
  catalog_owner_organization_id?: string | null;
  variants?: CommerceVariant[];
  listing?: {
    id: string;
    pickup_location_id: string;
    pickup_location_name: string | null;
    currency: string;
  } | null;
}

export interface CommerceProductMedia {
  id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_cover: boolean;
  option_value_id?: string | null;
}

export type CommerceSizeGuide = {
  body?: string;
  columns?: string[];
  rows?: Array<{ label?: string; values?: string[] } | string[]>;
};

export interface CommerceProductPresentation {
  id: string;
  product_id: string;
  locale: "sv-SE" | "en-SE";
  slug: string;
  short_description: string | null;
  long_description: string | null;
  material: string | null;
  fit: string | null;
  care: string | null;
  returns_policy: string | null;
  size_guide: CommerceSizeGuide;
  seo_title: string | null;
  seo_description: string | null;
  publication_state: "draft" | "published" | "archived";
  low_stock_threshold: number;
  published_at: string | null;
}

export interface CommerceResolvedPrice {
  public_price_minor: number;
  resolved_price_minor: number;
  discount_minor: number;
  pricing_source: "product_base_price" | "variant_price_override" | "membership_tier_pricing";
  membership_id: string | null;
  membership_tier_id: string | null;
  membership_tier_name: string | null;
}

export interface CommerceVariantOption {
  option_id: string;
  option_code: string;
  option_label: string;
  value_id: string;
  value_code: string;
  value_label: string;
  swatch: string | null;
}

export interface CommerceVariant {
  id: string;
  product_id: string;
  sku: string;
  title: string | null;
  price_override_minor: number | null;
  image_url: string | null;
  status: "active" | "archived";
  options: CommerceVariantOption[];
  available_to_sell: number;
  sold_out: boolean;
  pricing?: CommerceResolvedPrice;
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
  is_active?: boolean;
  created_at?: string | null;
}

export function commerceOfferedWithProducts(
  products: CommerceProduct[],
  relationships: CommerceRelationship[],
  sourceProductIds: string | string[],
) {
  const sources = new Set(Array.isArray(sourceProductIds) ? sourceProductIds.filter(Boolean) : [sourceProductIds].filter(Boolean));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seenTargets = new Set<string>();

  return [...relationships]
    .filter((relationship) => (
      relationship.relationship_type === "offered_with"
      && relationship.is_active !== false
      && sources.has(relationship.source_product_id)
    ))
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0)
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || left.id.localeCompare(right.id))
    .flatMap((relationship) => {
      if (seenTargets.has(relationship.target_product_id)) return [];
      const product = productsById.get(relationship.target_product_id);
      if (!product || product.status !== "active" || product.is_active === false) return [];
      if (product.commerce_kind === "participation" || product.activity_addon_enabled !== true) return [];
      seenTargets.add(product.id);
      return [product];
    });
}

export interface CommerceCartItemInput {
  product_id: string;
  quantity: number;
  activity_session_id?: string;
  session_date?: string;
  parent_product_id?: string;
  variant_id?: string;
  pickup_location_id?: string;
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
  activity_series_id?: string | null;
  session_date?: string | null;
  series_commitment_id?: string | null;
  league_team_entry_id?: string | null;
  dependent_participant_id?: string | null;
  product_snapshot?: Record<string, unknown> | null;
  resolver_snapshot?: Record<string, unknown> | null;
  inventory_policy?: "stockless" | "tracked";
  variant_id?: string | null;
  sku?: string | null;
  pickup_location_id?: string | null;
  variant_snapshot?: ({ title?: string | null; options?: CommerceVariantOption[] } & Record<string, unknown>) | null;
  collected_quantity?: number;
  cancelled_quantity?: number;
  cancellation_policy_snapshot_id?: string | null;
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
    expires_at?: string | null;
    booking_receipt_id?: string | null;
    customer_name?: string | null;
  };
  lines: CommerceOrderLine[];
  receipt?: Record<string, unknown> | null;
  receipt_lines?: CommerceOrderLine[];
  cancellation_policy?: {
    id?: string;
    policy_key: string;
    policy_version?: number | null;
    version?: number | null;
    policy_family?: string;
    provenance?: string;
    source?: string;
    rules: Record<string, unknown>;
    copy_sv: { title: string; summary: string; late: string; boundary: string };
    copy_en: { title: string; summary: string; late: string; boundary: string };
    cancel_deadline_at?: string | null;
    refund_deadline_at?: string | null;
  } | null;
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
  course_access?: {
    activity_series_id: string;
    name: string;
    start_date: string;
    end_date: string;
    start_time: string;
    end_time: string;
    total_sessions: number;
    presentation_type?: "course" | "social_event" | "clinic" | "tournament" | "league";
    format_name?: string | null;
    venue_name?: string | null;
    venue_slug?: string | null;
    participant_name?: string | null;
    commitment_id?: string | null;
  } | null;
  league_access?: {
    league_team_entry_id: string;
    league_season_id: string;
    activity_series_id: string;
    team_name: string;
    status: string;
    series_name: string;
    start_date: string;
    end_date: string;
    start_time: string;
    end_time: string;
    fixture_publication_deadline?: string | null;
    fixtures_published_at?: string | null;
    venue_name?: string | null;
    venue_slug?: string | null;
    members: Array<{ role: "captain" | "player"; name: string }>;
  } | null;
  checkout_verification_eligible?: boolean;
  checkout_session_id?: string;
  checkout_cancelled?: boolean;
}

export interface DeskFulfillmentItem {
  line_id: string;
  order_id: string;
  order_reference: string;
  receipt_id: string | null;
  receipt_number: string | null;
  customer_id: string | null;
  user_id: string | null;
  customer_name: string;
  customer_email: string | null;
  identity_state: "account" | "customer" | "guest";
  activity_title: string | null;
  activity_session_id: string | null;
  session_date: string | null;
  source_type: string;
  product_name: string;
  quantity: number;
  unit_price_minor: number;
  order_status: string;
  payment_status: string;
  payment_method: string | null;
  refund_status: string | null;
  fulfillment_status: string;
  fulfilled_at: string | null;
  created_at: string;
  paid_at: string | null;
  pickup_instruction: string;
  pickup_eligible: boolean;
  pickup_block_reason: string | null;
  sku?: string | null;
  variant_label?: string | null;
  collected_quantity: number;
  remaining_quantity: number;
}

export interface DeskFulfillmentResponse {
  items: DeskFulfillmentItem[];
}

export interface StaffCommerceOrderSummary {
  order_id: string;
  order_reference: string;
  customer_id: string | null;
  user_id: string | null;
  customer_name: string;
  customer_email: string | null;
  identity_state: "account" | "customer" | "guest";
  created_at: string;
  paid_at: string | null;
  order_status: string;
  payment_status: string;
  payment_method: string | null;
  total_inc_vat_minor: number;
  currency: string;
  refund_status: string | null;
  products: Array<{
    line_id: string;
    product_name: string;
    quantity: number;
    issued_quantity: number;
    remaining_quantity: number;
    fulfillment_status: string;
    sku: string | null;
    variant_label: string | null;
  }>;
}

export interface StaffCommerceOrderDetail {
  order: {
    id: string;
    venue_id: string;
    customer_id: string | null;
    user_id: string | null;
    order_reference: string;
    status: string;
    payment_status: string;
    payment_method: string | null;
    refund_status: string | null;
    currency: string;
    subtotal_minor: number;
    discount_minor: number;
    total_inc_vat_minor: number;
    total_ex_vat_minor: number;
    vat_amount_minor: number;
    created_at: string;
    checkout_frozen_at: string | null;
    paid_at: string | null;
  };
  customer: {
    customer_id: string | null;
    user_id: string | null;
    name: string;
    canonical_name: string | null;
    email: string | null;
    phone: string | null;
    identity_state: "account" | "customer" | "guest";
  };
  lines: Array<CommerceOrderLine & {
    source_type: string;
    source_id: string | null;
    issued_quantity: number;
    refunded_quantity: number;
    remaining_quantity: number;
    pickup_eligible: boolean;
    pickup_block_reason: string | null;
    activity?: { id: string; name: string; session_type?: string | null; start_time?: string | null; end_time?: string | null } | null;
  }>;
  receipt: Record<string, unknown> | null;
  receipt_lines: Array<Record<string, unknown>>;
  ledger_entries: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  pickup_commands: Array<Record<string, unknown>>;
  audit_events: Array<Record<string, unknown>>;
  history: Array<{
    id: string;
    occurred_at: string;
    type: string;
    label: string;
    actor_user_id?: string | null;
    line_id?: string | null;
  }>;
}

export const COMMERCE_PICKUP_COPY = "Hämtas vid disken.";

export function commercePendingPickupItems(
  lines: CommerceOrderLine[],
  options: { confirmed?: boolean } = {},
) {
  return lines.filter((line) => (
    line.fulfillment_type === "desk_pickup"
    && Number(line.quantity || 0) > 0
    && (!options.confirmed || line.fulfillment_status === "pending_pickup")
  )).map((line) => ({
    lineId: line.id,
    productName: [
      line.product_name,
      line.variant_snapshot?.options?.map((option) => option.value_label).join(" / "),
      line.sku ? `SKU ${line.sku}` : "",
    ].filter(Boolean).join(" · "),
    quantity: Math.max(0, Number(line.quantity || 0) - Number(line.collected_quantity || 0) - Number(line.cancelled_quantity || 0)),
  }));
}

export function formatCommerceMoney(minor: number, currency = "SEK") {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(Number(minor || 0) / 100);
}

export function fetchStaffCommerceOrders(venueId: string, search = "") {
  return apiGet<{ orders: StaffCommerceOrderSummary[] }>("api-commerce", "staff-orders", {
    venueId,
    ...(search.trim() ? { search: search.trim() } : {}),
  });
}

export function fetchStaffCommerceOrder(venueId: string, orderId: string) {
  return apiGet<StaffCommerceOrderDetail>("api-commerce", "staff-order", { venueId, orderId });
}

export function collectCommercePickup(input: {
  venueId: string;
  lineId: string;
  quantity: number;
  idempotencyKey: string;
}) {
  return apiPatch<{ item: DeskFulfillmentItem }>("api-commerce", "fulfillment", {
    venue_id: input.venueId,
    line_id: input.lineId,
    status: "collected",
    quantity: input.quantity,
    idempotency_key: input.idempotencyKey,
  });
}

export function fetchCommerceCatalog(venueId: string, locale: "sv-SE" | "en-SE" = "sv-SE") {
  return apiGet<{
    commerce_available: boolean;
    message: string | null;
    products: CommerceProduct[];
    relationships: CommerceRelationship[];
  }>("api-commerce", "catalog", { venueId, locale });
}

export function createCommerceCart(input: {
  venueId: string;
  items: CommerceCartItemInput[];
  source: string;
  draftScope?: string;
  guestName?: string;
  guestEmail?: string;
  journeyId?: string;
  idempotencyKey?: string;
}, options: ApiRequestOptions = {}) {
  const body = {
    venue_id: input.venueId,
    items: input.items,
    source: input.source,
    ...(input.draftScope ? { draft_scope: input.draftScope } : {}),
    guest_name: input.guestName || null,
    guest_email: input.guestEmail || null,
    ...(input.journeyId ? { journey_id: input.journeyId } : {}),
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
  };
  return Object.keys(options).length > 0
    ? apiPost<CommerceOrderResponse>("api-commerce", "cart", body, options)
    : apiPost<CommerceOrderResponse>("api-commerce", "cart", body);
}

export function updateCommerceCart(input: {
  reference: string;
  expectedVersion: number;
  items: CommerceCartItemInput[];
  guestName?: string;
  guestEmail?: string;
}, options: ApiRequestOptions = {}) {
  return apiPut<CommerceOrderResponse>("api-commerce", "cart", {
    token: input.reference,
    expected_version: input.expectedVersion,
    items: input.items,
    guest_name: input.guestName || null,
    guest_email: input.guestEmail || null,
  }, options);
}

export function commerceCartItemsFromLines(lines: CommerceOrderLine[]): CommerceCartItemInput[] {
  return lines.map((line) => ({
    product_id: String(line.product_id || ""),
    quantity: Number(line.quantity || 0),
    ...(line.activity_session_id ? { activity_session_id: line.activity_session_id } : {}),
    ...(line.session_date ? { session_date: line.session_date } : {}),
    ...(line.variant_id ? { variant_id: line.variant_id } : {}),
    ...(line.pickup_location_id ? { pickup_location_id: line.pickup_location_id } : {}),
  })).filter((item) => item.product_id && item.quantity > 0);
}

export type StandaloneCartIdentity = {
  idempotencyKey: string;
  reference: string;
  owner: "guest" | string;
};

const SHOP_CART_STORAGE_PREFIX = "pickla:commerce:r1b:shop-cart";
export const STANDALONE_CART_UPDATED_EVENT = "pickla:standalone-cart-updated";

export function notifyStandaloneCartUpdated(venueId: string, options: { broadcast?: boolean } = {}) {
  if (typeof window === "undefined") return;
  const updateId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  const detail = { venueId, updateId };
  window.dispatchEvent(new CustomEvent(STANDALONE_CART_UPDATED_EVENT, { detail }));
  if (options.broadcast !== false && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(`pickla-commerce-shop:${venueId}`);
    channel.postMessage(detail);
    channel.close();
  }
}

export function commerceCartQuantitiesFromLines(lines: CommerceOrderLine[]) {
  return Object.fromEntries(lines.map((line) => [
    commerceCartItemKey({
      product_id: String(line.product_id || ""),
      variant_id: line.variant_id || undefined,
      pickup_location_id: line.pickup_location_id || undefined,
    }),
    Math.max(0, Number(line.quantity || 0)),
  ]).filter(([productId]) => Boolean(productId)));
}

export function commerceCartItemKey(item: Pick<CommerceCartItemInput, "product_id" | "variant_id" | "pickup_location_id">) {
  return item.variant_id && item.pickup_location_id
    ? `${item.product_id}::${item.variant_id}::${item.pickup_location_id}`
    : item.product_id;
}

export function commerceCartItemFromKey(key: string, quantity: number): CommerceCartItemInput {
  const [productId, variantId, pickupLocationId] = key.split("::");
  return {
    product_id: productId,
    quantity,
    ...(variantId && pickupLocationId ? { variant_id: variantId, pickup_location_id: pickupLocationId } : {}),
  };
}

export function rebaseCommerceCartQuantities(
  base: Record<string, number>,
  desired: Record<string, number>,
  canonical: Record<string, number>,
) {
  const productIds = new Set([...Object.keys(base), ...Object.keys(desired), ...Object.keys(canonical)]);
  return Object.fromEntries(Array.from(productIds).map((productId) => {
    const delta = Number(desired[productId] || 0) - Number(base[productId] || 0);
    return [productId, Math.max(0, Number(canonical[productId] || 0) + delta)];
  }).filter(([, quantity]) => Number(quantity) > 0));
}

export function isCanonicalStandaloneShopCart(
  response: CommerceOrderResponse | null | undefined,
  venueId?: string | null,
  now = Date.now(),
) {
  if (!response || response.order.status !== "draft" || response.order.draft_scope !== "shop") return false;
  if (venueId && response.order.venue_id !== venueId) return false;
  if (response.order.expires_at && new Date(response.order.expires_at).getTime() <= now) return false;
  return true;
}

export function canonicalStandaloneShopCartCount(
  response: CommerceOrderResponse | null | undefined,
  venueId?: string | null,
) {
  if (!isCanonicalStandaloneShopCart(response, venueId)) return 0;
  return response.lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)), 0);
}

export function isStaleCommerceCartVersion(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; status?: unknown };
  return Number(candidate.status || 0) === 409
    && /cart changed|stale_cart_version|review it again/i.test(String(candidate.message || ""));
}

export function isStandaloneCartOwnerConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; status?: unknown };
  return Number(candidate.status || 0) === 409
    && /shop cart owner conflict/i.test(String(candidate.message || ""));
}

export async function reconcileStandaloneCartUpdate<T>(input: {
  baseQuantities: Record<string, number>;
  desiredQuantities: Record<string, number>;
  currentVersion: number;
  loadCanonical: () => Promise<CommerceOrderResponse>;
  apply: (quantities: Record<string, number>, expectedVersion: number) => Promise<T>;
  onCanonicalLoaded?: (cart: CommerceOrderResponse) => void;
}) {
  try {
    return await input.apply(input.desiredQuantities, input.currentVersion);
  } catch (error) {
    if (!isStaleCommerceCartVersion(error)) throw error;
    const canonical = await input.loadCanonical();
    input.onCanonicalLoaded?.(canonical);
    const rebased = rebaseCommerceCartQuantities(
      input.baseQuantities,
      input.desiredQuantities,
      commerceCartQuantitiesFromLines(canonical.lines),
    );
    return input.apply(rebased, canonical.order.version);
  }
}

function newStandaloneCartKey() {
  if (typeof crypto?.randomUUID === "function") return `${crypto.randomUUID()}${crypto.randomUUID()}`;
  return `${Date.now()}-${Math.random()}-${Math.random()}-${Math.random()}`;
}

export function standaloneCartStorageKey(venueId: string) {
  return `${SHOP_CART_STORAGE_PREFIX}:${venueId}`;
}

export function readStandaloneCartIdentity(venueId: string, userId?: string | null): StandaloneCartIdentity {
  const owner = userId || "guest";
  if (typeof window !== "undefined") {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(standaloneCartStorageKey(venueId)) || "null");
      const compatibleOwner = parsed?.owner === owner || (Boolean(userId) && parsed?.owner === "guest");
      if (compatibleOwner && String(parsed?.idempotencyKey || "").length >= 32) {
        return {
          idempotencyKey: String(parsed.idempotencyKey),
          reference: String(parsed.reference || ""),
          owner: String(parsed.owner) as StandaloneCartIdentity["owner"],
        };
      }
    } catch {
      // A corrupt or unavailable local cart is safely replaced below.
    }
  }
  return { idempotencyKey: newStandaloneCartKey(), reference: "", owner };
}

export function writeStandaloneCartIdentity(venueId: string, identity: StandaloneCartIdentity) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(standaloneCartStorageKey(venueId), JSON.stringify(identity));
    notifyStandaloneCartUpdated(venueId, { broadcast: false });
  } catch {
    // The server cart remains authoritative if local persistence is unavailable.
  }
}

export function clearStandaloneCartIdentity(venueId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(standaloneCartStorageKey(venueId));
    notifyStandaloneCartUpdated(venueId, { broadcast: false });
  } catch {
    // Nothing else to clean up.
  }
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

export function fetchCommerceOrder(token: string, options: ApiRequestOptions = {}, checkoutSessionId = "") {
  return apiGet<CommerceOrderResponse>("api-commerce", "order", {
    token,
    ...(checkoutSessionId ? { session: checkoutSessionId } : {}),
  }, options);
}

export function cancelCommerceCheckout(reference: string, options: ApiRequestOptions = {}) {
  return apiPost<CommerceOrderResponse>("api-commerce", "cancel-checkout", { token: reference }, options);
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

export function checkInCommerceRegistration(venueId: string, registrationId: string) {
  return apiPost<{ checked_in: boolean }>("api-checkins", "self", {
    venue_id: venueId,
    entry_type: "session_ticket",
    entitlement_id: registrationId,
  });
}

export function cancelCommerceActivityOrder(reference: string, options: ApiRequestOptions = {}) {
  return apiPost<CommerceOrderResponse & { cancellation_pending?: boolean }>("api-commerce", "cancel", { reference }, options);
}

export type CommerceRegistrationManagementState =
  | "paid"
  | "free"
  | "pending"
  | "refund_pending"
  | "refunded"
  | "cancelled"
  | "started"
  | "attention"
  | "unmanaged";

export interface CommerceRegistrationManagement {
  available: boolean;
  state: CommerceRegistrationManagementState;
  order_id?: string;
  registration_id?: string;
  paid?: boolean;
  cancellation_pending?: boolean;
  participation_status?: string;
  has_place?: boolean;
  receipt_payment_status?: string | null;
  policy?: "before_activity_start";
}

export function fetchCommerceRegistrationManagement(registrationId: string) {
  return apiGet<CommerceRegistrationManagement>("api-commerce", "registration-order", { registrationId });
}

export async function resumeCommerceActivityDraft(
  venueId: string,
  scope: string,
  options: ApiRequestOptions = {},
) {
  try {
    const expectedStatuses = Array.from(new Set([...(options.expectedStatuses || []), 404]));
    return await apiGet<CommerceOrderResponse>("api-commerce", "draft", {
      venueId,
      scope,
    }, { ...options, expectedStatuses });
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

export function clearActivityCommerceSelection(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
    window.sessionStorage.removeItem(`${key}:purchase-kind`);
  } catch {
    // A completed purchase remains durable even when browser storage is unavailable.
  }
}
