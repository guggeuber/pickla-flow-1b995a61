import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminCourses from "@/components/admin/AdminCourses";
import CourseSeriesPage from "@/pages/CourseSeriesPage";
import { formatCommerceMoney } from "@/lib/commerce";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  authStatus: "anonymous" as "session_hydrating" | "local_session" | "anonymous" | "terminal_failure",
  fetchCourseDetail: vi.fn(),
  fetchCourseAdmin: vi.fn(),
  fetchSeriesMemberPricing: vi.fn(),
  previewCourseSeries: vi.fn(),
  createCourseCart: vi.fn(),
  createCourseFormat: vi.fn(),
  updateCourseFormat: vi.fn(),
  createCourseSeries: vi.fn(),
  updateCourseSeries: vi.fn(),
  findSeriesGrantParticipants: vi.fn(),
  grantSeriesStaffPlace: vi.fn(),
  cancelSeriesStaffPlace: vi.fn(),
  saveSeriesMemberPricing: vi.fn(),
  removeSeriesMemberPricing: vi.fn(),
  saveSeriesEarlyBird: vi.fn(),
  saveSeriesIncludedAccess: vi.fn(),
  saveSeriesParticipantPolicy: vi.fn(),
  shareOrCopy: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: false, authStatus: mocks.authStatus }) }));
vi.mock("@/lib/courses", () => ({
  fetchCourseDetail: mocks.fetchCourseDetail,
  fetchCourseAdmin: mocks.fetchCourseAdmin,
  fetchSeriesMemberPricing: mocks.fetchSeriesMemberPricing,
  previewCourseSeries: mocks.previewCourseSeries,
  createCourseCart: mocks.createCourseCart,
  createCourseFormat: mocks.createCourseFormat,
  updateCourseFormat: mocks.updateCourseFormat,
  createCourseSeries: mocks.createCourseSeries,
  updateCourseSeries: mocks.updateCourseSeries,
  findSeriesGrantParticipants: mocks.findSeriesGrantParticipants,
  grantSeriesStaffPlace: mocks.grantSeriesStaffPlace,
  cancelSeriesStaffPlace: mocks.cancelSeriesStaffPlace,
  saveSeriesMemberPricing: mocks.saveSeriesMemberPricing,
  removeSeriesMemberPricing: mocks.removeSeriesMemberPricing,
  saveSeriesEarlyBird: mocks.saveSeriesEarlyBird,
  saveSeriesIncludedAccess: mocks.saveSeriesIncludedAccess,
  saveSeriesParticipantPolicy: mocks.saveSeriesParticipantPolicy,
}));
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => <div data-testid="topbar" /> }));
vi.mock("@/lib/commerce", () => ({
  formatCommerceMoney: (minor: number) => `${Math.round(minor / 100).toLocaleString("sv-SE")} kr`,
}));
vi.mock("@/lib/entryResolver", () => ({ preserveIntendedRoute: vi.fn() }));
vi.mock("@/lib/share", () => ({ shareOrCopy: mocks.shareOrCopy }));

const course = {
  id: "series-1", venue_id: "venue-1", format_id: "format-1", name: "Pickla 101 · Höst 2026",
  description: "Sex lugna tillfällen för nya spelare.", status: "active", start_date: "2026-09-08", end_date: "2026-10-13",
  total_sessions: 6, registration_opens_at: "2026-08-01T00:00:00Z", registration_closes_at: "2026-09-08T16:00:00Z",
  recurrence_days: [2], start_time: "18:00", end_time: "19:00", court_ids: [], registration_state: "open",
  customer_has_commitment: false,
  participant_policy: "self_adult_or_dependent" as const,
  coach: { coverage: "none" as const, mode: "unassigned" as const, coaches: [] },
  format: { id: "format-1", name: "Pickla 101", description: "Dina första fyra veckor med pickleball.", full_description: "Introduktion\n\nTillfälle 1 · Grepp och grundslag.\nTillfälle 2 · Serve och retur.\n\nDetta ingår\nInstruktör och lånerack.", image_urls: [], age_group: "adult", level: "beginner", requires_instructor: true, presentation_type: "course" },
  product: { id: "product-1", product_key: "course_pickla_101", name: "Pickla 101", description: null, base_price_sek: 1495, vat_rate: 6 },
  venue: { id: "venue-1", name: "Pickla Stockholm", slug: "pickla-arena-sthlm" },
  capacity: { capacity: 12, committed_count: 7, active_holds_count: 0, available_count: 5 },
  included_access: { open_play_series_period: { enabled: true, starts_at: "2026-09-07T22:00:00Z", expires_at: "2026-10-13T22:00:00Z", start_date: "2026-09-08", end_date: "2026-10-13", period_source: "active_series_occurrences" } },
  sessions: ["2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13"].map((sessionDate, index) => ({ id: `session-${index + 1}`, session_date: sessionDate, start_time: "18:00", end_time: "19:00", court_ids: [], requires_staffing: true, is_active: true, publish_status: "published", series_occurrence_index: index + 1 })),
};

