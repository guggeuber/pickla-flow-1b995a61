import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Course content projection boundary", () => {
  it("uses only the reusable short Format description on the compact Home card", () => {
    const registrationCard = readFileSync("src/components/series/SeriesRegistrationCard.tsx", "utf8");

    expect(registrationCard).toContain("series.format?.description");
    expect(registrationCard).not.toContain("full_description");
  });
});
