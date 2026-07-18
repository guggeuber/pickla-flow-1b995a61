import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  projectPublicEventParticipants,
  projectPublicVenueDisplayQueue,
} from "../../supabase/functions/_shared/security_projections";

const repairAMigration = readFileSync(
  "supabase/migrations/20260716120000_repair_active_personal_data_exposure.sql",
  "utf8",
);
const eventApiSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const checkinApiSource = readFileSync("supabase/functions/api-checkins/index.ts", "utf8");
const eventCardSource = readFileSync("src/components/hub/EventCard.tsx", "utf8");
const myPageSource = readFileSync("src/pages/MyPage.tsx", "utf8");
const venueDisplaySource = readFileSync("src/pages/VenueDisplay.tsx", "utf8");

function routeSource(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Repair A — active personal-data exposure", () => {
  it("removes anonymous players and venue_checkins policies without reopening either table", () => {
    expect(repairAMigration).toContain('DROP POLICY IF EXISTS "Public can read players" ON public.players');
    expect(repairAMigration).toContain('DROP POLICY IF EXISTS "Anon can read recent venue_checkins" ON public.venue_checkins');
    expect(repairAMigration).toContain('DROP POLICY IF EXISTS "Public can count checkins" ON public.venue_checkins');
    expect(repairAMigration).not.toMatch(/CREATE\s+POLICY/i);
    expect(repairAMigration).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(repairAMigration).not.toContain('DROP POLICY IF EXISTS "Staff manages venue checkins"');
    expect(repairAMigration).not.toContain('DROP POLICY IF EXISTS "Admin can manage players"');
  });

  it("projects event social proof without auth IDs or contact data", () => {
    const result = projectPublicEventParticipants(
      [{
        id: "internal-player-id",
        name: "  Safe Player  ",
        auth_user_id: "auth-user-id",
        email: "private@example.test",
        phone: "+46000000000",
      }],
      new Map([["auth-user-id", "https://example.test/avatar.png"]]),
    );

    expect(result).toEqual([{
      display_name: "Safe Player",
      avatar_url: "https://example.test/avatar.png",
    }]);
    expect(JSON.stringify(result)).not.toMatch(/auth_user_id|email|phone|internal-player-id/);
  });

  it("projects only the two fields required by the public Venue Display queue", () => {
    const result = projectPublicVenueDisplayQueue([
      {
        id: "internal-checkin-id",
        user_id: "private-user-id",
        customer_id: "private-customer-id",
        player_name: "  Queue Player  ",
        player_phone: "+46000000000",
        checked_in_by: "private-staff-id",
        checked_in_at: "2026-07-16T10:00:00Z",
        entry_type: "open_play",
        entitlement_id: "private-entitlement-id",
      },
      {
        player_name: "Manual Walkup",
        checked_in_at: "2026-07-16T10:05:00Z",
        entry_type: "manual",
        entitlement_id: null,
      },
      {
        player_name: "Not Public Queue",
        checked_in_at: "2026-07-16T10:10:00Z",
        entry_type: "booking",
        entitlement_id: "booking-id",
      },
    ]);

    expect(result).toEqual([
      { display_name: "Queue Player", checked_in_at: "2026-07-16T10:00:00Z" },
      { display_name: "Manual Walkup", checked_in_at: "2026-07-16T10:05:00Z" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/user_id|customer_id|phone|checked_in_by|entitlement|internal/);
  });

  it("moves every frontend consumer off direct players and venue_checkins reads", () => {
    expect(eventCardSource).not.toContain('.from("players")');
    expect(eventCardSource).toContain('"event-participants"');
    expect(eventCardSource).toContain("{playerCount} anmälda");
    expect(myPageSource).not.toContain('.from("players")');
    expect(myPageSource).toContain('"my-registrations"');
    expect(venueDisplaySource).not.toContain('.from("venue_checkins")');
    expect(venueDisplaySource).not.toContain('table: "venue_checkins"');
    expect(venueDisplaySource).toContain('"public-display-queue"');
    expect(venueDisplaySource).toContain("refetchInterval: 30_000");
  });

  it("preserves the authenticated My Registrations handler from Release 1", () => {
    const handler = routeSource(
      eventApiSource,
      "async function handleMyRegistrations",
      "async function verifyResendWebhook",
    );
    expect(handler).toContain("getAuthenticatedClient(req)");
    expect(handler).toContain(".eq('auth_user_id', userId)");
    expect(handler).toContain("client.auth.admin.getUserById(userId)");
    expect(handler).toContain("verifiedAuthIdentifiers(authUserData?.user)");
    expect(handler).not.toContain("player_profiles').select('phone'");
    expect(handler).not.toContain("url.searchParams.get('userId')");
    expect(handler).toContain("const selectFields = 'id, event_id, name, created_at,");
    expect(handler).not.toMatch(/selectFields\s*=.*auth_user_id/);
    expect(handler).not.toMatch(/selectFields\s*=.*email/);
    expect(eventApiSource).toContain("return handleMyRegistrations(req, client)");
  });

  it("keeps event-public projections safe and event registration functional", () => {
    const participantsRoute = routeSource(eventApiSource, "path === 'event-participants'", "path === 'my-registrations'");
    expect(participantsRoute).toContain(".eq('is_public', true)");
    expect(participantsRoute).toContain("projectPublicEventParticipants");
    expect(participantsRoute).toContain("current_user_registered");

    const registerRoute = routeSource(eventApiSource, "path === 'register'", "return errorResponse('Not found'");
    expect(registerRoute).toContain("client.from('players')");
    expect(registerRoute).toContain("let authUserId: string | null = await getOptionalUserId(req)");
    expect(registerRoute).toContain("if (!authUserId && phone)");
    expect(registerRoute).toContain("return jsonResponse({ success: true }, 201)");
    expect(registerRoute).not.toContain("jsonResponse({ success: true, player }");
  });

  it("keeps operational player lookup staff-authorized and staff check-in policy intact", () => {
    const playersRoute = routeSource(checkinApiSource, "path === 'players'", "path === 'toggle'");
    expect(playersRoute).toContain("getServiceClient()");
    expect(playersRoute).toContain("canStaffOperateVenue(serviceClient, authUserId, event.venue_id)");
    expect(playersRoute).toContain("if (!canOperate) return errorResponse('Forbidden', 403)");
    expect(checkinApiSource).toContain("path === 'today'");
  });
});
