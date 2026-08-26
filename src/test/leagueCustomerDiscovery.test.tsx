import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LeagueDiscoveryPage from "@/pages/LeagueDiscoveryPage";
import LeaguePage from "@/pages/LeaguePage";

const mocks = vi.hoisted(() => ({
  fetchLeagueHome: vi.fn(),
  fetchLeaguePublic: vi.fn(),
  user: null as { id: string } | null,
}));

vi.mock("@/lib/league", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/league")>();
  return { ...original, fetchLeagueHome: mocks.fetchLeagueHome, fetchLeaguePublic: mocks.fetchLeaguePublic, registerLeagueTeam: vi.fn() };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => <div data-testid="top-bar" /> }));
vi.mock("@/lib/share", () => ({ shareOrCopy: vi.fn() }));

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}{location.search}</span>;
}

const publicLeague = {
  series: {
    id: "series-1", venue_id: "venue-1", name: "Pickla Seriespel · Season 01", description: "Fem torsdagar.", image_urls: [],
    start_date: "2026-09-10", end_date: "2026-10-08", start_time: "18:00:00", end_time: "20:00:00",
    registration_opens_at: "2026-08-01T00:00:00Z", registration_closes_at: "2026-09-05T00:00:00Z", metadata: {},
    venues: { name: "Pickla Stockholm", slug: "pickla-arena-sthlm", timezone: "Europe/Stockholm" },
  },
  season: { id: "season-1", team_capacity: 6, players_per_team: 2, league_night_count: 5, matches_per_team_per_night: 2, blocks_per_night: 2, match_duration_minutes: 50, fixtures_published_at: "2026-09-01T00:00:00Z", fixture_publication_deadline: "2026-09-05T00:00:00Z" },
  product: { id: "product-1", name: "Lagplats", base_price_sek: 1995, vat_rate: 6, scarcity_mode: "none", early_bird_price_minor: null, early_bird_slots: null },
  sessions: ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"].map((date, index) => ({ id: `night-${index + 1}`, session_date: date, start_time: "18:00:00", end_time: "20:00:00", court_ids: ["court-1"], series_occurrence_index: index + 1 })),
  courts: [{ id: "court-1", name: "Bana 1", court_number: 1 }],
  capacity: { team_capacity: 6, active_teams: 2, active_holds: 0, fill_count: 2, available_count: 4, early_bird_allocated: 0, early_bird_remaining: null },
  current_price_minor: 199500, pricing_reason: "league_team_base_price",
  teams: [{ id: "team-a", team_name: "Dink Floyd", status: "active" }, { id: "team-b", team_name: "Kitchen Nightmares", status: "active" }],
  fixtures: [
    { id: "fixture-final", league_night_session_id: "night-1", round_number: 1, block_number: 1, venue_court_id: "court-1", team_a_entry_id: "team-a", team_b_entry_id: "team-b", scheduled_start_at: "2026-08-20T16:00:00Z", scheduled_end_at: "2026-08-20T16:50:00Z", status: "completed", league_fixture_results: [{ id: "result-1", state: "final", outcome_type: "played", sets: [{ team_a: 13, team_b: 11 }, { team_a: 13, team_b: 12 }, { team_a: 11, team_b: 7 }], walkover_winner_team_id: null, version: 2 }] },
    { id: "fixture-next", league_night_session_id: "night-2", round_number: 2, block_number: 1, venue_court_id: "court-1", team_a_entry_id: "team-b", team_b_entry_id: "team-a", scheduled_start_at: "2026-09-17T16:00:00Z", scheduled_end_at: "2026-09-17T16:50:00Z", status: "scheduled", league_fixture_results: [] },
  ],
  standings: [
    { position: 1, team_entry_id: "team-a", team_name: "Dink Floyd", matches_played: 1, wins: 1, losses: 0, sets_won: 3, sets_lost: 0, set_difference: 3, points_scored: 37, points_conceded: 30, point_difference: 7, league_points: 3, walkovers: 0 },
    { position: 2, team_entry_id: "team-b", team_name: "Kitchen Nightmares", matches_played: 1, wins: 0, losses: 1, sets_won: 0, sets_lost: 3, set_difference: -3, points_scored: 30, points_conceded: 37, point_difference: -7, league_points: 0, walkovers: 0 },
  ],
  customer_team_id: null,
};

