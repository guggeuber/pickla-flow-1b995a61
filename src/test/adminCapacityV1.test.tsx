import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  useAdminCapacity: vi.fn(),
  bookingDrawer: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({ useAdminCapacity: mocks.useAdminCapacity }));

vi.mock("@/components/operations/OperationsBookingDrawer", () => ({
  OperationsBookingDrawer: (props: { open: boolean; booking: { title?: string } | null }) => {
    mocks.bookingDrawer(props);
    return props.open ? <div data-testid="booking-drawer">{props.booking?.title}</div> : null;
  },
}));

import AdminCapacity from "@/components/admin/shell/AdminCapacity";

const opening = (resourceId: string, date = "2026-07-28") => ({
  id: `open-${resourceId}-${date}`,
  resource_id: resourceId,
  venue_date: date,
  starts_at: "2026-07-28T08:00:00.000Z",
  ends_at: "2026-07-28T22:00:00.000Z",
});

const interval = (overrides: Record<string, unknown> = {}) => ({
  id: "booking:booking-1:court-1:2026-07-28",
  source_type: "booking",
  source_id: "booking-1",
  venue_id: "venue-1",
  resource_id: "court-1",
  starts_at: "2026-07-28T10:00:00.000Z",
  ends_at: "2026-07-28T11:00:00.000Z",
  venue_date: "2026-07-28",
  status: "confirmed",
  classification: "booking",
  title: "Privat bokning",
  detail_target: { kind: "booking_drawer", booking: { title: "Privat bokning · Bana 1", source_ids: ["booking-1"] } },
  outside_opening_hours: false,
  conflict: { is_conflict: false, with: [] },
  ...overrides,
});

function capacityData(overrides: Record<string, unknown> = {}) {
  return {
    venue_id: "venue-1",
    timezone: "Europe/Stockholm",
    from: "2026-07-28",
    to: "2026-07-28",
    dates: ["2026-07-28"],
    resources: [
      { id: "court-1", name: "Bana 1", court_number: 1, sport_type: "pickleball", group: "pickleball" },
      { id: "court-2", name: "Bana 2", court_number: 2, sport_type: "dart", group: "dart" },
    ],
    opening_intervals: [opening("court-1"), opening("court-2")],
    intervals: [
      interval(),
      interval({
        id: "event:event-1:court-2:2026-07-28",
        source_type: "event_reservation",
        source_id: "event-1",
        resource_id: "court-2",
        classification: "event",
        title: "Företagsevent",
        detail_target: { kind: "module", module_id: "events", source_id: "event-1" },
      }),
    ],
    summary: {
      open_resource_minutes: 1680,
      occupied_resource_minutes: 120,
      available_resource_minutes: 1560,
      utilization_percentage: 7.1,
      conflict_count: 0,
    },
    source_status: {
      bookings: { status: "ok" },
      activities: { status: "ok" },
      activity_overrides: { status: "ok" },
      resource_blocks: { status: "ok" },
      closures: { status: "ok" },
    },
    partial: false,
    ...overrides,
  };
}

function queryResult(data = capacityData()) {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
  };
}

