import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLeague from "@/components/admin/AdminLeague";

const mocks = vi.hoisted(() => ({
  createLeagueSeason: vi.fn(),
  fetchLeagueAdmin: vi.fn(),
  updateLeagueArtwork: vi.fn(),
  uploadNamedEventImage: vi.fn(),
  removeNamedEventImage: vi.fn(),
}));

vi.mock("@/lib/league", () => ({
  createLeagueSeason: mocks.createLeagueSeason,
  fetchLeagueAdmin: mocks.fetchLeagueAdmin,
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
    fireEvent.click(screen.getByRole("button", { name: "Skapa Seriespel" }));

    await waitFor(() => expect(mocks.createLeagueSeason).toHaveBeenCalledTimes(1));
    expect(mocks.createLeagueSeason.mock.calls[0][0].night_dates).toEqual([
      "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-15",
    ]);
    expect(mocks.createLeagueSeason.mock.calls[0][0].image_urls).toEqual([]);
    await waitFor(() => expect(mocks.uploadNamedEventImage).toHaveBeenCalledWith({ owner: "activity-series", ownerId: "series-1", slot: 1, file: artwork }));
    expect(mocks.updateLeagueArtwork).toHaveBeenCalledWith("season-1", [expect.stringContaining("event-logos/activity-series/series-1/1.webp")]);
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
