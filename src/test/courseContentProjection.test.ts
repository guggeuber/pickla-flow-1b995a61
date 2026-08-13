import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Course content projection boundary", () => {
  it("uses only the reusable short Format description on the compact Home card", () => {
    const source = readFileSync("src/pages/TodayPage.tsx", "utf8");
    const registrationCard = source.slice(
      source.indexOf('courseHome?.mode === "registration"'),
      source.indexOf('courseHome?.mode === "next"'),
    );

    expect(registrationCard).toContain("course.format?.description");
    expect(registrationCard).not.toContain("full_description");
  });
});
