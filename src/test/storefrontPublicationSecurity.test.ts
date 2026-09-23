import { describe, expect, it } from "vitest";
import {
  STOREFRONT_MEDIA_CACHE_HEADERS,
  storefrontProductIsPublicForLocale,
} from "../../supabase/functions/_shared/storefront_publication";

describe("Storefront publication security", () => {
  it("keeps true legacy products public without requiring presentation rows", () => {
    expect(storefrontProductIsPublicForLocale(
      "legacy-product",
      new Set(),
      new Set(),
    )).toBe(true);
  });

  it("never falls an enhanced draft or archived product back to the legacy storefront", () => {
    const enhancedProducts = new Set(["draft-product", "archived-product"]);
    expect(storefrontProductIsPublicForLocale("draft-product", enhancedProducts, new Set())).toBe(false);
    expect(storefrontProductIsPublicForLocale("archived-product", enhancedProducts, new Set())).toBe(false);
  });

  it("requires publication in the requested locale", () => {
    const enhancedProducts = new Set(["tee"]);
    expect(storefrontProductIsPublicForLocale("tee", enhancedProducts, new Set(["tee"]))).toBe(true);
    expect(storefrontProductIsPublicForLocale("tee", enhancedProducts, new Set())).toBe(false);
  });

  it("makes product media immediately revocable across browsers and shared caches", () => {
    expect(STOREFRONT_MEDIA_CACHE_HEADERS["Cache-Control"]).toContain("no-store");
    expect(STOREFRONT_MEDIA_CACHE_HEADERS["Cache-Control"]).not.toContain("public");
    expect(STOREFRONT_MEDIA_CACHE_HEADERS["CDN-Cache-Control"]).toBe("no-store");
    expect(STOREFRONT_MEDIA_CACHE_HEADERS["Vercel-CDN-Cache-Control"]).toBe("no-store");
    expect(STOREFRONT_MEDIA_CACHE_HEADERS["Surrogate-Control"]).toBe("no-store");
  });
});
