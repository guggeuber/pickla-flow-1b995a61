import { describe, expect, it, vi } from "vitest";
import {
  loadPublicCourseCatalog,
  type PublicCourseCatalogRpcClient,
} from "../../supabase/functions/_shared/public_course_catalog";

function rawCard(index: number) {
  return {
    id: `course-${index}`,
    name: `Course ${index}`,
    description: index % 2 ? null : `Series ${index}`,
    image_urls: [`https://images.test/${index}.webp`, "https://images.test/unused.webp"],
    start_date: `2026-10-${String(index + 1).padStart(2, "0")}`,
    registration_state: index % 2 ? "upcoming" : "open",
    capacity: { available_count: index + 1, committed_count: 99 },
    format: { description: `Format ${index}`, presentation_type: "course", full_description: "private" },
    product: { base_price_sek: 1495 },
    coach: { display_name: "Must not escape" },
    customer_has_commitment: true,
  };
}

function rpcClient(items: unknown[], venueFound = true) {
  const rpc = vi.fn(async () => ({
    data: { venue_found: venueFound, items },
    error: null,
  }));
  return { client: { rpc } as PublicCourseCatalogRpcClient, rpc };
}

describe("public Course Catalog fast path", () => {
  it.each([1, 2, 10])("uses exactly one RPC call for %i returned cards", async (count) => {
    const { client, rpc } = rpcClient(Array.from({ length: count }, (_, index) => rawCard(index)));

    const result = await loadPublicCourseCatalog(client, "pickla-arena-sthlm");

    expect(result.items).toHaveLength(count);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("public_customer_course_cards", {
      p_venue_slug: "pickla-arena-sthlm",
    });
  });

  it("returns an exact privacy-safe card shape", async () => {
    const { client } = rpcClient([rawCard(0)]);

    const result = await loadPublicCourseCatalog(client, "pickla-arena-sthlm");

    expect(result.items[0]).toEqual({
      id: "course-0",
      name: "Course 0",
      description: "Series 0",
      image_urls: ["https://images.test/0.webp"],
      start_date: "2026-10-01",
      registration_state: "open",
      capacity: { available_count: 1 },
      format: { description: "Format 0", presentation_type: "course" },
    });
    expect(JSON.stringify(result)).not.toMatch(/price|coach|customer|commitment|full_description/i);
  });

  it("distinguishes a valid empty venue from an unknown venue without extra reads", async () => {
    const empty = rpcClient([]);
    const missing = rpcClient([], false);

    await expect(loadPublicCourseCatalog(empty.client, "empty-venue")).resolves.toEqual({
      venue_found: true,
      items: [],
    });
    await expect(loadPublicCourseCatalog(missing.client, "missing-venue")).resolves.toEqual({
      venue_found: false,
      items: [],
    });
    expect(empty.rpc).toHaveBeenCalledTimes(1);
    expect(missing.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed projection data", async () => {
    const { client } = rpcClient([{ ...rawCard(0), capacity: { available_count: -1 } }]);

    await expect(loadPublicCourseCatalog(client, "pickla-arena-sthlm"))
      .rejects.toThrow("Course catalog projection unavailable");
  });
});
