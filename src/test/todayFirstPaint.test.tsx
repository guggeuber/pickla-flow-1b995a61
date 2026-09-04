import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  fetchCourseDetail: vi.fn(),
  fetchCourseHome: vi.fn(),
  fetchLeaguePublic: vi.fn(),
  fetchLeagueHome: vi.fn(),
  supabaseFrom: vi.fn(),
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
  return { ...original, fetchCourseDetail: mocks.fetchCourseDetail, fetchCourseHome: mocks.fetchCourseHome };
});
vi.mock("@/lib/league", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/league")>();
  return { ...original, fetchLeaguePublic: mocks.fetchLeaguePublic, fetchLeagueHome: mocks.fetchLeagueHome };
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
  mocks.supabaseFrom.mockImplementation(query);
  return { supabase: { from: mocks.supabaseFrom, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } };
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
  seriesOccurrences: [],
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

function secondaryResponse(pricing: Array<Record<string, unknown>> = []) {
  return {
    course: { mode: "none", item: null },
    league: { mode: "none", item: null },
    first_visit: {
      is_first_time: false,
      has_configured_offer: false,
      occurrences: [],
      items: [],
      pricing,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function publicPromotions(courseId = "parker-brunch", courseName = "Parker Brunch") {
  return {
    first_visit: {
      is_first_time: true,
      has_configured_offer: true,
      occurrences: [],
      items: [{ route: "/program/first-visit?date=2026-08-26&v=pickla-arena-sthlm" }],
      pricing: [],
    },
    league: {
      mode: "registration",
      item: {
        series: { id: "league-1", name: "League Season 01", image_urls: [] },
        season: { team_capacity: 6, league_night_count: 5, matches_per_team_per_night: 2 },
        capacity: { available_count: 4 },
        current_price_minor: 199500,
        pricing_reason: "league_team_base_price",
        route: "/seriespel/league-1?v=pickla-arena-sthlm",
      },
    },
    course: {
      mode: "registration",
      item: {
        id: courseId,
        name: courseName,
        image_urls: [],
        start_date: "2026-09-20",
        registration_state: "open",
        capacity: { available_count: 12 },
        format: { name: courseName, description: "Spela och umgås.", presentation_type: "social_event" },
        product: { base_price_sek: 595 },
        pricing: {
          scope_type: "activity_series",
          list_price_minor: 59500,
          final_price_minor: 59500,
          pricing_reason: "series_product_base_price",
          sales_channel: "online",
          checkout_label: "595 kr",
          membership_tier_name: null,
          early_bird: { configured: false, active: false, applied: false, price_minor: null, slots: null, remaining: null },
        },
        included_access: { open_play_series_period: { enabled: false } },
        route: `/course/${courseId}?v=pickla-arena-sthlm`,
      },
    },
  };
}

function primaryWithSecondaryRow() {
  return {
    ...primaryResponse,
    sessions: [
      ...primaryResponse.sessions,
      {
        ...primaryResponse.sessions[0],
        id: "second-visible-session",
        name: "Open Play Sen",
        start_time: "20:00",
        end_time: "22:00",
      },
    ],
  };
}

function earlierOpenBooking() {
  return {
    id: "open-booking-1",
    title: "Häng på Gunnar",
    start_time: "2026-08-26T14:00:00Z",
    end_time: "2026-08-26T15:00:00Z",
    open_spots: 2,
    public_capacity: 4,
    pace_label: "Medel",
    booker_first_name: "Gunnar",
    committed_count: 2,
    claim_url: "https://playpickla.com/booking/claim/open-booking-1",
    courts: [{ name: "Bana 1" }],
  };
}

function weekendDiscoveryPrimary(registrationState: "open" | "closed" = "open", overrideStatus?: "hidden" | "cancelled") {
  const session = (id: string, name: string, date: string, startTime: string, endTime: string, sessionType: string) => ({
    id,
    name,
    session_type: sessionType,
    session_date: date,
    recurrence_days: null,
    start_time: startTime,
    end_time: endTime,
    capacity: 40,
    price_sek: 165,
    product_key: "open_play_slot",
    venue_id: "venue-1",
    access_policy: null,
    metadata: {},
    activity_series: null,
  });
  return {
    venue: { id: "venue-1", name: "Pickla Arena Stockholm", slug: "pickla-arena-sthlm" },
    sessions: [
      session("friday-lunch", "Lunch Play", "2026-09-04", "12:00", "14:00", "open_play"),
      session("saturday-morning", "Open Play FM", "2026-09-05", "10:00", "12:00", "open_play"),
      session("saturday-open", "Pickla Open", "2026-09-05", "10:00", "12:00", "pickla_open"),
      session("saturday-afternoon", "Open Play Eftermiddag", "2026-09-05", "14:00", "16:00", "open_play"),
    ],
    seriesOccurrences: [{
      session_id: "parker-session",
      series_id: "parker-series",
      title: "Parker Brunch",
      session_date: "2026-09-05",
      start_time: "13:00",
      end_time: "18:00",
      capacity: 40,
      presentation_type: "social_event",
      registration_state: registrationState,
      image_urls: ["https://example.test/parker.webp"],
      route: "/course/parker-series?v=pickla-arena-sthlm",
    }],
    events: [],
    overrides: overrideStatus ? [{
      id: "parker-override",
      activity_session_id: "parker-session",
      session_date: "2026-09-05",
      status: overrideStatus,
      reason: "Not public this date",
    }] : [],
    registrationCounts: [{
      activity_session_id: "parker-session",
      session_date: "2026-09-05",
      registrations_count: 4,
    }],
  };
}

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
    mocks.fetchCourseDetail.mockImplementation(() => never());
    mocks.fetchLeagueHome.mockImplementation(() => never());
    mocks.fetchLeaguePublic.mockImplementation(() => never());
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

  it("keeps the primary hero stable and defers private projections until public identity is known", async () => {
    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    const hero = screen.getByTestId("today-featured-hero");
    const greetingSlot = screen.getByTestId("today-hero-greeting-slot");
    expect(greetingSlot.textContent?.trim()).toBe("");

    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MemoryRouter initialEntries={["/today"]}><TodayPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Hej private.")).toBeInTheDocument();
    expect(mocks.fetchCourseHome).not.toHaveBeenCalled();
    expect(mocks.fetchCourseDetail).not.toHaveBeenCalled();
    expect(mocks.fetchLeagueHome).not.toHaveBeenCalled();
    expect(mocks.fetchLeaguePublic).not.toHaveBeenCalled();
    expect(screen.getByTestId("today-featured-hero")).toBe(hero);
    expect(screen.getByTestId("today-hero-greeting-slot")).toBe(greetingSlot);
    expect(greetingSlot).toHaveClass("h-[22px]");
    expect(screen.getByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(screen.getByText("Boka plats")).toBeInTheDocument();
  });

  it("also renders the public primary feed for an anonymous visitor", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
  });

  it("shows Parker as the third weekend row, preserves Open Play/Pickla Open, and removes a duplicate promotion", async () => {
    vi.setSystemTime(new Date("2026-09-04T10:00:00Z"));
    mocks.user = null;
    mocks.account.state = "anonymous";
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(weekendDiscoveryPrimary());
      if (endpoint === "today-secondary") return Promise.resolve(publicPromotions("parker-series", "Parker Brunch"));
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      return never();
    });

    renderToday();
    const weekendHeading = await screen.findByRole("heading", { name: "I helgen" });
    const weekend = weekendHeading.closest("section");
    expect(weekend).not.toBeNull();
    const rows = within(weekend as HTMLElement).getAllByRole("button");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Open Play FM");
    expect(rows[1]).toHaveTextContent("Pickla Open");
    expect(rows[2]).toHaveTextContent("Parker Brunch");
    expect(rows[2]).toHaveTextContent("4 kommer");
    expect(rows[2]).toHaveTextContent("36 platser kvar");
    expect(within(weekend as HTMLElement).queryByText("Open Play Eftermiddag")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-series-card")).not.toBeInTheDocument();
    expect(screen.getAllByText("Parker Brunch")).toHaveLength(1);
  });

  it.each([
    ["open", "Boka plats"],
    ["closed", "Visa"],
  ] as const)("keeps an %s social event discoverable with the correct hero CTA", async (registrationState, expectedCta) => {
    vi.setSystemTime(new Date("2026-09-04T10:00:00Z"));
    mocks.user = null;
    mocks.account.state = "anonymous";
    const primary = weekendDiscoveryPrimary(registrationState);
    primary.sessions = [];
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primary);
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      return never();
    });

    renderToday();
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByTestId("today-featured-hero")).toHaveTextContent(expectedCta);
  });

  it("keeps a full social event discoverable with a non-booking CTA", async () => {
    vi.setSystemTime(new Date("2026-09-04T10:00:00Z"));
    mocks.user = null;
    mocks.account.state = "anonymous";
    const primary = weekendDiscoveryPrimary();
    primary.sessions = [];
    primary.seriesOccurrences[0].capacity = 4;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primary);
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      return never();
    });

    renderToday();
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByTestId("today-featured-hero")).toHaveTextContent("Visa");
  });

  it.each(["hidden", "cancelled"] as const)("excludes a %s social-event occurrence", async (overrideStatus) => {
    vi.setSystemTime(new Date("2026-09-04T10:00:00Z"));
    mocks.user = null;
    mocks.account.state = "anonymous";
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(weekendDiscoveryPrimary("open", overrideStatus));
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      return never();
    });

    renderToday();
    const weekendHeading = await screen.findByRole("heading", { name: "I helgen" });
    const weekend = weekendHeading.closest("section") as HTMLElement;
    expect(within(weekend).queryByText("Parker Brunch")).not.toBeInTheDocument();
    expect(within(weekend).getByText("Open Play Eftermiddag")).toBeInTheDocument();
  });

  it("inserts First Visit, League and Course promotions from one anonymous secondary completion", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    let resolveSecondary!: (value: Record<string, unknown>) => void;
    const secondary = new Promise<Record<string, unknown>>((resolve) => {
      resolveSecondary = resolve;
    });
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "today-secondary") return secondary;
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      return never();
    });

    renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(screen.queryByTestId("league-home-offer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-series-card")).not.toBeInTheDocument();

    resolveSecondary({
      first_visit: {
        is_first_time: true,
        has_configured_offer: true,
        occurrences: [],
        items: [{ route: "/program/first-visit?date=2026-08-26&v=pickla-arena-sthlm" }],
        pricing: [],
      },
      league: {
        mode: "registration",
        item: {
          series: { id: "league-1", name: "League Season 01", image_urls: [] },
          season: { team_capacity: 6, league_night_count: 5, matches_per_team_per_night: 2 },
          capacity: { available_count: 4 },
          current_price_minor: 199500,
          pricing_reason: "league_team_base_price",
          route: "/seriespel/league-1?v=pickla-arena-sthlm",
        },
      },
      course: {
        mode: "registration",
        item: {
          id: "course-1",
          name: "Parker Brunch Series",
          image_urls: [],
          start_date: "2026-09-20",
          registration_state: "open",
          capacity: { available_count: 12 },
          format: { name: "Parker Brunch", description: "Spela och umgås.", presentation_type: "social_event" },
          product: { base_price_sek: 595 },
          pricing: {
            scope_type: "activity_series",
            list_price_minor: 59500,
            final_price_minor: 59500,
            pricing_reason: "series_product_base_price",
            sales_channel: "online",
            checkout_label: "595 kr",
            membership_tier_name: null,
            early_bird: { configured: false, active: false, applied: false, price_minor: null, slots: null, remaining: null },
          },
          included_access: { open_play_series_period: { enabled: false } },
          route: "/course/course-1?v=pickla-arena-sthlm",
        },
      },
    });

    expect(await screen.findByText("Första gången? Spela för 99 kr.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "League Season 01" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(mocks.apiGet.mock.calls.filter((call) => call[1] === "today-secondary")).toHaveLength(1);
    expect(mocks.fetchCourseHome).not.toHaveBeenCalled();
    expect(mocks.fetchLeagueHome).not.toHaveBeenCalled();
  });

  it("reuses existing Today projections without Activity Preview or direct registrations", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse([{
          activity_session_id: "visible-session",
          session_date: "2026-08-26",
          effective_price_sek: 165,
          requires_checkout: true,
          pricing_reason: "regular_price",
          customer_presentation: {
            identityState: "anonymous",
            displayPriceSek: 165,
            displayLabel: "165 kr",
            listPriceSek: 165,
            offerState: null,
            offerLabel: null,
            offerDetail: null,
          },
        }]));
      return never();
    });
    mocks.fetchCourseHome.mockResolvedValue({ mode: "none", item: null });
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "none", item: null });

    renderToday();

    expect(await screen.findByText("Boka plats · 165 kr")).toBeInTheDocument();
    expect(screen.getByText("2 kommer")).toBeInTheDocument();
    expect(mocks.apiGet.mock.calls.some((call) => call[1] === "activity-social-proof")).toBe(false);
    expect(mocks.apiGet.mock.calls.some((call) => call[1] === "activity-preview")).toBe(false);
    expect(mocks.supabaseFrom.mock.calls.some((call) => call[0] === "session_registrations")).toBe(false);
  });

  it("preserves verified registered state through the bounded social projection", async () => {
    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [{
        activity_session_id: "visible-session",
        session_date: "2026-08-26",
        registrations_count: 2,
        interested_count: 0,
        user_is_interested: false,
        user_registration_status: "confirmed",
      }] });
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "first-visit-offers") return Promise.resolve({
        is_first_time: false,
        has_configured_offer: false,
        occurrences: [],
        items: [],
        pricing: [],
      });
      return never();
    });
    mocks.fetchCourseHome.mockResolvedValue({ mode: "none", item: null });
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "none", item: null });

    renderToday();

    expect(await screen.findByText("✓ Redan anmäld")).toBeInTheDocument();
    expect(mocks.supabaseFrom.mock.calls.some((call) => call[0] === "session_registrations")).toBe(false);
  });

  it.each([
    { label: "included", price: 0, requiresCheckout: false, displayLabel: "Ingår", expected: "Boka plats · Ingår" },
    { label: "early bird", price: 99, requiresCheckout: true, displayLabel: "99 kr", expected: "Boka plats · 99 kr" },
  ])("preserves $label hero pricing from the existing occurrence projection", async ({ price, requiresCheckout, displayLabel, expected }) => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse([{
          activity_session_id: "visible-session",
          session_date: "2026-08-26",
          effective_price_sek: price,
          requires_checkout: requiresCheckout,
          pricing_reason: price === 99 ? "early_bird" : "membership_open_play_unlimited",
          customer_presentation: {
            identityState: "anonymous",
            displayPriceSek: price,
            displayLabel,
            listPriceSek: 165,
            offerState: null,
            offerLabel: null,
            offerDetail: null,
          },
        }]));
      return never();
    });
    mocks.fetchCourseHome.mockResolvedValue({ mode: "none", item: null });
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "none", item: null });

    renderToday();

    expect(await screen.findByText(expected)).toBeInTheDocument();
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

  it("keeps Parker Brunch mounted and enriches ownership in place instead of replacing it with Pickla Start", async () => {
    const courseDetail = deferred<Record<string, unknown>>();
    const promotions = publicPromotions();
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return Promise.resolve(promotions);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      return never();
    });
    mocks.fetchCourseDetail.mockReturnValue(courseDetail.promise);
    mocks.fetchCourseHome.mockResolvedValue({
      mode: "registration",
      item: publicPromotions("pickla-start", "Pickla Start").course.item,
    });
    mocks.fetchLeaguePublic.mockResolvedValue({
      series: { id: "league-1" },
      capacity: { available_count: 4 },
      current_price_minor: 199500,
      pricing_reason: "league_team_base_price",
      customer_team_id: null,
    });

    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    const publicCard = screen.getByTestId("home-series-card");
    expect(publicCard).toHaveAttribute("data-promotion-id", "parker-brunch");
    expect(publicCard).toHaveAttribute("data-customer-state", "available");

    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MemoryRouter initialEntries={["/today"]}><TodayPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledWith("parker-brunch"));
    expect(mocks.fetchCourseHome).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-series-card")).toBe(publicCard);
    expect(screen.getByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();

    await act(async () => {
      courseDetail.resolve({
        id: "parker-brunch",
        customer_has_commitment: true,
        capacity: { available_count: 11 },
        pricing: promotions.course.item.pricing,
        included_access: { open_play_series_period: { enabled: false } },
      });
    });

    await waitFor(() => expect(publicCard).toHaveAttribute("data-customer-state", "owned"));
    expect(screen.getByTestId("home-series-card")).toBe(publicCard);
    expect(screen.getByText("EVENT · Redan anmäld")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa bokning" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pickla Start" })).not.toBeInTheDocument();
  });

  it("keeps Parker Brunch as the deterministic initial candidate when verification is already available and it is not owned", async () => {
    const promotions = publicPromotions();
    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return Promise.resolve(promotions);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      if (endpoint === "first-visit-offers") return Promise.resolve(promotions.first_visit);
      return never();
    });
    mocks.fetchCourseDetail.mockResolvedValue({
      id: "parker-brunch",
      customer_has_commitment: false,
      capacity: { available_count: 10 },
      pricing: promotions.course.item.pricing,
      included_access: { open_play_series_period: { enabled: false } },
    });
    mocks.fetchCourseHome.mockResolvedValue({
      mode: "registration",
      item: publicPromotions("pickla-start", "Pickla Start").course.item,
    });
    mocks.fetchLeaguePublic.mockImplementation(() => never());

    renderToday();
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    const card = screen.getByTestId("home-series-card");
    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledWith("parker-brunch"));
    expect(card).toHaveAttribute("data-promotion-id", "parker-brunch");
    expect(card).toHaveAttribute("data-customer-state", "available");
    expect(mocks.fetchCourseHome).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Pickla Start" })).not.toBeInTheDocument();
  });

  it.each([
    { label: "not owned", customerTeamId: null, expectedState: "available", expectedCta: "Anmäl lag" },
    { label: "owned", customerTeamId: "private-team-id", expectedState: "owned", expectedCta: "Visa laget" },
  ])("keeps the public League node stable while $label enrichment resolves", async ({ customerTeamId, expectedState, expectedCta }) => {
    const leagueDetail = deferred<Record<string, unknown>>();
    const promotions = publicPromotions();
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "today-secondary") return Promise.resolve(promotions);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      return never();
    });
    mocks.fetchCourseDetail.mockImplementation(() => never());
    mocks.fetchLeaguePublic.mockReturnValue(leagueDetail.promise);

    const view = renderToday();
    expect(await screen.findByRole("heading", { name: "League Season 01" })).toBeInTheDocument();
    const leagueCard = screen.getByTestId("league-home-offer");

    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MemoryRouter initialEntries={["/today"]}><TodayPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.fetchLeaguePublic).toHaveBeenCalledWith("league-1"));
    expect(screen.getByTestId("league-home-offer")).toBe(leagueCard);
    expect(leagueCard).toHaveAttribute("data-customer-state", "available");

    await act(async () => {
      leagueDetail.resolve({
        series: { id: "league-1" },
        capacity: { available_count: 3 },
        current_price_minor: 149500,
        pricing_reason: "membership_tier_pricing",
        customer_team_id: customerTeamId,
      });
    });

    await waitFor(() => expect(leagueCard).toHaveAttribute("data-customer-state", expectedState));
    expect(screen.getByTestId("league-home-offer")).toBe(leagueCard);
    expect(screen.getByRole("heading", { name: "League Season 01" })).toBeInTheDocument();
    expect(screen.getByText(expectedCta)).toBeInTheDocument();
    expect(screen.queryByTestId("owned-league-home-card")).not.toBeInTheDocument();
  });

  it("keeps the First Visit slot and downstream DOM order stable when verified eligibility disappears", async () => {
    const privateFirstVisit = deferred<Record<string, unknown>>();
    const promotions = publicPromotions();
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return Promise.resolve(promotions);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      if (endpoint === "first-visit-offers") return privateFirstVisit.promise;
      return never();
    });
    mocks.fetchCourseDetail.mockImplementation(() => never());
    mocks.fetchLeaguePublic.mockImplementation(() => never());

    const view = renderToday();
    expect(await screen.findByText("Första gången? Spela för 99 kr.")).toBeInTheDocument();
    const slot = screen.getByTestId("today-first-visit-slot");
    const action = screen.getByRole("button", { name: /Första gången\? Spela för 99 kr/ });
    const downstream = screen.getByTestId("today-more-heading");
    expect(slot.compareDocumentPosition(downstream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot).toHaveClass("min-h-[72px]");

    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MemoryRouter initialEntries={["/today"]}><TodayPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.apiGet.mock.calls.some((call) => call[1] === "first-visit-offers")).toBe(true));

    await act(async () => {
      privateFirstVisit.resolve({
        is_first_time: false,
        has_configured_offer: false,
        occurrences: [],
        items: [],
        pricing: [],
      });
    });

    expect(await screen.findByText("Välkommen tillbaka till Pickla.")).toBeInTheDocument();
    expect(screen.getByTestId("today-first-visit-slot")).toBe(slot);
    expect(screen.getByRole("button", { name: /Välkommen tillbaka till Pickla/ })).toBe(action);
    expect(screen.getByTestId("today-more-heading")).toBe(downstream);
    expect(slot).toHaveAttribute("data-customer-state", "ineligible");
    expect(screen.queryByText("Första gången? Spela för 99 kr.")).not.toBeInTheDocument();
  });

  it("mounts promotions and the activity list once after both public presentation reads settle", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    const secondary = deferred<Record<string, unknown>>();
    const openBookings = deferred<Record<string, unknown>>();
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return secondary.promise;
      if (endpoint === "public-open-bookings") return openBookings.promise;
      return never();
    });

    renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    expect(screen.queryByTestId("today-secondary-region")).not.toBeInTheDocument();
    expect(screen.queryByTestId("today-more-heading")).not.toBeInTheDocument();

    await act(async () => secondary.resolve(publicPromotions()));
    expect(screen.queryByTestId("today-secondary-region")).not.toBeInTheDocument();

    await act(async () => openBookings.resolve({ items: [] }));
    expect(await screen.findByTestId("today-secondary-region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "League Season 01" })).toBeInTheDocument();
    expect(screen.getByTestId("today-more-heading")).toBeInTheDocument();
  });

  it("keeps the today-primary hero identity when an earlier public open booking arrives", async () => {
    mocks.user = null;
    mocks.account.state = "anonymous";
    const openBookings = deferred<Record<string, unknown>>();
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "public-open-bookings") return openBookings.promise;
      return never();
    });

    renderToday();
    expect(await screen.findByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
    const hero = screen.getByTestId("today-featured-hero");
    expect(hero).toHaveAttribute("data-featured-id", "session:visible-session:2026-08-26");

    await act(async () => openBookings.resolve({ items: [earlierOpenBooking()] }));

    expect(await screen.findByText("Häng på Gunnar")).toBeInTheDocument();
    expect(screen.getByTestId("today-featured-hero")).toBe(hero);
    expect(hero).toHaveAttribute("data-featured-id", "session:visible-session:2026-08-26");
    expect(screen.getByRole("heading", { name: "Open Play Express" })).toBeInTheDocument();
  });

  it("keeps the public Course card through an enrichment error and upgrades the same node after retry", async () => {
    const promotions = publicPromotions();
    const queryClient = client();
    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryWithSecondaryRow());
      if (endpoint === "today-secondary") return Promise.resolve(promotions);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      if (endpoint === "first-visit-offers") return Promise.resolve(promotions.first_visit);
      return never();
    });
    mocks.fetchCourseDetail
      .mockRejectedValueOnce(new Error("temporary course detail failure"))
      .mockResolvedValueOnce({
        id: "parker-brunch",
        customer_has_commitment: true,
        capacity: { available_count: 11 },
        pricing: promotions.course.item.pricing,
        included_access: { open_play_series_period: { enabled: false } },
      });
    mocks.fetchLeaguePublic.mockImplementation(() => never());

    renderToday("/today", queryClient);
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    const card = screen.getByTestId("home-series-card");
    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryState(["today-course-personalization", "pickla-arena-sthlm", "parker-brunch", "user-1"])?.status).toBe("error"));
    expect(screen.getByTestId("home-series-card")).toBe(card);
    expect(card).toHaveAttribute("data-customer-state", "available");

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["today-course-personalization", "pickla-arena-sthlm"] });
    });

    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card).toHaveAttribute("data-customer-state", "owned"));
    expect(screen.getByTestId("home-series-card")).toBe(card);
    expect(screen.getByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
  });

  it("freezes stale cached promotion identity for one mount and accepts a new identity after remount", async () => {
    const queryClient = client();
    const cached = publicPromotions();
    const refreshed = publicPromotions("pickla-start", "Pickla Start");
    queryClient.setQueryData(["today-secondary", "pickla-arena-sthlm"], cached, { updatedAt: 1 });
    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "today-secondary") return Promise.resolve(refreshed);
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      if (endpoint === "first-visit-offers") return Promise.resolve(cached.first_visit);
      return never();
    });
    mocks.fetchCourseDetail.mockImplementation((seriesId: string) => Promise.resolve({
      id: seriesId,
      customer_has_commitment: seriesId === "parker-brunch",
      capacity: { available_count: 8 },
      pricing: cached.course.item.pricing,
      included_access: { open_play_series_period: { enabled: false } },
    }));
    mocks.fetchLeaguePublic.mockResolvedValue({
      series: { id: "league-1" },
      capacity: { available_count: 4 },
      current_price_minor: 199500,
      pricing_reason: "league_team_base_price",
      customer_team_id: null,
    });

    const first = renderToday("/today", queryClient);
    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    const firstCard = screen.getByTestId("home-series-card");
    await waitFor(() => expect((queryClient.getQueryData(["today-secondary", "pickla-arena-sthlm"]) as typeof refreshed).course.item.id).toBe("pickla-start"));
    expect(screen.getByTestId("home-series-card")).toBe(firstCard);
    expect(screen.queryByRole("heading", { name: "Pickla Start" })).not.toBeInTheDocument();

    first.unmount();
    renderToday("/today", queryClient);
    expect(await screen.findByRole("heading", { name: "Pickla Start" })).toBeInTheDocument();
  });

  it("does not fabricate a public card when the committed public candidate is absent", async () => {
    mocks.account.state = "verified";
    mocks.account.verifiedUserId = "user-1";
    mocks.account.isVerified = true;
    mocks.apiGet.mockImplementation((_fn: string, endpoint: string) => {
      if (endpoint === "today-primary") return Promise.resolve(primaryResponse);
      if (endpoint === "today-secondary") return Promise.resolve(secondaryResponse());
      if (endpoint === "public-open-bookings") return Promise.resolve({ items: [] });
      if (endpoint === "activity-social-proof") return Promise.resolve({ occurrences: [] });
      if (endpoint === "first-visit-offers") return Promise.resolve(secondaryResponse().first_visit);
      return never();
    });
    mocks.fetchCourseHome.mockResolvedValue({ mode: "registration", item: publicPromotions().course.item });
    mocks.fetchLeagueHome.mockResolvedValue({ mode: "registration", item: publicPromotions().league.item });

    renderToday();
    await waitFor(() => expect(mocks.fetchCourseHome).toHaveBeenCalled());
    expect(mocks.fetchLeagueHome).toHaveBeenCalled();
    expect(screen.queryByTestId("home-series-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("league-home-offer")).not.toBeInTheDocument();
  });
});
