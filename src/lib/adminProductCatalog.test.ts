import { describe, expect, it } from "vitest";
import { filterAndSortProducts } from "@/lib/adminProductCatalog";

const products = Array.from({ length: 120 }, (_, index) => ({
  id: `product-${index}`,
  name: index === 87 ? "Rosa Pickla-påse" : `Produkt ${String(index).padStart(3, "0")}`,
  description: index % 2 === 0 ? "Hämtas vid disken" : null,
  status: index % 3 === 0 ? "draft" as const : "active" as const,
  standalone_enabled: index % 2 === 0,
  activity_addon_enabled: index % 5 === 0,
  category: index % 2 === 0 ? "Merchandise" : "Hyra",
  sport: index % 4 === 0 ? "Pickleball" : null,
  base_price_sek: index,
}));

describe("product catalog filtering", () => {
  it("finds one product in a catalog larger than one page", () => {
    const result = filterAndSortProducts(products, {
      search: "rosa pickla",
      status: "all",
      salesMode: "all",
      category: "",
      sport: "",
      sort: "name",
    });
    expect(result.map((product) => product.id)).toEqual(["product-87"]);
  });

  it("combines status, sales mode, category and sport filters", () => {
    const result = filterAndSortProducts(products, {
      search: "",
      status: "active",
      salesMode: "standalone",
      category: "Merchandise",
      sport: "Pickleball",
      sort: "price_desc",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((product) => product.status === "active" && product.standalone_enabled && product.category === "Merchandise" && product.sport === "Pickleball")).toBe(true);
    expect(result[0].base_price_sek).toBeGreaterThan(result.at(-1)!.base_price_sek);
  });
});
