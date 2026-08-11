import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  useAdminOperationsWeek: vi.fn(),
  useAdminOperationsStaffing: vi.fn(),
  bookingDrawer: vi.fn(),
  assign: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminOperationsWeek: mocks.useAdminOperationsWeek,
  useAdminOperationsStaffing: mocks.useAdminOperationsStaffing,
}));

vi.mock("@/components/admin/shell/AdminCapacity", () => ({
  TimelineDay: ({ date, intervals }: { date: string; intervals: Array<{ classification: string }> }) => (
    <div data-testid={`capacity-${date}`}>{intervals.some((row) => row.classification === "free") ? "Ledig kapacitet" : "Upptaget"}</div>
  ),
}));

vi.mock("@/components/operations/OperationsBookingDrawer", () => ({
  OperationsBookingDrawer: (props: { open: boolean; booking: { title?: string } | null }) => {
    mocks.bookingDrawer(props);
    return props.open ? <div data-testid="booking-drawer">{props.booking?.title}</div> : null;
  },
}));

import AdminOperationsWeek from "@/components/admin/shell/AdminOperationsWeek";

const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];

const occurrence = (overrides: Record<string, unknown> = {}) => ({
  id: "activity_session:activity-1:2026-08-10",
  source_type: "activity_session",
  source_id: "activity-1",
  occurrence_date: "2026-08-10",
  starts_at: "2026-08-10T16:00:00.000Z",
  ends_at: "2026-08-10T17:00:00.000Z",
  origin: "activity",
  classification: "activity",
  title: "Open Play",
  resource_ids: ["court-1"],
  resource_names: ["Bana 1"],
  capacity: 8,
  booked_count: 5,
  checked_in_count: 2,
  requires_staffing: true,
  assignments: [],
  warnings: [{ code: "missing_staff", label: "Saknar bemanning" }],
  detail_target: { kind: "module", module_id: "schedule", source_id: "activity-1", session_date: "2026-08-10" },
  ...overrides,
});

function weekData() {
  return {
    venue_id: "venue-1",
    timezone: "Europe/Stockholm",
    from: dates[0],
    to: dates[6],
    dates,
    resources: [{ id: "court-1", name: "Bana 1", court_number: 1, sport_type: "pickleball", group: "pickleball" }],
    opening_intervals: dates.map((date) => ({ id: `open-${date}`, resource_id: "court-1", venue_date: date, starts_at: `${date}T07:00:00.000Z`, ends_at: `${date}T21:00:00.000Z` })),
    intervals: [{ id: "free-1", source_type: "free", source_id: "free-1", venue_id: "venue-1", resource_id: "court-1", starts_at: "2026-08-10T07:00:00.000Z", ends_at: "2026-08-10T16:00:00.000Z", venue_date: "2026-08-10", status: "available", classification: "free", title: "Ledigt", detail_target: null, outside_opening_hours: false, conflict: { is_conflict: false, with: [] } }],
    summary: { open_resource_minutes: 5880, occupied_resource_minutes: 300, available_resource_minutes: 5580, utilization_percentage: 5.1, conflict_count: 0 },
    source_status: { bookings: { status: "ok" }, activities: { status: "ok" }, activity_overrides: { status: "ok" }, resource_blocks: { status: "ok" }, closures: { status: "ok" } },
    partial: false,
    operations: {
      occurrences: [
        occurrence(),
        occurrence({
          id: "booking:booking-1:2026-08-10",
          source_type: "booking",
          source_id: "booking-1",
          source_ids: ["booking-1", "booking-2"],
          origin: "private_booking",
          classification: "booking",
          title: "Privat bokning",
          requires_staffing: false,
          warnings: [],
          booked_count: 2,
          checked_in_count: 0,
          detail_target: { kind: "booking_drawer", booking: { title: "Privat bokning · Bana 1" } },
        }),
        occurrence({
          id: "event:event-1:2026-08-11",
          source_type: "event",
          source_id: "event-1",
          occurrence_date: "2026-08-11",
          starts_at: "2026-08-11T16:00:00.000Z",
          ends_at: "2026-08-11T19:00:00.000Z",
          origin: "event",
          classification: "event",
          title: "Acme kickoff",
          assignments: [{ id: "assignment-1", venue_staff_id: "staff-1", role: "host", display_name: "Anna", valid: true }],
          warnings: [],
          detail_target: { kind: "module", module_id: "events", source_id: "event-1" },
        }),
        occurrence({
          id: "operation_override:block-1:2026-08-12",
          source_type: "operation_override",
          source_id: "block-1",
          occurrence_date: "2026-08-12",
          starts_at: "2026-08-12T10:00:00.000Z",
          ends_at: "2026-08-12T12:00:00.000Z",
          origin: "maintenance",
          classification: "maintenance",
          title: "Nätservice",
          requires_staffing: false,
          warnings: [{ code: "staff_overlap", label: "Anna är dubbelbokad" }],
          detail_target: { kind: "module", module_id: "operations", source_id: "block-1" },
        }),
      ],
      staff_options: [{ id: "staff-1", user_id: "user-1", display_name: "Anna", venue_role: "venue_admin", is_active: true }],
      daily: dates.map((date, index) => ({
        date,
        occurrence_count: index === 0 ? 2 : index < 3 ? 1 : 0,
        missing_staff_count: index === 0 ? 1 : 0,
        queue_count: index === 0 ? 3 : 0,
        queue: { incidents: index === 0 ? 1 : 0, attention_orders: index === 0 ? 1 : 0, uncollected_products: index === 0 ? 1 : 0 },
        free_resource_minutes: 600,
      })),
      query_strategy: { bounded: true, maximum_queries: 17, n_plus_one: false },
    },
  };
}

