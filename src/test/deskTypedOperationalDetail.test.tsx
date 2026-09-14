import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVITY_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  bookingDrawer: vi.fn(),
  activityRow: vi.fn(),
}));

vi.mock("@/components/operations/AdminBookingDetailDrawer", () => ({
  AdminBookingDetailDrawer: (props: Record<string, unknown>) => {
    mocks.bookingDrawer(props);
    return <div data-testid="booking-detail" />;
  },
}));

vi.mock("@/components/desk/shell/DeskToday", () => ({
  ActivityRow: (props: Record<string, unknown>) => {
    mocks.activityRow(props);
    return <div data-testid="activity-detail" />;
  },
}));

vi.mock("@/components/customers/Customer360Drawer", () => ({ default: () => null }));

import { DeskOperationalDetailDrawer } from "@/components/operations/DeskOperationalDetailDrawer";
import { parseDeskOperationalDetailTarget } from "@/lib/deskOperationalDetail";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function renderDrawer(target: unknown, sourceItem: Record<string, unknown> | null = null, open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeskOperationalDetailDrawer open={open} venueId={VENUE_ID} target={target} sourceItem={sourceItem} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("Desk typed operational detail targets", () => {
  const apiBookings = source("../../supabase/functions/api-bookings/index.ts");
  const deskToday = source("../components/desk/shell/DeskToday.tsx");
  const deskOps = source("../lib/deskOps.ts");
  const drawer = source("../components/operations/DeskOperationalDetailDrawer.tsx");

  beforeEach(() => {
    mocks.bookingDrawer.mockReset();
    mocks.activityRow.mockReset();
  });

  it("A. private booking click targets booking-detail", () => {
    renderDrawer({ kind: "booking", booking_id: BOOKING_ID });
    expect(screen.getByTestId("booking-detail")).toBeInTheDocument();
    expect(mocks.bookingDrawer).toHaveBeenLastCalledWith(expect.objectContaining({ venueId: VENUE_ID, bookingId: BOOKING_ID }));
    expect(mocks.activityRow).not.toHaveBeenCalled();
    expect(source("../pages/Index.tsx")).toContain("setOpenDetail({ target: booking.detail_target, sourceItem: booking })");
  });

  it("B. Open Play click targets activity occurrence detail", () => {
    renderDrawer(
      { kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-14" },
      { activity_session: { name: "Open Play" } },
    );
    expect(screen.getByTestId("activity-detail")).toBeInTheDocument();
    expect(mocks.activityRow).toHaveBeenLastCalledWith(expect.objectContaining({
      activity: expect.objectContaining({ activity_session_id: ACTIVITY_ID, session_date: "2026-09-14" }),
      expanded: true,
    }));
    expect(mocks.bookingDrawer).not.toHaveBeenCalled();
  });

  it("C. Group Training uses the same typed activity occurrence branch", () => {
    renderDrawer(
      { kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-15" },
      { activity_session: { name: "Group Training", session_type: "training" } },
    );
    expect(mocks.activityRow).toHaveBeenCalledOnce();
    expect(mocks.bookingDrawer).not.toHaveBeenCalled();
  });

  it("D. recurring activity identity includes exactly one local occurrence date", () => {
    expect(parseDeskOperationalDetailTarget({
      kind: "activity_occurrence",
      activity_session_id: ACTIVITY_ID,
      occurrence_date: "2026-09-16",
    })).toEqual({
      ok: true,
      target: { kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-16" },
    });
    expect(apiBookings).toContain("loadEffectiveActivityOccurrence(admin, venueId, activitySessionId, sessionDate)");
  });

  it("E. booking ID is never treated as an activity ID", () => {
    renderDrawer({ kind: "booking", booking_id: BOOKING_ID });
    expect(mocks.activityRow).not.toHaveBeenCalled();
  });

  it("F. activity ID is never sent as bookingId", () => {
    renderDrawer({ kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-14" });
    expect(mocks.bookingDrawer).not.toHaveBeenCalled();
    expect(drawer).not.toContain("bookingId={parsed.target.activity_session_id}");
  });

  it("G. protected participant detail is dormant before an authorized click", () => {
    renderDrawer({ kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-14" }, null, false);
    expect(mocks.activityRow).not.toHaveBeenCalled();
    expect(deskToday).toContain("enabled: expanded && !!venueId && !!activitySessionId && !!sessionDate");
  });

  it("H. list projection adds opaque targets without embedding contact data in them", () => {
    expect(apiBookings).toContain("detail_target: { kind: 'booking', booking_id: booking.id }");
    expect(apiBookings).toContain("kind: 'activity_occurrence'");
    const activityTarget = apiBookings.slice(apiBookings.indexOf("kind: 'activity_occurrence'"), apiBookings.indexOf("kind: 'activity_occurrence'") + 220);
    expect(activityTarget).not.toMatch(/customer_|email|phone|participant/);
  });

  it("I. activity detail reuses add-player and payment invitation actions", () => {
    expect(deskToday).toContain("addActivityParticipant");
    expect(deskToday).toContain("resendActivityParticipantInvitation");
    expect(deskToday).toContain("Lägg till spelare");
    expect(deskToday).toContain("Skicka länken igen");
  });

  it("J. participant state and canonical capacity truth remain on the protected occurrence loader", () => {
    expect(deskOps).toContain('"activity-participants"');
    expect(apiBookings).toContain("admin.rpc('capacity_fill'");
    expect(apiBookings).toContain("participants: [...projectedRegistrations, ...projectedInvites]");
    expect(apiBookings).toContain("courts: occurrenceCourtIds.map");
  });

  it("K. cross-venue activity detail is denied before service-role detail reads", () => {
    const branchStart = apiBookings.indexOf("path === 'activity-participants'");
    const branch = apiBookings.slice(branchStart, branchStart + 1_100);
    expect(branch.indexOf("canOperateVenue(admin, userId, venueId)")).toBeLessThan(branch.indexOf("loadEffectiveActivityOccurrence"));
    expect(branch).toContain("return errorResponse('Forbidden', 403)");
  });

  it("L. unauthenticated and authenticated non-staff callers are denied", () => {
    const branchStart = apiBookings.indexOf("path === 'activity-participants'");
    expect(apiBookings.slice(branchStart - 450, branchStart)).toContain("getAuthenticatedClient(req)");
    expect(apiBookings.slice(branchStart - 450, branchStart)).toContain("return errorResponse(error || 'Unauthorized', 401)");
    expect(apiBookings.slice(branchStart, branchStart + 1_100)).toContain("canOperateVenue(admin, userId, venueId)");
  });

  it("M. malformed and unknown targets fail closed without mounting either loader", () => {
    renderDrawer({ kind: "activity_occurrence", activity_session_id: ACTIVITY_ID });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Ogiltigt aktivitetstillfälle");
    expect(parseDeskOperationalDetailTarget({ kind: "event", event_id: ACTIVITY_ID })).toEqual({ ok: false, error: "Okänd detaljtyp" });
    expect(mocks.bookingDrawer).not.toHaveBeenCalled();
    expect(mocks.activityRow).not.toHaveBeenCalled();
  });

  it("N. valid Open Play cannot reach the invalid-booking-target response", () => {
    renderDrawer({ kind: "activity_occurrence", activity_session_id: ACTIVITY_ID, occurrence_date: "2026-09-14" });
    expect(screen.getByTestId("activity-detail")).toBeInTheDocument();
    expect(mocks.bookingDrawer).not.toHaveBeenCalled();
    expect(drawer).not.toContain("Invalid booking detail target");
  });
});
