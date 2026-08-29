import { describe, expect, it, vi } from "vitest";
import { activitySocialProof } from "../../supabase/functions/_shared/activity_social_proof";

type QueryResult = { data: unknown; error: null };
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  lte: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => QueryBuilder;
};
type ProofInputRow = {
  activity_session_id: string;
  session_date: string;
  status: string;
  user_id: string;
};

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "maybeSingle"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return builder as unknown as QueryBuilder;
}

function proofClient(sessionIds: string[], registrations: ProofInputRow[], interests: ProofInputRow[] = []) {
  const from = vi.fn((table: string) => {
    if (table === "venues") return query({ data: { id: "venue-1", slug: "pickla-arena-sthlm", is_public: true }, error: null });
    if (table === "activity_sessions") return query({ data: sessionIds.map((id) => ({ id })), error: null });
    if (table === "session_registrations") return query({ data: registrations, error: null });
    if (table === "activity_session_interests") return query({ data: interests, error: null });
    throw new Error(`Unexpected table ${table}`);
  });
  return { client: { from }, from };
}

function args(sessionIds: string[], userId: string | null = null) {
  return {
    venueSlug: "pickla-arena-sthlm",
    sessionIds,
    startDate: "2026-08-30",
    endDate: "2026-09-05",
    userId,
  };
}

describe("activity social-proof batching", () => {
  it.each([1, 5, 20])("uses four bounded queries for %i occurrences", async (occurrenceCount) => {
    const sessionIds = Array.from({ length: occurrenceCount }, (_, index) => `session-${index + 1}`);
    const registrations = sessionIds.map((activity_session_id) => ({
      activity_session_id,
      session_date: "2026-08-30",
      status: "confirmed",
      user_id: `private-user-${activity_session_id}`,
    }));
    const { client, from } = proofClient(sessionIds, registrations);

    const result = await activitySocialProof(client, args(sessionIds));

    expect(from).toHaveBeenCalledTimes(4);
    expect(result.occurrences).toHaveLength(occurrenceCount);
    expect(result.occurrences.every((row) => row.registrations_count === 1)).toBe(true);
  });

  it("returns only aggregate proof and the verified caller's registration state", async () => {
    const sessionIds = ["session-1", "session-2"];
    const registrations = [
      { activity_session_id: "session-1", session_date: "2026-08-30", status: "confirmed", user_id: "verified-user" },
      { activity_session_id: "session-1", session_date: "2026-08-30", status: "checked_in", user_id: "other-user" },
      { activity_session_id: "session-2", session_date: "2026-08-31", status: "pending", user_id: "verified-user" },
    ];
    const interests = [
      { activity_session_id: "session-1", session_date: "2026-08-30", status: "interested", user_id: "verified-user" },
    ];
    const { client } = proofClient(sessionIds, registrations, interests);

    const result = await activitySocialProof(client, args(sessionIds, "verified-user"));
    const serialized = JSON.stringify(result);

    expect(result.occurrences).toEqual([
      {
        activity_session_id: "session-1",
        session_date: "2026-08-30",
        registrations_count: 2,
        interested_count: 1,
        user_is_interested: true,
        user_registration_status: "confirmed",
      },
      {
        activity_session_id: "session-2",
        session_date: "2026-08-31",
        registrations_count: 0,
        interested_count: 0,
        user_is_interested: false,
        user_registration_status: "pending",
      },
    ]);
    expect(serialized).not.toContain("verified-user");
    expect(serialized).not.toContain("other-user");
    expect(serialized).not.toContain("display_name");
    expect(serialized).not.toContain("avatar_url");
  });
});