describe("League customer discovery and canonical public results", () => {
  beforeEach(() => {
    mocks.user = null;
    mocks.fetchLeaguePublic.mockResolvedValue(publicLeague);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resolves the customer discovery route to the canonical League detail", async () => {
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "registration", item: publicLeague });
    render(<QueryClientProvider client={queryClient()}><MemoryRouter initialEntries={["/seriespel?v=pickla-arena-sthlm"]}><Routes><Route path="/seriespel" element={<LeagueDiscoveryPage />} /><Route path="/seriespel/:seriesId" element={<LocationProbe />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByTestId("location-probe")).toHaveTextContent("/seriespel/series-1?v=pickla-arena-sthlm");
    expect(mocks.fetchLeagueHome).toHaveBeenCalledWith("pickla-arena-sthlm", { auth: "omit" });
  });

  it("renders the public League discovery shell while its projection is slow", () => {
    mocks.fetchLeagueHome.mockImplementation(() => new Promise(() => undefined));
    render(<QueryClientProvider client={queryClient()}><MemoryRouter initialEntries={["/seriespel"]}><LeagueDiscoveryPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Pickla Seriespel" })).toBeInTheDocument();
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
  });

  it("keeps the discovery route safe when no public or owned League exists", async () => {
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "none", item: null });
    render(<QueryClientProvider client={queryClient()}><MemoryRouter initialEntries={["/seriespel?v=pickla-arena-sthlm"]}><LeagueDiscoveryPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Nästa säsong kommer snart" })).toBeInTheDocument();
  });

  it("renders dates, fixtures, canonical results and backend-derived standings without private roster data", async () => {
    render(<QueryClientProvider client={queryClient()}><MemoryRouter initialEntries={["/seriespel/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/seriespel/:seriesId" element={<LeaguePage />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Pickla Seriespel · Season 01" })).toBeInTheDocument();
    expect(screen.getByText("10/9")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nästa omgång" })).toBeInTheDocument();
    expect(screen.getByText("13–11 · 13–12 · 11–7")).toBeInTheDocument();
    const standingsRow = within(screen.getByRole("table")).getByText("Dink Floyd").closest("tr");
    expect(standingsRow).not.toBeNull();
    expect(within(standingsRow!).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("captain@example.test")).not.toBeInTheDocument();

    const api = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
    const publicProjection = api.slice(api.indexOf("async function loadPublicProjection"), api.indexOf("async function createLeagueCart"));
    expect(publicProjection).toContain("admin.rpc('get_league_standings'");
    expect(publicProjection).toContain("select('id, team_name, status')");
    expect(publicProjection).not.toContain("primary_email");
    expect(publicProjection).not.toContain("payer_customer_id");
  });

  it("renders public League detail while signed-in team ownership is still loading", async () => {
    mocks.user = { id: "captain-1" };
    mocks.fetchLeaguePublic.mockImplementation((_seriesId: string, options?: { auth?: string }) =>
      options?.auth === "omit" ? Promise.resolve(publicLeague) : new Promise(() => undefined)
    );
    render(<QueryClientProvider client={queryClient()}><MemoryRouter initialEntries={["/seriespel/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/seriespel/:seriesId" element={<LeaguePage />} /></Routes></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByRole("heading", { name: "Pickla Seriespel · Season 01" })).toBeInTheDocument();
    expect(screen.getByText("Din lagstatus hämtas…")).toBeInTheDocument();
    expect(screen.queryByText("Ditt lag är anmält · Visa")).not.toBeInTheDocument();
    expect(mocks.fetchLeaguePublic).toHaveBeenCalledWith("series-1", { auth: "omit" });
  });

  it("keeps concrete activity sessions authoritative after the first-date proposal", () => {
    const playSql = readFileSync("supabase/migrations/20260827122000_league_v1_play.sql", "utf8");
    expect(playSql).toContain("FOR v_date IN SELECT day FROM unnest(p_night_dates) day ORDER BY day LOOP");
    expect(playSql).toContain("TIME '18:00', TIME '20:00', 0, 12, p_court_ids");
    expect(playSql).not.toContain("start_date +");
  });
});
