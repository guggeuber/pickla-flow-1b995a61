import { apiGet } from "@/lib/api";

export type PublicPricesResponse = {
  memberships: Array<{
    id: string;
    name: string;
    description: string | null;
    monthly_price: number | null;
  }>;
  court_pricing: Array<{
    id: string;
    name: string;
    type: "hourly";
    price: number;
    days_of_week: number[];
    time_from: string | null;
    time_to: string | null;
  }>;
  day_passes: Array<{
    id: string;
    name: string;
    description: string;
    base_price_sek: number;
  }>;
  punch_cards: Array<{
    id: string;
    name: string;
    description: string | null;
    base_price_sek: number;
  }>;
  courses: Array<{
    id: string;
    name: string;
    description: string | null;
    base_price_sek: number;
  }>;
  first_visit: {
    available: boolean;
    title: string | null;
    description: string | null;
    public_price_sek: number | null;
    route: string | null;
  };
};

export function fetchPublicPrices(venueSlug: string) {
  return apiGet<PublicPricesResponse>("api-event-public", "public-prices", {
    venueSlug,
  }, {
    auth: "omit",
    publicRead: { maxRetries: 1, retryDelayMs: 250 },
  });
}

export function fetchPricesFirstVisitEligibility() {
  return apiGet<{ eligible: boolean }>(
    "api-event-public",
    "prices-first-visit-eligibility",
  );
}
