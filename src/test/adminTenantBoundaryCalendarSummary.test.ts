import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  getAuthenticatedClient: vi.fn(),
  getServiceClient: vi.fn(),
}));

import {
  adminBookingDetailTarget,
  authorizeVenueScopedAdminRead,
  isVenueScopedAdminRead,
  projectAdminBookingSummary,
} from "../../supabase/functions/_shared/admin_read_security";
import { requireVenueRole } from "../../supabase/functions/_shared/authorization";

const VENUE_SCOPED_READ_PATHS = [
  "stats",
  "history",
  "zettle-status",
  "revenue-ledger",
  "capacity",
  "operations-week",
  "calendar",
  "booking-detail",
  "attention",
  "agent-inbox",
  "todays-plan",
  "venue",
  "staff",
  "courts",
  "venue-operation-overrides",
  "resource-blocks",
  "display-devices",
  "hours",
  "pricing",
  "products",
  "product-relationships",
  "activity-series",
  "activity-sessions",
  "links",
  "event-categories",
] as const;

function authorizationAdmin(activeVenueAdminRoles: Record<string, string[]>) {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.set(column, value); return query; },
        in() { return query; },
        limit() { return query; },
        async maybeSingle() {
          if (table === "user_roles") return { data: null, error: null };
          if (table === "venue_staff") {
            const userId = String(filters.get("user_id") || "");
            const venueId = String(filters.get("venue_id") || "");
            return { data: activeVenueAdminRoles[userId]?.includes(venueId) ? { id: "role-id" } : null, error: null };
          }
          throw new Error(`Unexpected authorization table: ${table}`);
        },
      };
      return query;
    },
  } as unknown as Parameters<typeof requireVenueRole>[0];
}

describe("api-admin tenant boundary", () => {
  it("treats every authenticated GET as venue-scoped except the two explicit account-level reads", () => {
    for (const path of VENUE_SCOPED_READ_PATHS) {
      expect(isVenueScopedAdminRead("GET", path), path).toBe(true);
    }
    expect(isVenueScopedAdminRead("GET", "check")).toBe(false);
    expect(isVenueScopedAdminRead("GET", "venues")).toBe(false);
    expect(isVenueScopedAdminRead("POST", "calendar")).toBe(false);
    expect(isVenueScopedAdminRead("GET", "future-admin-read")).toBe(true);
  });

  it("allows an admin of Venue A to read Venue A", async () => {
    const admin = authorizationAdmin({ "admin-a": ["venue-a"] });
    await expect(authorizeVenueScopedAdminRead({
      method: "GET",
      path: "calendar",
      venueId: "venue-a",
      authorizeVenue: (venueId) => requireVenueRole(admin, "admin-a", venueId, ["venue_admin"]),
    })).resolves.toBe(true);
  });

  it("denies an admin of Venue A from reading Venue B", async () => {
    const admin = authorizationAdmin({ "admin-a": ["venue-a"] });
    await expect(authorizeVenueScopedAdminRead({
      method: "GET",
      path: "calendar",
      venueId: "venue-b",
      authorizeVenue: (venueId) => requireVenueRole(admin, "admin-a", venueId, ["venue_admin"]),
    })).rejects.toThrow("Forbidden: venue role required");
  });

  it("denies an authenticated user without a venue-admin role", async () => {
    const admin = authorizationAdmin({ "admin-a": ["venue-a"] });
    await expect(authorizeVenueScopedAdminRead({
      method: "GET",
      path: "calendar",
      venueId: "venue-a",
      authorizeVenue: (venueId) => requireVenueRole(admin, "authenticated-outsider", venueId, ["venue_admin"]),
    })).rejects.toThrow("Forbidden: venue role required");
  });

  it("places the central guard before every venue-scoped route and reuses requireVenueRole", () => {
    const source = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
    const handler = source.slice(source.indexOf("Deno.serve"));
    const guardIndex = handler.indexOf("await authorizeVenueScopedAdminRead({");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(handler).toContain("if (!ok) return errorResponse('Forbidden: admin only', 403)");
    expect(handler).toContain(
      "authorizeVenue: (requestedVenueId) => requireVenueRole(admin, userId, requestedVenueId, ['venue_admin'])",
    );
    expect(handler).toContain("if (message.startsWith('Forbidden')) return errorResponse(message, 403)");

    for (const path of VENUE_SCOPED_READ_PATHS) {
      const routeIndex = handler.indexOf(`req.method === 'GET' && path === '${path}'`);
      expect(routeIndex, path).toBeGreaterThan(guardIndex);
    }
  });
});

