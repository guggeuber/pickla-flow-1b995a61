import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminCourses from "@/components/admin/AdminCourses";
import CourseSeriesPage from "@/pages/CourseSeriesPage";
import { formatCommerceMoney } from "@/lib/commerce";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  fetchCourseDetail: vi.fn(),
  fetchCourseAdmin: vi.fn(),
  previewCourseSeries: vi.fn(),
  createCourseCart: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock("@/lib/courses", () => ({
  fetchCourseDetail: mocks.fetchCourseDetail,
  fetchCourseAdmin: mocks.fetchCourseAdmin,
  previewCourseSeries: mocks.previewCourseSeries,
  createCourseCart: mocks.createCourseCart,
  createCourseFormat: vi.fn(),
  createCourseSeries: vi.fn(),
  updateCourseSeries: vi.fn(),
}));
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => <div data-testid="topbar" /> }));
vi.mock("@/lib/commerce", () => ({
  formatCommerceMoney: (minor: number) => `${Math.round(minor / 100).toLocaleString("sv-SE")} kr`,
}));
vi.mock("@/lib/entryResolver", () => ({ preserveIntendedRoute: vi.fn() }));

const course = {
  id: "series-1", venue_id: "venue-1", format_id: "format-1", name: "Pickla 101 · Höst 2026",
  description: "Sex lugna tillfällen för nya spelare.", status: "active", start_date: "2026-09-08", end_date: "2026-10-13",
  total_sessions: 6, registration_opens_at: "2026-08-01T00:00:00Z", registration_closes_at: "2026-09-08T16:00:00Z",
  recurrence_days: [2], start_time: "18:00", end_time: "19:00", court_ids: [], registration_state: "open",
  customer_has_commitment: false,
  format: { id: "format-1", name: "Pickla 101", description: "Nybörjarkurs", age_group: "adult", level: "beginner", requires_instructor: true },
  product: { id: "product-1", name: "Pickla 101", description: null, base_price_sek: 1495, vat_rate: 6 },
  venue: { id: "venue-1", name: "Pickla Stockholm", slug: "pickla-arena-sthlm" },
  capacity: { capacity: 12, committed_count: 7, active_holds_count: 0, available_count: 5 },
  sessions: Array.from({ length: 6 }, (_, index) => ({ id: `session-${index + 1}`, session_date: `2026-09-${String(8 + index * 7).padStart(2, "0")}`, start_time: "18:00", end_time: "19:00", court_ids: [], requires_staffing: true, is_active: true, series_occurrence_index: index + 1 })),
};

function wrapper(initial = "/course/series-1?v=pickla-arena-sthlm") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter></QueryClientProvider>;
}

