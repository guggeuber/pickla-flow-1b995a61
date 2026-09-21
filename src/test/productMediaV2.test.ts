import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260921120000_product_media_gallery.sql", "utf8");
const adminApi = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const commerceApi = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const adminExperience = readFileSync("src/components/admin/commerce/AdminCommerceWorkspace.tsx", "utf8");
const mediaEditor = readFileSync("src/components/admin/commerce/ProductMediaEditor.tsx", "utf8");
const shop = readFileSync("src/pages/CommerceShopPage.tsx", "utf8");

describe("Admin Commerce product media V2 contracts", () => {
  it("adds ordered stable media while keeping image_url as the cover projection", () => {
    expect(migration).toContain("CREATE TABLE public.product_media");
    expect(migration).toContain("CREATE UNIQUE INDEX uq_product_media_active_cover");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.reorder_product_media");
    expect(migration).toContain("UPDATE public.access_products SET image_url = v_cover_url");
    expect(migration).toContain("'legacy-external'");
    expect(migration).toContain("WHERE p.image_url IS NOT NULL");
    expect(migration).not.toContain("image_url_2");
  });

  it("keeps storage private and every mutation behind authenticated Admin service commands", () => {
    expect(migration).toMatch(/'product-media',[\s\S]*?'product-media',[\s\S]*?false,/);
    expect(migration).toContain("REVOKE ALL ON TABLE public.product_media FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.add_product_media");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain('CREATE POLICY "Authenticated can upload product media"');
    expect(adminApi).toContain("req.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')");
    expect(adminApi).toContain("requireVenueRole(admin, userId, venueId, ['venue_admin'])");
    expect(adminApi).toContain("PRODUCT_MEDIA_TYPES");
    expect(adminApi).toContain("archive_product_media");
  });

  it("serves bytes publicly only after canonical product publication checks", () => {
    expect(commerceApi).toContain("path === 'product-media'");
    expect(commerceApi).toContain(".eq('status', 'active').eq('is_active', true)");
    expect(commerceApi).toContain("admin.storage.from(media.storage_bucket).download(media.storage_path)");
    expect(commerceApi).toContain("media: mediaByProduct.get(product.id) || []");
  });

  it("exposes first-class multi-image UX without a normal raw URL field", () => {
    expect(adminExperience).not.toContain('label="Bildlänk"');
    expect(adminExperience).toContain("<DraftProductMediaPicker");
    expect(adminExperience).toContain("<ProductMediaEditor");
    expect(mediaEditor).toContain('multiple capture="environment"');
    expect(mediaEditor).toContain('data-testid="product-image-dropzone"');
    expect(mediaEditor).toContain('action: "reorder"');
    expect(mediaEditor).toContain('action: "archive"');
    expect(shop).toContain('loading={index === 0 ? "eager" : "lazy"}');
  });
});
