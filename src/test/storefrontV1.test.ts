import { describe, expect, it } from "vitest";
import type { CommerceProduct, CommerceVariant, CommerceVariantOption } from "@/lib/commerce";
import {
  isEnhancedStorefrontProduct,
  resolveStorefrontVariant,
  storefrontAvailability,
  storefrontErrorMessage,
  storefrontImageSources,
  storefrontMedia,
  storefrontOptionValueState,
  storefrontOptions,
  storefrontPrice,
  storefrontProductPath,
} from "@/lib/storefront";
import { resolveCommerceProductPrice } from "../../supabase/functions/_shared/commerce_product_pricing";

const colorOptionId = "option-color";
const sizeOptionId = "option-size";

function option(
  optionId: string,
  optionCode: string,
  optionLabel: string,
  valueId: string,
  valueCode: string,
  valueLabel: string,
  swatch: string | null = null,
): CommerceVariantOption {
  return {
    option_id: optionId,
    option_code: optionCode,
    option_label: optionLabel,
    value_id: valueId,
    value_code: valueCode,
    value_label: valueLabel,
    swatch,
  };
}

function variant(
  color: "black" | "off-white",
  size: "s" | "m" | "l" | "xl",
  availableToSell: number,
  overrides: Partial<CommerceVariant> = {},
): CommerceVariant {
  return {
    id: `${color}-${size}`,
    product_id: "tee",
    sku: `PCT-${color === "black" ? "BLK" : "OW"}-${size.toUpperCase()}`,
    title: `${color} / ${size}`,
    price_override_minor: null,
    image_url: null,
    status: "active",
    available_to_sell: availableToSell,
    sold_out: availableToSell <= 0,
    options: [
      option(colorOptionId, "color", "Färg", color, color, color === "black" ? "Black" : "Off-white", color === "black" ? "#111111" : "#f4f0e7"),
      option(sizeOptionId, "size", "Storlek", size, size, size.toUpperCase()),
    ],
    ...overrides,
  };
}

function tee(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    id: "tee",
    venue_id: "venue-solna",
    product_key: "pickla_classic_tee",
    product_kind: "merchandise",
    name: "Pickla Classic Tee",
    description: "Synthetic test tee",
    commerce_kind: "merchandise",
    fulfillment_type: "desk_pickup",
    fulfillment_presentation: "desk_pickup",
    base_price_sek: 299,
    vat_rate: 25,
    sort_order: 10,
    status: "active",
    is_active: true,
    standalone_enabled: true,
    activity_addon_enabled: false,
    category: "apparel",
    sport: "pickleball",
    image_url: "https://legacy.example/tee.webp",
    inventory_policy: "tracked",
    listing: {
      id: "listing-solna",
      pickup_location_id: "location-solna",
      pickup_location_name: "Pickla Solna",
      currency: "SEK",
    },
    presentation: {
      id: "presentation-sv",
      product_id: "tee",
      locale: "sv-SE",
      slug: "pickla-classic-tee",
      short_description: "En tee för banan och resten av dagen.",
      long_description: "Test copy",
      material: "100% cotton",
      fit: "Regular",
      care: "30 degrees",
      returns_policy: "Return at desk",
      size_guide: {},
      seo_title: null,
      seo_description: null,
      publication_state: "published",
      low_stock_threshold: 2,
      published_at: "2026-09-23T08:00:00Z",
    },
    variants: [
      variant("black", "s", 4), variant("black", "m", 2),
      variant("black", "l", 0), variant("black", "xl", 1),
      variant("off-white", "s", 4), variant("off-white", "m", 4),
      variant("off-white", "l", 3), variant("off-white", "xl", 0),
    ],
    media: [
      { id: "shared", url: "https://example.test/functions/v1/api-commerce/product-media?id=shared", alt_text: "Pickla mark", sort_order: 2, is_cover: false, option_value_id: null },
      { id: "black-front", url: "https://example.test/functions/v1/api-commerce/product-media?id=black-front", alt_text: "Black front", sort_order: 0, is_cover: true, option_value_id: "black" },
      { id: "black-back", url: "https://example.test/functions/v1/api-commerce/product-media?id=black-back", alt_text: "Black back", sort_order: 1, is_cover: false, option_value_id: "black" },
      { id: "white-front", url: "https://example.test/functions/v1/api-commerce/product-media?id=white-front", alt_text: "Off-white front", sort_order: 0, is_cover: false, option_value_id: "off-white" },
    ],
    ...overrides,
  };
}

