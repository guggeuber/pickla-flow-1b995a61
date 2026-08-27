import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  account: {
    state: "remote_validating",
    account: null,
    verifiedUserId: null as string | null,
    isVerified: false,
    retry: vi.fn(),
  },
  user: { id: "user-1", email: "private@example.test" } as { id: string; email: string } | null,
  apiGet: vi.fn(),
  fetchCourseHome: vi.fn(),
  fetchLeagueHome: vi.fn(),
  venueData: undefined as { id: string; name: string; slug: string } | undefined,
  venueError: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.user, loading: false, authStatus: mocks.user ? "local_session" : "anonymous" }),
}));
vi.mock("@/hooks/useVerifiedAccount", () => ({ useVerifiedAccount: () => mocks.account }));
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => <div data-testid="topbar" /> }));
vi.mock("@/lib/venueStatus", () => ({
  useVenueWithHours: () => ({
    data: mocks.venueData,
    isLoading: !mocks.venueData && !mocks.venueError,
    isError: mocks.venueError,
  }),
}));
vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/lib/courses", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/courses")>();
  return { ...original, fetchCourseHome: mocks.fetchCourseHome };
});
vi.mock("@/lib/league", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/league")>();
  return { ...original, fetchLeagueHome: mocks.fetchLeagueHome };
});
vi.mock("@/lib/publicProfiles", () => ({ getPublicProfileMap: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/entryResolver", () => ({
  consumeFirstRunWelcome: () => false,
  preserveIntendedRoute: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = () => {
    const result = { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "gte", "lte", "lt", "order"]) {
      builder[method] = () => builder;
    }
    builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  };
  return { supabase: { from: vi.fn(query), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } };
});

import TodayPage from "@/pages/TodayPage";

