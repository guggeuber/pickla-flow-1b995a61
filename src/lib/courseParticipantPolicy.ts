export const COURSE_PARTICIPANT_POLICIES = [
  "self_only",
  "self_or_adult",
  "self_adult_or_dependent",
  "dependent_only",
] as const;

export type CourseParticipantPolicy = typeof COURSE_PARTICIPANT_POLICIES[number];
export type CourseParticipantType = "self" | "adult" | "dependent";

export const DEFAULT_COURSE_PARTICIPANT_POLICY: CourseParticipantPolicy = "self_adult_or_dependent";

export const COURSE_PARTICIPANT_POLICY_OPTIONS: Array<{ value: CourseParticipantPolicy; label: string }> = [
  { value: "self_only", label: "Endast köparen själv" },
  { value: "self_or_adult", label: "Köparen eller annan vuxen" },
  { value: "self_adult_or_dependent", label: "Köparen, annan vuxen eller barn" },
  { value: "dependent_only", label: "Endast barn som köparen ansvarar för" },
];

export function resolveCourseParticipantPolicy(resolverRules: unknown): CourseParticipantPolicy {
  if (!resolverRules || typeof resolverRules !== "object" || Array.isArray(resolverRules)) {
    return DEFAULT_COURSE_PARTICIPANT_POLICY;
  }
  const configured = (resolverRules as Record<string, unknown>).participant_policy;
  return COURSE_PARTICIPANT_POLICIES.includes(configured as CourseParticipantPolicy)
    ? configured as CourseParticipantPolicy
    : DEFAULT_COURSE_PARTICIPANT_POLICY;
}

export function courseParticipantOptions(policy: CourseParticipantPolicy): CourseParticipantType[] {
  if (policy === "self_only") return ["self"];
  if (policy === "self_or_adult") return ["self", "adult"];
  if (policy === "dependent_only") return ["dependent"];
  return ["self", "adult", "dependent"];
}

export function defaultCourseParticipantPolicyForAgeGroup(ageGroup: unknown): CourseParticipantPolicy {
  return ageGroup === "youth" ? "dependent_only" : DEFAULT_COURSE_PARTICIPANT_POLICY;
}
