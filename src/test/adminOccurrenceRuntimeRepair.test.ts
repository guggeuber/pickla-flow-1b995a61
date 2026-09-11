import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const apiAdmin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
const activityTime = readFileSync("supabase/functions/_shared/activity_session_time.ts", "utf8");
const genericOccurrence = readFileSync("supabase/functions/_shared/generic_activity_resource_conflicts.ts", "utf8");
const managedSeries = readFileSync("supabase/migrations/20260825120000_managed_series_admin_edit.sql", "utf8");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function transpile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function loadOccurrenceRuntime() {
  const timeSource = activityTime
    .replace(/^import .*?;\n/m, "")
    .replace(/export /g, "");
  const timeFactory = new Function(
    "DateTime",
    `${transpile(timeSource)}; return { activitySessionOccurrenceInterval };`,
  );
  const { activitySessionOccurrenceInterval } = timeFactory(DateTime) as {
    activitySessionOccurrenceInterval: (
      date: unknown,
      startTime: unknown,
      endTime: unknown,
    ) => { startISO: string; endISO: string; durationMinutes: number } | null;
  };

  const occurrenceSource = between(
    genericOccurrence,
    "function cleanDate",
    "export function nextSharedGenericActivityDate",
  ).replace(/export /g, "");
  const occurrenceFactory = new Function(
    `${transpile(occurrenceSource)}; return { genericActivityOccursOnDate };`,
  );
  const { genericActivityOccursOnDate } = occurrenceFactory() as {
    genericActivityOccursOnDate: (session: Record<string, unknown>, date: string) => boolean;
  };

  const adapterSource = between(
    apiAdmin,
    "function activitySessionOccursOnDate",
    "async function validateActivitySessionCourtAvailability",
  );
  const adapterFactory = new Function(
    "activitySessionOccurrenceInterval",
    "genericActivityOccursOnDate",
    `${transpile(adapterSource)}; return {
      activitySessionOccursOnDate,
      activitySessionOccurrenceRangeUtc,
    };`,
  );

  return adapterFactory(activitySessionOccurrenceInterval, genericActivityOccursOnDate) as {
    activitySessionOccursOnDate: (session: Record<string, unknown>, date: string) => boolean;
    activitySessionOccurrenceRangeUtc: (
      session: Record<string, unknown>,
      date: string,
    ) => { startISO: string; endISO: string; durationMinutes: number } | null;
  };
}

describe("api-admin activity occurrence runtime", () => {
  it("keeps the Operations Week and Capacity range adapter bound to the canonical interval primitive", () => {
    const runtime = loadOccurrenceRuntime();
    const range = runtime.activitySessionOccurrenceRangeUtc(
      { start_time: "18:00", end_time: "19:30" },
      "2026-08-10",
    );

    expect(range).toMatchObject({
      startISO: "2026-08-10T16:00:00.000Z",
      endISO: "2026-08-10T17:30:00.000Z",
      durationMinutes: 90,
    });
    expect(apiAdmin.match(/activitySessionOccurrenceRangeUtc\(effectiveSession, date\)/g)).toHaveLength(2);
    expect(apiAdmin).toContain("effectiveActivityOccurrenceForDate(session, date, scheduleVersions)");
  });

  it("returns an empty occurrence for invalid ranges and preserves venue-local DST conversion", () => {
    const runtime = loadOccurrenceRuntime();
    expect(runtime.activitySessionOccurrenceRangeUtc(
      { start_time: "18:00", end_time: "18:00" },
      "2026-08-10",
    )).toBeNull();

    const spring = runtime.activitySessionOccurrenceRangeUtc(
      { start_time: "01:30", end_time: "03:30" },
      "2026-03-29",
    );
    expect(spring).toMatchObject({
      startISO: "2026-03-29T00:30:00.000Z",
      endISO: "2026-03-29T01:30:00.000Z",
      durationMinutes: 60,
    });
  });

  it("keeps concrete and recurring occurrence eligibility on the existing calendar-date contract", () => {
    const runtime = loadOccurrenceRuntime();
    expect(runtime.activitySessionOccursOnDate({ session_date: "2026-08-10" }, "2026-08-10")).toBe(true);
    expect(runtime.activitySessionOccursOnDate({ session_date: "2026-08-10" }, "2026-08-11")).toBe(false);
    expect(runtime.activitySessionOccursOnDate({ session_date: null, recurrence_days: [1, 3] }, "2026-08-10")).toBe(true);
    expect(runtime.activitySessionOccursOnDate({ session_date: null, recurrence_days: [1, 3] }, "2026-08-11")).toBe(false);
  });

  it("excludes hidden and cancelled overrides from both operational projections", () => {
    const operations = between(apiAdmin, "async function buildOperationsWeekProjection", "async function capacityResponse");
    const capacity = between(apiAdmin, "async function capacityResponse", "async function analyzeOperationImpact");
    for (const projection of [operations, capacity]) {
      expect(projection).toContain("['hidden', 'cancelled'].includes(String(override?.status || ''))");
    }
  });

  it("continues to project bounded Series through their materialized concrete Sessions", () => {
    expect(managedSeries).toContain("LIMIT p_total_sessions");
    expect(managedSeries).toContain("dates.session_date");
    expect(managedSeries).toContain("series_occurrence_index");
    expect(apiAdmin).toContain("session.session_date");
    expect(apiAdmin).toContain("origin: session.series_id ? 'series' : 'activity'");
  });
});
