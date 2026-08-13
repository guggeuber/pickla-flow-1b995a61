import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkinsApi = readFileSync("supabase/functions/api-checkins/index.ts", "utf8");

function functionSource(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("self check-in public purchase options", () => {
  const purchaseOptions = functionSource(
    checkinsApi,
    "async function purchaseOptionsForVenue",
    "async function findActiveCheckin",
  );

  it("applies the canonical public visibility boundary to service-role activity reads", () => {
    expect(purchaseOptions).toContain(".eq('is_active', true)");
    expect(purchaseOptions).toContain(".eq('publish_status', 'published')");
    expect(purchaseOptions).toContain(".eq('closed_to_public', false)");
    expect(purchaseOptions).not.toMatch(/session_type\s*[!=]==?\s*['"]course['"]/);
  });

  it("keeps the self-check-in fallback on the filtered projection", () => {
    const selfCheckin = functionSource(
      checkinsApi,
      "// POST /api-checkins/self",
      "// POST /api-checkins/checkin",
    );
    expect(selfCheckin).toContain("purchase_options: await purchaseOptionsForVenue(serviceClient, venue)");
  });

  it("does not alter the staff-authorized concrete-session check-in path", () => {
    const staffCheckin = functionSource(
      checkinsApi,
      "// POST /api-checkins/checkin",
      "// GET /api-checkins/today",
    );
    expect(staffCheckin).toContain("canStaffOperateVenue(serviceClient, userId, venue_id)");
    expect(staffCheckin).toContain("String(entry_type || '') === 'session_ticket'");
    expect(staffCheckin).toContain("session_registrations");
  });
});
