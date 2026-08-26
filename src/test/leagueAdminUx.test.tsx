import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLeague from "@/components/admin/AdminLeague";
import { ApiRequestError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  createLeagueSeason: vi.fn(),
  fetchLeagueAdmin: vi.fn(),
  previewLeagueResources: vi.fn(),
  updateLeagueArtwork: vi.fn(),
  uploadNamedEventImage: vi.fn(),
  removeNamedEventImage: vi.fn(),
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
  updateLeagueArtwork: mocks.updateLeagueArtwork,
}));
vi.mock("@/lib/eventMedia", () => ({
  uploadNamedEventImage: mocks.uploadNamedEventImage,
  removeNamedEventImage: mocks.removeNamedEventImage,
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
    mocks.removeNamedEventImage.mockResolvedValue(undefined);
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

  it("keeps artwork persistence behind the admin API and the configured storage origin", () => {
    const api = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
    const artworkPath = api.slice(api.indexOf("function cleanLeagueImageUrls"), api.indexOf("if (req.method === 'POST' && path === 'create')"));
    expect(artworkPath).toContain("Deno.env.get('SUPABASE_URL')");
    expect(artworkPath).toContain("parsed.origin !== new URL(storageOrigin).origin");
    expect(artworkPath).toContain("requireVenueRole(admin, authenticatedUserId, season.venue_id, ['venue_admin'])");
    expect(artworkPath).toContain(".update({ image_urls: imageUrls })");
  });
});
