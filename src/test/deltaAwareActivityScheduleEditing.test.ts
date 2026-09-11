import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const migration = readFileSync("supabase/migrations/20260911120000_delta_aware_activity_schedule_editing.sql", "utf8");
const scheduleRuntime = readFileSync("supabase/functions/_shared/activity_schedule_versions.ts", "utf8");
const genericOccurrence = readFileSync("supabase/functions/_shared/generic_activity_resource_conflicts.ts", "utf8");
const physicalRuntime = readFileSync("supabase/functions/_shared/physical_availability.ts", "utf8");
const admin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const eventPublic = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const adminSchedule = readFileSync("src/components/admin/AdminSchedule.tsx", "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function transpile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadScheduleRuntime() {
  const genericSource = between(
    genericOccurrence,
    "function cleanDate",
    "export function nextSharedGenericActivityDate",
  ).replaceAll("export ", "");
  const genericFactory = new Function(`${transpile(genericSource)}; return { genericActivityOccursOnDate };`);
  const { genericActivityOccursOnDate } = genericFactory();

  const runtimeSource = scheduleRuntime
    .replace(/^import .*?;\n/m, "")
    .replaceAll("export ", "");
  const factory = new Function(
    "genericActivityOccursOnDate",
    `${transpile(runtimeSource)}; return {
      activityScheduleVersionsBySession,
      effectiveActivityScheduleForDate,
      effectiveActivityOccurrenceForDate,
    };`,
  );
  return factory(genericActivityOccursOnDate) as {
    activityScheduleVersionsBySession: (versions: Array<Record<string, unknown>>) => Map<string, Array<Record<string, unknown>>>;
    effectiveActivityScheduleForDate: (session: Record<string, unknown>, date: string, versions: Map<string, Array<Record<string, unknown>>>) => Record<string, unknown> | null;
    effectiveActivityOccurrenceForDate: (session: Record<string, unknown>, date: string, versions: Map<string, Array<Record<string, unknown>>>) => Record<string, unknown> | null;
  };
}

