import { apiGet, apiPost } from "@/lib/api";

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
  line_total_inc_vat_minor: number;
  vat_rate: number;
  vat_amount_minor: number;
  fulfillment_type: string;
  fulfillment_status: string;
  session_registration_id?: string | null;
  parent_line_id?: string | null;
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
    guest_name?: string | null;
    guest_email?: string | null;
    paid_at?: string | null;
  };
  lines: CommerceOrderLine[];
  receipt?: Record<string, unknown> | null;
  receipt_lines?: CommerceOrderLine[];
  cart_token?: string;
}

export function formatCommerceMoney(minor: number, currency = "SEK") {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(Number(minor || 0) / 100);
}

export function fetchCommerceCatalog(venueId: string) {
  return apiGet<{ products: CommerceProduct[]; relationships: CommerceRelationship[] }>("api-commerce", "catalog", { venueId });
}

export function createCommerceCart(input: {
  venueId: string;
  items: CommerceCartItemInput[];
  source: string;
  guestName?: string;
  guestEmail?: string;
}) {
  return apiPost<CommerceOrderResponse>("api-commerce", "cart", {
    venue_id: input.venueId,
    items: input.items,
    source: input.source,
    guest_name: input.guestName || null,
    guest_email: input.guestEmail || null,
  });
}

export function fetchCommerceOrder(token: string) {
  return apiGet<CommerceOrderResponse>("api-commerce", "order", { token });
}
