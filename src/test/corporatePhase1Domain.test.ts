import { describe, expect, it } from "vitest";
import {
  canListPublicCorporateAccount,
  canResolvePublicCorporateAccount,
  deriveCorporateParticipation,
  normalizeCorporateSlug,
  normalizeExternalBookingLabel,
  normalizeExternalBookingUrl,
} from "../../supabase/functions/_shared/corporate";

describe("corporate Phase 1 domain rules", () => {
  it("normalizes the slug and enforces listed versus unlisted visibility", () => {
    expect(normalizeCorporateSlug("  Ericsson-SE  ")).toBe("ericsson-se");
    expect(() => normalizeCorporateSlug("Ericsson SE")).toThrow();
    expect(canResolvePublicCorporateAccount({ is_active: true, public_visibility: "private", slug: "ericsson" })).toBe(false);
    expect(canResolvePublicCorporateAccount({ is_active: true, public_visibility: "unlisted", slug: "ericsson" })).toBe(true);
    expect(canListPublicCorporateAccount({ is_active: true, public_visibility: "unlisted", slug: "ericsson" })).toBe(false);
    expect(canListPublicCorporateAccount({ is_active: true, public_visibility: "listed", slug: "ericsson" })).toBe(true);
    expect(canResolvePublicCorporateAccount({ is_active: false, public_visibility: "listed", slug: "ericsson" })).toBe(false);
  });

  it("accepts only normalized HTTPS booking URLs without credentials", () => {
    expect(normalizeExternalBookingUrl("  https://book.example.test/path  ")).toBe("https://book.example.test/path");
    expect(normalizeExternalBookingUrl(" ")).toBeNull();
    for (const invalid of ["http://book.example.test", "javascript:alert(1)", "data:text/plain,no", "https://user:secret@book.example.test"]) {
      expect(() => normalizeExternalBookingUrl(invalid)).toThrow();
    }
    expect(normalizeExternalBookingLabel("  Boka via ESIK  ")).toBe("Boka via ESIK");
    expect(normalizeExternalBookingLabel("")).toBeNull();
  });

  it("derives every Phase 1 state and never claims Pickla readiness", () => {
    expect(deriveCorporateParticipation({ participation_management_mode: "unconfigured" }).state).toBe("not_configured");
    expect(deriveCorporateParticipation({ participation_management_mode: "external", company_name: "Ericsson", purchaser_name: "ESIK" })).toEqual({
      mode: "external",
      state: "external_pending",
      message: "Deltagandet hanteras av Ericsson/ESIK. Mer bokningsinformation kommer snart.",
      cta: null,
    });
    expect(deriveCorporateParticipation({ participation_management_mode: "external", external_booking_url: "https://book.example.test" })).toEqual({
      mode: "external",
      state: "external_ready",
      message: null,
      cta: { label: "Gå till bokning", url: "https://book.example.test/" },
    });
    expect(deriveCorporateParticipation({ participation_management_mode: "external", external_booking_url: "" }).state).toBe("external_pending");
    expect(deriveCorporateParticipation({ participation_management_mode: "external", external_booking_url: "bad" }).cta).toBeNull();
    expect(deriveCorporateParticipation({ participation_management_mode: "pickla" }).state).toBe("pickla_pending");
    for (const mode of ["unconfigured", "external", "pickla"] as const) {
      expect(deriveCorporateParticipation({ participation_management_mode: mode }).state).not.toBe("pickla_ready");
    }
  });
});