describe("admin calendar least-privilege booking summary", () => {
  it("projects an explicit safe DTO even when the input contains customer and payment secrets", () => {
    const projected = projectAdminBookingSummary({
      id: "booking-summary-id",
      source_id: "booking-id",
      source_ids: ["booking-id"],
      date: "2026-09-09",
      time: "10:00",
      end_time: "11:00",
      title: "Bokning · Bana 1",
      kind: "court_booking",
      tone: "electric",
      moduleTarget: "bookings",
      courts: [{ id: "court-id", name: "Bana 1" }],
      court_name: "Bana 1",
      checked_in: false,
      checked_in_count: 0,
      detail_target: adminBookingDetailTarget("booking-id"),
      venue_id: "venue-a",
      customer_id: "customer-id",
      user_id: "user-id",
      customer_name: "Ada Lovelace",
      customer_phone: "+46700000000",
      customer_email: "ada@example.com",
      booking_refs: ["PRIVATE-REF"],
      amount_sek: 500,
      payment_status: "paid",
      payment_method: "card",
      receipt_number: "R-1",
      booking_receipt_id: "receipt-id",
      stripe_session_id: "cs_secret",
      access_code: "1234",
      notes: "private note",
    });

    expect(projected).toEqual({
      id: "booking-summary-id",
      source_id: "booking-id",
      date: "2026-09-09",
      time: "10:00",
      end_time: "11:00",
      title: "Bokning · Bana 1",
      kind: "court_booking",
      tone: "electric",
      moduleTarget: "bookings",
      courts: [{ id: "court-id", name: "Bana 1" }],
      court_name: "Bana 1",
      checked_in: false,
      checked_in_count: 0,
      detail_target: { kind: "booking_detail", source_id: "booking-id" },
    });
  });

  it("keeps sensitive fields in the explicit detail route and scopes its anchor and grouped reads", () => {
    const source = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
    const summaryStart = source.indexOf("async function groupedCourtBookingSummaryItems");
    const detailStart = source.indexOf("const ADMIN_BOOKING_DETAIL_SELECT", summaryStart);
    const detailRouteStart = source.indexOf("path === 'booking-detail'");
    const attentionRouteStart = source.indexOf("path === 'attention'", detailRouteStart);
    const summarySource = source.slice(summaryStart, detailStart);
    const detailSource = source.slice(detailStart, source.indexOf("async function activeBookableCourtResources", detailStart));
    const detailRoute = source.slice(detailRouteStart, attentionRouteStart);

    expect(summarySource).not.toMatch(/customer_(?:id|name|phone|email)|booking_refs|amount_sek|payment_status|payment_method|receipt_number|booking_receipt_id|checked_in_at|notes/);
    expect(summarySource).not.toContain("booked_by");
    expect(summarySource).toContain("return projectAdminBookingSummary({");
    expect(detailSource).toMatch(/customer_phone|customer_email|access_code|payment_status|receipt_number/);
    expect(detailSource).toContain(".eq('id', bookingId)");
    expect(detailSource).toContain(".eq('venue_id', venueId)");
    expect(detailRoute).toContain("groupedCourtBookingDetail(admin, venueId!, bookingId)");
    expect(detailRoute).toContain("Booking not found");
    expect(detailRoute).toContain("jsonResponse(detail, 200, 0)");
  });

  it("does not embed booking detail in Capacity or Operations Week projections", () => {
    const source = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
    const projectionStart = source.indexOf("async function buildOperationsWeekProjection");
    const capacityStart = source.indexOf("async function capacityResponse", projectionStart);
    const handlerStart = source.indexOf("Deno.serve", capacityStart);
    const projectionSources = source.slice(projectionStart, handlerStart);

    expect(projectionSources).not.toContain("kind: 'booking_drawer'");
    expect(projectionSources).not.toContain("booking: {");
    expect(projectionSources).toContain("detail_target: adminBookingDetailTarget(first.id)");
  });
});
