type EventParticipantRow = {
  [key: string]: unknown;
  name?: unknown;
  auth_user_id?: unknown;
};

type VenueDisplayCheckinRow = {
  [key: string]: unknown;
  player_name?: unknown;
  checked_in_at?: unknown;
  entry_type?: unknown;
  entitlement_id?: unknown;
};

function cleanPublicName(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return normalized.slice(0, 100) || 'Spelare';
}

export function projectPublicEventParticipants(
  rows: EventParticipantRow[],
  avatarByUserId: Map<string, string | null>,
  limit = 5,
) {
  return rows.slice(0, limit).map((row) => {
    const authUserId = typeof row.auth_user_id === 'string' ? row.auth_user_id : null;
    return {
      display_name: cleanPublicName(row.name),
      avatar_url: authUserId ? avatarByUserId.get(authUserId) || null : null,
    };
  });
}

export function projectPublicVenueDisplayQueue(rows: VenueDisplayCheckinRow[]) {
  return rows
    .filter((row) =>
      row.entry_type === 'open_play' ||
      (row.entry_type === 'manual' && row.entitlement_id == null)
    )
    .map((row) => ({
      display_name: cleanPublicName(row.player_name),
      checked_in_at: typeof row.checked_in_at === 'string' ? row.checked_in_at : '',
    }))
    .filter((row) => row.checked_in_at.length > 0);
}
