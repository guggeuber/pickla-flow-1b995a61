import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Course Catalog consumer boundary", () => {
  it("keeps discovery on the lean catalog and Prices on its explicit compatibility route", () => {
    const client = readFileSync("src/lib/courses.ts", "utf8");
    const prices = readFileSync("src/pages/PricesMembershipPage.tsx", "utf8");
    const discovery = readFileSync("src/pages/CoursesPage.tsx", "utf8");

    expect(client).toContain('"api-courses", "catalog", { v: venueSlug }');
    expect(client).toContain('"api-courses", "catalog-prices", { v: venueSlug }');
    expect(discovery).toContain("fetchCourseCatalog(slug, { auth: \"omit\" })");
    expect(prices).toContain("fetchCoursePricingCatalog(slug)");
    expect(prices).not.toContain("fetchCourseCatalog");
  });
});
