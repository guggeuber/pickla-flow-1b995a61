import { apiGet, apiPatch, apiPost } from "@/lib/api";

export type LeagueTeam = { id: string; team_name: string; status: string };
export type LeagueStanding = {
  position: number;
  team_entry_id: string;
  team_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  sets_won: number;
  sets_lost: number;
  set_difference: number;
  points_scored: number;
  points_conceded: number;
  point_difference: number;
  league_points: number;
  walkovers: number;
};

export type LeagueFixtureResult = {
  id: string;
  fixture_id?: string;
  state: "incomplete" | "final";
  outcome_type: "played" | "walkover";
  sets: Array<{ team_a: number; team_b: number }>;
  walkover_winner_team_id: string | null;
  version: number;
};

export type LeagueFixture = {
  id: string;
  league_night_session_id: string;
  round_number: number;
  block_number: number;
  venue_court_id: string;
  team_a_entry_id: string;
  team_b_entry_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  status: "scheduled" | "completed" | "postponed" | "cancelled";
  opponent_team_name?: string | null;
  court_name?: string | null;
  league_fixture_results?: LeagueFixtureResult[] | LeagueFixtureResult | null;
};

export type LeaguePublicProjection = {
  series: {
    id: string;
    venue_id: string;
    name: string;
    description: string | null;
    image_urls: string[];
    start_date: string;
    end_date: string;
    start_time: string;
    end_time: string;
    registration_opens_at: string;
    registration_closes_at: string;
    metadata: Record<string, unknown>;
    venues: { name: string; slug: string; timezone: string } | Array<{ name: string; slug: string; timezone: string }>;
  };
  season: {
    id: string;
    team_capacity: number;
    players_per_team: number;
    league_night_count: number;
    matches_per_team_per_night: number;
    blocks_per_night: number;
    match_duration_minutes: number;
    fixtures_published_at: string | null;
    fixture_publication_deadline: string;
  };
  product: {
    id: string;
    name: string;
    base_price_sek: number;
    vat_rate: number;
    scarcity_mode: string;
    early_bird_price_minor: number | null;
    early_bird_slots: number | null;
  };
  sessions: Array<{ id: string; session_date: string; start_time: string; end_time: string; court_ids: string[]; series_occurrence_index: number }>;
  courts: Array<{ id: string; name: string; court_number: number }>;
  capacity: { team_capacity: number; active_teams: number; active_holds: number; fill_count: number; available_count: number; early_bird_allocated: number; early_bird_remaining: number | null };
  current_price_minor: number;
  pricing_reason: string;
  teams: LeagueTeam[];
  fixtures: LeagueFixture[];
  standings: LeagueStanding[];
  customer_team_id: string | null;
};

export type MyLeagueItem = {
  membership: { id: string; role: "captain" | "player" };
  team: LeagueTeam;
  season: { id: string; activity_series_id: string; fixtures_published_at: string | null };
  series: { id: string; venue_id: string; name: string; start_date: string; end_date: string; start_time: string; end_time: string; image_urls: string[]; venues: { name: string; slug: string } };
  next_session: { id: string; session_date: string; start_time: string; end_time: string } | null;
  next_fixtures: LeagueFixture[];
  standing: LeagueStanding | null;
};

export type LeagueCustomerSummary = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_email?: string | null;
};

export type LeagueAdminMember = {
  id: string;
  team_entry_id: string;
  customer_id: string;
  role: "captain" | "player";
  status: string;
  customers: LeagueCustomerSummary | LeagueCustomerSummary[] | null;
};

export type LeagueAdminTeam = LeagueTeam & {
  captain_customer_id: string;
  payer_customer_id: string;
  commerce_order_id: string | null;
  commerce_order_line_id: string | null;
  pricing_reason: string | null;
  final_price_minor: number | null;
};

export type LeagueAdminSession = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  court_ids: string[];
  capacity: number;
  series_occurrence_index: number;
  is_active: boolean;
};

export type LeagueAdminOrder = { id: string; status: string; total_inc_vat_minor: number; paid_at: string | null };
export type LeagueAdminProduct = {
  id: string;
  name: string;
  description: string | null;
  product_kind: "league_team";
  base_price_sek: number;
  vat_rate: number;
  scarcity_mode: "none" | "early_bird";
  early_bird_price_minor: number | null;
  early_bird_slots: number | null;
  status: string;
  is_active: boolean;
};
export type LeagueCatalogEditPolicy = {
  lifecycle_editable: boolean;
  registration_opens_editable: boolean;
  registration_deadline_editable: boolean;
  fixture_deadline_editable: boolean;
  pricing_editable: boolean;
  schedule_editable: false;
  schedule_lock_reason: "league_v1_structure_locked" | "participants_matches_or_payments_exist";
  historical_prices_frozen: boolean;
};
export type LeagueAdminSeries = {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  image_urls: string[];
  start_date: string;
  end_date: string;
  status: string;
  registration_opens_at: string;
  registration_closes_at: string;
  start_time: string;
  end_time: string;
  court_ids: string[];
  venues?: { slug: string } | Array<{ slug: string }> | null;
  access_products?: LeagueAdminProduct | LeagueAdminProduct[] | null;
};
export type LeagueFixtureValidation = { valid: boolean; errors?: string[] };
export type LeagueAdminSeason = {
  id: string;
  activity_series_id: string;
  fixtures_published_at: string | null;
  fixture_publication_deadline: string;
  activity_series: LeagueAdminSeries | LeagueAdminSeries[];
  teams: LeagueAdminTeam[];
  members: LeagueAdminMember[];
  sessions: LeagueAdminSession[];
  fixtures: LeagueFixture[];
  results: LeagueFixtureResult[];
  orders: LeagueAdminOrder[];
  validation: LeagueFixtureValidation | null;
  edit_policy: LeagueCatalogEditPolicy;
};