describe("Operations Week V1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T10:00:00.000Z"));
    mocks.assign.mockReset();
    mocks.remove.mockReset();
    mocks.assign.mockResolvedValue({});
    mocks.remove.mockResolvedValue({});
    mocks.useAdminOperationsStaffing.mockReturnValue({ assign: { mutateAsync: mocks.assign, isPending: false }, remove: { mutateAsync: mocks.remove, isPending: false } });
    mocks.useAdminOperationsWeek.mockReturnValue({ data: weekData(), isLoading: false, isError: false, isFetching: false, error: null });
  });

  it("shows Monday–Sunday, venue, daily truth and representative canonical sources once", () => {
    render(<AdminOperationsWeek venueId="venue-1" venueName="Pickla Arena" onOpenModule={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Pickla Arena" })).toBeInTheDocument();
    for (const label of ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"]) expect(screen.getAllByText(new RegExp(label, "i")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open Play")).toHaveLength(1);
    expect(screen.getAllByText("Privat bokning").filter((node) => node.tagName === "P")).toHaveLength(1);
    expect(screen.getAllByText("Acme kickoff")).toHaveLength(1);
    expect(screen.getAllByText("Nätservice")).toHaveLength(1);
    expect(screen.getByText("3 i befintlig kö")).toBeInTheDocument();
    expect(screen.getAllByText("10 h ledigt").length).toBeGreaterThan(0);
  });

  it("shows missing staff, assigned staff and non-blocking overlap warnings", () => {
    render(<AdminOperationsWeek venueId="venue-1" venueName="Pickla Arena" onOpenModule={vi.fn()} />);
    expect(screen.getByText("Saknar bemanning")).toBeInTheDocument();
    expect(screen.getByText("Anna · Värd")).toBeInTheDocument();
    expect(screen.getByText("Anna är dubbelbokad")).toBeInTheDocument();
    expect(screen.getAllByText("0 saknar personal").length).toBeGreaterThan(0);
  });

  it("keeps click-through on canonical detail and staffing on a secondary action", () => {
    const onOpenModule = vi.fn();
    render(<AdminOperationsWeek venueId="venue-1" venueName="Pickla Arena" onOpenModule={onOpenModule} />);
    fireEvent.click(screen.getByText("Open Play").closest("button")!);
    expect(onOpenModule).toHaveBeenCalledWith("schedule");

    const privateBookingTitle = screen.getAllByText("Privat bokning").find((node) => node.tagName === "P")!;
    fireEvent.click(privateBookingTitle.closest("button")!);
    expect(screen.getByTestId("booking-drawer")).toHaveTextContent("Privat bokning · Bana 1");

    const openPlayCard = screen.getByText("Open Play").closest("div.rounded-2xl")!;
    fireEvent.click(within(openPlayCard).getByRole("button", { name: "Bemanna" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Bemanna förekomst");
  });

  it("moves exactly one venue-local Monday–Sunday week", () => {
    render(<AdminOperationsWeek venueId="venue-1" venueName="Pickla Arena" onOpenModule={vi.fn()} />);
    expect(mocks.useAdminOperationsWeek).toHaveBeenLastCalledWith("venue-1", "2026-08-10", "2026-08-16");
    fireEvent.click(screen.getByRole("button", { name: "Nästa vecka" }));
    expect(mocks.useAdminOperationsWeek).toHaveBeenLastCalledWith("venue-1", "2026-08-17", "2026-08-23");
    fireEvent.click(screen.getByRole("button", { name: "Denna vecka" }));
    expect(mocks.useAdminOperationsWeek).toHaveBeenLastCalledWith("venue-1", "2026-08-10", "2026-08-16");
  });
});

describe("Operations Week backend contract", () => {
  const api = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260810130000_operations_week_staffing.sql", "utf8");

  it("keeps one bounded projection with no per-day or per-resource query loop", () => {
    const start = api.indexOf("async function buildOperationsWeekProjection");
    const end = api.indexOf("async function analyzeOperationImpact", start);
    const source = api.slice(start, end);
    expect(source).toContain("operationsExtrasPromise");
    expect(source).toContain("maximum_queries: 17");
    expect(source).toContain("n_plus_one: false");
    expect(source).not.toMatch(/for \(const date of dates\)[\s\S]{0,300}admin\.from/);
  });

  it("projects Events read-only from booked identity plus confirmed resource blocks without duplicate block cards", () => {
    expect(api).toContain(".in('planning_status', ['booked', 'ready', 'published', 'done'])");
    expect(api).toContain("if (block.event_id || cleanBlockMetadata(block.metadata).venue_operation_override_id) continue");
    expect(api).toContain("event_resource_drift");
    expect(api).toContain("event_resource_missing");
    expect(api).not.toContain("operations_week_events");
  });

  it("stores no duplicate time/resource truth and uses authorized venue staff", () => {
    const tableStart = migration.indexOf("CREATE TABLE IF NOT EXISTS public.operational_staff_assignments");
    const tableEnd = migration.indexOf(");", tableStart);
    const table = migration.slice(tableStart, tableEnd);
    expect(table).toContain("venue_staff_id");
    expect(table).toContain("occurrence_date");
    expect(table).not.toContain("starts_at");
    expect(table).not.toContain("ends_at");
    expect(table).not.toContain("resource_id");
    expect(migration).toContain("operational_staff_must_belong_to_venue");
    expect(migration).toContain("role IN ('host', 'instructor', 'service')");
  });

  it("keeps staffing optional by default and explicit on activities while booked Events require it", () => {
    expect(migration).toContain("requires_staffing boolean NOT NULL DEFAULT false");
    expect(api).toContain("requires_staffing: session.requires_staffing === true");
    expect(api).toContain("requires_staffing: true");
    expect(api).toContain("requires_staffing: false");
  });

  it("audits assignment changes through the established api-admin mutation path", () => {
    expect(api).toContain("'operations-staffing': 'operational_staff_assignments'");
    expect(api).toContain("if (path === 'operations-staffing') return body.assignmentId");
    expect(api).toContain("shouldAuditMutation");
    expect(api).toContain("validateOperationalStaffingSource");
  });
});
