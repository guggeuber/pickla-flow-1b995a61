export type TimePeriod = "MORGON" | "LUNCH" | "EFTERMIDDAG" | "KVÄLL";

const TIME_PERIOD_ORDER: TimePeriod[] = ["MORGON", "LUNCH", "EFTERMIDDAG", "KVÄLL"];

export function getTimePeriod(time: string): TimePeriod {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "MORGON";
  if (hour < 15) return "LUNCH";
  if (hour < 20) return "EFTERMIDDAG";
  return "KVÄLL";
}

export function groupTimesByDaypart(times: string[]): Array<{ period: TimePeriod; slots: string[] }> {
  const groups = new Map<TimePeriod, string[]>();
  for (const time of times) {
    const period = getTimePeriod(time);
    groups.set(period, [...(groups.get(period) || []), time]);
  }

  return TIME_PERIOD_ORDER
    .map((period) => ({ period, slots: groups.get(period) || [] }))
    .filter((group) => group.slots.length > 0);
}

export type CourtSelectionReconciliation = {
  nextCourtIds: string[];
  unavailableCourtIds: string[];
  replacementCourtIds: string[];
};

export function reconcileCourtSelection(
  selectedCourtIds: string[],
  availableCourtIds: string[],
): CourtSelectionReconciliation {
  if (selectedCourtIds.length === 0) {
    return {
      nextCourtIds: availableCourtIds.slice(0, 1),
      unavailableCourtIds: [],
      replacementCourtIds: [],
    };
  }

  const available = new Set(availableCourtIds);
  const unavailableCourtIds = selectedCourtIds.filter((id) => !available.has(id));
  if (unavailableCourtIds.length === 0) {
    return {
      nextCourtIds: selectedCourtIds,
      unavailableCourtIds: [],
      replacementCourtIds: [],
    };
  }

  const retainedCourtIds = selectedCourtIds.filter((id) => available.has(id));
  const retained = new Set(retainedCourtIds);
  const replacementPool = availableCourtIds.filter((id) => !retained.has(id));
  const replacementCourtIds = replacementPool.slice(0, unavailableCourtIds.length);
  let replacementIndex = 0;
  const nextCourtIds = selectedCourtIds.flatMap((id) => {
    if (available.has(id)) return [id];
    const replacement = replacementCourtIds[replacementIndex++];
    return replacement ? [replacement] : [];
  });

  return {
    nextCourtIds,
    unavailableCourtIds,
    replacementCourtIds,
  };
}
