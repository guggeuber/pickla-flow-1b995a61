type ActivitySessionHostRow = {
  [key: string]: unknown;
  first_name?: unknown;
  display_name?: unknown;
  avatar_url?: unknown;
  is_playing?: unknown;
};

export type PublicActivitySessionHost = {
  first_name: string;
  display_name: string;
  avatar_url: string | null;
  is_playing: boolean;
};

function cleanPublicHostName(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return normalized.slice(0, 100) || fallback;
}

function cleanPublicAvatarUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function projectPublicActivitySessionHosts(
  rows: ActivitySessionHostRow[],
): PublicActivitySessionHost[] {
  return rows.map((row) => {
    const displayName = cleanPublicHostName(row.display_name ?? row.first_name, 'Värd');
    const firstName = cleanPublicHostName(row.first_name ?? displayName, 'Värd').split(' ')[0] || 'Värd';
    return {
      first_name: firstName,
      display_name: displayName,
      avatar_url: cleanPublicAvatarUrl(row.avatar_url),
      is_playing: row.is_playing !== false,
    };
  });
}
