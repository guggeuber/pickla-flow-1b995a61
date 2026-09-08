const NON_VENUE_SCOPED_ADMIN_READ_PATHS = new Set([
  'check',
  'venues',
]);

export function isVenueScopedAdminRead(method: string, path: string) {
  return method === 'GET' && !NON_VENUE_SCOPED_ADMIN_READ_PATHS.has(path);
}

export async function authorizeVenueScopedAdminRead({
  method,
  path,
  venueId,
  authorizeVenue,
}: {
  method: string;
  path: string;
  venueId: string | null;
  authorizeVenue: (venueId: string) => Promise<unknown>;
}) {
  if (!isVenueScopedAdminRead(method, path)) return false;
  if (!venueId) throw new Error('Missing venueId');
  await authorizeVenue(venueId);
  return true;
}

const ADMIN_BOOKING_SUMMARY_FIELDS = [
  'id',
  'source_id',
  'date',
  'time',
  'end_time',
  'title',
  'kind',
  'tone',
  'moduleTarget',
  'courts',
  'court_name',
  'checked_in',
  'checked_in_count',
  'detail_target',
] as const;

export function adminBookingDetailTarget(sourceId: string) {
  return { kind: 'booking_detail' as const, source_id: sourceId };
}

export function projectAdminBookingSummary(input: Record<string, unknown>) {
  return Object.fromEntries(
    ADMIN_BOOKING_SUMMARY_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(input, field))
      .map((field) => [field, input[field]]),
  );
}
