export const COMMITTED_REGISTRATION_STATUSES = new Set(['confirmed', 'checked_in', 'attended']);

export type ActivitySocialProofRow = {
  activity_session_id: string;
  session_date: string;
  registrations_count: number;
  interested_count: number;
  user_is_interested: boolean;
  user_registration_status: string | null;
  hidden_count?: number;
  first_visit_count?: number;
  shared_history_count?: number;
  attendees?: Array<{
    person_id: string;
    display_name: string;
    avatar_url: string | null;
    is_host: boolean;
    is_first_visit: boolean;
    has_shared_session_history: boolean;
  }>;
};

type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  lte: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => QueryBuilder;
};
type ActivitySocialProofClient = { from: (table: string) => QueryBuilder };
type VenueRow = { id?: string; slug?: string; is_public?: boolean };
type SessionRow = { id: string };
type RegistrationRow = { activity_session_id: string; session_date: string; status?: string | null; user_id?: string | null };

function preferRegistrationStatus(current: string | null, next: string) {
  if (current === 'checked_in') return current;
  return next;
}

export async function activitySocialProof(client: unknown, {
  venueSlug,
  sessionIds,
  startDate,
  endDate,
  userId,
}: {
  venueSlug?: string | null;
  sessionIds: string[];
  startDate: string;
  endDate: string;
  userId?: string | null;
}) {
  const queryClient = client as ActivitySocialProofClient;
  const cleanSessionIds = [...new Set(sessionIds.filter(Boolean))];
  if (!venueSlug) throw new Error('Missing venueSlug');
  if (!startDate || !endDate) throw new Error('Missing date range');
  if (!cleanSessionIds.length) return { occurrences: [] as ActivitySocialProofRow[] };

  const { data: venueData, error: venueErr } = await queryClient.from('venues')
    .select('id, slug, is_public')
    .eq('slug', venueSlug)
    .maybeSingle();
  const venue = venueData as VenueRow | null;
  if (venueErr || !venue?.id || venue.is_public !== true) throw new Error('Venue not public');

  const { data: sessionsData, error: sessionsErr } = await queryClient.from('activity_sessions')
    .select('id')
    .eq('venue_id', venue.id)
    .eq('is_active', true)
    .eq('publish_status', 'published')
    .eq('closed_to_public', false)
    .in('id', cleanSessionIds);
  if (sessionsErr) throw sessionsErr;

  const sessions = (sessionsData || []) as SessionRow[];
  const allowedIds = new Set(sessions.map((session) => session.id));
  if (!allowedIds.size) return { occurrences: [] as ActivitySocialProofRow[] };
  const allowedSessionIds = cleanSessionIds.filter((id) => allowedIds.has(id));

  const [registrationsResult, interestsResult] = await Promise.all([
    queryClient.from('session_registrations')
      .select('activity_session_id, session_date, status, user_id')
      .in('activity_session_id', allowedSessionIds)
      .gte('session_date', startDate)
      .lte('session_date', endDate),
    queryClient.from('activity_session_interests')
      .select('activity_session_id, session_date, status, user_id')
      .in('activity_session_id', allowedSessionIds)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .eq('status', 'interested'),
  ]);

  if (registrationsResult.error) throw registrationsResult.error;
  if (interestsResult.error) throw interestsResult.error;

  const byKey = new Map<string, ActivitySocialProofRow>();
  const getRow = (activitySessionId: string, sessionDate: string) => {
    const key = `${activitySessionId}:${sessionDate}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const row: ActivitySocialProofRow = {
      activity_session_id: activitySessionId,
      session_date: sessionDate,
      registrations_count: 0,
      interested_count: 0,
      user_is_interested: false,
      user_registration_status: null,
    };
    byKey.set(key, row);
    return row;
  };

  for (const row of (registrationsResult.data || []) as RegistrationRow[]) {
    const status = String(row.status || '');
    const committed = COMMITTED_REGISTRATION_STATUSES.has(status);
    const ownActiveRegistration = Boolean(userId && row.user_id === userId && status !== 'cancelled' && status !== 'refunded');
    if (!committed && !ownActiveRegistration) continue;
    const proof = getRow(row.activity_session_id, row.session_date);
    if (committed) proof.registrations_count += 1;
    if (ownActiveRegistration) {
      proof.user_registration_status = preferRegistrationStatus(proof.user_registration_status, status || 'confirmed');
    }
  }

  for (const row of (interestsResult.data || []) as RegistrationRow[]) {
    const proof = getRow(row.activity_session_id, row.session_date);
    proof.interested_count += 1;
    if (userId && row.user_id === userId) proof.user_is_interested = true;
  }

  return { occurrences: Array.from(byKey.values()) };
}
