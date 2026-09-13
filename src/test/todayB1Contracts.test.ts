import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const today = readFileSync("src/pages/TodayPage.tsx", "utf8");
const detail = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const detailPricing = readFileSync("src/lib/programSessionPricing.ts", "utf8");
const personalizedPricing = readFileSync("src/lib/personalizedPricing.ts", "utf8");

describe("Today B1 duplicate-read boundary", () => {
  it("does not reconstruct featured activity or registrations in the browser", () => {
    expect(today).not.toContain('"activity-preview"');
    expect(today).not.toContain('.from("session_registrations")');
    expect(today).not.toContain("getPublicProfileMap");
    expect(today).toContain("pricingByOccurrence.get");
    expect(today).toContain("socialProof?.user_registration_status");
  });

  it("keeps anonymous Today auth-free and holds authenticated cards for the personalized read model", () => {
    expect(today).toContain('auth: "omit"');
    expect(today).toContain("fetchPersonalizedToday");
    expect(today).toContain("today-personalized");
    expect(today).toContain("today-personalized-skeleton");
    expect(today).not.toContain("Kontrollerar pris");
    expect(detail).toContain("PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT");
    expect(detail).toContain("PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT");
    expect(detailPricing).toContain('PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT = "activity-preview"');
    expect(detailPricing).toContain('PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT = "activity-preview-personalized"');
  });

  it("keeps secondary discovery separate while Today pricing is one authenticated projection", () => {
    expect(today).toContain("fetchCourseHome");
    expect(today).toContain("fetchLeagueHome");
    expect(today).not.toContain("fetchPersonalizedPricingBatch");
    expect(personalizedPricing).toContain('"today-personalized"');
    expect(personalizedPricing).not.toContain('"activity-pricing-previews-personalized"');
    expect(today).toContain("verifiedAccount.isVerified");
    expect(today).toContain("fetchTodaySecondary");
  });
});