function loadDeltaClientRuntime() {
  const source = between(
    physicalRuntime,
    "export async function checkPhysicalActivityScheduleDelta",
    "export async function claimPhysicalResourceBlocks",
  ).replaceAll("export ", "");
  const factory = new Function(
    "PhysicalAvailabilityLookupError",
    "uniqueIds",
    `${transpile(source)}; return { checkPhysicalActivityScheduleDelta };`,
  );
  class PhysicalAvailabilityLookupError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PhysicalAvailabilityLookupError";
    }
  }
  return factory(
    PhysicalAvailabilityLookupError,
    (values: unknown[]) => [...new Set((values || []).map(String).filter(Boolean))],
  ) as {
    checkPhysicalActivityScheduleDelta: (client: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}

describe("delta-aware activity schedule editing", () => {
  it("persists effective-dated schedule identity without materializing occurrence rows", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.activity_session_schedule_versions");
    for (const field of [
      "effective_from DATE NOT NULL",
      "effective_until DATE",
      "series_start_date DATE",
      "series_end_date DATE",
      "series_total_sessions INTEGER",
      "recurrence_days INTEGER[]",
      "court_ids UUID[]",
    ]) expect(migration).toContain(field);
    expect(migration).toContain("UNIQUE (activity_session_id, effective_from)");
    expect(migration).toContain("idx_activity_session_schedule_versions_open");
    expect(migration).not.toMatch(/CREATE TABLE[^;]*activity_session_occurrences/i);
  });

  it("classifies only added dates, courts, and half-open time slices as new physical claims", () => {
    const delta = between(
      migration,
      "CREATE OR REPLACE FUNCTION public.check_physical_activity_schedule_delta",
      "REVOKE ALL ON FUNCTION public.check_physical_activity_schedule_delta",
    );
    expect(delta).toContain("WHERE NOT v_old_owns_court");
    expect(delta).toContain("WHERE v_old_owns_court AND v_new_start < v_old_start");
    expect(delta).toContain("WHERE v_old_owns_court AND v_new_end > v_old_end");
    expect(delta).toContain("public.check_physical_availability(");
    expect(delta).toContain("p_session_id,\n          v_date,\n          NULL");
    expect(delta).toContain("'interval_semantics', '[start,end)'");
  });

  it("grandfathers unchanged claims, permits removals, and makes writes atomic", () => {
    const guard = between(
      migration,
      "CREATE OR REPLACE FUNCTION public.guard_activity_session_physical_claim",
      "REVOKE ALL ON FUNCTION public.guard_activity_session_physical_claim",
    );
    expect(guard).toContain("v_result := public.check_physical_activity_schedule_delta");
    expect(guard).toContain("MESSAGE = CASE WHEN NEW.session_type IN ('course', 'league')");
    expect(guard).toContain("INSERT INTO public.activity_session_schedule_versions");
    expect(guard).toContain("RETURN NEW;");
    expect(guard).not.toMatch(/UPDATE public\.session_registrations|DELETE FROM public\.session_registrations/);
  });

  it("enforces a prospective venue-local boundary and does not rewrite history", () => {
    expect(migration).toContain("v_today := (now() AT TIME ZONE v_timezone)::DATE");
    expect(migration).toContain("v_effective_from < v_today + 1");
    expect(migration).toContain("effective_until = v_effective_from");
    expect(admin).toContain("plus({ days: 1 }).toISODate()");
    expect(adminSchedule).toContain("Tidigare förekomster lämnas oförändrade");
  });

  it("resolves old and new definitions by occurrence date, including original Series bounds", () => {
    const runtime = loadScheduleRuntime();
    const versions = runtime.activityScheduleVersionsBySession([
      {
        activity_session_id: "session-a",
        effective_from: "2026-01-01",
        effective_until: "2026-09-12",
        recurrence_days: [1, 6],
        start_time: "14:00",
        end_time: "16:00",
        court_ids: ["court-old"],
        is_active: true,
        publish_status: "published",
      },
      {
        activity_session_id: "session-a",
        effective_from: "2026-09-12",
        recurrence_days: [1],
        start_time: "14:00",
        end_time: "16:00",
        court_ids: ["court-new"],
        is_active: true,
        publish_status: "published",
      },
    ]);
    const current = { id: "session-a", schedule_effective_from: "2026-09-12", recurrence_days: [1], start_time: "14:00", end_time: "16:00", court_ids: ["court-new"] };

    expect(runtime.effectiveActivityOccurrenceForDate(current, "2026-09-05", versions)?.court_ids).toEqual(["court-old"]);
    expect(runtime.effectiveActivityOccurrenceForDate(current, "2026-09-14", versions)?.court_ids).toEqual(["court-new"]);
    expect(runtime.effectiveActivityOccurrenceForDate(current, "2026-09-19", versions)).toBeNull();

    const boundedVersions = runtime.activityScheduleVersionsBySession([{
      activity_session_id: "series-session",
      effective_from: "2026-09-01",
      series_id: "series-a",
      series_start_date: "2026-09-01",
      series_end_date: "2026-12-31",
      series_total_sessions: 2,
      recurrence_days: [1, 3],
      start_time: "17:00",
      end_time: "18:00",
      is_active: true,
      publish_status: "published",
    }]);
    const bounded = { id: "series-session", schedule_effective_from: "2026-09-01" };
    expect(runtime.effectiveActivityOccurrenceForDate(bounded, "2026-09-02", boundedVersions)).not.toBeNull();
    expect(runtime.effectiveActivityOccurrenceForDate(bounded, "2026-09-07", boundedVersions)).not.toBeNull();
    expect(runtime.effectiveActivityOccurrenceForDate(bounded, "2026-09-09", boundedVersions)).toBeNull();
  });

  it("routes Calendar, Operations, Capacity, Desk, Today and public detail through the dated resolver", () => {
    for (const source of [admin, bookings, eventPublic]) {
      expect(source).toContain("activity_session_schedule_versions");
      expect(source).toContain("effectiveActivityOccurrenceForDate");
    }
    expect(admin.match(/effectiveActivityOccurrenceForDate\(session, date, scheduleVersions\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(bookings).toContain("effectiveActivityScheduleForDate(baseSession, registration.session_date");
    expect(eventPublic).toContain("effectiveActivityOccurrenceForDate(baseSession, occurrenceDate, versions)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_session_public_context");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_session_social_context_batch");
  });

  it("fails closed when the canonical delta decision cannot be read", async () => {
    const runtime = loadDeltaClientRuntime();
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "lookup unavailable" } }) };
    await expect(runtime.checkPhysicalActivityScheduleDelta(client, {
      venueId: "venue-a",
      sessionId: "session-a",
      effectiveFrom: "2026-09-12",
      oldSchedule: {},
      newSchedule: {},
    })).rejects.toMatchObject({ name: "PhysicalAvailabilityLookupError", message: "lookup unavailable" });
    expect(admin).toContain("code: 'physical_availability_unavailable'");
    expect(admin).toContain("Inga schemaändringar sparades");
  });

  it("returns structured, PII-free conflicts and renders actionable Admin feedback", () => {
    const decorator = between(admin, "async function decorateActivityScheduleConflicts", "async function validateActivitySessionScheduleDelta");
    for (const field of ["occurrence_date", "starts_at", "ends_at", "resource_id", "court_name", "type"]) {
      expect(decorator).toContain(field);
    }
    expect(decorator).not.toMatch(/customer|email|phone|access_code|stripe|receipt|payment/i);
    expect(adminSchedule).toContain("activityScheduleConflictSummary");
    expect(adminSchedule).toContain("ACTIVITY_CONFLICT_LABELS");
    expect(adminSchedule).toContain('role="alert"');
  });
});
