import { DateTime } from 'https://esm.sh/luxon@3.5.0';

export type PhysicalConflictType =
  | 'venue_closed'
  | 'court_unavailable'
  | 'booking'
  | 'activity_occurrence'
  | 'resource_block';

export type PhysicalAvailabilityConflict = {
  type: PhysicalConflictType;
  resource_id: string;
  source_id?: string;
  occurrence_date?: string;
  starts_at: string;
  ends_at: string;
};

export type PhysicalAvailabilityDecision = {
  available: boolean;
  venue_id: string;
  resource_ids: string[];
  starts_at: string;
  ends_at: string;
  interval_semantics: '[start,end)';
  conflicts: PhysicalAvailabilityConflict[];
};

export type PhysicalActivityScheduleDeltaDecision = {
  available: boolean;
  venue_id: string;
  activity_session_id: string;
  effective_from: string;
  interval_semantics: '[start,end)';
  new_claims: Array<{
    occurrence_date: string;
    resource_id: string;
    starts_at: string;
    ends_at: string;
    available: boolean;
    conflicts: PhysicalAvailabilityConflict[];
  }>;
  conflicts: Array<PhysicalAvailabilityConflict & {
    occurrence_date: string;
    claim_starts_at: string;
    claim_ends_at: string;
  }>;
};

type PhysicalRpcError = { message?: string; details?: string } | null;

type PhysicalRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: PhysicalRpcError }>;
};

function isAvailabilityDecision(value: unknown): value is PhysicalAvailabilityDecision {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { available?: unknown }).available === 'boolean'
    && Array.isArray((value as { conflicts?: unknown }).conflicts),
  );
}

export class PhysicalAvailabilityLookupError extends Error {
  constructor(message = 'Physical availability could not be established') {
    super(message);
    this.name = 'PhysicalAvailabilityLookupError';
  }
}

export class PhysicalAvailabilityConflictError extends Error {
  decision: PhysicalAvailabilityDecision | null;

  constructor(message: string, decision: PhysicalAvailabilityDecision | null = null) {
    super(message);
    this.name = 'PhysicalAvailabilityConflictError';
    this.decision = decision;
  }
}

function uniqueIds(ids: unknown[]) {
  return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))).sort();
}

export function physicalIntervalFromLocal(
  date: string,
  startTime: string,
  endTime: string,
  timezone = 'Europe/Stockholm',
) {
  const start = DateTime.fromISO(`${date}T${startTime}`, { zone: timezone });
  let end = DateTime.fromISO(`${date}T${endTime}`, { zone: timezone });
  if (!start.isValid || !end.isValid) throw new PhysicalAvailabilityLookupError('Invalid physical availability interval');
  if (end <= start) end = end.plus({ days: 1 });
  const startsAt = start.toUTC().toISO();
  const endsAt = end.toUTC().toISO();
  if (!startsAt || !endsAt || endsAt <= startsAt) throw new PhysicalAvailabilityLookupError('Invalid physical availability interval');
  return { startsAt, endsAt };
}

export async function checkPhysicalAvailability(
  client: PhysicalRpcClient,
  input: {
    venueId: string;
    courtIds: string[];
    startsAt: string;
    endsAt: string;
    excludeBookingIds?: string[];
    excludeActivitySessionId?: string | null;
    excludeActivityOccurrenceDate?: string | null;
    excludeActivitySeriesId?: string | null;
    excludeResourceBlockIds?: string[];
    excludeOperationOverrideId?: string | null;
  },
): Promise<PhysicalAvailabilityDecision> {
  const courtIds = uniqueIds(input.courtIds || []);
  if (!input.venueId || !courtIds.length || !input.startsAt || !input.endsAt) {
    throw new PhysicalAvailabilityLookupError('Physical availability identity is incomplete');
  }
  const { data, error } = await client.rpc('check_physical_availability', {
    p_venue_id: input.venueId,
    p_court_ids: courtIds,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_exclude_booking_ids: uniqueIds(input.excludeBookingIds || []),
    p_exclude_activity_session_id: input.excludeActivitySessionId || null,
    p_exclude_activity_occurrence_date: input.excludeActivityOccurrenceDate || null,
    p_exclude_activity_series_id: input.excludeActivitySeriesId || null,
    p_exclude_resource_block_ids: uniqueIds(input.excludeResourceBlockIds || []),
    p_exclude_operation_override_id: input.excludeOperationOverrideId || null,
  });
  if (error || !isAvailabilityDecision(data)) {
    throw new PhysicalAvailabilityLookupError(error?.message || 'Physical availability returned an invalid decision');
  }
  return data as PhysicalAvailabilityDecision;
}

export async function claimPhysicalBookings(client: PhysicalRpcClient, venueId: string, claims: Record<string, unknown>[]) {
  if (!venueId || !Array.isArray(claims) || !claims.length) {
    throw new PhysicalAvailabilityLookupError('Physical booking claim is incomplete');
  }
  const { data, error } = await client.rpc('claim_physical_bookings', {
    p_venue_id: venueId,
    p_claims: claims,
  });
  if (error) {
    let detail: PhysicalAvailabilityDecision | null = null;
    try {
      detail = typeof error.details === 'string' && error.details.trim().startsWith('{')
        ? JSON.parse(error.details) as PhysicalAvailabilityDecision
        : null;
    } catch {
      detail = null;
    }
    if (error.message === 'physical_availability_conflict') {
      throw new PhysicalAvailabilityConflictError(error.message, detail);
    }
    throw new PhysicalAvailabilityLookupError(error.message || 'Physical booking claim failed closed');
  }
  if (!Array.isArray(data) || data.length !== claims.length) {
    throw new PhysicalAvailabilityLookupError('Physical booking claim returned an incomplete result');
  }
  return data;
}

