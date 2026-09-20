import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const index = read("src/pages/Index.tsx");
const today = read("src/components/desk/shell/DeskToday.tsx");
const live = read("src/components/desk/shell/DeskLive.tsx");
const queue = read("src/components/desk/shell/DeskQueue.tsx");
const topNav = read("src/components/desk/shell/DeskTopNav.tsx");
const bruce = read("src/components/desk/shell/DeskBrucePanel.tsx");
const deskHooks = read("src/hooks/useDesk.ts");
const commerceApi = read("supabase/functions/api-commerce/index.ts");
const bookingsApi = read("supabase/functions/api-bookings/index.ts");
const app = read("src/App.tsx");

describe("Desk OS truth repair #1", () => {
  it("removes ambiguous Today revenue, booking and raw resource KPIs", () => {
    expect(today).not.toContain("useTodayRevenue");
    expect(today).not.toContain('MiniStat label="Intäkt"');
    expect(today).not.toContain('MiniStat label="Bokningar"');
    expect(today).not.toContain('MiniStat label="Banor"');
    expect(today).not.toContain("function MiniStat");
  });

  it("keeps operational work complete and hides an empty Bruce module", () => {
    expect(today).not.toContain(".slice(0, 16)");
    expect(today).not.toContain(".slice(0, 8)");
    expect(bruce).toContain("if (!sessionsQuery.isLoading && sessions.length === 0) return null");
    expect(today).toContain("<BookingActionRow");
    expect(today).toContain("<ActivityRow");
  });

  it("uses the canonical physical resolver and truthful Live reservation labels", () => {
    const routeStart = bookingsApi.indexOf("path === 'live-resources'");
    const routeEnd = bookingsApi.indexOf("// GET /api-bookings/venue", routeStart);
    const route = bookingsApi.slice(routeStart, routeEnd);
    expect(routeStart).toBeGreaterThan(-1);
    expect(route).toContain("await canOperateVenue");
    expect(route).toContain("checkPhysicalAvailability");
    expect(route).toContain("decision.conflicts.map");
    expect(live).toContain('label: "Aktivitet nu"');
    expect(live).toContain('label: "Bokad nu"');
    expect(live).toContain('label: "Blockerad"');
    expect(live).toContain('label: "Stängd"');
    expect(live).toContain('label: "Okänt"');
    expect(live).not.toContain("banor i spel");
    expect(live).not.toContain(">Realtime<");
    expect(index).not.toContain("Hela hallen i realtid");
  });

  it("date-scopes scheduled fulfillment while retaining undated merchandise pickup obligations", () => {
    expect(today).toContain('status: "pending_pickup", date: today');
    expect(today).toContain('status: "collected", date: today');
    expect(commerceApi).toContain("filter: { status?: string; lineId?: string; serviceDate?: string }");
    expect(commerceApi).toContain("lineQuery = lineQuery.or(`session_date.eq.${filter.serviceDate},session_date.is.null`)");
    expect(commerceApi).toContain("loadDeskFulfillmentItems(admin, venueId, { status, serviceDate })");
    expect(commerceApi).not.toContain("created_at', filter.serviceDate");
  });

  it("uses bounded Queue wording instead of unsupported all-clear certainty", () => {
    expect(queue).toContain("Inga kända problem i nuvarande Queue.");
    expect(queue).not.toContain("Allt rullar utan friktion");
    expect(queue).not.toContain("Inget akut");
    expect(today).not.toContain("Inget akut just nu");
  });

  it("uses the canonical auth projection for the Admin shortcut", () => {
    expect(deskHooks).toContain("roles: Array.isArray(me.roles) ? me.roles : []");
    expect(index).toContain("canAccessDeskAdmin(staffVenue)");
    expect(index).toContain('navigate("/hub/admin")');
  });

  it("makes Today default while preserving every current Desk surface and deep booking route", () => {
    expect(index).toContain("useState<DeskSurfaceId>(DEFAULT_DESK_SURFACE)");
    for (const surface of ["today", "arrivals", "live", "queue"]) {
      expect(index).toContain(`id: "${surface}"`);
      expect(index).toContain(`active === "${surface}"`);
    }
    expect(app).toContain('<Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />');
    expect(app).toContain('<Route path="/desk/booking/:bookingId" element={<ProtectedRoute><Index /></ProtectedRoute>} />');
  });

  it("keeps all four surfaces reachable without new mobile horizontal overflow", () => {
    expect(topNav).toContain("grid grid-cols-4");
    expect(topNav).toContain("min-w-0");
    expect(topNav).toContain("w-full");
  });

  it("preserves detail, check-in and participant/capacity operations", () => {
    expect(index).toContain("<DeskOperationalDetailDrawer");
    expect(index).toContain("setOpenDetail({ target: booking.detail_target, sourceItem: booking })");
    expect(today).toContain("checkInDeskBooking");
    expect(today).toContain("checkInActivityRegistration");
    expect(today).toContain("checkInBookingParticipant");
    expect(today).toContain("fetchActivityParticipants");
    expect(today).toContain("registered_count");
    expect(today).toContain("checked_in_count");
    expect(today).toContain("capacity");
  });
});
