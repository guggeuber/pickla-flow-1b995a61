import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertCourseParticipantIdentity,
  assertCourseParticipantRequest,
  resolveCourseParticipantPolicy,
} from "../../supabase/functions/_shared/course_participant_policy";
import { projectPublicCourseCoaches } from "../../supabase/functions/_shared/course_coach_projection";

const read = (path: string) => readFileSync(path, "utf8");

describe("Course participant policy", () => {
  it("defaults existing offers to the released flexible participant behavior", () => {
    expect(resolveCourseParticipantPolicy({})).toBe("self_adult_or_dependent");
    expect(assertCourseParticipantRequest({ policy: "self_adult_or_dependent", participantType: "adult", userId: null })).toBe("adult");
    expect(assertCourseParticipantRequest({ policy: "self_adult_or_dependent", participantType: "dependent", userId: "guardian" })).toBe("dependent");
  });

  it.each(["adult", "dependent"])("rejects manipulated %s participation for self-only", (participantType) => {
    expect(() => assertCourseParticipantRequest({
      policy: "self_only",
      participantType,
      userId: "verified-user",
    })).toThrow("course_participant_policy_violation");
  });

  it("requires a verified purchaser and rejects hidden delegated identity input", () => {
    expect(() => assertCourseParticipantRequest({
      policy: "self_only",
      participantType: "self",
      userId: null,
    })).toThrow("course_self_only_requires_verified_purchaser");
    expect(() => assertCourseParticipantRequest({
      policy: "self_only",
      participantType: "self",
      userId: "verified-user",
      hasDelegatedInput: true,
    })).toThrow("course_participant_policy_violation");
  });

  it("maps verified purchaser, participant and pricing principal to the same Customer", () => {
    expect(() => assertCourseParticipantIdentity({
      policy: "self_only",
      participantType: "self",
      userId: "verified-user",
      payerCustomerId: "customer-1",
      participantCustomerId: "customer-1",
      dependentParticipantId: null,
      beneficiaryUserId: "verified-user",
    })).not.toThrow();
    expect(() => assertCourseParticipantIdentity({
      policy: "self_only",
      participantType: "self",
      userId: "verified-user",
      payerCustomerId: "customer-1",
      participantCustomerId: "customer-2",
      dependentParticipantId: null,
      beneficiaryUserId: "verified-user",
    })).toThrow("course_participant_identity_mismatch");
  });

  it("keeps delegated adult and guardian-dependent identity shapes intact for configured offers", () => {
    expect(() => assertCourseParticipantIdentity({
      policy: "self_or_adult",
      participantType: "adult",
      userId: "payer-user",
      payerCustomerId: "payer-customer",
      participantCustomerId: "adult-customer",
      dependentParticipantId: null,
    })).not.toThrow();
    expect(() => assertCourseParticipantIdentity({
      policy: "self_adult_or_dependent",
      participantType: "dependent",
      userId: "guardian-user",
      payerCustomerId: "guardian-customer",
      participantCustomerId: null,
      dependentParticipantId: "dependent-1",
    })).not.toThrow();
  });

  it("enforces before identity creation, again during checkout resolution and during paid fulfillment", () => {
    const commerce = read("supabase/functions/api-commerce/index.ts");
    const webhook = read("supabase/functions/api-stripe-webhook/index.ts");
    const cart = commerce.slice(commerce.indexOf("async function createCourseCart"), commerce.indexOf("async function validateCartItems"));
    expect(cart.indexOf("assertCourseParticipantRequest")).toBeLessThan(cart.indexOf("resolveOrCreateCustomerIdForUser"));
    expect(cart.indexOf("assertCourseParticipantRequest")).toBeLessThan(cart.indexOf("dependent_participants').insert"));
    expect(commerce).toContain("await assertCurrentCourseParticipantIdentity(admin");
    const paidCourse = webhook.slice(webhook.indexOf("purchaseKind === 'course'"), webhook.indexOf("p_metadata: {", webhook.indexOf("purchaseKind === 'course'")));
    expect(paidCourse).toContain("await assertCurrentCourseParticipantIdentity(serviceClient");
    expect(paidCourse.indexOf("assertCurrentCourseParticipantIdentity")).toBeLessThan(paidCourse.indexOf("commit_series_participant_capacity"));
  });

  it("uses offer resolver configuration and contains no Pickla Next name branch or migration", () => {
    const coursePage = read("src/pages/CourseSeriesPage.tsx");
    const coursesApi = read("supabase/functions/api-courses/index.ts");
    expect(coursePage).not.toContain("Pickla Next");
    expect(coursesApi).not.toContain("Pickla Next");
    expect(coursesApi).toContain("participant_policy: participantPolicy");
    expect(coursesApi).toContain("path === 'series-participant-policy'");
    expect(coursesApi).toContain("order_history_count");
  });
});

