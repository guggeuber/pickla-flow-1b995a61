import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  commerceOfferedWithProducts,
  type CommerceProduct,
  type CommerceRelationship,
} from "@/lib/commerce";
import {
  visibleOfferedWithRelationships,
  type OfferedWithRelationship,
} from "../../supabase/functions/_shared/product_relationships";

const root = process.cwd();
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

function product(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    id: "product-addon",
    venue_id: "venue-a",
    product_key: "generic_addon",
    product_kind: "merchandise",
    name: "Handduk",
    description: null,
    commerce_kind: "merchandise",
    fulfillment_type: "desk_pickup",
    fulfillment_presentation: "desk_pickup",
    base_price_sek: 75,
    vat_rate: 25,
    sort_order: 0,
    status: "active",
    is_active: true,
    standalone_enabled: false,
    activity_addon_enabled: true,
    category: "Tillbehör",
    sport: null,
    image_url: "https://images.example.test/handduk.webp",
    ...overrides,
  };
}

const source = product({
  id: "product-source",
  product_key: "participation",
  name: "Aktivitetsplats",
  product_kind: "series_access",
  commerce_kind: "participation",
  fulfillment_type: "participation",
  fulfillment_presentation: "participation",
  standalone_enabled: false,
  activity_addon_enabled: false,
  image_url: null,
});

function relationship(overrides: Partial<OfferedWithRelationship> = {}): OfferedWithRelationship {
  return {
    id: "relationship-b",
    venue_id: "venue-a",
    source_product_id: source.id,
    target_product_id: "product-addon",
    relationship_type: "offered_with",
    is_active: true,
    sort_order: 10,
    created_at: "2026-09-09T10:00:00Z",
    ...overrides,
  };
}

describe("Product Upsell contract", () => {
  it("C-E: exposes only active offered_with relationships with active eligible same-venue targets", () => {
    const eligible = product();
    const archived = product({ id: "product-archived", status: "archived", is_active: false });
    const disabled = product({ id: "product-disabled", activity_addon_enabled: false });
    const otherVenue = product({ id: "product-other-venue", venue_id: "venue-b" });
    const relationships = [
      relationship(),
      relationship({ id: "inactive", is_active: false }),
      relationship({ id: "archived", target_product_id: archived.id }),
      relationship({ id: "disabled", target_product_id: disabled.id }),
      relationship({ id: "cross-venue", target_product_id: otherVenue.id }),
    ];

    expect(visibleOfferedWithRelationships({
      products: [source, eligible, archived, disabled, otherVenue],
      relationships,
      venueId: "venue-a",
      venueCommerceEnabled: true,
    }).map((item) => item.id)).toEqual(["relationship-b"]);
  });

  it("F and K: follows relationship order with a stable tie-break and takes presentation from target products", () => {
    const first = product({ id: "product-first", name: "Första", base_price_sek: 90, image_url: "https://images.example.test/first.webp" });
    const second = product({ id: "product-second", name: "Andra", base_price_sek: 40, image_url: "https://images.example.test/second.webp" });
    const relations: CommerceRelationship[] = [
      relationship({ id: "relationship-b", target_product_id: second.id, sort_order: 20 }) as CommerceRelationship,
      relationship({ id: "relationship-z", target_product_id: second.id, sort_order: 10 }) as CommerceRelationship,
      relationship({ id: "relationship-a", target_product_id: first.id, sort_order: 10 }) as CommerceRelationship,
    ];

    const result = commerceOfferedWithProducts([source, second, first], relations, source.id);
    expect(result.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(result[0]).toMatchObject({ name: "Första", base_price_sek: 90, image_url: "https://images.example.test/first.webp" });
  });

  it("A, B, G-I: keeps relationship writes semantic, venue-bound, removable, and open to managed participation sources", () => {
    const adminSource = read("supabase/functions/api-admin/index.ts");
    const postStart = adminSource.indexOf("req.method === 'POST' && path === 'product-relationships'");
    const deleteStart = adminSource.indexOf("req.method === 'DELETE' && path === 'product-relationships'", postStart);
    const relationshipWrite = adminSource.slice(postStart, deleteStart);
    const relationshipDelete = adminSource.slice(deleteStart, adminSource.indexOf("// ── ACTIVITY PROGRAM / SCHEDULE", deleteStart));

    expect(relationshipWrite).not.toContain("image_urls");
    expect(relationshipWrite).toContain(".select('id, commerce_kind').eq('venue_id', venueId)");
    expect(relationshipWrite).toContain("Products must belong to the selected venue");
    expect(relationshipWrite).toContain("commerce_kind !== 'participation'");
    expect(relationshipWrite).toContain("is_active: body.is_active !== false");
    expect(relationshipWrite).not.toContain("loadManagedSeriesForProduct");
    expect(relationshipDelete).toContain(".delete().eq('id', relationshipId).eq('venue_id', venueId)");
    expect(relationshipDelete).not.toContain("loadManagedSeriesForProduct");
  });

  it("J-N: has no product-name special case and retains canonical child lines plus server price resolution", () => {
    const commerceApi = read("supabase/functions/api-commerce/index.ts");
    const commerceClient = read("src/lib/commerce.ts");
    const activityPage = read("src/pages/ProgramSessionPage.tsx");

    expect(commerceApi).not.toMatch(/racket|hyrrack/i);
    expect(commerceClient).not.toMatch(/racket|hyrrack/i);
    expect(activityPage).toContain("src={product.image_url}");
    expect(activityPage).toContain("parent_product_id: selectedProduct.id");
    expect(commerceApi).toContain("item.parentLineId = parent.id");
    expect(commerceApi).toContain("let unitPriceMinor = Math.round(Number(product.base_price_sek || 0) * 100)");
    expect(commerceApi).toContain("Product relationship changed — review the cart again");
  });
});
