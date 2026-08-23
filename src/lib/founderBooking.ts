import { DateTime } from "luxon";

const STOCKHOLM_ZONE = "Europe/Stockholm";

export type FounderCourtLineItem = {
  hourlyPrice: number;
  hours: number;
};

export function calculateFounderCourtCoverage(input: {
  remainingHours: number;
  lineItems: FounderCourtLineItem[];
}) {
  const remainingHours = Math.max(0, Number(input.remainingHours) || 0);
  const requestedHours = input.lineItems.reduce((sum, item) => sum + Math.max(0, item.hours), 0);
  const includedHours = Math.min(remainingHours, requestedHours);
  const paidHours = Math.max(0, requestedHours - includedHours);
  const memberTotal = input.lineItems.reduce(
    (sum, item) => sum + Math.round(Math.max(0, item.hourlyPrice) * Math.max(0, item.hours)),
    0,
  );

  let hoursToApply = includedHours;
  const includedValue = [...input.lineItems]
    .sort((a, b) => b.hourlyPrice - a.hourlyPrice)
    .reduce((sum, item) => {
      if (hoursToApply <= 0) return sum;
      const applied = Math.min(hoursToApply, Math.max(0, item.hours));
      hoursToApply -= applied;
      return sum + Math.round(applied * Math.max(0, item.hourlyPrice));
    }, 0);

  return {
    requestedHours,
    includedHours,
    paidHours,
    memberTotal,
    includedValue,
    finalPrice: Math.max(0, memberTotal - includedValue),
  };
}

export function formatFounderHours(value: number) {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(value);
}

export function founderAllowancePeriodLabel(
  periodStart: string | null | undefined,
  now: DateTime = DateTime.now().setZone(STOCKHOLM_ZONE),
) {
  const selectedWeek = DateTime.fromISO(String(periodStart || ""), { zone: STOCKHOLM_ZONE }).startOf("week");
  const currentWeek = now.setZone(STOCKHOLM_ZONE).startOf("week");
  if (!selectedWeek.isValid) return "den valda veckan";
  if (selectedWeek.hasSame(currentWeek, "day")) return "den här veckan";
  if (selectedWeek.hasSame(currentWeek.plus({ weeks: 1 }), "day")) return "nästa vecka";
  return `vecka ${selectedWeek.weekNumber}`;
}

export function founderAllowanceCopy(input: {
  tierName?: string | null;
  remainingHours: number;
  periodStart?: string | null;
  now?: DateTime;
}) {
  const tierName = String(input.tierName || "Founder").trim() || "Founder";
  const remainingHours = Math.max(0, Number(input.remainingHours) || 0);
  const period = founderAllowancePeriodLabel(input.periodStart, input.now);
  if (remainingHours > 0) return `${tierName} · ${formatFounderHours(remainingHours)} h kvar ${period}`;
  if (period === "den här veckan") return `${tierName} · Veckans fria timmar använda`;
  return `${tierName} · Fria timmar använda ${period}`;
}
