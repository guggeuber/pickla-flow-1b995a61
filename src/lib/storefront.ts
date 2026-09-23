import type {
  CommerceProduct,
  CommerceProductMedia,
  CommerceResolvedPrice,
  CommerceVariant,
  CommerceVariantOption,
} from "@/lib/commerce";

export const STOREFRONT_COLOR_OPTION_CODE = "color";
export const STOREFRONT_SIZE_OPTION_CODE = "size";

export type StorefrontOption = {
  id: string;
  code: string;
  label: string;
  values: Array<Pick<CommerceVariantOption, "value_id" | "value_code" | "value_label" | "swatch">>;
};

export type StorefrontAvailability = {
  state: "available" | "low_stock" | "sold_out" | "unavailable";
  availableToSell: number | null;
  label: string;
};

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return Array.from(new Map(items.map((item) => [key(item), item])).values());
}

export function storefrontOptions(product: CommerceProduct): StorefrontOption[] {
  const facts = (product.variants || []).flatMap((variant) => variant.options || []);
  return uniqueBy(facts, (fact) => fact.option_id).map((option) => ({
    id: option.option_id,
    code: option.option_code,
    label: option.option_label,
    values: uniqueBy(
      facts.filter((fact) => fact.option_id === option.option_id),
      (fact) => fact.value_id,
    ).map((fact) => ({
      value_id: fact.value_id,
      value_code: fact.value_code,
      value_label: fact.value_label,
      swatch: fact.swatch,
    })),
  }));
}

export function storefrontVariantMatches(
  variant: CommerceVariant,
  selections: Record<string, string>,
) {
  return Object.entries(selections).every(([optionCode, valueId]) => (
    !valueId || variant.options.some((option) => option.option_code === optionCode && option.value_id === valueId)
  ));
}

export function resolveStorefrontVariant(
  product: CommerceProduct,
  selections: Record<string, string>,
) {
  const options = storefrontOptions(product);
  if (options.some((option) => !selections[option.code])) return null;
  return (product.variants || []).find((variant) => (
    variant.status === "active"
    && variant.options.length === options.length
    && storefrontVariantMatches(variant, selections)
  )) || null;
}

export function storefrontOptionValueState(input: {
  product: CommerceProduct;
  optionCode: string;
  valueId: string;
  selections: Record<string, string>;
}) {
  const nextSelections = { ...input.selections, [input.optionCode]: input.valueId };
  const candidates = (input.product.variants || []).filter((variant) => (
    variant.status === "active" && storefrontVariantMatches(variant, nextSelections)
  ));
  return {
    exists: candidates.length > 0,
    available: candidates.some((variant) => !variant.sold_out && Number(variant.available_to_sell || 0) > 0),
  };
}

export function storefrontAvailability(
  product: CommerceProduct,
  variant: CommerceVariant | null,
): StorefrontAvailability {
  if (product.inventory_policy !== "tracked") {
    return { state: "available", availableToSell: null, label: "Tillgänglig" };
  }
  if (!product.listing || !variant) {
    return { state: "unavailable", availableToSell: null, label: "Välj alternativ" };
  }
  const quantity = Math.max(0, Number(variant.available_to_sell || 0));
  if (variant.sold_out || quantity <= 0) {
    return { state: "sold_out", availableToSell: 0, label: "Slutsåld" };
  }
  const threshold = Math.max(0, Number(product.presentation?.low_stock_threshold ?? 3));
  if (threshold > 0 && quantity <= threshold) {
    return { state: "low_stock", availableToSell: quantity, label: `Endast ${quantity} kvar` };
  }
  return { state: "available", availableToSell: quantity, label: "Finns att hämta" };
}

export function storefrontPrice(product: CommerceProduct, variant?: CommerceVariant | null): CommerceResolvedPrice {
  const publicPriceMinor = variant?.price_override_minor ?? Math.round(Number(product.base_price_sek || 0) * 100);
  return variant?.pricing || product.pricing || {
    public_price_minor: publicPriceMinor,
    resolved_price_minor: publicPriceMinor,
    discount_minor: 0,
    pricing_source: variant?.price_override_minor != null ? "variant_price_override" : "product_base_price",
    membership_id: null,
    membership_tier_id: null,
    membership_tier_name: null,
  };
}

export function storefrontMedia(product: CommerceProduct, colorValueId?: string | null): CommerceProductMedia[] {
  const media = [...(product.media || [])].sort((left, right) => (
    Number(right.is_cover) - Number(left.is_cover)
    || Number(left.sort_order) - Number(right.sort_order)
    || left.id.localeCompare(right.id)
  ));
  const shared = media.filter((item) => !item.option_value_id);
  const scoped = colorValueId ? media.filter((item) => item.option_value_id === colorValueId) : [];
  if (scoped.length > 0) return [...scoped, ...shared];
  if (shared.length > 0) return shared;
  if (media.length > 0 && !colorValueId) return media;
  if (product.image_url) {
    return [{
      id: `${product.id}-legacy-cover`,
      url: product.image_url,
      alt_text: product.name,
      sort_order: 0,
      is_cover: true,
      option_value_id: null,
    }];
  }
  return [];
}

export function storefrontImageUrl(url: string, width: number) {
  if (!url.includes("/functions/v1/api-commerce/product-media")) return url;
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "https://playpickla.com" : window.location.origin);
    parsed.searchParams.set("width", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function storefrontImageSources(url: string) {
  if (!url.includes("/functions/v1/api-commerce/product-media")) return { src: url, srcSet: undefined };
  const widths = [320, 480, 640, 720, 960, 1280, 1600];
  return {
    src: storefrontImageUrl(url, 960),
    srcSet: widths.map((width) => `${storefrontImageUrl(url, width)} ${width}w`).join(", "),
  };
}

export function isEnhancedStorefrontProduct(product: CommerceProduct) {
  return product.presentation?.publication_state === "published" && Boolean(product.presentation.slug);
}

export function storefrontProductPath(product: CommerceProduct, venueSlug: string) {
  return product.presentation?.slug
    ? `/shop/products/${encodeURIComponent(product.presentation.slug)}?v=${encodeURIComponent(venueSlug)}`
    : `/shop?v=${encodeURIComponent(venueSlug)}`;
}

export function storefrontErrorMessage(error: unknown) {
  const message = String((error as { message?: unknown })?.message || error || "");
  if (/inventory|sold out|out.of.stock|reservation|slutsåld/i.test(message)) {
    return "Tillgängligheten har ändrats. Vi har uppdaterat din varukorg.";
  }
  if (/variant_required|required option|select.*size/i.test(message)) return "Välj storlek först.";
  if (/cart changed|stale_cart_version/i.test(message)) return "Varukorgen ändrades. Kontrollera den igen.";
  return "Något gick fel. Försök igen.";
}
