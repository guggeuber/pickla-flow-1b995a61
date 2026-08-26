import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCatalog from "@/components/admin/shell/AdminCatalog";
import { catalogOfferHiddenReason, catalogOfferSection } from "@/lib/adminCatalog";
import type { CourseDetail } from "@/lib/courses";

const mocks = vi.hoisted(() => ({
  fetchCourseAdmin: vi.fn(),
  fetchLeagueAdmin: vi.fn(),
}));

vi.mock("@/lib/courses", () => ({ fetchCourseAdmin: mocks.fetchCourseAdmin }));
vi.mock("@/lib/league", () => ({ fetchLeagueAdmin: mocks.fetchLeagueAdmin }));

vi.mock("@/components/admin/AdminCourses", () => ({
  default: (props: { initialSeriesId?: string | null; initialPresentationType?: string; catalogMode?: boolean }) => (
    <div data-testid="canonical-managed-series-editor">
      {props.catalogMode ? "catalog" : "legacy"}:{props.initialSeriesId || "new"}:{props.initialPresentationType}
    </div>
  ),
}));
vi.mock("@/components/admin/AdminLeague", () => ({
  default: (props: { leagueSeasonId?: string | null }) => (
    <div data-testid="canonical-league-editor">league:{props.leagueSeasonId || "new"}</div>
  ),
}));

const format = {
  id: "format-course",
  name: "Pickla 101",
  description: "Fyra veckor pickleball.",
  full_description: "Hela kursinnehållet.",
  image_urls: [],
  presentation_type: "course" as const,
  age_group: "adult" as const,
  level: "beginner" as const,
  requires_instructor: true,
};

function offer(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: "pickla-series",
    venue_id: "venue-1",
    format_id: format.id,
    name: "Pickla 101 · Hösten 2026",
    description: null,
    metadata: {},
    image_urls: [],
    status: "active",
    start_date: "2026-09-09",
    end_date: "2026-09-30",
    total_sessions: 4,
    registration_opens_at: "2026-08-01T00:00:00Z",
    registration_closes_at: "2026-09-09T16:00:00Z",
    recurrence_days: [3],
    start_time: "18:00",
    end_time: "19:15",
    court_ids: ["court-2", "court-3"],
    registration_state: "open",
    customer_has_commitment: false,
    format,
    product: {
      id: "product-1",
      product_key: "course_pickla_101",
      name: "Pickla 101",
      description: null,
      base_price_sek: 1395,
      vat_rate: 6,
      status: "active",
      is_active: true,
      scarcity_mode: "none",
      early_bird_price_minor: null,
      early_bird_slots: null,
    },
    venue: { id: "venue-1", name: "Pickla Stockholm", slug: "pickla-arena-sthlm" },
    capacity: { capacity: 8, committed_count: 0, active_holds_count: 0, available_count: 8 },
    sessions: [],
    ...overrides,
  };
}

const parker = offer({
  id: "parker-series",
  format_id: "format-parker",
  name: "Parker",
  start_date: "2026-09-05",
  end_date: "2026-09-05",
  total_sessions: 1,
  start_time: "13:00",
  end_time: "18:00",
  format: { ...format, id: "format-parker", name: "Parker Brunch", presentation_type: "social_event", requires_instructor: false },
  product: { ...offer().product, id: "product-parker", product_key: "parker_brunch", name: "Parker Brunch", base_price_sek: 199, scarcity_mode: "early_bird", early_bird_price_minor: 17900, early_bird_slots: 8 },
  capacity: { capacity: 40, committed_count: 2, active_holds_count: 0, available_count: 38 },
});