beforeEach(() => {
  mocks.user = null;
  mocks.authStatus = "anonymous";
  mocks.fetchSeriesMemberPricing.mockResolvedValue({ series: [] });
  mocks.shareOrCopy.mockResolvedValue("shared");
});

function wrapper(initial = "/course/series-1?v=pickla-arena-sthlm") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter></QueryClientProvider>;
}

function renderCourse() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/course/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/course/:seriesId" element={<CourseSeriesPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("Course V1 customer flow", () => {
  it("renders public Course detail while signed-in pricing and ownership are still loading", async () => {
    mocks.user = { id: "member-1" };
    mocks.authStatus = "local_session";
    mocks.fetchCourseDetail.mockImplementation((_seriesId: string, options?: { auth?: string }) =>
      options?.auth === "omit" ? Promise.resolve(course) : new Promise(() => undefined)
    );
    renderCourse();

    expect(await screen.findByRole("heading", { name: "Pickla 101 · Höst 2026" })).toBeInTheDocument();
    expect(screen.getByText("Pris · 1 495 kr")).toBeInTheDocument();
    expect(screen.getByText("Medlemspris kontrolleras efter verifiering…")).toBeInTheDocument();
    expect(screen.queryByText(/Founder|Play\+/)).not.toBeInTheDocument();
    expect(screen.getByText("Pris och plats hämtas…")).toBeInTheDocument();
    expect(screen.queryByText("Du har en plats")).not.toBeInTheDocument();
    expect(mocks.fetchCourseDetail).toHaveBeenCalledWith("series-1", { auth: "omit" });
  });

  it("moves from truthful public price to verified Founder price without enabling an unverified CTA", async () => {
    const founderCourse = {
      ...course,
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 149500,
        final_price_minor: 119500,
        pricing_reason: "membership_tier_pricing",
        sales_channel: "online",
        checkout_label: "1 195 kr",
        membership_tier_name: "Founder",
        early_bird: { configured: false, active: false, applied: false, price_minor: null, slots: null, remaining: null },
      },
    };
    mocks.user = { id: "founder-1" };
    mocks.authStatus = "local_session";
    mocks.fetchCourseDetail.mockImplementation((_seriesId: string, options?: { auth?: string }) =>
      options?.auth === "omit" ? Promise.resolve(course) : Promise.resolve(founderCourse)
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/course/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/course/:seriesId" element={<CourseSeriesPage />} /></Routes></MemoryRouter></QueryClientProvider>;
    const view = render(tree());

    expect(await screen.findByText("Pris · 1 495 kr")).toBeInTheDocument();
    expect(screen.queryByText("Medlemspris · 1 195 kr")).not.toBeInTheDocument();
    expect(screen.getByText("Pris och plats hämtas…")).toBeInTheDocument();

    mocks.authStatus = "anonymous";
    view.rerender(tree());
    expect(await screen.findByText("Medlemspris · 1 195 kr")).toBeInTheDocument();
    expect(screen.getByText("Founder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Boka kurs · 1\s195\skr/ })).toBeEnabled();
  });

  it("drops a verified member price on terminal auth failure and customer switch", async () => {
    const founderCourse = {
      ...course,
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 149500,
        final_price_minor: 119500,
        pricing_reason: "membership_tier_pricing",
        sales_channel: "online",
        checkout_label: "1 195 kr",
        membership_tier_name: "Founder",
        early_bird: { configured: false, active: false, applied: false, price_minor: null, slots: null, remaining: null },
      },
    };
    mocks.user = { id: "founder-1" };
    mocks.fetchCourseDetail.mockImplementation((_seriesId: string, options?: { auth?: string }) => {
      if (options?.auth === "omit") return Promise.resolve(course);
      return Promise.resolve(mocks.user?.id === "founder-1" ? founderCourse : course);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={["/course/series-1?v=pickla-arena-sthlm"]}><Routes><Route path="/course/:seriesId" element={<CourseSeriesPage />} /></Routes></MemoryRouter></QueryClientProvider>;
    const view = render(tree());

    expect(await screen.findByText("Medlemspris · 1 195 kr")).toBeInTheDocument();
    mocks.user = null;
    mocks.authStatus = "terminal_failure";
    view.rerender(tree());
    expect(await screen.findByText("Pris · 1 495 kr")).toBeInTheDocument();
    expect(screen.queryByText("Founder")).not.toBeInTheDocument();
    expect(screen.queryByText("Pris och plats hämtas…")).not.toBeInTheDocument();

    mocks.user = { id: "non-member-2" };
    mocks.authStatus = "anonymous";
    view.rerender(tree());
    expect(await screen.findByText("Pris · 1 495 kr")).toBeInTheDocument();
    expect(screen.queryByText("Founder")).not.toBeInTheDocument();
  });

  it("presents one Series purchase and the non-refundable absence doctrine", async () => {
    mocks.user = null;
    mocks.fetchCourseDetail.mockResolvedValue(course);
    renderCourse();
    expect(await screen.findByRole("heading", { name: "Pickla 101 · Höst 2026" })).toBeInTheDocument();
    expect(screen.getByText("6 tillfällen · tisdagar 18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("5 platser kvar")).toBeInTheDocument();
    expect(screen.getByText("Dina första fyra veckor med pickleball.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Om kursen" })).toBeInTheDocument();
    expect(screen.getByText(/Tillfälle 1 · Grepp och grundslag/)).toBeInTheDocument();
    const occurrences = screen.getByTestId("course-occurrences");
    expect(within(occurrences).getByText("Tis 8 sep · 18:00–19:00")).toBeInTheDocument();
    expect(within(occurrences).getByText("Tis 13 okt · 18:00–19:00")).toBeInTheDocument();
    expect(within(occurrences).getAllByRole("listitem")).toHaveLength(6);
    const inclusions = screen.getByTestId("course-inclusions");
    expect(within(inclusions).getByText("Fri Open Play under hela kursperioden")).toBeInTheDocument();
    expect(within(inclusions).getByText(/alla vanliga Open Play ingår/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Din plats gäller hela kursen" })).toBeInTheDocument();
    expect(screen.getByText(/Missade tillfällen återbetalas inte/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Boka kurs · ${formatCommerceMoney(149500)}` })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dela Pickla 101 · Höst 2026" }));
    await waitFor(() => expect(mocks.shareOrCopy).toHaveBeenCalledWith(expect.objectContaining({
      title: "Pickla 101 · Höst 2026",
      url: "http://localhost:3000/course/series-1?v=pickla-arena-sthlm",
      copyText: "http://localhost:3000/course/series-1?v=pickla-arena-sthlm",
    })));
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

  it("hides participant selection and maps a verified self-only purchaser automatically", async () => {
    const selfOnlyCourse = {
      ...course,
      participant_policy: "self_only" as const,
      product: { ...course.product, resolver_rules: { participant_policy: "self_only" } },
    };
    mocks.user = { id: "verified-purchaser" };
    mocks.fetchCourseDetail.mockResolvedValue(selfOnlyCourse);
    mocks.createCourseCart.mockResolvedValue({ order: { id: "order-self" }, cart_token: "x".repeat(40) });
    renderCourse();

    expect(await screen.findByRole("heading", { name: "Pickla 101 · Höst 2026" })).toBeInTheDocument();
    expect(screen.queryByText("Vem ska delta?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jag själv" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "En annan vuxen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ett barn jag ansvarar för" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Boka kurs/ }));
    await waitFor(() => expect(mocks.createCourseCart).toHaveBeenCalledWith({ series_id: "series-1" }, undefined));
  });

  it("keeps delegated adult while suppressing dependents for self-or-adult offers", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      participant_policy: "self_or_adult",
      product: { ...course.product, resolver_rules: { participant_policy: "self_or_adult" } },
    });
    renderCourse();
    expect(await screen.findByRole("button", { name: "En annan vuxen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ett barn jag ansvarar för" })).not.toBeInTheDocument();
  });

  it("shows one canonical named coach without redundant generic instructor copy", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      total_sessions: 4,
      sessions: course.sessions.slice(0, 4),
      coach: { coverage: "complete", mode: "single", coaches: [{ display_name: "Gunnar Svalander" }] },
    });
    renderCourse();
    expect(await screen.findByText("Coach: Gunnar Svalander")).toBeInTheDocument();
    expect(screen.getAllByText("Coach: Gunnar Svalander")).toHaveLength(1);
    expect(screen.getByText("4 coachledda tillfällen")).toBeInTheDocument();
    expect(screen.queryByText("Instruktör vid varje tillfälle")).not.toBeInTheDocument();
  });

  it("does not invent one coach when staffing is unassigned or split across occurrences", async () => {
    mocks.fetchCourseDetail.mockResolvedValueOnce({
      ...course,
      coach: { coverage: "none", mode: "unassigned", coaches: [] },
    });
    const first = renderCourse();
    expect((await screen.findAllByText("Instruktör vid varje tillfälle")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Coach:/)).not.toBeInTheDocument();
    first.unmount();

    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      coach: { coverage: "complete", mode: "multiple", coaches: [{ display_name: "Anna Andersson" }, { display_name: "Bertil Berg" }] },
    });
    renderCourse();
    expect(await screen.findByText("Coacher: Anna Andersson och Bertil Berg")).toBeInTheDocument();
    expect(screen.queryByText(/^Coach:/)).not.toBeInTheDocument();
  });

  it("projects Parker Brunch as a one-occurrence social event without Course language", async () => {
    mocks.user = null;
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      id: "parker-brunch",
      name: "Parker",
      start_date: "2026-09-05",
      end_date: "2026-09-05",
      total_sessions: 1,
      start_time: "13:00",
      end_time: "18:00",
      image_urls: ["https://example.test/parker-brunch.webp"],
      format: {
        ...course.format,
        name: "Parker Brunch",
        description: "Brunch, pickleball och människor i huset.",
        full_description: "En eftermiddag med brunch och pickleball.",
        presentation_type: "social_event",
        requires_instructor: true,
      },
      product: { ...course.product, base_price_sek: 199 },
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 19900,
        final_price_minor: 14900,
        pricing_reason: "early_bird",
        sales_channel: "online",
        checkout_label: "149 kr",
        membership_tier_name: null,
        early_bird: { configured: true, active: true, applied: true, price_minor: 14900, slots: 10, remaining: 10 },
      },
      capacity: { capacity: 40, committed_count: 0, active_holds_count: 0, available_count: 40 },
      sessions: [{ id: "parker-session", session_date: "2026-09-05", start_time: "13:00", end_time: "18:00", court_ids: [], requires_staffing: true, is_active: true, series_occurrence_index: 1 }],
    });
    renderCourse();

    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByText("EVENT")).toBeInTheDocument();
    expect(screen.getByText(/5 september · 13:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText(/Pickla Stockholm · 40 platser kvar/)).toBeInTheDocument();
    expect(screen.getByText("Early Bird · 149 kr")).toBeInTheDocument();
    expect(screen.getByText("Första 10 platserna · sedan 199 kr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boka Early Bird · 149 kr" })).toBeDisabled();
    expect(screen.getByTestId("series-detail-image")).toHaveAttribute("src", "https://example.test/parker-brunch.webp");
    expect(screen.getByTestId("series-detail-image")).toHaveClass("w-full", "rounded-[24px]");
    expect(screen.getByTestId("series-detail-image")).not.toHaveClass("object-cover");
    expect(screen.getByTestId("series-detail-image")).not.toHaveClass("-mx-5");
    expect(screen.queryByText(/1 tillfällen?/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Instruktör vid varje tillfälle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kursplatsen|plats på kursen/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "En annan vuxen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ett barn jag ansvarar för" })).not.toBeInTheDocument();
  });

  it("keeps the normal social-event CTA when a lower member price beats Early Bird", async () => {
    mocks.user = { id: "member-1" };
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      id: "parker-brunch",
      name: "Parker",
      total_sessions: 1,
      image_urls: [],
      format: { ...course.format, name: "Parker Brunch", presentation_type: "social_event", requires_instructor: false },
      product: { ...course.product, base_price_sek: 199 },
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 19900,
        final_price_minor: 12900,
        pricing_reason: "membership_tier_pricing",
        sales_channel: "online",
        checkout_label: "129 kr",
        membership_tier_name: "Play+",
        early_bird: { configured: true, active: true, applied: false, price_minor: 14900, slots: 10, remaining: 7 },
      },
      capacity: { capacity: 40, committed_count: 3, active_holds_count: 0, available_count: 37 },
      sessions: [{ id: "parker-session", session_date: "2026-09-05", start_time: "13:00", end_time: "18:00", court_ids: [], requires_staffing: false, is_active: true, series_occurrence_index: 1 }],
    });
    renderCourse();

    expect(await screen.findByRole("heading", { name: "Parker Brunch" })).toBeInTheDocument();
    expect(screen.getByText("Medlemspris · 129 kr")).toBeInTheDocument();
    expect(screen.queryByText(/Early Bird · 149 kr/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boka plats · 129 kr" })).toBeEnabled();
  });

  it("shows durable ownership and canonical sharing without reselling an owned social event", async () => {
    mocks.user = { id: "owner-1" };
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      id: "parker-brunch",
      name: "Parker",
      customer_has_commitment: true,
      total_sessions: 1,
      format: { ...course.format, name: "Parker Brunch", presentation_type: "social_event", requires_instructor: false },
      product: { ...course.product, base_price_sek: 199 },
      capacity: { capacity: 40, committed_count: 1, active_holds_count: 0, available_count: 39 },
      sessions: [{ id: "parker-session", session_date: "2026-09-05", start_time: "13:00", end_time: "18:00", court_ids: [], requires_staffing: false, is_active: true, series_occurrence_index: 1 }],
    });
    renderCourse();

    expect(await screen.findByText("Du har en plats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Boka plats/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dela Parker Brunch" }));
    await waitFor(() => expect(mocks.shareOrCopy).toHaveBeenCalledWith(expect.objectContaining({
      title: "Parker Brunch",
      url: "http://localhost:3000/course/parker-brunch?v=pickla-arena-sthlm",
      copyText: "http://localhost:3000/course/parker-brunch?v=pickla-arena-sthlm",
    })));
  });

  it("does not present the payer's member quote as another participant's price", async () => {
    mocks.user = { id: "payer-1" };
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      pricing: {
        scope_type: "activity_series",
        list_price_minor: 149500,
        final_price_minor: 127100,
        pricing_reason: "membership_tier_pricing",
        sales_channel: "online",
        checkout_label: "1 271 kr",
        membership_tier_name: "Play",
        early_bird: { configured: false, active: false, applied: false, price_minor: null, slots: null, remaining: null },
      },
    });
    renderCourse();

    expect(await screen.findByText("Medlemspris · 1 271 kr")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "En annan vuxen" }));
    expect(screen.getByText("Priset bekräftas för deltagaren i nästa steg.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fortsätt" })).toBeDisabled();
  });

  it.each([
    ["clinic", "CLINIC", "Om clinicen", "Coach vid varje tillfälle"],
    ["tournament", "TURNERING", "Om turneringen", null],
  ] as const)("projects %s language without changing the shared purchase surface", async (presentationType, label, heading, instructorCopy) => {
    mocks.user = null;
    mocks.fetchCourseDetail.mockResolvedValue({
      ...course,
      name: presentationType === "clinic" ? "Serve & Return" : "Stockholm League Pickleball",
      format: {
        ...course.format,
        full_description: presentationType === "clinic" ? "Teknikträning med coach." : "Tävlingsdag hos Pickla.",
        presentation_type: presentationType,
      },
    });
    renderCourse();

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Boka plats · ${formatCommerceMoney(149500)}` })).toBeDisabled();
    if (instructorCopy) expect(screen.getByText(instructorCopy)).toBeInTheDocument();
    else expect(screen.queryByText("Instruktör vid varje tillfälle")).not.toBeInTheDocument();
    expect(screen.queryByText(/Kursplatsen|plats på kursen/i)).not.toBeInTheDocument();
  });
});

describe("Course V1 Admin", () => {
  it("configures product-owned Open Play access using the canonical occurrence period", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    mocks.saveSeriesIncludedAccess.mockResolvedValue({
      series_id: course.id,
      access_product_id: course.product.id,
      enabled: false,
      starts_at: "2026-09-07T22:00:00Z",
      expires_at: "2026-10-13T22:00:00Z",
    });

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    const section = await screen.findByTestId("series-included-access");
    expect(within(section).getByText("Gäller: 8 sep → 13 okt")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("checkbox", { name: "Open Play under erbjudandets period" }));
    fireEvent.click(within(section).getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(mocks.saveSeriesIncludedAccess).toHaveBeenCalledWith({
      seriesId: "series-1",
      openPlaySeriesPeriodEnabled: false,
    }));
  });

  it("configures product-owned Series Early Bird and shows the compact preview", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    mocks.saveSeriesEarlyBird.mockResolvedValue({
      series_id: course.id,
      product: { ...course.product, scarcity_mode: "early_bird", early_bird_price_minor: 129500, early_bird_slots: 3 },
      preview: { ordinary_price_sek: 1495, early_bird_price_sek: 1295, early_bird_slots: 3 },
    });

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    const section = await screen.findByTestId("series-early-bird");
    fireEvent.click(within(section).getByRole("checkbox", { name: "Early Bird" }));
    fireEvent.change(within(section).getByLabelText(/Early Bird-pris/), { target: { value: "1295" } });
    fireEvent.change(within(section).getByLabelText(/Första/), { target: { value: "3" } });
    expect(within(section).getByText("1 295 kr")).toBeInTheDocument();
    expect(within(section).getByText("3 platser")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(mocks.saveSeriesEarlyBird).toHaveBeenCalledWith({
      seriesId: "series-1",
      enabled: true,
      priceSek: 1295,
      slots: 3,
    }));
  });

  it("edits the canonical Series product member price and renders the server preview", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    mocks.fetchSeriesMemberPricing.mockResolvedValue({
      series: [{
        series_id: course.id,
        product: {
          id: course.product.id,
          venue_id: course.venue_id,
          product_key: course.product.product_key,
          product_kind: "series_access",
          name: course.product.name,
          base_price_sek: course.product.base_price_sek,
          is_active: true,
          status: "active",
        },
        tiers: [{
          tier: { id: "tier-play", name: "Play", color: null, sort_order: 1 },
          rule: { id: "rule-play", tier_id: "tier-play", product_type: course.product.product_key, fixed_price: 1295, discount_percent: null, vat_rate: 6, label: "Play", mode: "fixed" },
          preview: { ordinary_price_sek: 1495, resolved_price_sek: 1295, mode: "fixed", value: 1295 },
        }],
      }],
    });
    mocks.saveSeriesMemberPricing.mockResolvedValue({ id: "rule-play" });

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    const section = await screen.findByTestId("series-member-pricing");
    expect(within(section).getByText("Ordinarie 1 495 kr")).toBeInTheDocument();
    const row = within(section).getByTestId("series-member-price-tier-play");
    expect(within(row).getByText("1 295 kr")).toBeInTheDocument();
    expect(within(row).queryByLabelText("Play prismodell")).not.toBeInTheDocument();
    fireEvent.change(within(row).getByLabelText("Play medlemspris"), { target: { value: "1195" } });
    fireEvent.click(within(row).getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(mocks.saveSeriesMemberPricing).toHaveBeenCalledWith({
      ruleId: "rule-play",
      tierId: "tier-play",
      productKey: "course_pickla_101",
      mode: "fixed",
      value: 1195,
      label: "Play · Pickla 101",
    }));
  });

  it("configures the participant policy per Course offer without changing the age taxonomy", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    mocks.saveSeriesParticipantPolicy.mockResolvedValue({
      series_id: course.id,
      access_product_id: course.product.id,
      participant_policy: "self_only",
    });
    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    const section = await screen.findByTestId("series-participant-policy");
    expect(within(section).getByLabelText("Vem kan bokas?")).toHaveValue("self_adult_or_dependent");
    fireEvent.change(within(section).getByLabelText("Vem kan bokas?"), { target: { value: "self_only" } });
    fireEvent.click(within(section).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(mocks.saveSeriesParticipantPolicy).toHaveBeenCalledWith({
      seriesId: "series-1",
      participantPolicy: "self_only",
    }));
    expect(course.format.age_group).toBe("adult");
  });

  it("grants an identified participant a non-financial Series place with a required reason", async () => {
    const participant = { kind: "customer", id: "customer-anna", name: "Anna Andersson", detail: "anna@example.test" };
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [{ ...course, staff_grants: [] }], courts: [] });
    mocks.findSeriesGrantParticipants.mockResolvedValue({ items: [participant] });
    mocks.grantSeriesStaffPlace.mockResolvedValue({
      ok: true,
      commitment_id: "commitment-1",
      entitlement_id: "entitlement-1",
      available_count: 4,
      reason: "granted",
      grant: {
        id: "commitment-1",
        activity_series_id: "series-1",
        status: "active",
        participant,
        provenance_label: "Friplats · Pickla",
      },
    });

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ge plats" }));

    expect(screen.getByText("7 av 12 bokade · 5 platser kvar")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sök deltagare"), { target: { value: "Anna" } });
    fireEvent.click(await screen.findByRole("button", { name: /Anna Andersson/ }));
    fireEvent.change(screen.getByLabelText("Anledning"), { target: { value: "Community-värd" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Ge plats" }).at(-1)!);

    await waitFor(() => expect(mocks.grantSeriesStaffPlace).toHaveBeenCalledWith(expect.objectContaining({
      venue_id: "venue-1",
      series_id: "series-1",
      participant_kind: "customer",
      participant_id: "customer-anna",
      reason: "Community-värd",
      request_id: expect.any(String),
    })));
  });

  it("uses the existing Schedule surface for Format, Series and Session preview", async () => {
    mocks.fetchCourseAdmin.mockResolvedValue({ formats: [course.format], series: [course], courts: [] });
    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    expect(await screen.findByText("Koncept & innehåll")).toBeInTheDocument();
    expect(screen.getByText("Program & Event", { selector: "h3" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    await screen.findByText("Skapa program eller event");
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "format-1" } });
    fireEvent.change(screen.getByPlaceholderText("Pickla 101 · Höst 2026"), { target: { value: "Pickla 101 · Höst 2026" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-09-08" } });
    fireEvent.change(screen.getByLabelText("Slut"), { target: { value: "2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Anmälan öppnar"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Anmälan stänger"), { target: { value: "2026-09-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Bana 3" }));

    expect(await screen.findByText("Privat bokning · 17:30–19:30")).toBeInTheDocument();
    expect(screen.getByText("Ändra schema eller resurser innan serien kan sparas.")).toBeInTheDocument();
    expect(screen.getAllByText("Konflikt")).toHaveLength(1);
    expect(screen.getAllByText("Ledig")).toHaveLength(5);
    await waitFor(() => expect(screen.getByRole("button", { name: "Skapa omgång och tillfällen" })).toBeDisabled());
  });

  it("edits reusable Format content and reloads a draft Series into the canonical preview", async () => {
    const courtId = "c0100000-0000-4000-8000-000000000003";
    const draftCourse = { ...course, status: "draft", customer_has_commitment: false, court_ids: [courtId] };
    mocks.previewCourseSeries.mockClear();
    mocks.fetchCourseAdmin.mockResolvedValue({
      formats: [course.format],
      series: [draftCourse],
      courts: [{ id: courtId, name: "Bana 3", sport_type: "pickleball" }],
    });
    mocks.updateCourseFormat.mockResolvedValue({ ...course.format, description: "Ny kort text", full_description: "Ny lång text" });
    mocks.previewCourseSeries.mockResolvedValue({
      occurrence_count: 6,
      has_conflicts: false,
      rows: course.sessions.map((session, index) => ({
        occurrence_index: index + 1,
        occurrence_date: session.session_date,
        proposed_starts_at: `${session.session_date}T16:00:00Z`,
        proposed_ends_at: `${session.session_date}T17:00:00Z`,
        court_id: courtId,
        court_name: "Bana 3",
        is_available: true,
        conflicts: [],
      })),
    });
    mocks.updateCourseSeries.mockResolvedValue(draftCourse);

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    await screen.findByText("Koncept & innehåll");

    fireEvent.click(screen.getByRole("button", { name: "Redigera koncept Pickla 101" }));
    expect(screen.getByLabelText("Kort beskrivning")).toHaveValue("Dina första fyra veckor med pickleball.");
    expect((screen.getByLabelText("Full beskrivning och innehåll") as HTMLTextAreaElement).value).toContain("Tillfälle 1");
    fireEvent.change(screen.getByLabelText("Kort beskrivning"), { target: { value: "Ny kort text" } });
    fireEvent.change(screen.getByLabelText("Full beskrivning och innehåll"), { target: { value: "Ny lång text" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara format" }));
    await waitFor(() => expect(mocks.updateCourseFormat).toHaveBeenCalledWith(expect.objectContaining({
      format_id: "format-1",
      description: "Ny kort text",
      full_description: "Ny lång text",
      presentation_type: "course",
    })));

    fireEvent.click(screen.getByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));
    expect(screen.getByText("Redigera omgång")).toBeInTheDocument();
    expect(screen.getByLabelText("Omgångens namn")).toHaveValue("Pickla 101 · Höst 2026");
    await waitFor(() => expect(mocks.previewCourseSeries).toHaveBeenCalledWith(expect.objectContaining({ series_id: "series-1" })));
    expect(await screen.findAllByText("Ledig")).toHaveLength(6);
  });

  it("reopens a published Series without sales and safely reconciles its schedule", async () => {
    const courtId = "c0100000-0000-4000-8000-000000000003";
    const published = {
      ...course,
      status: "active",
      total_sessions: 4,
      court_ids: [courtId],
      capacity: { capacity: 8, committed_count: 0, active_holds_count: 0, available_count: 8 },
      sessions: course.sessions.slice(0, 4),
      edit_policy: {
        lifecycle_editable: true,
        schedule_editable: true,
        schedule_lock_reason: null,
        has_started: false,
        commitment_count: 0,
        active_holds_count: 0,
        order_history_count: 0,
        registration_count: 0,
        staffing_assignment_count: 0,
        minimum_capacity: 0,
        historical_prices_frozen: false,
      },
    };
    mocks.fetchCourseAdmin.mockResolvedValue({
      formats: [course.format],
      series: [published],
      courts: [{ id: courtId, name: "Bana 3", sport_type: "pickleball" }],
    });
    mocks.previewCourseSeries.mockResolvedValue({
      occurrence_count: 4,
      has_conflicts: false,
      rows: published.sessions.map((session, index) => ({
        occurrence_index: index + 1,
        occurrence_date: session.session_date,
        proposed_starts_at: `${session.session_date}T17:00:00Z`,
        proposed_ends_at: `${session.session_date}T18:00:00Z`,
        court_id: courtId,
        court_name: "Bana 3",
        is_available: true,
        conflicts: [],
      })),
    });
    mocks.updateCourseSeries.mockResolvedValue(published);

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    expect(screen.getByText("Publicerad · 0 av 8 platser")).toBeInTheDocument();
    expect(screen.getByLabelText("Omgångens namn")).toHaveValue("Pickla 101 · Höst 2026");
    expect(screen.getByLabelText("Starttid")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Bana 3" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Starttid"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Sluttid"), { target: { value: "20:00" } });

    await waitFor(() => expect(mocks.previewCourseSeries).toHaveBeenLastCalledWith(expect.objectContaining({
      series_id: "series-1",
      start_time: "19:00",
      end_time: "20:00",
      total_sessions: 4,
      court_ids: [courtId],
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Spara ändringar" }));
    await waitFor(() => expect(mocks.updateCourseSeries).toHaveBeenCalledWith(expect.objectContaining({
      series_id: "series-1",
      name: "Pickla 101 · Höst 2026",
      start_time: "19:00",
      end_time: "20:00",
      total_sessions: 4,
      capacity: 8,
      price_sek: 1495,
      court_ids: [courtId],
    })));
  });

  it("locks schedule truth after a commitment while preserving safe future-facing edits", async () => {
    const courtId = "c0100000-0000-4000-8000-000000000003";
    const sold = {
      ...course,
      status: "active",
      court_ids: [courtId],
      capacity: { capacity: 8, committed_count: 2, active_holds_count: 1, available_count: 5 },
      edit_policy: {
        lifecycle_editable: true,
        schedule_editable: false,
        schedule_lock_reason: "participants_or_payments_exist" as const,
        has_started: false,
        commitment_count: 2,
        active_holds_count: 1,
        order_history_count: 2,
        registration_count: 12,
        staffing_assignment_count: 0,
        minimum_capacity: 3,
        historical_prices_frozen: true,
      },
    };
    mocks.fetchCourseAdmin.mockResolvedValue({
      formats: [course.format],
      series: [sold],
      courts: [{ id: courtId, name: "Bana 3", sport_type: "pickleball" }],
    });
    mocks.previewCourseSeries.mockResolvedValue({
      occurrence_count: 6,
      has_conflicts: false,
      rows: sold.sessions.map((session, index) => ({
        occurrence_index: index + 1,
        occurrence_date: session.session_date,
        proposed_starts_at: `${session.session_date}T16:00:00Z`,
        proposed_ends_at: `${session.session_date}T17:00:00Z`,
        court_id: courtId,
        court_name: "Bana 3",
        is_available: true,
        conflicts: [],
      })),
    });
    mocks.updateCourseSeries.mockResolvedValue(sold);

    render(<AdminCourses venueId="venue-1" />, { wrapper: wrapper("/hub/admin/schedule") });
    fireEvent.click(screen.getByRole("button", { name: /Program/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Redigera omgång Pickla 101 · Höst 2026" }));

    expect(screen.getByText(/Schemat är låst eftersom deltagare eller betalningshistorik finns/)).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toBeDisabled();
    expect(screen.getByLabelText("Starttid")).toBeDisabled();
    expect(screen.getByLabelText("Tillfällen")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bana 3" })).toBeDisabled();
    expect(screen.getByLabelText("Omgångens namn")).toBeEnabled();
    expect(screen.getByLabelText("Anmälan stänger")).toBeEnabled();
    expect(screen.getByLabelText("Ordinarie pris SEK")).toBeEnabled();
    expect(screen.getByText(/Tidigare order, kvitto och huvudbok förblir frusna/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Total kapacitet"), { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "Spara ändringar" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Total kapacitet"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Omgångens namn"), { target: { value: "Pickla 101 · Uppdaterad" } });
    fireEvent.change(screen.getByLabelText("Ordinarie pris SEK"), { target: { value: "1595" } });
    fireEvent.click(await screen.findByRole("button", { name: "Spara ändringar" }));

    await waitFor(() => expect(mocks.updateCourseSeries).toHaveBeenCalledWith(expect.objectContaining({
      series_id: "series-1",
      name: "Pickla 101 · Uppdaterad",
      start_time: "18:00",
      end_time: "19:00",
      capacity: 10,
      price_sek: 1595,
      court_ids: [courtId],
    })));
  });
});

describe("Course privacy contract", () => {
  it("keeps subordinate identity out of customer-facing capacity data", () => {
    expect(Object.keys(course.capacity)).toEqual(["capacity", "committed_count", "active_holds_count", "available_count"]);
    expect(JSON.stringify(course.capacity)).not.toContain("Elsa");
  });
});
