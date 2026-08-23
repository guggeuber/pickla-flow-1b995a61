import type { SeriesCustomerPricing } from "@/lib/courses";

type SeriesPriceInput = {
  pricing?: SeriesCustomerPricing | null;
  basePriceSek: number;
};

export type SeriesPricePresentation = {
  label: "Early Bird" | "Medlemspris" | "Pris";
  finalPriceMinor: number;
  primary: string;
  context: string | null;
};

function money(minor: number) {
  return `${Math.round(minor / 100).toLocaleString("sv-SE")} kr`;
}

function earlyBirdContext(slots: number | null, listPriceMinor: number) {
  if (!slots) return null;
  const places = slots === 1 ? "Första platsen" : `Första ${slots} platserna`;
  return `${places} · sedan ${money(listPriceMinor)}`;
}

/**
 * Formats canonical Series resolver output for customer surfaces. This helper
 * never decides eligibility or precedence; it only names the already-resolved
 * winner returned by api-courses/api-commerce.
 */
export function seriesPricePresentation({ pricing, basePriceSek }: SeriesPriceInput): SeriesPricePresentation {
  const fallbackMinor = Math.round(Number(basePriceSek || 0) * 100);
  if (!pricing) {
    return {
      label: "Pris",
      finalPriceMinor: fallbackMinor,
      primary: `Pris · ${money(fallbackMinor)}`,
      context: null,
    };
  }

  const finalPriceMinor = Number(pricing.final_price_minor || 0);
  if (pricing.pricing_reason === "early_bird") {
    return {
      label: "Early Bird",
      finalPriceMinor,
      primary: `Early Bird · ${money(finalPriceMinor)}`,
      context: earlyBirdContext(pricing.early_bird.slots, pricing.list_price_minor),
    };
  }

  if (pricing.pricing_reason === "membership_tier_pricing") {
    return {
      label: "Medlemspris",
      finalPriceMinor,
      primary: `Medlemspris · ${money(finalPriceMinor)}`,
      context: pricing.membership_tier_name || null,
    };
  }

  return {
    label: "Pris",
    finalPriceMinor,
    primary: `Pris · ${money(finalPriceMinor)}`,
    context: null,
  };
}

export function frozenSeriesLinePriceLabel(snapshot: Record<string, unknown> | null | undefined) {
  const reason = String(snapshot?.pricing_reason || "");
  if (reason === "early_bird") return "Early Bird";
  if (reason === "membership_tier_pricing") {
    const tier = String(snapshot?.membership_tier_name || "").trim();
    return tier ? `Medlemspris · ${tier}` : "Medlemspris";
  }
  return null;
}

export function seriesBookingCta(price: SeriesPricePresentation, defaultCta: string) {
  const action = price.label === "Early Bird" ? "Boka Early Bird" : defaultCta;
  return `${action} · ${money(price.finalPriceMinor)}`;
}
