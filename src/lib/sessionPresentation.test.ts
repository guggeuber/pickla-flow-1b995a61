import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { activitySessionToPresentation, openBookingToPresentation } from "@/lib/sessionPresentation";

const stockholmNow = DateTime.fromISO("2026-07-12T17:30:00", { zone: "Europe/Stockholm" });

describe("sessionPresentation timing", () => {
  it("maps activity sessions through the shared timing helper", () => {
    const presentation = activitySessionToPresentation({
      id: "activity-1",
      typeLabel: "OPEN PLAY",
      title: "Open Play Kväll",
      sessionDate: "2026-07-12",
      startTime: "18:00",
      endTime: "22:00",
      now: stockholmNow,
    });

    expect(presentation.timingStatus.stateLabel).toBe("IKVÄLL");
    expect(presentation.timingStatus.detailLabel).toBe("Startar om 30 min");
  });

  it("maps open private bookings through the same timing helper", () => {
    const presentation = openBookingToPresentation({
      id: "open-booking-1",
      bookerFirstName: "Letz",
      startsAt: DateTime.fromISO("2026-07-12T17:00:00", { zone: "Europe/Stockholm" }).toISO()!,
      endsAt: DateTime.fromISO("2026-07-12T20:00:00", { zone: "Europe/Stockholm" }).toISO()!,
      now: stockholmNow,
    });

    expect(presentation.timingStatus.stateLabel).toBe("PÅGÅR");
    expect(presentation.timingStatus.detailLabel).toBe("Slutar om 2 tim 30 min");
  });
});