describe("public Course coach projection", () => {
  const sessions = ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01"].map((date, index) => ({
    id: `session-${index + 1}`,
    session_date: date,
    requires_staffing: true,
    is_active: true,
    publish_status: "published",
  }));
  const assignment = (sessionIndex: number, staffId: string) => ({
    source_id: `session-${sessionIndex + 1}`,
    occurrence_date: sessions[sessionIndex].session_date,
    venue_staff_id: staffId,
  });

  it("derives one named coach across every canonical occurrence and exposes display name only", () => {
    const result = projectPublicCourseCoaches({
      sessions,
      assignments: sessions.map((_, index) => assignment(index, "staff-gunnar")),
      staff: [{ id: "staff-gunnar", user_id: "auth-gunnar" }],
      profiles: [{ auth_user_id: "auth-gunnar", display_name: "Gunnar Svalander", email: "private@example.test", phone: "0700000000" } as never],
    });
    expect(result).toEqual({
      coverage: "complete",
      mode: "single",
      coaches: [{ display_name: "Gunnar Svalander" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/staff-gunnar|auth-gunnar|private@example|0700000000/);
  });

  it("does not falsely claim one owner when instructors differ or coverage is incomplete", () => {
    const split = projectPublicCourseCoaches({
      sessions,
      assignments: sessions.map((_, index) => assignment(index, index < 2 ? "staff-a" : "staff-b")),
      staff: [{ id: "staff-a", user_id: "auth-a" }, { id: "staff-b", user_id: "auth-b" }],
      profiles: [{ auth_user_id: "auth-a", display_name: "Anna Andersson" }, { auth_user_id: "auth-b", display_name: "Bertil Berg" }],
    });
    expect(split.mode).toBe("multiple");
    expect(split.coaches).toEqual([{ display_name: "Anna Andersson" }, { display_name: "Bertil Berg" }]);

    const partial = projectPublicCourseCoaches({
      sessions,
      assignments: [assignment(0, "staff-a")],
      staff: [{ id: "staff-a", user_id: "auth-a" }],
      profiles: [{ auth_user_id: "auth-a", display_name: "Anna Andersson" }],
    });
    expect(partial).toEqual({ coverage: "partial", mode: "unassigned", coaches: [] });
  });

  it("uses existing occurrence staffing without a coach field, name hardcode or extra client request", () => {
    const coursesApi = read("supabase/functions/api-courses/index.ts");
    const coursePage = read("src/pages/CourseSeriesPage.tsx");
    expect(coursesApi).toContain("operational_staff_assignments");
    expect(coursesApi).toContain(".eq('role', 'instructor')");
    expect(coursesApi).toContain("player_profiles");
    expect(coursesApi).not.toContain("Gunnar Svalander");
    expect(coursePage).not.toContain("Gunnar Svalander");
    expect(coursePage).not.toMatch(/fetch.*coach|useQuery.*coach/i);
  });
});