describe("Storefront V1 canonical variant selection", () => {
  it("builds color and size controls from canonical option/value identity", () => {
    const options = storefrontOptions(tee());
    expect(options.map((item) => item.code)).toEqual(["color", "size"]);
    expect(options[0].values.map((value) => value.value_id)).toEqual(["black", "off-white"]);
    expect(options[1].values.map((value) => value.value_id)).toEqual(["s", "m", "l", "xl"]);
  });

  it("resolves exactly one canonical SKU and never invents an incomplete variant", () => {
    const product = tee();
    expect(resolveStorefrontVariant(product, { color: "black", size: "m" })?.sku).toBe("PCT-BLK-M");
    expect(resolveStorefrontVariant(product, { color: "black" })).toBeNull();
    expect(resolveStorefrontVariant(product, { color: "black", size: "xxl" })).toBeNull();
    expect(resolveStorefrontVariant(tee({ variants: [variant("black", "m", 2, { status: "archived" })] }), { color: "black", size: "m" })).toBeNull();
  });

  it("disables impossible and sold-out combinations while preserving other colors", () => {
    const product = tee();
    expect(storefrontOptionValueState({ product, optionCode: "size", valueId: "l", selections: { color: "black" } })).toEqual({ exists: true, available: false });
    expect(storefrontOptionValueState({ product, optionCode: "size", valueId: "l", selections: { color: "off-white" } })).toEqual({ exists: true, available: true });
    expect(storefrontOptionValueState({ product, optionCode: "size", valueId: "xxl", selections: { color: "black" } })).toEqual({ exists: false, available: false });
  });
});

describe("Storefront V1 inventory and location presentation", () => {
  it("uses canonical available-to-sell for available, low-stock and sold-out states", () => {
    const product = tee();
    expect(storefrontAvailability(product, variant("black", "s", 4))).toMatchObject({ state: "available", availableToSell: 4 });
    expect(storefrontAvailability(product, variant("black", "m", 2))).toEqual({ state: "low_stock", availableToSell: 2, label: "Endast 2 kvar" });
    expect(storefrontAvailability(product, variant("black", "l", 0))).toEqual({ state: "sold_out", availableToSell: 0, label: "Slutsåld" });
  });

  it("fails closed when a tracked location or exact variant is missing", () => {
    expect(storefrontAvailability(tee({ listing: null }), variant("black", "m", 2)).state).toBe("unavailable");
    expect(storefrontAvailability(tee(), null).state).toBe("unavailable");
    expect(storefrontAvailability(tee(), variant("black", "m", 0, { sold_out: true })).state).toBe("sold_out");
  });
});

describe("Storefront V1 media, routing and pricing projections", () => {
  it("switches to color-scoped media, retains shared assets and supports legacy cover", () => {
    expect(storefrontMedia(tee(), "black").map((media) => media.id)).toEqual(["black-front", "black-back", "shared"]);
    expect(storefrontMedia(tee(), "off-white").map((media) => media.id)).toEqual(["white-front", "shared"]);
    expect(storefrontMedia(tee({ media: [] }), "black")[0]).toMatchObject({ id: "tee-legacy-cover", url: "https://legacy.example/tee.webp" });
  });

  it("generates bounded responsive variants only for canonical media delivery", () => {
    const canonical = storefrontImageSources("https://example.test/functions/v1/api-commerce/product-media?id=black-front");
    expect(canonical.src).toContain("width=960");
    expect(canonical.srcSet).toContain("320w");
    expect(canonical.srcSet).toContain("1600w");
    expect(storefrontImageSources("https://legacy.example/tee.webp")).toEqual({ src: "https://legacy.example/tee.webp", srcSet: undefined });
  });

  it("keeps slug as routing presentation while product id stays canonical", () => {
    const product = tee();
    expect(isEnhancedStorefrontProduct(product)).toBe(true);
    expect(storefrontProductPath(product, "pickla-solna")).toBe("/shop/products/pickla-classic-tee?v=pickla-solna");
    expect(isEnhancedStorefrontProduct(tee({ presentation: { ...product.presentation!, publication_state: "draft" } }))).toBe(false);
  });

  it("shows canonical public, variant and membership prices without storefront overrides", () => {
    expect(storefrontPrice(tee()).resolved_price_minor).toBe(29900);
    expect(storefrontPrice(tee(), variant("black", "m", 2, { price_override_minor: 32900 }))).toMatchObject({ public_price_minor: 32900, resolved_price_minor: 32900, pricing_source: "variant_price_override" });
    expect(resolveCommerceProductPrice({
      context: {
        membershipId: "membership-founder",
        membershipTierId: "tier-founder",
        membershipTierName: "Founder",
        rows: [{ product_type: "pickla_classic_tee", fixed_price: null, discount_percent: 20 }],
      },
      productKey: "pickla_classic_tee",
      publicPriceMinor: 29900,
    })).toMatchObject({
      public_price_minor: 29900,
      resolved_price_minor: 23920,
      discount_minor: 5980,
      pricing_source: "membership_tier_pricing",
      membership_tier_name: "Founder",
    });
  });

  it("translates Commerce conflicts into human retail messages", () => {
    expect(storefrontErrorMessage(new Error("reservation_conflict"))).toContain("Tillgängligheten har ändrats");
    expect(storefrontErrorMessage(new Error("VARIANT_REQUIRED"))).toBe("Välj storlek först.");
    expect(storefrontErrorMessage(new Error("stale_cart_version"))).toContain("Varukorgen ändrades");
  });
});
