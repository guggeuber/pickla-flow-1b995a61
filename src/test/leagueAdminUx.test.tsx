import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLeague from "@/components/admin/AdminLeague";
import { ApiRequestError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  createLeagueSeason: vi.fn(),
  fetchLeagueAdmin: vi.fn(),
  previewLeagueResources: vi.fn(),
  updateLeagueCatalog: vi.fn(),
  updateLeagueArtwork: vi.fn(),
  uploadNamedEventImage: vi.fn(),
  removeNamedEventImage: vi.fn(),
  fetchSeriesMemberPricing: vi.fn(),
  saveSeriesMemberPricing: vi.fn(),
  removeSeriesMemberPricing: vi.fn(),
}));

vi.mock("@/lib/league", () => ({
  createLeagueSeason: mocks.createLeagueSeason,
  fetchLeagueAdmin: mocks.fetchLeagueAdmin,
  previewLeagueResources: mocks.previewLeagueResources,
  generateLeagueFixtures: vi.fn(),
  publishLeagueFixtures: vi.fn(),
  publishLeagueOffer: vi.fn(),
  renameLeagueTeam: vi.fn(),
  rescheduleLeagueNight: vi.fn(),
  replaceLeaguePlayer: vi.fn(),
  updateLeagueCatalog: mocks.updateLeagueCatalog,
  updateLeagueArtwork: mocks.updateLeagueArtwork,
}));
vi.mock("@/lib/eventMedia", () => ({
  uploadNamedEventImage: mocks.uploadNamedEventImage,
  removeNamedEventImage: mocks.removeNamedEventImage,
}));
vi.mock("@/lib/courses", () => ({
  fetchSeriesMemberPricing: mocks.fetchSeriesMemberPricing,
  saveSeriesMemberPricing: mocks.saveSeriesMemberPricing,
  removeSeriesMemberPricing: mocks.removeSeriesMemberPricing,
}));

const courts = [1, 2, 3].map((number) => ({ id: `court-${number}`, name: `Bana ${number}`, court_number: number }));

function previewFor(input: { night_dates: string[]; court_ids: string[] }, conflicts: Record<number, Array<Record<string, unknown>>> = {}) {
  return {
    has_conflicts: Object.keys(conflicts).length > 0,
    nights: input.night_dates.map((date, index) => ({
      night_index: index + 1,
      date,
      proposed_starts_at: `${date}T16:00:00Z`,
      proposed_ends_at: `${date}T18:00:00Z`,
      status: conflicts[index]?.length ? "conflict" : "clear",
      courts: input.court_ids.map((courtId) => ({
        court_id: courtId,
        court_name: courts.find((court) => court.id === courtId)?.name || courtId,
        is_available: !conflicts[index]?.some((item) => item.court_id === courtId),
        conflicts: (conflicts[index] || []).filter((item) => item.court_id === courtId).map(({ court_id: _courtId, ...item }) => item),
      })),
    })),
  };
}

function renderLeague(leagueSeasonId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><AdminLeague venueId="venue-1" leagueSeasonId={leagueSeasonId} /></QueryClientProvider>);
}

function completeRequiredCreateFields() {
  fireEvent.change(screen.getByLabelText("Moms · konfigurerad %"), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText("Öppnar"), { target: { value: "2026-08-01T10:00" } });
  fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-09-01T10:00" } });
  fireEvent.change(screen.getByLabelText("Schema senast"), { target: { value: "2026-09-05T10:00" } });
  for (const court of courts) fireEvent.click(screen.getByRole("button", { name: court.name }));
}

