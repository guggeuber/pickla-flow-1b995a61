import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  calculateFounderCourtCoverage,
  founderAllowanceCopy,
  founderAllowancePeriodLabel,
} from "@/lib/founderBooking";

const sunday = DateTime.fromISO("2026-08-23T18:00:00", { zone: "Europe/Stockholm" });

describe("Founder selected play-week preview", () => {
  it("uses the server-returned Stockholm week across the Sunday to Monday boundary", () => {
    expect(founderAllowancePeriodLabel("2026-08-17", sunday)).toBe("den här veckan");
    expect(founderAllowancePeriodLabel("2026-08-24", sunday)).toBe("nästa vecka");
    expect(founderAllowancePeriodLabel("2026-08-31", sunday)).toBe("vecka 36");
    expect(founderAllowanceCopy({ tierName: "Founder", remainingHours: 4, periodStart: "2026-08-24", now: sunday }))
      .toBe("Founder · 4 h kvar nästa vecka");
  });

  it("prices only the uncovered hours at the configured Founder member price", () => {
    expect(calculateFounderCourtCoverage({
      remainingHours: 2,
      lineItems: [{ hourlyPrice: 160, hours: 3 }],
    })).toEqual({
      requestedHours: 3,
      includedHours: 2,
      paidHours: 1,
      memberTotal: 480,
      includedValue: 320,
      finalPrice: 160,
    });
  });

  it("updates deterministically when cache identity switches between play weeks", () => {
    const threeHourBooking = [{ hourlyPrice: 160, hours: 3 }];
    expect(calculateFounderCourtCoverage({ remainingHours: 0, lineItems: threeHourBooking }).finalPrice).toBe(480);
    expect(calculateFounderCourtCoverage({ remainingHours: 4, lineItems: threeHourBooking }).finalPrice).toBe(0);
    expect(calculateFounderCourtCoverage({ remainingHours: 0, lineItems: threeHourBooking }).finalPrice).toBe(480);
  });

  it("keeps exhausted-week copy explicit without changing discount doctrine", () => {
    expect(founderAllowanceCopy({ tierName: "Founder", remainingHours: 0, periodStart: "2026-08-17", now: sunday }))
      .toBe("Founder · Veckans fria timmar använda");
  });
});
