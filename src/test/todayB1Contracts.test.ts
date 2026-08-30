import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const today = readFileSync("src/pages/TodayPage.tsx", "utf8");
const detail = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");

describe("Today B1 duplicate-read boundary", () => {
  it("does not reconstruct featured activity or registrations in the browser", () => {
    expect(today).not.toContain('"activity-preview"');
    expect(today).not.toContain('.from("session_registrations")');
    expect(today).not.toContain("getPublicProfileMap");
    expect(today).toContain("pricingByOccurrence.get");
    expect(today).toContain("socialProof?.user_registration_status");
  });

  it("keeps public first paint auth-free and leaves Activity Preview on detail", () => {
    expect(today).toContain('auth: "omit"');
    expect(detail).toContain('"activity-preview"');
  });

  it("keeps legacy discovery endpoints only for verified personal enrichment", () => {
    expect(today).toContain("fetchCourseHome");
    expect(today).toContain("fetchLeagueHome");
    expect(today).toContain('"first-visit-offers"');
    expect(today).toContain("verifiedAccount.isVerified");
    expect(today).toContain("fetchTodaySecondary");
  });
});