describe("League Admin artwork and date entry", () => {
  beforeEach(() => {
    mocks.fetchLeagueAdmin.mockResolvedValue({ seasons: [], courts });
    mocks.createLeagueSeason.mockResolvedValue({ season: { id: "season-1", activity_series_id: "series-1" } });
    mocks.previewLeagueResources.mockImplementation(async (input: { night_dates: string[]; court_ids: string[] }) => previewFor(input));
    mocks.uploadNamedEventImage.mockResolvedValue("https://project.supabase.co/storage/v1/object/public/event-logos/activity-series/series-1/1.webp?v=1");
    mocks.updateLeagueArtwork.mockResolvedValue({ id: "series-1", image_urls: [] });
    mocks.updateLeagueCatalog.mockResolvedValue({ edit: { league_season_id: "season-1", historical_orders_frozen: false, schedule_reconciled: false } });
    mocks.removeNamedEventImage.mockResolvedValue(undefined);
    mocks.fetchSeriesMemberPricing.mockResolvedValue({ series: [] });
    mocks.saveSeriesMemberPricing.mockResolvedValue({ id: "saved-rule" });
    mocks.removeSeriesMemberPricing.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts with one date, proposes five Stockholm Thursdays, and preserves manual overrides", async () => {
    renderLeague();
    const first = await screen.findByLabelText("Första League-kvällen");
    expect(screen.queryByLabelText("Kväll 2")).not.toBeInTheDocument();
    fireEvent.change(first, { target: { value: "2026-09-10" } });
    expect((screen.getByLabelText("Kväll 2") as HTMLInputElement).value).toBe("2026-09-17");
    expect((screen.getByLabelText("Kväll 3") as HTMLInputElement).value).toBe("2026-09-24");
    expect((screen.getByLabelText("Kväll 4") as HTMLInputElement).value).toBe("2026-10-01");
    expect((screen.getByLabelText("Kväll 5") as HTMLInputElement).value).toBe("2026-10-08");

    fireEvent.change(screen.getByLabelText("Kväll 5"), { target: { value: "2026-10-22" } });
    fireEvent.change(first, { target: { value: "2026-09-17" } });
    expect((screen.getByLabelText("Kväll 2") as HTMLInputElement).value).toBe("2026-09-24");
    expect((screen.getByLabelText("Kväll 5") as HTMLInputElement).value).toBe("2026-10-22");

    fireEvent.click(screen.getByRole("button", { name: "Återställ till fem torsdagar" }));
    expect((screen.getByLabelText("Kväll 5") as HTMLInputElement).value).toBe("2026-10-15");
  });

  it("uses the canonical Series upload and saves the five concrete dates", async () => {
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Kväll 5"), { target: { value: "2026-10-15" } });
    const artwork = new File(["image"], "league.webp", { type: "image/webp" });
    fireEvent.change(screen.getByLabelText("Ladda upp League-bild"), { target: { files: [artwork] } });
    expect(screen.queryByPlaceholderText("Artwork URL (https://...)")).not.toBeInTheDocument();
    completeRequiredCreateFields();
    const createButton = screen.getByRole("button", { name: "Skapa Seriespel" });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);

    await waitFor(() => expect(mocks.createLeagueSeason).toHaveBeenCalledTimes(1));
    expect(mocks.createLeagueSeason.mock.calls[0][0].night_dates).toEqual([
      "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-15",
    ]);
    expect(mocks.createLeagueSeason.mock.calls[0][0].image_urls).toEqual([]);
    await waitFor(() => expect(mocks.uploadNamedEventImage).toHaveBeenCalledWith({ owner: "activity-series", ownerId: "series-1", slot: 1, file: artwork }));
    expect(mocks.updateLeagueArtwork).toHaveBeenCalledWith("season-1", [expect.stringContaining("event-logos/activity-series/series-1/1.webp")]);
  });

  it("does not preflight an incomplete plan and only enables Create after the current plan is clear", async () => {
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    expect(mocks.previewLeagueResources).not.toHaveBeenCalled();
    expect(screen.getByText("Välj fem torsdagar och exakt tre banor för att kontrollera planen.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeDisabled();

    completeRequiredCreateFields();
    expect(await screen.findByText("Kontrollerar banorna…")).toBeInTheDocument();
    await waitFor(() => expect(mocks.previewLeagueResources).toHaveBeenCalledTimes(1));
    await screen.findByText("Alla fem League-kvällar är fria");
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeEnabled();
  });

  it("shows every conflicting night and keeps Create disabled", async () => {
    mocks.previewLeagueResources.mockImplementation(async (input: { night_dates: string[]; court_ids: string[] }) => previewFor(input, {
      0: [{ court_id: "court-1", owner_type: "booking", owner_label: "Banbokning", owner_name: null, starts_at: "2026-09-10T16:00:00Z", ends_at: "2026-09-10T17:00:00Z" }],
      2: [{ court_id: "court-2", owner_type: "open_play", owner_label: "Open Play", owner_name: "Open Play Kväll", starts_at: "2026-09-24T16:00:00Z", ends_at: "2026-09-24T18:00:00Z" }],
      4: [{ court_id: "court-3", owner_type: "event", owner_label: "Event", owner_name: "Företagsevent", starts_at: "2026-10-08T17:00:00Z", ends_at: "2026-10-08T19:00:00Z" }],
    }));
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    completeRequiredCreateFields();

    await screen.findByText("Banor behöver ändras");
    expect(screen.getByText("Bana 1 · upptagen 18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("Bana 2 · upptagen 18:00–20:00")).toBeInTheDocument();
    expect(screen.getByText("Bana 3 · upptagen 19:00–21:00")).toBeInTheDocument();
    expect(screen.getByText("Banbokning")).toBeInTheDocument();
    expect(screen.getByText(/Open Play Kväll/)).toBeInTheDocument();
    expect(screen.getByText(/Företagsevent/)).toBeInTheDocument();
    expect(screen.getAllByText("Ledig")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeDisabled();
  });

  it("ignores an older response after an individual date edit", async () => {
    let resolveFirst!: (value: ReturnType<typeof previewFor>) => void;
    const first = new Promise<ReturnType<typeof previewFor>>((resolve) => { resolveFirst = resolve; });
    mocks.previewLeagueResources
      .mockImplementationOnce(() => first)
      .mockImplementation(async (input: { night_dates: string[]; court_ids: string[] }) => previewFor(input));
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    completeRequiredCreateFields();
    await waitFor(() => expect(mocks.previewLeagueResources).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Kväll 5"), { target: { value: "2026-10-15" } });
    await waitFor(() => expect(mocks.previewLeagueResources).toHaveBeenCalledTimes(2));
    await screen.findByText("Alla fem League-kvällar är fria");

    const firstInput = mocks.previewLeagueResources.mock.calls[0][0] as { night_dates: string[]; court_ids: string[] };
    resolveFirst(previewFor(firstInput, {
      0: [{ court_id: "court-1", owner_type: "booking", owner_label: "Banbokning", owner_name: null, starts_at: "2026-09-10T16:00:00Z", ends_at: "2026-09-10T18:00:00Z" }],
    }));
    await waitFor(() => expect(screen.queryByText("Banor behöver ändras")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeEnabled();
  });

  it("invalidates a green result and runs a fresh check after a court edit", async () => {
    mocks.fetchLeagueAdmin.mockResolvedValue({
      seasons: [],
      courts: [...courts, { id: "court-4", name: "Bana 4", court_number: 4 }],
    });
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    completeRequiredCreateFields();
    await screen.findByText("Alla fem League-kvällar är fria");
    expect(mocks.previewLeagueResources).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Bana 3" }));
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Bana 4" }));
    expect(await screen.findByText("Kontrollerar banorna…")).toBeInTheDocument();
    await waitFor(() => expect(mocks.previewLeagueResources).toHaveBeenCalledTimes(2));
    await screen.findByText("Alla fem League-kvällar är fria");
    expect(mocks.previewLeagueResources.mock.calls[1][0].court_ids).toEqual(["court-1", "court-2", "court-4"]);
  });

  it("treats a preview failure as unverified and retryable", async () => {
    mocks.previewLeagueResources.mockRejectedValueOnce(new Error("network unavailable"));
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    completeRequiredCreateFields();

    await screen.findByText("Banorna kunde inte kontrolleras");
    expect(screen.getByText("Ingen ledighet har bekräftats. Försök igen innan Seriespelet skapas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    await screen.findByText("Alla fem League-kvällar är fria");
  });

  it("turns a final-create race into the same human conflict model without clearing the form", async () => {
    const racePreview = previewFor({ night_dates: ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"], court_ids: courts.map((court) => court.id) }, {
      2: [{ court_id: "court-2", owner_type: "course", owner_label: "Kurs", owner_name: "Pickla Start", starts_at: "2026-09-24T16:00:00Z", ends_at: "2026-09-24T18:00:00Z" }],
    });
    mocks.createLeagueSeason.mockRejectedValue(new ApiRequestError(
      "Bana 2 är upptagen av Pickla Start 18:00–20:00. Ändra League-planen och kontrollera banorna igen.",
      409,
      { code: "managed_series_resource_conflict", preview: racePreview },
    ));
    renderLeague();
    fireEvent.change(await screen.findByLabelText("Första League-kvällen"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Min bevarade League" } });
    completeRequiredCreateFields();
    const createButton = screen.getByRole("button", { name: "Skapa Seriespel" });
    await waitFor(() => expect(createButton).toBeEnabled());
    mocks.previewLeagueResources.mockImplementation(async () => racePreview);
    fireEvent.click(createButton);

    await screen.findByText("Banor behöver ändras");
    expect(screen.getByText("Bana 2 · upptagen 18:00–20:00")).toBeInTheDocument();
    expect(screen.getByText(/Pickla Start/)).toBeInTheDocument();
    expect(screen.queryByText("managed_series_resource_conflict")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Titel")).toHaveValue("Min bevarade League");
    expect(mocks.createLeagueSeason).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Skapa Seriespel" })).toBeDisabled();
  });

  it("can replace an existing League image through the same canonical upload", async () => {
    mocks.fetchLeagueAdmin.mockResolvedValue({
      courts,
      seasons: [{
        id: "season-1", activity_series_id: "series-1", fixtures_published_at: null,
        activity_series: { id: "series-1", venue_id: "venue-1", name: "Season 01", description: null, image_urls: ["https://project.supabase.co/storage/v1/object/public/event-logos/activity-series/series-1/1.webp?v=old"], status: "draft", start_date: "2026-09-10", end_date: "2026-10-08", registration_closes_at: "2026-09-01T10:00:00Z" },
        teams: [], members: [], sessions: [], fixtures: [], results: [], orders: [], validation: null,
      }],
    });
    renderLeague("season-1");
    const input = await screen.findByLabelText("Byt League-bild");
    const replacement = new File(["new"], "replacement.webp", { type: "image/webp" });
    fireEvent.change(input, { target: { files: [replacement] } });
    await waitFor(() => expect(mocks.uploadNamedEventImage).toHaveBeenCalledWith({ owner: "activity-series", ownerId: "series-1", slot: 1, file: replacement }));
    expect(mocks.updateLeagueArtwork).toHaveBeenCalledWith("season-1", [expect.stringContaining("event-logos/activity-series/series-1/1.webp")]);
  });

  it("edits safe League Catalog fields in one Save and links published customer truth", async () => {
    mocks.fetchLeagueAdmin.mockResolvedValue({
      courts,
      seasons: [{
        id: "season-1", activity_series_id: "series-1", fixtures_published_at: null,
        fixture_publication_deadline: "2027-08-27T10:00:43.789Z",
        activity_series: {
          id: "series-1", venue_id: "venue-1", name: "Pickla Seriespel · Pilot", description: "Original beskrivning",
          image_urls: [], status: "active", start_date: "2027-09-02", end_date: "2027-09-30",
          registration_opens_at: "2027-08-01T10:00:37.123Z", registration_closes_at: "2027-08-20T10:00:41.456Z",
          start_time: "18:00", end_time: "20:00", court_ids: ["court-1", "court-2", "court-3"],
          venues: { slug: "pickla-arena-sthlm" },
          access_products: { id: "product-1", name: "Pilot · Lagplats", description: null, product_kind: "league_team", base_price_sek: 1995, vat_rate: 6, scarcity_mode: "early_bird", early_bird_price_minor: 179500, early_bird_slots: 2, status: "active", is_active: true },
        },
        edit_policy: { lifecycle_editable: true, registration_opens_editable: true, registration_deadline_editable: true, fixture_deadline_editable: true, pricing_editable: true, schedule_editable: false, schedule_lock_reason: "league_v1_structure_locked", historical_prices_frozen: false },
        teams: [], members: [], sessions: [{ id: "session-1", session_date: "2027-09-02", start_time: "18:00:00", end_time: "20:00:00", court_ids: [], capacity: 12, series_occurrence_index: 1, is_active: true }], fixtures: [], results: [], orders: [], validation: null,
      }],
    });
    renderLeague("season-1");

    expect(await screen.findByRole("link", { name: "Visa kundsida" })).toHaveAttribute("href", "/seriespel/series-1?v=pickla-arena-sthlm");
    fireEvent.change(screen.getByLabelText("League-titel"), { target: { value: "Pickla Seriespel · Höst" } });
    fireEvent.change(screen.getByLabelText("League-beskrivning"), { target: { value: "Ny kundbeskrivning" } });
    fireEvent.change(screen.getByLabelText("Ordinarie teampris"), { target: { value: "2095" } });
    fireEvent.change(screen.getByLabelText("Early Bird-teampris"), { target: { value: "1895" } });
    fireEvent.change(screen.getByLabelText("Första N lag"), { target: { value: "3" } });
    const save = screen.getByRole("button", { name: "Spara ändringar" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateLeagueCatalog).toHaveBeenCalledTimes(1));
    expect(mocks.updateLeagueCatalog).toHaveBeenCalledWith(expect.objectContaining({
      league_season_id: "season-1",
      name: "Pickla Seriespel · Höst",
      description: "Ny kundbeskrivning",
      base_price_minor: 209500,
      early_bird_price_minor: 189500,
      early_bird_slots: 3,
      registration_opens_at: "2027-08-01T10:00:37.123Z",
      registration_deadline: "2027-08-20T10:00:41.456Z",
      fixture_publication_deadline: "2027-08-27T10:00:43.789Z",
    }));
  });

  it("uses the shared fixed-SEK Catalog editor for dynamic League team member prices", async () => {
    mocks.fetchSeriesMemberPricing.mockResolvedValue({
      series: [{
        series_id: "series-1",
        product: {
          id: "product-1", venue_id: "venue-1", product_key: "league_dynamic_team",
          product_kind: "league_team", name: "League · Lagplats", base_price_sek: 1995,
          is_active: true, status: "active",
        },
        tiers: [
          {
            tier: { id: "tier-play", name: "Play", color: null, sort_order: 1, is_active: true, is_assignable: true },
            rule: { id: "rule-play", tier_id: "tier-play", product_type: "league_dynamic_team", fixed_price: 1795, discount_percent: null, vat_rate: 6, label: "Play", mode: "fixed" },
            preview: { ordinary_price_sek: 1995, resolved_price_sek: 1795, mode: "fixed", value: 1795 },
          },
          {
            tier: { id: "tier-founder", name: "Founder", color: null, sort_order: 2, is_active: false, is_assignable: true },
            rule: null, preview: null,
          },
          {
            tier: { id: "tier-synthetic", name: "Synthetic eligible", color: null, sort_order: 3, is_active: false, is_assignable: true },
            rule: null, preview: null,
          },
        ],
      }],
    });
    mocks.fetchLeagueAdmin.mockResolvedValue({
      courts,
      seasons: [{
        id: "season-1", activity_series_id: "series-1", fixtures_published_at: null,
        fixture_publication_deadline: "2027-08-27T10:00:00Z",
        activity_series: {
          id: "series-1", venue_id: "venue-1", name: "Dynamic League", description: null,
          image_urls: [], status: "active", start_date: "2027-09-02", end_date: "2027-09-30",
          registration_opens_at: "2027-08-01T10:00:00Z", registration_closes_at: "2027-08-20T10:00:00Z",
          start_time: "18:00", end_time: "20:00", court_ids: ["court-1", "court-2", "court-3"],
          venues: { slug: "pickla-arena-sthlm" },
          access_products: { id: "product-1", name: "League · Lagplats", product_key: "league_dynamic_team", product_kind: "league_team", base_price_sek: 1995, vat_rate: 6, scarcity_mode: "none", early_bird_price_minor: null, early_bird_slots: null, status: "active", is_active: true },
        },
        edit_policy: { lifecycle_editable: true, registration_opens_editable: true, registration_deadline_editable: true, fixture_deadline_editable: true, pricing_editable: true, schedule_editable: false, schedule_lock_reason: "league_v1_structure_locked", historical_prices_frozen: false },
        teams: [], members: [], sessions: [], fixtures: [], results: [], orders: [], validation: null,
      }],
    });
    renderLeague("season-1");

    const editor = await screen.findByTestId("series-member-pricing");
    expect(within(editor).getByText("Teampris för hela lagplatsen · båda spelarna")).toBeInTheDocument();
    expect(within(editor).getByLabelText("Play medlemspris")).toHaveValue("1795");
    expect(within(editor).getByLabelText("Founder medlemspris")).toHaveValue("");
    expect(within(editor).getByLabelText("Synthetic eligible medlemspris")).toBeInTheDocument();
    expect(within(editor).queryByText(/procent|%/i)).not.toBeInTheDocument();

    const founder = within(editor).getByTestId("series-member-price-tier-founder");
    fireEvent.change(within(founder).getByLabelText("Founder medlemspris"), { target: { value: "1595" } });
    fireEvent.click(within(founder).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(mocks.saveSeriesMemberPricing).toHaveBeenCalledWith({
      ruleId: undefined,
      tierId: "tier-founder",
      productKey: "league_dynamic_team",
      mode: "fixed",
      value: 1595,
      label: "Founder · League · Lagplats",
    }));

    const play = within(editor).getByTestId("series-member-price-tier-play");
    fireEvent.change(within(play).getByLabelText("Play medlemspris"), { target: { value: "" } });
    fireEvent.click(within(play).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(mocks.removeSeriesMemberPricing).toHaveBeenCalledWith("rule-play"));
  });

  it("locks historical deadlines, pricing and V1 structure with human reasons", async () => {
    mocks.fetchLeagueAdmin.mockResolvedValue({
      courts,
      seasons: [{
        id: "season-1", activity_series_id: "series-1", fixtures_published_at: "2020-08-25T10:00:00Z",
        fixture_publication_deadline: "2020-08-24T10:00:00Z",
        activity_series: {
          id: "series-1", venue_id: "venue-1", name: "Historisk League", description: null, image_urls: [], status: "active",
          start_date: "2020-09-03", end_date: "2020-10-01", registration_opens_at: "2020-08-01T10:00:00Z", registration_closes_at: "2020-08-20T10:00:00Z",
          start_time: "18:00", end_time: "20:00", court_ids: ["court-1", "court-2", "court-3"], venues: { slug: "pickla-arena-sthlm" },
          access_products: { id: "product-1", name: "Historisk League · Lagplats", description: null, product_kind: "league_team", base_price_sek: 1995, vat_rate: 6, scarcity_mode: "none", early_bird_price_minor: null, early_bird_slots: null, status: "active", is_active: true },
        },
        edit_policy: { lifecycle_editable: true, registration_opens_editable: false, registration_deadline_editable: false, fixture_deadline_editable: false, pricing_editable: false, schedule_editable: false, schedule_lock_reason: "participants_matches_or_payments_exist", historical_prices_frozen: true },
        teams: [{ id: "team-1", team_name: "Historiskt lag", status: "active", captain_customer_id: "customer-1", payer_customer_id: "customer-1", commerce_order_id: "order-1", commerce_order_line_id: "line-1", pricing_reason: "early_bird", final_price_minor: 179500, activated_at: "2020-08-10T00:00:00Z" }],
        members: [], sessions: [], fixtures: [], results: [], orders: [{ id: "order-1", status: "paid", total_inc_vat_minor: 179500, paid_at: "2020-08-10T00:00:00Z" }], validation: null,
      }],
    });
    renderLeague("season-1");

    expect(await screen.findByLabelText("Anmälan öppnar")).toBeDisabled();
    expect(screen.getByLabelText("Anmälan stänger")).toBeDisabled();
    expect(screen.getByLabelText("Schema publiceras senast")).toBeDisabled();
    expect(screen.getByLabelText("Ordinarie teampris")).toBeDisabled();
    expect(screen.getByText(/Tidigare lagköp behåller betalt pris/)).toBeInTheDocument();
    expect(screen.getByText(/Schema och resurser är låsta eftersom säsongen har deltagare/)).toBeInTheDocument();
    expect(screen.queryByText(/UUID|managed_series|league_seasons/)).not.toBeInTheDocument();
  });

  it("keeps artwork persistence behind the admin API and the configured storage origin", () => {
    const api = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
    const artworkPath = api.slice(api.indexOf("function cleanLeagueImageUrls"), api.indexOf("if (req.method === 'POST' && path === 'create')"));
    expect(artworkPath).toContain("Deno.env.get('SUPABASE_URL')");
    expect(artworkPath).toContain("parsed.origin !== new URL(storageOrigin).origin");
    expect(artworkPath).toContain("requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin'])");
    expect(artworkPath).toContain(".update({ image_urls: imageUrls })");
  });
});
