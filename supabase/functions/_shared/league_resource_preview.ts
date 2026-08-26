export type CanonicalResourceConflict = {
  source_type: string;
  source_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
};

export type CanonicalResourcePreviewRow = {
  occurrence_index: number;
  occurrence_date: string;
  proposed_starts_at: string;
  proposed_ends_at: string;
  court_id: string;
  court_name: string;
  is_available: boolean;
  conflicts: CanonicalResourceConflict[];
};

export type LeagueResourceOwnerType =
  | 'booking'
  | 'open_play'
  | 'course'
  | 'league'
  | 'activity'
  | 'event'
  | 'resource_block'
  | 'venue_closure';

export type LeagueResourceConflict = {
  owner_type: LeagueResourceOwnerType;
  owner_label: string;
  owner_name: string | null;
  starts_at: string;
  ends_at: string;
};

export type LeagueResourcePreview = {
  has_conflicts: boolean;
  nights: Array<{
    night_index: number;
    date: string;
    proposed_starts_at: string;
    proposed_ends_at: string;
    status: 'clear' | 'conflict';
    courts: Array<{
      court_id: string;
      court_name: string;
      is_available: boolean;
      conflicts: LeagueResourceConflict[];
    }>;
  }>;
};

function cleanOwnerName(value: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  return name || null;
}

export function presentLeagueResourceOwner(
  conflict: CanonicalResourceConflict,
  activitySessionType?: string | null,
): Pick<LeagueResourceConflict, 'owner_type' | 'owner_label' | 'owner_name'> {
  if (conflict.source_type === 'booking') {
    return { owner_type: 'booking', owner_label: 'Banbokning', owner_name: null };
  }

  if (conflict.source_type === 'activity_session') {
    const sessionType = String(activitySessionType || '').toLowerCase();
    if (sessionType === 'open_play') {
      return { owner_type: 'open_play', owner_label: 'Open Play', owner_name: cleanOwnerName(conflict.title) };
    }
    if (sessionType === 'course') {
      return { owner_type: 'course', owner_label: 'Kurs', owner_name: cleanOwnerName(conflict.title) };
    }
    if (sessionType === 'league' || sessionType === 'league_reschedule') {
      return { owner_type: 'league', owner_label: 'Seriespel', owner_name: cleanOwnerName(conflict.title) };
    }
    if (sessionType === 'event') {
      return { owner_type: 'event', owner_label: 'Event', owner_name: cleanOwnerName(conflict.title) };
    }
    return { owner_type: 'activity', owner_label: 'Aktivitet', owner_name: cleanOwnerName(conflict.title) };
  }

  if (conflict.source_type === 'event_reservation') {
    return { owner_type: 'event', owner_label: 'Event', owner_name: cleanOwnerName(conflict.title) };
  }
  if (conflict.source_type === 'venue_closure') {
    return { owner_type: 'venue_closure', owner_label: 'Driftstopp', owner_name: cleanOwnerName(conflict.title) };
  }
  return { owner_type: 'resource_block', owner_label: 'Resursblockering', owner_name: cleanOwnerName(conflict.title) };
}

export function buildLeagueResourcePreview(
  nightDates: string[],
  rowsByNight: CanonicalResourcePreviewRow[][],
  activitySessionTypes: ReadonlyMap<string, string>,
): LeagueResourcePreview {
  const nights = nightDates.map((date, index) => {
    const rows = rowsByNight[index] || [];
    const courts = rows.map((row) => ({
      court_id: row.court_id,
      court_name: row.court_name,
      is_available: row.is_available,
      conflicts: (row.conflicts || []).map((conflict) => ({
        ...presentLeagueResourceOwner(conflict, activitySessionTypes.get(conflict.source_id)),
        starts_at: conflict.starts_at,
        ends_at: conflict.ends_at,
      })),
    }));
    const hasConflicts = courts.some((court) => !court.is_available || court.conflicts.length > 0);
    return {
      night_index: index + 1,
      date,
      proposed_starts_at: rows[0]?.proposed_starts_at || '',
      proposed_ends_at: rows[0]?.proposed_ends_at || '',
      status: hasConflicts ? 'conflict' as const : 'clear' as const,
      courts,
    };
  });
  return { has_conflicts: nights.some((night) => night.status === 'conflict'), nights };
}
