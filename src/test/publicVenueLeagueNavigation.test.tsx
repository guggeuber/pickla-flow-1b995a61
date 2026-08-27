import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVenueWithHours } from "@/lib/venueStatus";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("live League false-venue-404 regression", () => {
  beforeEach(() => {
    mocks.apiGet.mockResolvedValue({
      venue: { id: "venue-1", slug: "pickla-arena-sthlm", name: "Pickla Stockholm" },
      openingHours: [],
      operationOverrides: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reuses a fresh successful public-venue result on an immediate same-app League remount", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderHook(() => useVenueWithHours("pickla-arena-sthlm"), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useVenueWithHours("pickla-arena-sthlm"), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.apiGet).toHaveBeenCalledWith(
      "api-bookings",
      "public-venue",
      { slug: "pickla-arena-sthlm" },
      expect.objectContaining({
        auth: "omit",
        publicRead: expect.objectContaining({ maxRetries: 1 }),
      }),
    );
  });

  it("documents the independent TopBar initiator and existing browser cache window without coupling League data to it", () => {
    const leagueSource = readFileSync("src/pages/LeaguePage.tsx", "utf8");
    const topBarSource = readFileSync("src/components/PicklaTopBar.tsx", "utf8");
    const venueSource = readFileSync("src/lib/venueStatus.ts", "utf8");
    const bookingsSource = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");

    expect(leagueSource).toContain("fetchLeaguePublic(seriesId, { auth: \"omit\" })");
    expect(leagueSource).toContain("<PicklaTopBar slug={venueSlug}");
    expect(leagueSource).not.toContain('apiGet("api-bookings", "public-venue"');
    expect(topBarSource).toContain("useVenueStatusBySlug(slug)");
    expect(venueSource).toContain('["venue-with-hours", slug]');
    expect(venueSource).toContain("staleTime: 60_000");
    expect(bookingsSource).toContain("}, readContext, 200, 30)");
  });
});
