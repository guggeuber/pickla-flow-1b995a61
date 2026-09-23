import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commerceSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const adminSource = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const commerceClientSource = readFileSync("src/lib/commerce.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260923120000_storefront_v1_product_presentation.sql",
  "utf8",
);

describe("Storefront V1 server contracts", () => {
  it("keeps presentation separate from canonical commercial truth", () => {
    const tableStart = migration.indexOf("CREATE TABLE public.commerce_product_presentations");
    const tableEnd = migration.indexOf("CREATE UNIQUE INDEX", tableStart);
    const table = migration.slice(tableStart, tableEnd);
    expect(table).toContain("product_id UUID NOT NULL REFERENCES public.access_products");
    expect(table).toContain("publication_state TEXT NOT NULL");
    expect(table).not.toMatch(/\b(price|vat|sku|inventory|stock|discount)_/i);
  });

  it("scopes color media to a canonical option value and rejects cross-product association", () => {
    expect(migration).toContain("ADD COLUMN option_value_id UUID REFERENCES public.product_option_values(id) ON DELETE RESTRICT");
    expect(migration).toContain("product_option.product_id = NEW.product_id");
    expect(migration).toContain("product_media_option_value_scope_mismatch");
    expect(adminSource).toContain("action === 'scope'");
    expect(adminSource).toContain("option_value_id: optionValueId");
  });

  it("hides draft presentation and media while retaining legacy media behavior", () => {
    expect(migration).toContain("publication_state = 'published'");
    expect(migration).toContain("storefront_product_media_is_public");
    expect(migration).toContain("SECURITY DEFINER");
    expect(commerceSource).toContain("productsWithPublishedPresentation");
    expect(commerceSource).toContain("productsWithPresentation.has(productId) && !productsWithPublishedPresentation.has(productId)");
    expect(commerceSource).toContain("storefrontProductIsPublicForLocale(");
    expect(commerceSource).toContain("productsWithPublishedPresentationForLocale");
    expect(commerceSource).toContain("Product image not found");
    expect(commerceSource).toContain("STOREFRONT_MEDIA_CACHE_HEADERS");
  });

  it("uses one pricing resolver for catalog, cart freeze and Stripe net amount", () => {
    expect(commerceSource.match(/loadCommerceProductPricingContext/g)?.length).toBeGreaterThanOrEqual(3);
    expect(commerceSource.match(/resolveCommerceProductPrice/g)?.length).toBeGreaterThanOrEqual(4);
    expect(commerceSource).toContain("discountMinor = productPrice.discount_minor * Number(line.quantity || 1)");
    expect(commerceSource.match(/Number\(line\.unit_price_minor\) \* Number\(line\.quantity \|\| 1\) - Number\(line\.discount_minor \|\| 0\)/g)?.length).toBe(2);
  });

  it("preserves R2A location inventory and checkout authority", () => {
    expect(commerceSource).toContain("Number(level.on_hand) - Number(level.reserved) - Number(level.allocated)");
    expect(commerceSource).toContain("p_provider_idempotency_key");
    expect(commerceSource).toContain("commerce_r2a_prepare_checkout");
    expect(commerceSource).toContain("tracked_activity_addon_unsupported");
  });

  it("never serves stale catalog pricing, inventory or cover media", () => {
    expect(commerceSource).toContain("return privateJsonResponse({");
    expect(commerceClientSource).toContain('{ cache: "no-store" }');
  });

  it("validates privacy-safe storefront events against venue, product and variant", () => {
    expect(commerceSource).toContain("STOREFRONT_COMMERCE_EVENTS");
    expect(commerceSource).toContain(".eq('product_id', productId)");
    expect(commerceSource).toContain(".eq('venue_id', venueId)");
    expect(commerceSource).toContain("validatedVariantId = variant.id");
    expect(commerceSource).toContain("journey_id_hash");
  });

  it("returns authorization failures as forbidden without weakening role checks", () => {
    expect(commerceSource).toContain("message.startsWith('Forbidden')");
    expect(commerceSource).toContain("requireVenueRole(");
  });
});