describe("Capacity V1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00.000Z"));
    mocks.useAdminCapacity.mockReset();
    mocks.bookingDrawer.mockReset();
    mocks.useAdminCapacity.mockReturnValue(queryResult());
  });

  it("renders read-only capacity metrics and comparable resources", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Husets kapacitet")).toBeInTheDocument();
    expect(screen.getByText("28 h")).toBeInTheDocument();
    expect(screen.getByText("26 h")).toBeInTheDocument();
    expect(screen.getAllByText("Bana 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bana 2").length).toBeGreaterThan(0);
    expect(screen.queryByText(/skapa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/spara/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ta bort/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ledigt är ett planeringsmått/i)).toBeInTheDocument();
  });

  it("switches between day and a seven-day venue-local week", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(mocks.useAdminCapacity).toHaveBeenLastCalledWith("venue-1", "2026-07-28", "2026-07-28", "day");
    fireEvent.click(screen.getByRole("button", { name: "Vecka" }));
    expect(mocks.useAdminCapacity).toHaveBeenLastCalledWith("venue-1", "2026-07-28", "2026-08-03", "week");
  });

  it("moves the selected period and resets to today", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Nästa period" }));
    expect(mocks.useAdminCapacity).toHaveBeenLastCalledWith("venue-1", "2026-07-29", "2026-07-29", "day");
    fireEvent.click(screen.getByRole("button", { name: "Idag" }));
    expect(mocks.useAdminCapacity).toHaveBeenLastCalledWith("venue-1", "2026-07-28", "2026-07-28", "day");
  });

  it("keeps Day and Week navigation inside the server operational window", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    const dateInput = screen.getByLabelText("Startdatum");
    expect(dateInput).toHaveAttribute("min", "2025-07-27");
    expect(dateInput).toHaveAttribute("max", "2027-07-29");
    fireEvent.change(dateInput, { target: { value: "2027-07-29" } });
    expect(screen.getByRole("button", { name: "Nästa period" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Vecka" }));
    expect(screen.getByLabelText("Startdatum")).toHaveValue("2027-07-23");
    expect(mocks.useAdminCapacity).toHaveBeenLastCalledWith("venue-1", "2027-07-23", "2027-07-29", "week");
  });

  it("filters the grid without changing canonical server totals", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Bana 1" }));
    expect(screen.getByText("Privat bokning")).toBeInTheDocument();
    expect(screen.queryByText("Företagsevent")).not.toBeInTheDocument();
    expect(screen.getByText("28 h")).toBeInTheDocument();
  });

  it("opens the existing booking drawer for booking intervals", () => {
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Bokning: Privat bokning 12:00–13:00"));
    expect(screen.getByTestId("booking-drawer")).toHaveTextContent("Privat bokning · Bana 1");
    expect(mocks.bookingDrawer).toHaveBeenLastCalledWith(expect.objectContaining({ readOnly: true }));
  });

  it("routes non-booking intervals to their existing admin module", () => {
    const onOpenModule = vi.fn();
    render(<AdminCapacity venueId="venue-1" onOpenModule={onOpenModule} />);
    fireEvent.click(screen.getByTitle("Event: Företagsevent 12:00–13:00"));
    fireEvent.click(screen.getByRole("button", { name: "Öppna befintlig detaljvy" }));
    expect(onOpenModule).toHaveBeenCalledWith("events");
  });

  it("shows partial-source failure rather than presenting incomplete data as healthy", () => {
    mocks.useAdminCapacity.mockReturnValue(queryResult(capacityData({
      partial: true,
      source_status: { bookings: { status: "error", message: "Källan kunde inte läsas" } },
    })));
    render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Delvis data")).toBeInTheDocument();
    expect(screen.getByText(/beslut bör vänta/i)).toBeInTheDocument();
  });

  it("distinguishes unauthorized access from a generic backend failure", () => {
    mocks.useAdminCapacity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: Object.assign(new Error("Forbidden"), { status: 403 }),
    });
    const { rerender } = render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Behörighet saknas")).toBeInTheDocument();

    mocks.useAdminCapacity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: Object.assign(new Error("Unavailable"), { status: 500 }),
    });
    rerender(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Capacity kunde inte laddas")).toBeInTheDocument();
  });

  it("has explicit empty states for no active resources and no opening hours", () => {
    mocks.useAdminCapacity.mockReturnValue(queryResult(capacityData({ resources: [], opening_intervals: [], intervals: [] })));
    const { rerender } = render(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Inga aktiva resurser")).toBeInTheDocument();

    mocks.useAdminCapacity.mockReturnValue(queryResult(capacityData({ opening_intervals: [], intervals: [] })));
    rerender(<AdminCapacity venueId="venue-1" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Inga öppettider")).toBeInTheDocument();
  });
});

describe("Capacity V1 endpoint contract", () => {
  const apiAdmin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
  const component = readFileSync("src/components/admin/shell/AdminCapacity.tsx", "utf8");

  it("is a GET-only endpoint with explicit venue-role authorization", () => {
    const pathIndex = apiAdmin.indexOf("path === 'capacity'");
    const routeStart = apiAdmin.lastIndexOf("if (req.method", pathIndex);
    const routeEnd = apiAdmin.indexOf("OPERATIONS WEEK", routeStart);
    const route = apiAdmin.slice(routeStart, routeEnd);
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain("requireVenueRole(admin, userId, scopedVenueId");
    expect(route).not.toContain("req.method === 'POST'");
    expect(route).not.toContain("insert(");
    expect(route).not.toContain("update(");
    expect(route).not.toContain("delete(");
    expect(route).toContain("jsonResponse(result.data, result.status);");
    expect(route).toContain("Invalid Capacity view");
    expect(route).toContain("Unsupported timezone");
    expect(route).toContain("Invalid operational date");
  });

  it("scopes every canonical source to the requested venue and active resources", () => {
    const aggregatorStart = apiAdmin.indexOf("async function capacityResponse");
    const aggregatorEnd = apiAdmin.indexOf("Deno.serve", aggregatorStart);
    const aggregator = apiAdmin.slice(aggregatorStart, aggregatorEnd);
    expect(aggregator).toContain(".eq('venue_id', venueId)");
    expect(aggregator).toContain(".eq('is_available', true)");
    expect(aggregator).toContain(".neq('status', 'cancelled')");
    expect(aggregator).toContain(".eq('blocks_public_booking', true)");
    expect(aggregator).not.toContain("customer_email");
    expect(aggregator).not.toContain("customer_phone");
    expect(aggregator).not.toContain("customer_id");
    expect(aggregator).toContain(".select('id, booking_ref, stripe_session_id, access_code, venue_id, venue_court_id, booked_by, start_time, end_time, status'");
    expect(aggregator).not.toContain("customer_email");
    expect(aggregator).not.toContain("customer_phone");
    expect(aggregator).toContain("capacityDatesWithinOperationalWindow");
    expect(aggregator).toContain("capacity source row limit exceeded");
    expect(aggregator).toContain("if (override?.status === 'cancelled') continue");
    expect(aggregator).toContain("includeOperations");
    expect(aggregator).toContain("admin.from('events')");
    expect(aggregator).toContain("linkedOperationOverrideIds.has(String(override.id))");
  });

  it("contains no client mutation path or duplicated editor", () => {
    expect(component).not.toMatch(/apiPost|apiPatch|apiDelete|useMutation/);
    expect(component).not.toMatch(/drag|drop/i);
    expect(component).toContain("OperationsBookingDrawer");
    expect(component).toContain("OperationsBookingDrawer readOnly");
  });
});
