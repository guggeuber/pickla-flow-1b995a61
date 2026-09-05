import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT,
  PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT,
  resolveProgramSessionPricingView,
} from "@/lib/programSessionPricing";
import { jsonResponse, privateJsonResponse } from "../../supabase/functions/_shared/cors.ts";

const programSource = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const eventApiSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const serviceWorkerSource = readFileSync("src/sw.ts", "utf8");

type TestPricing = {
  effectivePriceSek: number;
  finalAmountSek: number;
  requiresCheckout?: boolean;
  pricingReason?: string;
  membershipTierName?: string;
  customerPresentation: { displayPriceSek: number; displayLabel: string };
};

type TestPreview = {
  activityTicketPricing: TestPricing;
  dayPassPricing: TestPricing;
};

const publicPreview: TestPreview = {
  activityTicketPricing: {
    effectivePriceSek: 165,
    finalAmountSek: 165,
    customerPresentation: { displayPriceSek: 165, displayLabel: "165 kr" },
  },
  dayPassPricing: {
    effectivePriceSek: 199,
    finalAmountSek: 199,
    customerPresentation: { displayPriceSek: 199, displayLabel: "199 kr" },
  },
};

const playPreview: TestPreview = {
  activityTicketPricing: {
    effectivePriceSek: 99,
    finalAmountSek: 99,
    pricingReason: "membership_tier_pricing",
    customerPresentation: { displayPriceSek: 99, displayLabel: "99 kr" },
  },
  dayPassPricing: {
    effectivePriceSek: 119.4,
    finalAmountSek: 119.4,
    pricingReason: "membership_tier_pricing",
    customerPresentation: { displayPriceSek: 119.4, displayLabel: "119,40 kr" },
  },
};

const founderPreview: TestPreview = {
  activityTicketPricing: {
    effectivePriceSek: 0,
    finalAmountSek: 0,
    requiresCheckout: false,
    pricingReason: "membership_entitlement",
    membershipTierName: "Founder",
    customerPresentation: { displayPriceSek: 0, displayLabel: "Ingår" },
  },
  dayPassPricing: publicPreview.dayPassPricing,
};

function pricingView(overrides: Partial<Parameters<typeof resolveProgramSessionPricingView<TestPreview>>[0]> = {}) {
  return resolveProgramSessionPricingView({
    accountState: "verified",
    publicPreview,
    personalizedPreview: null,
    publicError: false,
    personalizedError: false,
    accessPending: false,
    ...overrides,
  });
}

