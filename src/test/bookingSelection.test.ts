import { describe, expect, it } from "vitest";

import { getTimePeriod, groupTimesByDaypart, reconcileCourtSelection } from "@/lib/bookingSelection";

describe("booking selection", () => {
  it("preserves selected courts that remain available", () => {
    expect(reconcileCourtSelection(["court-2"], ["court-1", "court-2"])).toEqual({
      nextCourtIds: ["court-2"],
      unavailableCourtIds: [],
      replacementCourtIds: [],
    });
  });

  it("only replaces courts that became unavailable", () => {
    expect(reconcileCourtSelection(["court-1", "court-2"], ["court-2", "court-3"])).toEqual({
      nextCourtIds: ["court-3", "court-2"],
      unavailableCourtIds: ["court-1"],
      replacementCourtIds: ["court-3"],
    });
  });

  it("derives daypart directly from the selected time", () => {
    expect(getTimePeriod("08:00")).toBe("MORGON");
    expect(getTimePeriod("13:00")).toBe("LUNCH");
    expect(getTimePeriod("17:00")).toBe("EFTERMIDDAG");
    expect(getTimePeriod("21:00")).toBe("KVÄLL");
  });

  it("keeps available times grouped by daypart for presentation", () => {
    expect(groupTimesByDaypart(["20:00", "08:00", "13:00", "17:00", "09:00"])).toEqual([
      { period: "MORGON", slots: ["08:00", "09:00"] },
      { period: "LUNCH", slots: ["13:00"] },
      { period: "EFTERMIDDAG", slots: ["17:00"] },
      { period: "KVÄLL", slots: ["20:00"] },
    ]);
  });
});