export type LeagueCourt = { id: string; name: string; court_number?: number };
export type LeagueResourceConflict = {
  owner_type: "booking" | "open_play" | "course" | "league" | "activity" | "event" | "resource_block" | "venue_closure";
  owner_label: string;
  owner_name: string | null;
  starts_at: string;
  ends_at: string;
};
export type LeagueResourcePreview = {
  has_conflicts: boolean;
  nights: Array<{
    night_index: number;
    date: string;
    proposed_starts_at: string;
    proposed_ends_at: string;
    status: "clear" | "conflict";
    courts: Array<{
      court_id: string;
      court_name: string;
      is_available: boolean;
      conflicts: LeagueResourceConflict[];
    }>;
  }>;
};
export type LeagueResourcePlanInput = {
  venue_id: string;
  night_dates: string[];
  start_time: "18:00";
  end_time: "20:00";
  court_ids: string[];
};
export type LeagueOperationsRegistration = { id: string; league_team_member_id: string; status: string };
export type LeagueOperationsCheckin = { id: string; customer_id: string };
export type LeagueOperationsProjection = {
  nights: Array<{ id: string; name: string; session_date: string; start_time: string; end_time: string }>;
  fixtures: LeagueFixture[];
  teams: LeagueTeam[];
  members: LeagueAdminMember[];
  registrations: LeagueOperationsRegistration[];
  checkins: LeagueOperationsCheckin[];
  courts: LeagueCourt[];
};

export function fetchLeaguePublic(seriesId: string) {
  return apiGet<LeaguePublicProjection>("api-leagues", "public", { seriesId });
}

export function registerLeagueTeam(input: Record<string, unknown>) {
  return apiPost<{ order: { id: string }; cart_token: string; pricing: Record<string, unknown> }>("api-leagues", "register", input);
}

export function fetchMyLeagues() {
  return apiGet<{ items: MyLeagueItem[] }>("api-leagues", "my");
}

export function fetchLeagueHome(venueSlug: string) {
  return apiGet<{ mode: "none" | "registration" | "next"; item: LeaguePublicProjection | MyLeagueItem | null }>("api-leagues", "home", { v: venueSlug });
}

export function fetchLeagueAdmin(venueId: string) {
  return apiGet<{ seasons: LeagueAdminSeason[]; courts: LeagueCourt[] }>("api-leagues", "admin", { venueId });
}

export function fetchLeagueOperations(venueId: string, date: string) {
  return apiGet<LeagueOperationsProjection>("api-leagues", "operations", { venueId, date });
}

export function previewLeagueResources(input: LeagueResourcePlanInput, signal?: AbortSignal) {
  return apiPost<LeagueResourcePreview>("api-leagues", "resource-preview", input, { signal });
}

export const createLeagueSeason = (input: Record<string, unknown>) => apiPost<{ season: { id: string; activity_series_id: string } }>("api-leagues", "create", input);
export const updateLeagueArtwork = (leagueSeasonId: string, imageUrls: string[]) => apiPatch<{ id: string; image_urls: string[] }>("api-leagues", "artwork", { league_season_id: leagueSeasonId, image_urls: imageUrls });
export const updateLeagueCatalog = (input: Record<string, unknown>) => apiPatch<{ edit: { league_season_id: string; historical_orders_frozen: boolean; schedule_reconciled: false } }>("api-leagues", "catalog", input);
export const publishLeagueOffer = (leagueSeasonId: string) => apiPost("api-leagues", "publish-offer", { league_season_id: leagueSeasonId });
export const generateLeagueFixtures = (leagueSeasonId: string) => apiPost("api-leagues", "generate-fixtures", { league_season_id: leagueSeasonId });
export const publishLeagueFixtures = (leagueSeasonId: string) => apiPost("api-leagues", "publish-fixtures", { league_season_id: leagueSeasonId });
export const saveLeagueResult = (input: Record<string, unknown>) => apiPost("api-leagues", "result", input);
export const postponeLeagueFixture = (fixtureId: string, reason: string) => apiPost("api-leagues", "postpone", { fixture_id: fixtureId, reason, request_id: crypto.randomUUID() });
export const rescheduleLeagueFixture = (input: Record<string, unknown>) => apiPost("api-leagues", "reschedule-fixture", input);
export const rescheduleLeagueNight = (input: Record<string, unknown>) => apiPost("api-leagues", "reschedule-night", input);
export const replaceLeaguePlayer = (input: Record<string, unknown>) => apiPost("api-leagues", "replace-player", input);
export const renameLeagueTeam = (input: Record<string, unknown>) => apiPost("api-leagues", "rename-team", input);