describe("ProgramSession personalized pricing cache isolation", () => {
  it("gives public and authenticated representations different HTTP identities", () => {
    expect(PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT).toBe("activity-preview");
    expect(PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT).toBe("activity-preview-personalized");
    expect(PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT).not.toBe(PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT);
    expect(programSource).toContain("PROGRAM_SESSION_PUBLIC_PREVIEW_ENDPOINT");
    expect(programSource).toContain("PROGRAM_SESSION_PERSONALIZED_PREVIEW_ENDPOINT");
  });

  it("makes the public route strictly anonymous and the personalized route auth-required", () => {
    const routeStart = eventApiSource.indexOf("const isPersonalizedActivityPreview");
    const routeEnd = eventApiSource.indexOf("// GET /api-event-public/activity-social-proof", routeStart);
    const previewRoute = eventApiSource.slice(routeStart, routeEnd);

    expect(previewRoute).toContain("path === 'activity-preview-personalized'");
    expect(previewRoute).toContain("path === 'activity-preview' || isPersonalizedActivityPreview");
    expect(previewRoute).toContain("await getAuthenticatedClient(req)");
    expect(previewRoute).toContain("privateErrorResponse('Unauthorized', 401)");
    expect(previewRoute).not.toContain("getOptionalUserId(req)");
    expect(previewRoute).toContain("privateJsonResponse(preview)");
    expect(previewRoute).toContain("jsonResponse(preview, 200, 5)");
  });

  it("sets the public and personalized cache headers explicitly", () => {
    const publicResponse = jsonResponse(publicPreview, 200, 5);
    const personalizedResponse = privateJsonResponse(playPreview);

    expect(publicResponse.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=5");
    expect(publicResponse.headers.get("Vary")).toBeNull();
    expect(personalizedResponse.headers.get("Cache-Control")).toBe("private, no-store");
    expect(personalizedResponse.headers.get("Vary")).toBe("Authorization");
  });

  it("reproduces public-first then commits Play without allowing a later public refetch to win", () => {
    const accountPending = pricingView({ accountState: "remote_validating" });
    expect(accountPending).toEqual({ phase: "pending", preview: null, source: null });

    const personalizedPending = pricingView();
    expect(personalizedPending).toEqual({ phase: "pending", preview: null, source: null });

    const committed = pricingView({ personalizedPreview: playPreview });
    expect(committed.source).toBe("personalized");
    expect(committed.preview?.activityTicketPricing.customerPresentation.displayPriceSek).toBe(99);
    expect(committed.preview?.dayPassPricing.customerPresentation.displayPriceSek).toBe(119.4);

    const publicBackgroundRefetch = {
      ...publicPreview,
      activityTicketPricing: {
        ...publicPreview.activityTicketPricing,
        customerPresentation: { displayPriceSek: 165, displayLabel: "165 kr refetched" },
      },
    };
    const afterPublicRefetch = pricingView({
      publicPreview: publicBackgroundRefetch,
      personalizedPreview: committed.preview,
    });
    expect(afterPublicRefetch.source).toBe("personalized");
    expect(afterPublicRefetch.preview).toBe(playPreview);
  });

  it("retains a committed personalized result during refetch errors but not for a new access identity", () => {
    const duringBackgroundError = pricingView({
      personalizedPreview: playPreview,
      personalizedError: true,
    });
    expect(duringBackgroundError).toEqual({
      phase: "resolved",
      preview: playPreview,
      source: "personalized",
    });

    const changedAccessSnapshot = pricingView({ personalizedPreview: null, accessPending: true });
    expect(changedAccessSnapshot).toEqual({ phase: "pending", preview: null, source: null });
  });

  it.each([
    ["cold signed in", "session_hydrating"],
    ["hard reload signed in", "remote_validating"],
    ["soft list to detail", "remote_validating"],
    ["auth recovery", "remote_validating"],
  ] as const)("fails closed while %s is unresolved", (_scenario, accountState) => {
    expect(pricingView({ accountState })).toEqual({ phase: "pending", preview: null, source: null });
  });

  it.each([
    "warm authenticated cache",
    "detail back to detail",
    "stale public cache",
    "background public refetch",
    "personalized refetch",
    "auth recovery settled",
  ])("settles verified Play at 99/119.40 for %s", () => {
    const view = pricingView({ personalizedPreview: playPreview });
    expect(view.source).toBe("personalized");
    expect(view.preview?.activityTicketPricing.effectivePriceSek).toBe(99);
    expect(view.preview?.dayPassPricing.effectivePriceSek).toBe(119.4);
  });

  it("allows public pricing only after anonymous state commits", () => {
    const signedOut = pricingView({ accountState: "anonymous" });
    expect(signedOut).toEqual({ phase: "resolved", preview: publicPreview, source: "public" });
    expect(signedOut.preview?.activityTicketPricing.effectivePriceSek).toBe(165);
    expect(signedOut.preview?.dayPassPricing.effectivePriceSek).toBe(199);
  });

  it("preserves Founder included pricing as an authenticated representation", () => {
    const founder = pricingView({ personalizedPreview: founderPreview });
    expect(founder.source).toBe("personalized");
    expect(founder.preview?.activityTicketPricing.effectivePriceSek).toBe(0);
    expect(founder.preview?.activityTicketPricing.requiresCheckout).toBe(false);
    expect(founder.preview?.activityTicketPricing.customerPresentation.displayLabel).toBe("Ingår");
  });

  it("shows controlled retry states without exposing public pricing as verified", () => {
    expect(pricingView({ personalizedError: true })).toEqual({ phase: "error", preview: null, source: null });
    expect(pricingView({ accountState: "validation_error" })).toEqual({ phase: "error", preview: null, source: null });
    expect(pricingView({ accountState: "terminal_failure" })).toEqual({ phase: "error", preview: null, source: null });
    expect(programSource).toContain('data-testid="commerce-pricing-error"');
    expect(programSource).toContain("Kunde inte kontrollera ditt pris.");
    expect(programSource).toContain("Försök igen");
  });

  it("keeps the price-bearing CTA disabled until authenticated pricing resolves", () => {
    expect(programSource).toContain("Kontrollerar ditt pris…");
    expect(programSource).toContain("pricingPending || pricingError");
    expect(programSource).toContain('data-testid="commerce-pricing-pending"');
  });

  it("keeps Supabase Function requests NetworkOnly in the service worker", () => {
    expect(serviceWorkerSource).toContain("NetworkOnly");
    expect(serviceWorkerSource).toContain("/functions/v1/");
  });
});