function renderCourse() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/course/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/course/:seriesId" element={<CourseSeriesPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("Course V1 customer flow", () => {
  it("presents one Series purchase and the non-refundable absence doctrine", async () => {
    mocks.user = null;
    mocks.fetchCourseDetail.mockResolvedValue(course);
    renderCourse();
    expect(await screen.findByRole("heading", { name: "Pickla 101 · Höst 2026" })).toBeInTheDocument();
    expect(screen.getByText("6 tillfällen · tisdagar 18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("5 platser kvar")).toBeInTheDocument();
    expect(screen.getByText(/Missade tillfällen återbetalas inte/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Boka kurs · ${formatCommerceMoney(149500)}` })).toBeDisabled();
  });

  it("requires guardian authentication before collecting subordinate identity", async () => {
    mocks.user = null;
    mocks.fetchCourseDetail.mockResolvedValue(course);
    renderCourse();
    fireEvent.click(await screen.findByRole("button", { name: "Ett barn jag ansvarar för" }));
    expect(screen.queryByLabelText("Barnets förnamn")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Logga in för att anmäla barn/ })).toBeInTheDocument();
  });

  it("collects only minimal child data after guardian login", async () => {
    mocks.user = { id: "guardian-1" };
    mocks.fetchCourseDetail.mockResolvedValue(course);
    renderCourse();
    fireEvent.click(await screen.findByRole("button", { name: "Ett barn jag ansvarar för" }));
    expect(screen.getByLabelText("Barnets förnamn")).toBeInTheDocument();
    expect(screen.getByLabelText("Barnets födelseår")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Barnets e-post/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Barnets efternamn/i)).not.toBeInTheDocument();
    expect(screen.getByText("Uppgifterna visas bara för dig och behörig personal.")).toBeInTheDocument();
  });
});

describe("Course V1 Admin", () => {
  it("uses the existing Schedule surface for Format, Series and Session preview", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Kurser/ }));
    expect(await screen.findByText("1. Kursformat")).toBeInTheDocument();
    expect(screen.getByText("2. Konkret kursserie")).toBeInTheDocument();
    expect(await screen.findByText(/7\/12 platser/)).toBeInTheDocument();
    expect(screen.getByText("Instruktör krävs")).toBeInTheDocument();
    expect(screen.getByText("Kommande tillfällen")).toBeInTheDocument();
    expect(screen.getByText(/^1\. tis 8 sep\.?$/)).toBeInTheDocument();
    expect(screen.getAllByText("18:00–19:00")).toHaveLength(6);
  });

  it("shows every conflicting occurrence and blocks Course creation", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({
      formats: [course.format],
      series: [],
      courts: [{ id: "c0100000-0000-4000-8000-000000000003", name: "Bana 3", sport_type: "pickleball" }],
    });
    mocks.previewCourseSeries.mockResolvedValue({
      occurrence_count: 6,
      has_conflicts: true,
      rows: Array.from({ length: 6 }, (_, index) => ({
        occurrence_index: index + 1,
        occurrence_date: `2026-${index === 0 ? "09-08" : index === 1 ? "09-15" : index === 2 ? "09-22" : index === 3 ? "09-29" : index === 4 ? "10-06" : "10-13"}`,
        proposed_starts_at: "2026-09-08T16:00:00Z",
        proposed_ends_at: "2026-09-08T17:00:00Z",
        court_id: "c0100000-0000-4000-8000-000000000003",
        court_name: "Bana 3",
        is_available: index !== 2,
        conflicts: index === 2 ? [{
          source_type: "booking",
          source_id: "booking-1",
          title: "Privat bokning",
          starts_at: "2026-09-22T15:30:00Z",
          ends_at: "2026-09-22T17:30:00Z",
        }] : [],
      })),
    });

    render(<AdminCourses venueId="c0100000-0000-4000-8000-000000000002" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Kurser/ }));
    await screen.findByText("2. Konkret kursserie");
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "format-1" } });
    fireEvent.change(screen.getByPlaceholderText("Pickla 101 · Höst 2026"), { target: { value: "Pickla 101 · Höst 2026" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-09-08" } });
    fireEvent.change(screen.getByLabelText("Slut"), { target: { value: "2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Anmälan öppnar"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Anmälan stänger"), { target: { value: "2026-09-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Bana 3" }));

    expect(await screen.findByText("Privat bokning · 17:30–19:30")).toBeInTheDocument();
    expect(screen.getByText("Ändra schema eller resurser innan kursen kan skapas.")).toBeInTheDocument();
    expect(screen.getAllByText("Konflikt")).toHaveLength(1);
    expect(screen.getAllByText("Ledig")).toHaveLength(5);
    await waitFor(() => expect(screen.getByRole("button", { name: "Skapa kurs och tillfällen" })).toBeDisabled());
  });
});

describe("Course privacy contract", () => {
  it("keeps subordinate identity out of customer-facing capacity data", () => {
    expect(Object.keys(course.capacity)).toEqual(["capacity", "committed_count", "active_holds_count", "available_count"]);
    expect(JSON.stringify(course.capacity)).not.toContain("Elsa");
  });
});
