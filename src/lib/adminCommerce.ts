import type { ProductCatalogStatus } from "@/lib/adminProductCatalog";

export type CommerceSection = "products" | "inventory" | "orders";
export type ProductDetailTab = "overview" | "variants" | "inventory" | "sales" | "orders";

export type InventorySummary = {
  on_hand: number;
  reserved: number;
  allocated: number;
  available_to_sell: number;
  incident_blocked: boolean;
  configured: boolean;
  sold_out: boolean;
  low_stock: boolean;
};

export type ProductMedia = {
  id: string;
  product_id: string;
  venue_id: string;
  storage_bucket: "product-media" | "legacy-external";
  storage_path: string;
  public_url: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_cover: boolean;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type AdminCommerceProduct = {
  id: string;
  product_key: string;
  name: string;
  description: string | null;
  product_kind: string;
  session_type: string | null;
  base_price_sek: number;
  vat_rate: number;
  is_active: boolean;
  sort_order: number;
  commerce_kind: "participation" | "rental" | "merchandise" | null;
  fulfillment_type: "participation" | "desk_pickup" | null;
  commerce_enabled: boolean;
  status: ProductCatalogStatus;
  standalone_enabled: boolean;
  activity_addon_enabled: boolean;
  fulfillment_presentation: "desk_pickup" | "digital" | "participation" | null;
  category: string | null;
  sport: string | null;
  image_url: string | null;
  media?: ProductMedia[];
  venue_commerce_enabled?: boolean;
  store_eligible?: boolean;
  activity_addon_eligible?: boolean;
  sales_state_label?: string;
  sales_block_reason?: string | null;
  store_path?: string | null;
  inventory_policy: "stockless" | "tracked";
  catalog_owner_organization_id?: string | null;
  variant_count?: number;
  active_variant_count?: number;
  listing?: null | {
    id: string;
    status: string;
    tracked_sales_enabled: boolean;
    default_inventory_location_id: string;
    location_name: string | null;
  };
  inventory_summary?: InventorySummary;
};

export type OptionValue = { id: string; code: string; label: string; swatch: string | null; status: string };
export type ProductOption = { id: string; code: string; label: string; product_option_values: OptionValue[] };
export type ProductVariant = {
  id: string;
  sku: string;
  title: string | null;
  price_override_minor: number | null;
  image_url: string | null;
  status: string;
  product_variant_option_values: Array<{ option_id: string; option_value_id: string }>;
  inventory: null | {
    id: string;
    on_hand: number;
    reserved: number;
    allocated: number;
    available_to_sell: number;
    version: number;
    incident_blocked: boolean;
  };
};

export type TrackedProductDetail = {
  product: { id: string; inventory_policy: string };
  venue: {
    franchisee_id: string | null;
    tracked_merch_sales_enabled: boolean;
    franchisees: { id: string; legal_name: string } | Array<{ id: string; legal_name: string }> | null;
  } | null;
  listing: null | {
    id: string;
    tracked_sales_enabled: boolean;
    default_inventory_location_id: string;
    inventory_locations: { name: string } | Array<{ name: string }> | null;
  };
  options: ProductOption[];
  variants: ProductVariant[];
};

export type CommerceOrderLine = {
  id: string;
  commerce_order_id: string;
  product_id: string | null;
  product_key: string;
  product_name: string;
  commerce_kind: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_inc_vat_minor: number;
  vat_rate: number;
  vat_amount_minor: number;
  fulfillment_type: string;
  fulfillment_status: string;
  variant_id: string | null;
  sku: string | null;
  inventory_policy: string;
  variant_snapshot: Record<string, unknown> | null;
  collected_quantity: number;
  cancelled_quantity: number;
};

export type CommerceOrder = {
  id: string;
  customer_id: string | null;
  user_id: string | null;
  status: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  total_inc_vat_minor: number;
  total_ex_vat_minor: number;
  vat_amount_minor: number;
  guest_name: string | null;
  paid_at: string | null;
  created_at: string;
  booking_receipts: { receipt_number: string; payment_status: string } | Array<{ receipt_number: string; payment_status: string }> | null;
  lines: CommerceOrderLine[];
};

export type InventoryOperations = {
  locations: Array<{ id: string; name: string; status: string }>;
  levels: Array<{
    id: string;
    variant_id: string;
    location_id: string;
    on_hand: number;
    reserved: number;
    allocated: number;
    available_to_sell: number;
    version: number;
    incident_blocked: boolean;
    product_variants: { id: string; product_id: string; sku: string; title: string | null; status: string } | Array<{ id: string; product_id: string; sku: string; title: string | null; status: string }>;
  }>;
  movements: Array<{
    id: string;
    variant_id: string;
    location_id: string;
    movement_type: string;
    on_hand_delta: number;
    reserved_delta: number;
    allocated_delta: number;
    source_entity_type: string;
    source_entity_id: string;
    reason: string;
    occurred_at: string;
  }>;
  incidents: Array<{
    id: string;
    incident_type: string;
    deficit_quantity: number;
    status: string;
    blocking: boolean;
    opened_at: string;
    inventory_levels: { variant_id: string; location_id: string } | Array<{ variant_id: string; location_id: string }>;
  }>;
  attempts: Array<{ id: string; commerce_order_id: string; status: string; last_error: string | null; recovery_attempts: number }>;
  refunds: Array<{
    id: string;
    commerce_order_id: string;
    status: string;
    amount_inc_vat_minor: number;
    unallocated_amount_minor: number;
    provider_refund_id: string | null;
    commerce_refund_lines: Array<{ commerce_order_line_id: string; quantity: number }>;
  }>;
  allocations: Array<{
    id: string;
    commerce_order_id: string;
    commerce_order_line_id: string;
    variant_id: string;
    location_id: string;
    quantity: number;
    collected_quantity: number;
    cancelled_quantity: number;
    status: string;
  }>;
  dispositions: Array<{
    id: string;
    commerce_order_id: string;
    commerce_order_line_id: string;
    refund_id: string | null;
    outcome: string;
    quantity: number;
    reason: string;
    created_at: string;
  }>;
  orders: CommerceOrder[];
  orders_page: { has_more: boolean; next_before: string | null };
  movements_page: { has_more: boolean; next_before: string | null };
};

export const sekFromMinor = (minor: number) => `${(Number(minor || 0) / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
export const sek = (amount: number) => `${Number(amount || 0).toLocaleString("sv-SE")} kr`;

export function normalizeCode(value: string) {
  return value.trim().toLocaleLowerCase("sv-SE")
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function skuPart(value: string) {
  const clean = normalizeCode(value).toUpperCase().replace(/-/g, "");
  if (clean === "BLACK") return "BLK";
  if (clean === "OFFWHITE") return "OFF";
  return clean.length <= 4 ? clean : clean.slice(0, 3);
}

export function skuBaseFromName(name: string) {
  const words = normalizeCode(name).split("-").filter(Boolean);
  if (!words.length) return "SKU";
  if (words[0] === "pickla") return ["PCL", words.at(-1)?.slice(0, 4).toUpperCase()].filter(Boolean).join("-");
  if (words.length === 1) return words[0].slice(0, 8).toUpperCase();
  return `${words.slice(0, -1).map((word) => word[0]).join("").slice(0, 4)}-${words.at(-1)?.slice(0, 4)}`.toUpperCase();
}

export type VariantMatrixRow = { key: string; color: string; size: string; sku: string; priceOverride: string };

export function buildVariantMatrix(name: string, colors: string[], sizes: string[], existing: Record<string, Pick<VariantMatrixRow, "sku" | "priceOverride">> = {}) {
  const base = skuBaseFromName(name);
  return colors.flatMap((color) => sizes.map((size) => {
    const key = `${normalizeCode(color)}:${normalizeCode(size)}`;
    return {
      key,
      color,
      size,
      sku: existing[key]?.sku || `${base}-${skuPart(color)}-${skuPart(size)}`,
      priceOverride: existing[key]?.priceOverride || "",
    };
  }));
}

export function variantLabel(variant: ProductVariant, options: ProductOption[]) {
  const selected = new Map(variant.product_variant_option_values.map((value) => [value.option_id, value.option_value_id]));
  const labels = options.map((option) => option.product_option_values.find((value) => value.id === selected.get(option.id))?.label).filter(Boolean);
  return labels.length ? labels.join(" / ") : variant.title || variant.sku;
}

export function productInventoryState(product: AdminCommerceProduct) {
  if (product.inventory_policy !== "tracked") return "Lager ej spårat";
  if (!product.listing || !product.variant_count) return "Ej konfigurerad";
  if (product.inventory_summary?.incident_blocked) return "Blockerad";
  if (!product.inventory_summary?.configured) return "Saldo saknas";
  if (product.inventory_summary.sold_out) return "Slutsåld";
  if (product.inventory_summary.low_stock) return "Lågt lager";
  return `${product.inventory_summary?.available_to_sell ?? 0} tillgängliga`;
}
