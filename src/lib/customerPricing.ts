export type CustomerCourtPricingRule = {
  name?: string | null;
  days_of_week?: number[] | null;
  time_from?: string | null;
  time_to?: string | null;
};

const INTERNAL_COPY = /\b(upsell|resolver|product[ _-]?kind|implementation|implementering|intern(?:t|a)? pris)\b/i;

export function customerFacingDescription(value: string | null | undefined, fallback: string) {
  const description = String(value || "").trim();
  return description && !INTERNAL_COPY.test(description) ? description : fallback;
}

export function customerCourtPriceLabel(rule: CustomerCourtPricingRule) {
  const days = Array.isArray(rule.days_of_week) ? rule.days_of_week : [];
  const weekendOnly = days.length > 0 && days.every((day) => day === 0 || day === 6);
  if (weekendOnly) return "Helg";

  const startMinutes = (() => {
    const [hour, minute] = String(rule.time_from || "00:00").split(":").map(Number);
    return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
  })();
  if (startMinutes >= 16 * 60) return "Kväll";
  if (startMinutes >= 14 * 60) return "Eftermiddag";
  if (startMinutes >= 12 * 60) return "Lunch";
  if (startMinutes >= 9 * 60) return "Förmiddag";
  return "Morgon";
}
