import { apiGet, apiPost } from "@/lib/api";

const COMMERCE_DRAFT_STORAGE_KEY = "pickla:commerce:draft-ref";

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
  activity_session_id?: string | null;
  session_date?: string | null;
  session_registration_id?: string | null;
  parent_line_id?: string | null;
}

export interface CommerceOrderResponse {
  order: {
    id: string;
    venue_id: string;
    draft_scope: string;
    status: string;
    version: number;
    currency: string;
    subtotal_minor: number;
    discount_minor: number;
    total_inc_vat_minor: number;
    total_ex_vat_minor: number;
    vat_amount_minor: number;
    contact_email_present: boolean;
    paid_at?: string | null;
    booking_receipt_id?: string | null;
  };
  lines: CommerceOrderLine[];
  receipt?: Record<string, unknown> | null;
  receipt_lines?: CommerceOrderLine[];
  draft_ref?: string;
}

export interface CommerceResolvedOrder {
  order: {
    id: string;
    version: number;
    currency: string;
    subtotal_minor: number;
    discount_minor: number;
    total_inc_vat_minor: number;
    total_ex_vat_minor: number;
    vat_amount_minor: number;
  };
  lines: CommerceOrderLine[];
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
  draftScope: string;
  draftRef?: string | null;
  guestName?: string;
  guestEmail?: string;
}) {
  return apiPost<CommerceOrderResponse>("api-commerce", "cart", {
    venue_id: input.venueId,
    items: input.items,
    source: input.source,
    draft_scope: input.draftScope,
    draft_ref: input.draftRef || null,
    guest_name: input.guestName || null,
    guest_email: input.guestEmail || null,
  });
}

export function fetchCommerceOrder(reference: string) {
  return apiGet<CommerceOrderResponse>("api-commerce", "order", { ref: reference });
}

export function resumeCommerceDraft(venueId: string, scope: string) {
  return apiGet<CommerceOrderResponse>("api-commerce", "draft", {
    venueId,
    scope,
  });
}

export function readCommerceDraftReference() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(COMMERCE_DRAFT_STORAGE_KEY) || "";
}

export function rememberCommerceDraftReference(reference: string) {
  if (typeof window === "undefined") return;
  const cleanReference = String(reference || "").trim();
  if (!cleanReference) return;
  window.sessionStorage.setItem(COMMERCE_DRAFT_STORAGE_KEY, cleanReference);
}

export function clearCommerceDraftReference() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(COMMERCE_DRAFT_STORAGE_KEY);
}