export async function checkPhysicalActivitySchedule(
  client: PhysicalRpcClient,
  input: {
    venueId: string;
    courtIds: string[];
    sessionDate?: string | null;
    recurrenceDays?: number[] | null;
    startTime: string;
    endTime: string;
    seriesId?: string | null;
    excludeSessionId?: string | null;
  },
) {
  const courtIds = uniqueIds(input.courtIds || []);
  const { data, error } = await client.rpc('check_physical_activity_schedule', {
    p_venue_id: input.venueId,
    p_court_ids: courtIds,
    p_session_date: input.sessionDate || null,
    p_recurrence_days: input.recurrenceDays || null,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_series_id: input.seriesId || null,
    p_exclude_session_id: input.excludeSessionId || null,
  });
  if (
    error
    || !data
    || typeof data !== 'object'
    || typeof (data as { available?: unknown }).available !== 'boolean'
    || !Array.isArray((data as { occurrences?: unknown }).occurrences)
  ) {
    throw new PhysicalAvailabilityLookupError(error?.message || 'Physical activity schedule returned an invalid decision');
  }
  return data as {
    available: boolean;
    venue_id: string;
    resource_ids: string[];
    interval_semantics: '[start,end)';
    occurrences: Array<{
      occurrence_date: string;
      starts_at: string;
      ends_at: string;
      available: boolean;
      conflicts: PhysicalAvailabilityConflict[];
    }>;
  };
}

export async function checkPhysicalActivityScheduleDelta(
  client: PhysicalRpcClient,
  input: {
    venueId: string;
    sessionId: string;
    effectiveFrom: string;
    oldSchedule: Record<string, unknown>;
    newSchedule: Record<string, unknown>;
  },
): Promise<PhysicalActivityScheduleDeltaDecision> {
  const oldSchedule = input.oldSchedule || {};
  const newSchedule = input.newSchedule || {};
  const { data, error } = await client.rpc('check_physical_activity_schedule_delta', {
    p_venue_id: input.venueId,
    p_session_id: input.sessionId,
    p_effective_from: input.effectiveFrom,
    p_old_series_id: oldSchedule.series_id || null,
    p_old_session_date: oldSchedule.session_date || null,
    p_old_recurrence_days: oldSchedule.recurrence_days || null,
    p_old_start_time: oldSchedule.start_time,
    p_old_end_time: oldSchedule.end_time,
    p_old_court_ids: uniqueIds(Array.isArray(oldSchedule.court_ids) ? oldSchedule.court_ids : []),
    p_old_is_active: oldSchedule.is_active !== false,
    p_old_publish_status: oldSchedule.publish_status || 'published',
    p_new_series_id: newSchedule.series_id || null,
    p_new_session_date: newSchedule.session_date || null,
    p_new_recurrence_days: newSchedule.recurrence_days || null,
    p_new_start_time: newSchedule.start_time,
    p_new_end_time: newSchedule.end_time,
    p_new_court_ids: uniqueIds(Array.isArray(newSchedule.court_ids) ? newSchedule.court_ids : []),
    p_new_is_active: newSchedule.is_active !== false,
    p_new_publish_status: newSchedule.publish_status || 'published',
  });
  if (
    error
    || !data
    || typeof data !== 'object'
    || typeof (data as { available?: unknown }).available !== 'boolean'
    || !Array.isArray((data as { new_claims?: unknown }).new_claims)
    || !Array.isArray((data as { conflicts?: unknown }).conflicts)
  ) {
    throw new PhysicalAvailabilityLookupError(error?.message || 'Physical activity schedule delta returned an invalid decision');
  }
  return data as PhysicalActivityScheduleDeltaDecision;
}

export async function claimPhysicalResourceBlocks(client: PhysicalRpcClient, venueId: string, claims: Record<string, unknown>[]) {
  if (!venueId || !Array.isArray(claims) || !claims.length) {
    throw new PhysicalAvailabilityLookupError('Physical resource-block claim is incomplete');
  }
  const { data, error } = await client.rpc('claim_physical_resource_blocks', {
    p_venue_id: venueId,
    p_claims: claims,
  });
  if (error) {
    let detail: PhysicalAvailabilityDecision | null = null;
    try {
      detail = typeof error.details === 'string' && error.details.trim().startsWith('{')
        ? JSON.parse(error.details) as PhysicalAvailabilityDecision
        : null;
    } catch {
      detail = null;
    }
    if (error.message === 'physical_availability_conflict') {
      throw new PhysicalAvailabilityConflictError(error.message, detail);
    }
    throw new PhysicalAvailabilityLookupError(error.message || 'Physical resource-block claim failed closed');
  }
  if (!Array.isArray(data) || data.length !== claims.length) {
    throw new PhysicalAvailabilityLookupError('Physical resource-block claim returned an incomplete result');
  }
  return data;
}

export function publicPhysicalConflicts(decision: PhysicalAvailabilityDecision) {
  return decision.conflicts.map((conflict) => ({
    type: conflict.type,
    resource_id: conflict.resource_id,
    starts_at: conflict.starts_at,
    ends_at: conflict.ends_at,
    ...(conflict.occurrence_date ? { occurrence_date: conflict.occurrence_date } : {}),
  }));
}
