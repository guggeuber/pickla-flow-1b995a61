import { apiGet } from "@/lib/api";
import type { ActivityDiscoveryPricingResponse } from "@/lib/activityPricing";
import type { SeriesCustomerPricing } from "@/lib/courses";
import type { SeriesPresentationType } from "@/lib/seriesPresentation";

export type TodayCoursePromotion = {
  id: string;
  name: string;
  image_urls: string[];
  start_date: string;
  registration_state: "open";
  capacity: { available_count: number };
  format: {
    name: string | null;
    description: string | null;
    presentation_type: SeriesPresentationType | null;
  };
  product: { base_price_sek: number };
  pricing: SeriesCustomerPricing;
  included_access: { open_play_series_period: { enabled: boolean } };
  route: string;
};

export type TodayLeaguePromotion = {
  series: { id: string; name: string; image_urls: string[] };
  season: {
    team_capacity: number;
    league_night_count: number;
    matches_per_team_per_night: number;
  };
  capacity: { available_count: number };
  current_price_minor: number;
  pricing_reason: string;
  route: string;
};

export type TodaySecondaryResponse = {
  course: { mode: "none"; item: null } | { mode: "registration"; item: TodayCoursePromotion };
  league: { mode: "none"; item: null } | { mode: "registration"; item: TodayLeaguePromotion };
  first_visit: ActivityDiscoveryPricingResponse;
};

export function fetchTodaySecondary(venueSlug: string, startDate: string, endDate: string) {
  return apiGet<TodaySecondaryResponse>("api-event-public", "today-secondary", {
    venueSlug,
    startDate,
    endDate,
  }, {
    auth: "omit",
    publicRead: { maxRetries: 1, retryDelayMs: 250 },
  });
}
