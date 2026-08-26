import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLeagueResourcePreview,
  presentLeagueResourceOwner,
  type CanonicalResourceConflict,
  type CanonicalResourcePreviewRow,
} from "../../supabase/functions/_shared/league_resource_preview";

const leagueApi = readFileSync("supabase/functions/api-leagues/index.ts", "utf8");
const canonicalResolver = readFileSync("supabase/migrations/20260813130000_course_resource_conflict_guard.sql", "utf8");
const leagueCreate = readFileSync("supabase/migrations/20260827122000_league_v1_play.sql", "utf8");

const dates = ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"];
const courts = ["court-1", "court-2", "court-3"];

function conflict(sourceType: string, sourceId: string, title: string): CanonicalResourceConflict {
  return {
    source_type: sourceType,
    source_id: sourceId,
    title,
    starts_at: "2026-09-10T16:00:00Z",
    ends_at: "2026-09-10T18:00:00Z",
  };
}

function rowsFor(date: string, conflictsByCourt: Record<string, CanonicalResourceConflict[]> = {}): CanonicalResourcePreviewRow[] {
  return courts.map((courtId, index) => {
    const conflicts = conflictsByCourt[courtId] || [];
    return {
      occurrence_index: 1,
      occurrence_date: date,
      proposed_starts_at: `${date}T16:00:00Z`,
      proposed_ends_at: `${date}T18:00:00Z`,
      court_id: courtId,
      court_name: `Bana ${index + 1}`,
      is_available: conflicts.length === 0,
      conflicts,
    };
  });
}

describe("League resource preflight contracts", () => {
  it("returns all conflicts across all five concrete nights in one privacy-safe projection", () => {
    const rows = dates.map((date) => rowsFor(date));
    rows[0] = rowsFor(dates[0], { "court-1": [conflict("booking", "booking-secret-id", "Customer Person Name")] });
    rows[2] = rowsFor(dates[2], { "court-2": [conflict("activity_session", "open-play-id", "Open Play Kväll")] });
    rows[4] = rowsFor(dates[4], { "court-3": [conflict("event_reservation", "event-block-id", "Företagsevent")] });

    const preview = buildLeagueResourcePreview(dates, rows, new Map([["open-play-id", "open_play"]]));

    expect(preview.has_conflicts).toBe(true);
    expect(preview.nights.map((night) => night.status)).toEqual(["conflict", "clear", "conflict", "clear", "conflict"]);
    expect(preview.nights.flatMap((night) => night.courts).flatMap((court) => court.conflicts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner_type: "booking", owner_label: "Banbokning", owner_name: null }),
      expect.objectContaining({ owner_type: "open_play", owner_label: "Open Play", owner_name: "Open Play Kväll" }),
      expect.objectContaining({ owner_type: "event", owner_label: "Event", owner_name: "Företagsevent" }),
    ]));
    expect(JSON.stringify(preview)).not.toContain("booking-secret-id");
    expect(JSON.stringify(preview)).not.toContain("Customer Person Name");
    expect(JSON.stringify(preview)).not.toContain("source_id");
  });

  it("maps Course, League, generic activity, event block, and closure owners without inventing occupancy", () => {
    const activity = conflict("activity_session", "session-id", "Pickla Start");
    expect(presentLeagueResourceOwner(activity, "course")).toMatchObject({ owner_type: "course", owner_label: "Kurs", owner_name: "Pickla Start" });
    expect(presentLeagueResourceOwner({ ...activity, title: "Season 02" }, "league")).toMatchObject({ owner_type: "league", owner_label: "Seriespel", owner_name: "Season 02" });
    expect(presentLeagueResourceOwner({ ...activity, title: "Singelträning" }, "training")).toMatchObject({ owner_type: "activity", owner_label: "Aktivitet" });
    expect(presentLeagueResourceOwner(conflict("resource_block", "block-id", "Underhåll"))).toMatchObject({ owner_type: "resource_block", owner_label: "Resursblockering" });
    expect(presentLeagueResourceOwner(conflict("venue_closure", "closure-id", "Stängt"))).toMatchObject({ owner_type: "venue_closure", owner_label: "Driftstopp" });
  });

  it("uses the canonical bounded resolver for each exact date and keeps preview read-only", () => {
    const previewPath = leagueApi.slice(
      leagueApi.indexOf("async function previewLeagueResourcePlan"),
      leagueApi.indexOf("function leagueConflictResponse"),
    );
    expect(previewPath).toContain("input.nightDates.map");
    expect(previewPath).toContain("admin.rpc('preview_course_resource_schedule'");
    expect(previewPath).toContain("p_start_date: date");
    expect(previewPath).toContain("p_end_date: date");
    expect(previewPath).toContain("p_total_sessions: 1");
    expect(previewPath).not.toMatch(/\.insert\(|\.update\(|\.delete\(|create_league_season_v1/);
    expect(leagueApi).toContain("path === 'resource-preview'");
    expect(leagueApi).toContain("['venue_admin']");
  });

  it("keeps the canonical resource universe, Stockholm semantics, and half-open boundary doctrine", () => {
    expect(canonicalResolver).toContain("COALESCE(NULLIF(venue.timezone, ''), 'Europe/Stockholm')");
    expect(canonicalResolver).toContain("JOIN public.bookings booking");
    expect(canonicalResolver).toContain("FROM proposed\n  JOIN public.activity_sessions session");
    expect(canonicalResolver).toContain("session.publish_status = 'published'");
    expect(canonicalResolver).toContain("override.status = 'cancelled'");
    expect(canonicalResolver).toContain("JOIN public.event_resource_blocks block");
    expect(canonicalResolver).toContain("JOIN public.venue_operation_overrides override");
    expect(canonicalResolver).toContain("booking.start_time < proposed.ends_at");
    expect(canonicalResolver).toContain("booking.end_time > proposed.starts_at");
  });

  it("retains the transactional create guard, emits a structured race conflict, and preflights before writes", () => {
    const createRoute = leagueApi.slice(
      leagueApi.indexOf("path === 'create'"),
      leagueApi.indexOf("path === 'publish-offer'"),
    );
    expect(createRoute).toContain("create_league_season_v1");
    expect(createRoute).toContain("managed_series_resource_conflict");
    expect(createRoute).toContain("leagueConflictResponse");
    expect(leagueApi).toContain("code: 'managed_series_resource_conflict'");
    expect(leagueApi).not.toContain("return errorResponse('managed_series_resource_conflict'");
    expect(leagueCreate.indexOf("preview_course_resource_schedule")).toBeLessThan(leagueCreate.indexOf("INSERT INTO public.access_products"));
    expect(leagueCreate.indexOf("preview_course_resource_schedule")).toBeLessThan(leagueCreate.indexOf("INSERT INTO public.activity_series"));
  });
});