function never<T>() {
  return new Promise<T>(() => undefined);
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const primaryResponse = {
  venue: { id: "venue-1", name: "Pickla Arena Stockholm", slug: "pickla-arena-sthlm" },
  sessions: [
    {
      id: "visible-session",
      name: "Open Play Express",
      session_type: "open_play",
      session_date: "2026-08-26",
      recurrence_days: null,
      start_time: "18:00",
      end_time: "20:00",
      capacity: 10,
      price_sek: 165,
      product_key: "open_play",
      venue_id: "venue-1",
      access_policy: null,
      metadata: {},
      activity_series: null,
    },
    {
      id: "cancelled-session",
      name: "Inställt pass",
      session_type: "open_play",
      session_date: "2026-08-26",
      recurrence_days: null,
      start_time: "19:00",
      end_time: "21:00",
      capacity: 10,
      price_sek: 165,
      product_key: "open_play",
      venue_id: "venue-1",
      access_policy: null,
      metadata: {},
      activity_series: null,
    },
  ],
  events: [],
  overrides: [{
    id: "override-1",
    activity_session_id: "cancelled-session",
    session_date: "2026-08-26",
    status: "cancelled",
    reason: "Inställt",
  }],
  registrationCounts: [{
    activity_session_id: "visible-session",
    session_date: "2026-08-26",
    registrations_count: 2,
  }],
};

function renderToday(initialEntry = "/today", queryClient = client()) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><TodayPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("Today customer first paint", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-26T10:00:00Z"));
    vi.stubGlobal("scrollTo", vi.fn());
    mocks.account.state = "remote_validating";
    mocks.account.account = null;
    mocks.account.verifiedUserId = null;
    mocks.account.isVerified = false;
    mocks.user = { id: "user-1", email: "private@example.test" };
    mocks.venueData = undefined;
    mocks.venueError = false;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      return never();
    });
    mocks.fetchCourseHome.mockImplementation(() => never());
    mocks.fetchLeagueHome.mockImplementation(() => never());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders truthful primary activity before venue discovery or remote account enrichment", async () => {
    renderToday();

    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(screen.queryByText("Inställt pass")).not.toBeInTheDocument();
    expect(screen.getByText("Boka plats")).toBeInTheDocument();
    expect(screen.queryByText(/private@example.test/i)).not.toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith(
      "api-event-public",
      "today-primary",
      expect.objectContaining({ venueSlug: "pickla-arena-sthlm" }),
      expect.objectContaining({
        auth: "omit",
        publicRead: expect.objectContaining({ maxRetries: 1 }),
      }),
    );
    expect(mocks.fetchCourseHome).not.toHaveBeenCalled();
    expect(mocks.fetchLeagueHome).not.toHaveBeenCalled();
  });

  it("keeps the primary hero stable while verified secondary projections are slow", async () => {
    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();

    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    view.rerender(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/today"]}><TodayPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.fetchCourseHome).toHaveBeenCalled());
    expect(mocks.fetchLeagueHome).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(screen.getByText("Boka plats")).toBeInTheDocument();
  });

  it("also renders the public primary feed for an anonymous visitor", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
  });

  it("keeps a future explicit venue path available after public validation", async () => {
    mocks.venueData = { id: "venue-2", name: "Future Pickla Venue", slug: "future-pickla-venue" };
    renderToday("/today?v=future-pickla-venue");

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith(
      "api-event-public",
      "today-primary",
      expect.objectContaining({ venueSlug: "future-pickla-venue" }),
      expect.objectContaining({
        auth: "omit",
        publicRead: expect.objectContaining({ maxRetries: 1 }),
      }),
    ));
  });

  it("shows the initial error state when no successful primary result exists", async () => {
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary"
        ? Promise.reject(Object.assign(new Error("Unavailable"), { status: 503 }))
        : never()
    ));
    renderToday();

    expect(await screen.findByText("Dagens schema kunde inte hämtas.")).toBeInTheDocument();
    expect(screen.queryByTestId("today-refresh-warning")).not.toBeInTheDocument();
  });

  it("keeps a successful schedule visible when a transient background refresh fails", async () => {
    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();

    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary"
        ? Promise.reject(Object.assign(new Error("Unavailable"), { status: 503 }))
        : never()
    ));
    await act(async () => {
      await view.queryClient.invalidateQueries({ queryKey: ["today-primary", "pickla-arena-sthlm"] });
    });

    expect(screen.getByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(await screen.findByText("Kunde inte uppdatera just nu")).toBeInTheDocument();
    expect(screen.queryByText("Dagens schema kunde inte hämtas.")).not.toBeInTheDocument();
  });

  it("clears the stale warning after manual retry recovers", async () => {
    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();

    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary"
        ? Promise.reject(Object.assign(new Error("Unavailable"), { status: 503 }))
        : never()
    ));
    await act(async () => {
      await view.queryClient.invalidateQueries({ queryKey: ["today-primary", "pickla-arena-sthlm"] });
    });
    expect(await screen.findByText("Kunde inte uppdatera just nu")).toBeInTheDocument();

    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary" ? Promise.resolve(primaryResponse) : never()
    ));
    fireEvent.click(screen.getByRole("button", { name: "Försök igen" }));
    await waitFor(() => expect(screen.queryByTestId("today-refresh-warning")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
  });

  it("replaces cached content with a successful refreshed primary result without a warning", async () => {
    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    const refreshedResponse = {
      ...primaryResponse,
      sessions: primaryResponse.sessions.map((session) => (
        session.id === "visible-session" ? { ...session, name: "Open Play Uppdaterad" } : session
      )),
    };
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary" ? Promise.resolve(refreshedResponse) : never()
    ));

    await act(async () => {
      await view.queryClient.invalidateQueries({ queryKey: ["today-primary", "pickla-arena-sthlm"] });
    });

    expect(await screen.findByRole("heading", { name: "Open Play Uppdaterad" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Open Play Express" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("today-refresh-warning")).not.toBeInTheDocument();
  });

  it("renders venue-not-found for an initial true 404", async () => {
    mocks.venueData = { id: "venue-1", name: "Pickla Arena Stockholm", slug: "pickla-arena-sthlm" };
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => (
      endpoint === "today-primary"
        ? Promise.reject(Object.assign(new Error("Venue not found"), { status: 404 }))
        : never()
    ));
    renderToday();

    expect(await screen.findByText("Arenan kunde inte hittas.")).toBeInTheDocument();
    expect(screen.queryByText("Dagens schema kunde inte hämtas.")).not.toBeInTheDocument();
  });

  it("does not reuse old venue data when navigating to a different invalid slug", async () => {
    const queryClient = client();
    const first = renderToday("/today", queryClient);
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    first.unmount();

    mocks.venueData = undefined;
    mocks.venueError = true;
    renderToday("/today?v=does-not-exist", queryClient);

    expect(await screen.findByText("Arenan kunde inte hittas.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Open Play Express" })).not.toBeInTheDocument();
  });
});
