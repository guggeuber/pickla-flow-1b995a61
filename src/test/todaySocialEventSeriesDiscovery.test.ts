import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { projectPublicTodaySocialEventOccurrence } from "../../supabase/functions/_shared/today_primary";

const endpoint = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");

function parkerCandidate() {
  return {
    id: "parker-session",
    series_id: "parker-series",
    name: "Internal fallback title",
    session_date: "2026-09-05",
    start_time: "13:00:00",
    end_time: "18:00:00",
    capacity: 40,
    is_active: true,
    publish_status: "published",
    closed_to_public: true,
    customer_id: "must-not-leak",
    payer_customer_id: "must-not-leak",
    participant_customer_id: "must-not-leak",
    activity_series: {
      id: "parker-series",
      name: "Parker",
      series_type: "course",
      status: "active",
      registration_opens_at: "2026-08-19T22:00:00Z",
      registration_closes_at: "2026-09-05T11:30:00Z",
      image_urls: ["https://example.test/parker.webp", "https://example.test/ignored.webp"],
      auth_user_id: "must-not-leak",
      activity_formats: {
        name: "Parker Brunch",
        presentation_type: "social_event",
        image_urls: ["https://example.test/format.webp"],
        email: "must-not-leak@example.test",
      },
    },
    venues: {
      slug: "pickla-arena-sthlm",
      is_public: true,
      phone: "must-not-leak",
    },
  };
}

const projectionInput = {
  venueSlug: "pickla-arena-sthlm",
  startDate: "2026-09-04",
  endDate: "2026-09-10",
  asOf: new Date("2026-09-04T10:00:00Z"),
};

describe("Today social-event Series occurrence projection", () => {
  it("projects a Parker-shaped occurrence to the Series route and only exposes customer-safe fields", () => {
    const result = projectPublicTodaySocialEventOccurrence(parkerCandidate(), projectionInput);

    expect(result).toEqual({
      session_id: "parker-session",
      series_id: "parker-series",
      title: "Parker Brunch",
      session_date: "2026-09-05",
      start_time: "13:00:00",
      end_time: "18:00:00",
      capacity: 40,
      presentation_type: "social_event",
      registration_state: "open",
      image_urls: ["https://example.test/parker.webp"],
      route: "/course/parker-series?v=pickla-arena-sthlm",
    });
    expect(Object.keys(result || {}).sort()).toEqual([
      "capacity",
      "end_time",
      "image_urls",
      "presentation_type",
      "registration_state",
      "route",
      "series_id",
      "session_date",
      "session_id",
      "start_time",
      "title",
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["must-not-leak", "customer_id", "payer", "participant", "auth_user_id", "email", "phone"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("/program/");
  });

  it("derives canonical open, upcoming and closed registration states without hiding the occurrence", () => {
    const candidate = parkerCandidate();
    expect(projectPublicTodaySocialEventOccurrence(candidate, projectionInput)?.registration_state).toBe("open");
    expect(projectPublicTodaySocialEventOccurrence(candidate, {
      ...projectionInput,
      asOf: new Date("2026-08-19T10:00:00Z"),
    })?.registration_state).toBe("upcoming");
    expect(projectPublicTodaySocialEventOccurrence(candidate, {
      ...projectionInput,
      asOf: new Date("2026-09-05T12:00:00Z"),
    })?.registration_state).toBe("closed");
  });

  it.each([
    ["ordinary Course", (row: ReturnType<typeof parkerCandidate>) => { row.activity_series.activity_formats.presentation_type = "course"; }],
    ["League", (row: ReturnType<typeof parkerCandidate>) => { row.activity_series.series_type = "league"; }],
    ["inactive Series", (row: ReturnType<typeof parkerCandidate>) => { row.activity_series.status = "draft"; }],
    ["inactive occurrence", (row: ReturnType<typeof parkerCandidate>) => { row.is_active = false; }],
    ["unpublished occurrence", (row: ReturnType<typeof parkerCandidate>) => { row.publish_status = "draft"; }],
    ["private venue", (row: ReturnType<typeof parkerCandidate>) => { row.venues.is_public = false; }],
    ["wrong venue", (row: ReturnType<typeof parkerCandidate>) => { row.venues.slug = "other-venue"; }],
    ["outside date window", (row: ReturnType<typeof parkerCandidate>) => { row.session_date = "2026-09-11"; }],
  ])("rejects %s", (_label, mutate) => {
    const candidate = parkerCandidate();
    mutate(candidate);
    expect(projectPublicTodaySocialEventOccurrence(candidate, projectionInput)).toBeNull();
  });

  it("treats closed_to_public as a booking boundary, not a discovery filter", () => {
    const candidate = parkerCandidate();
    candidate.closed_to_public = false;
    expect(projectPublicTodaySocialEventOccurrence(candidate, projectionInput)?.route).toBe(
      "/course/parker-series?v=pickla-arena-sthlm",
    );
  });

  it("adds one bounded parallel query without weakening the ordinary session boundary", () => {
    const route = endpoint.slice(
      endpoint.indexOf("path === 'today-primary'"),
      endpoint.indexOf("path === 'first-visit-offers'"),
    );
    const seriesQuery = route.slice(
      route.indexOf("'series_occurrences'"),
      route.indexOf("measurePublicReadStage(readContext, 'events'"),
    );

    expect(route).toContain("await Promise.all([");
    expect(seriesQuery).toContain("client.from('activity_sessions')");
    expect(seriesQuery).not.toContain("closed_to_public");
    expect(seriesQuery).toContain(".eq('activity_series.series_type', 'course')");
    expect(seriesQuery).toContain(".eq('activity_series.status', 'active')");
    expect(seriesQuery).toContain(".eq('activity_series.activity_formats.presentation_type', 'social_event')");
    expect(seriesQuery).toContain(".eq('is_active', true)");
    expect(seriesQuery).toContain(".eq('publish_status', 'published')");
    expect(seriesQuery).toContain(".eq('venues.is_public', true)");
    expect(seriesQuery).toContain(".gte('session_date', startDate)");
    expect(seriesQuery).toContain(".lte('session_date', endDate)");
    expect(seriesQuery).not.toMatch(/customer|participant|payer|auth_user|email|phone|membership/i);
    expect(route).toContain(".eq('closed_to_public', false)");
    expect(route).toContain("projectPublicTodaySocialEventOccurrence");
    expect(route).toContain("seriesOccurrenceSessionIds");
    expect(route).toContain("!seriesOccurrenceSessionIds.has(String(session.id))");
    expect(route).not.toContain("/program/${series");
  });
});
