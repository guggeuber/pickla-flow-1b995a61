type CourseStaffingSession = {
  id: unknown;
  session_date: unknown;
  requires_staffing: unknown;
  is_active: unknown;
  publish_status: unknown;
};

type CourseInstructorAssignment = {
  source_id: unknown;
  occurrence_date: unknown;
  venue_staff_id: unknown;
};

type CourseVenueStaff = { id: unknown; user_id: unknown };
type CourseStaffProfile = { auth_user_id: unknown; display_name: unknown };

export type PublicCourseCoachProjection = {
  coverage: 'complete' | 'partial' | 'none';
  mode: 'single' | 'multiple' | 'unassigned';
  coaches: Array<{ display_name: string }>;
};

function publicDisplayName(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function projectPublicCourseCoaches(input: {
  sessions: CourseStaffingSession[];
  assignments: CourseInstructorAssignment[];
  staff: CourseVenueStaff[];
  profiles: CourseStaffProfile[];
}): PublicCourseCoachProjection {
  const requiredSessions = input.sessions.filter((session) => session.is_active === true
    && session.publish_status === 'published'
    && session.requires_staffing === true
    && session.id
    && session.session_date);
  if (!requiredSessions.length) return { coverage: 'none', mode: 'unassigned', coaches: [] };

  const staffById = new Map(input.staff.map((staff) => [String(staff.id), staff]));
  const displayNameByUserId = new Map(input.profiles
    .map((profile) => [String(profile.auth_user_id), publicDisplayName(profile.display_name)] as const)
    .filter(([, displayName]) => Boolean(displayName)));
  const assignedStaffBySession = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    const session = requiredSessions.find((candidate) => String(candidate.id) === String(assignment.source_id)
      && String(candidate.session_date).slice(0, 10) === String(assignment.occurrence_date).slice(0, 10));
    const staff = staffById.get(String(assignment.venue_staff_id));
    if (!session || !staff || !displayNameByUserId.has(String(staff.user_id))) continue;
    const current = assignedStaffBySession.get(String(session.id)) || new Set<string>();
    current.add(String(staff.id));
    assignedStaffBySession.set(String(session.id), current);
  }
  const complete = requiredSessions.every((session) => (assignedStaffBySession.get(String(session.id))?.size || 0) > 0);
  if (!complete) {
    return {
      coverage: assignedStaffBySession.size > 0 ? 'partial' : 'none',
      mode: 'unassigned',
      coaches: [],
    };
  }

  const assignedStaffIds = [...new Set([...assignedStaffBySession.values()].flatMap((ids) => [...ids]))];
  const coaches = [...new Set(assignedStaffIds.map((staffId) => {
    const staff = staffById.get(staffId);
    return staff ? displayNameByUserId.get(String(staff.user_id)) : null;
  }).filter(Boolean) as string[])]
    .sort((left, right) => left.localeCompare(right, 'sv'))
    .map((displayName) => ({ display_name: displayName }));
  return {
    coverage: 'complete',
    mode: assignedStaffIds.length === 1 ? 'single' : 'multiple',
    coaches,
  };
}