function renderCatalog(initialSeriesId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminCatalog venueId="venue-1" initialSeriesId={initialSeriesId} onOpenModule={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.fetchCourseAdmin.mockResolvedValue({
    formats: [format, parker.format],
    series: [
      offer(),
      parker,
      offer({ id: "draft-series", name: "Pickla 102", status: "draft" }),
      offer({ id: "smoke-series", name: "One-off hc_run_20260822", status: "cancelled" }),
    ],
    courts: [],
  });
  mocks.fetchLeagueAdmin.mockResolvedValue({
    courts: [],
    seasons: [{
      id: "league-season-1",
      activity_series_id: "league-series-1",
      fixtures_published_at: null,
      fixture_publication_deadline: "2026-09-05T10:00:00Z",
      activity_series: {
        id: "league-series-1", venue_id: "venue-1", name: "Pickla Seriespel · Pilot",
        description: "Fem torsdagar", image_urls: [], status: "active",
        start_date: "2026-09-10", end_date: "2026-10-08",
        registration_opens_at: "2026-08-01T10:00:00Z", registration_closes_at: "2026-09-01T10:00:00Z",
        start_time: "18:00", end_time: "20:00", court_ids: [],
        access_products: { base_price_sek: 1995 },
      },
      teams: [], members: [], sessions: [], fixtures: [], results: [], orders: [], validation: null,
    }],
  });
});

describe("Admin OS Catalog V1", () => {
  it("opens on a clean offer list and keeps smoke history out of the operator view", async () => {
    renderCatalog();
    expect(await screen.findByText("Pickla 101 · Hösten 2026")).toBeInTheDocument();
    expect(screen.getByText("Parker Brunch")).toBeInTheDocument();
    expect(screen.getByText("Pickla 102")).toBeInTheDocument();
    expect(screen.queryByText(/hc_run/i)).not.toBeInTheDocument();
    expect(screen.getByText("Early Bird 179 kr · första 8 platser")).toBeInTheDocument();
  });

  it("reuses the canonical managed-Series editor for existing offers", async () => {
    renderCatalog();
    await screen.findByText("Parker Brunch");
    fireEvent.click(screen.getByTestId("catalog-offer-parker-series").querySelector("button")!);
    expect(screen.getByTestId("canonical-managed-series-editor")).toHaveTextContent("catalog:parker-series:social_event");
  });

  it("presents League as an editable Catalog offer and opens its canonical editor", async () => {
    renderCatalog();
    const league = await screen.findByTestId("catalog-league-league-season-1");
    expect(league).toHaveTextContent("Pickla Seriespel · Pilot");
    expect(league.querySelector("button")).toHaveTextContent("Redigera");
    fireEvent.click(league.querySelector("button")!);
    expect(screen.getByTestId("canonical-league-editor")).toHaveTextContent("league:league-season-1");
  });

  it("chooses the operator offer type before opening the same create path", async () => {
    renderCatalog();
    fireEvent.click(await screen.findByRole("button", { name: /Nytt erbjudande/ }));
    expect(screen.getByTestId("catalog-offer-type-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    expect(screen.getByTestId("canonical-managed-series-editor")).toHaveTextContent("catalog:new:social_event");
  });

  it("classifies lifecycle state without using presentation type as behavior", () => {
    expect(catalogOfferSection(parker)).toBe("active");
    expect(catalogOfferSection(offer({ status: "draft" }))).toBe("draft");
    expect(catalogOfferHiddenReason(offer({ metadata: { test_fixture: true } }))).toBe("synthetic");
    expect(catalogOfferHiddenReason(parker)).toBeNull();
  });

  it("projects managed occurrences into the one Calendar and links back to Catalog", () => {
    const apiAdmin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
    const calendar = readFileSync("src/components/admin/shell/AdminCalendar.tsx", "utf8");
    expect(apiAdmin).toContain("activity_series(id, name, format_id, access_product_id, activity_formats(presentation_type))");
    expect(apiAdmin).toContain("managed_series_id: managedSeries?.id || null");
    expect(apiAdmin).toContain("moduleTarget: managedSeries ? null : 'schedule'");
    expect(apiAdmin).toContain("activityCourtById.get(courtId)");
    expect(calendar).toContain("Genererat från Catalog");
    expect(calendar).toContain("Öppna i Catalog");
  });
});
