export type BookingParticipantOperationalState =
  | 'confirmed_included'
  | 'confirmed_paid'
  | 'payment_pending'
  | 'payment_expired'
  | 'payment_attention'
  | 'identity_pending'
  | 'confirmation_pending'
  | 'cancelled_released';

export type BookingParticipantHoldTruth = {
  id?: string | null;
  scope_id?: string | null;
  source_id?: string | null;
  status?: string | null;
  expires_at?: string | null;
  stripe_session_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type BookingParticipantOperationalProjection = {
  operational_state: BookingParticipantOperationalState;
  has_place: boolean;
  confirmed: boolean;
  reserved: boolean;
  reservation_expires_at: string | null;
  check_in_allowed: boolean;
  can_resume_payment: boolean;
  can_retry_payment: boolean;
  requires_attention: boolean;
  state_reason: string;
};

type BookingParticipantProjectedState = BookingParticipantStateInput & Partial<BookingParticipantOperationalProjection>;

export type BookingParticipantCountSummary = {
  confirmed_count: number;
  reserved_count: number;
  available_count: number;
  pending_unreserved_count: number;
  capacity: number;
  capacity_source: BookingGroupCapacitySource;
  capacity_is_authoritative: boolean;
  capacity_state: 'ok' | 'over_capacity_attention';
  capacity_invariant_violation: boolean;
  over_capacity_count: number;
};

export type BookingGroupCapacitySource =
  | 'open_for_more_public_capacity'
  | 'open_for_more_opened_places'
  | 'open_for_more_total_players'
  | 'booking_rows_fallback';

export type BookingGroupCapacityResolution = {
  capacity: number;
  capacity_source: BookingGroupCapacitySource;
  capacity_is_authoritative: boolean;
};

type BookingGroupCapacityRow = {
  open_for_more_status?: string | null;
  open_for_more_public_capacity?: number | string | null;
  open_for_more_opened_places?: number | string | null;
  open_for_more_committed_at_publication?: number | string | null;
  open_for_more_total_players?: number | string | null;
  [key: string]: unknown;
};

const BOOKING_PARTICIPANT_FALLBACK_CAPACITY_PER_ROW = 4;

type BookingParticipantStateInput = {
  id?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  price_minor?: number | null;
  payment_status?: string | null;
  booking_receipt_id?: string | null;
  payment_stripe_session_id?: string | null;
  checked_in_at?: string | null;
  entitlement_reresolution_pending?: boolean | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type HoldTruthQueryResult = {
  data: BookingParticipantHoldTruth[] | null;
  error: { message: string } | null;
};

type HoldTruthQuery = PromiseLike<HoldTruthQueryResult> & {
  select(columns: string): HoldTruthQuery;
  eq(column: string, value: unknown): HoldTruthQuery;
  in(column: string, values: string[]): HoldTruthQuery;
  order(column: string, options: { ascending: boolean }): HoldTruthQuery;
};

type HoldTruthClient = {
  from(table: string): HoldTruthQuery;
};

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function metadataOf(value: BookingParticipantStateInput): Record<string, unknown> {
  return value?.metadata && typeof value.metadata === 'object' ? value.metadata : {};
}

function validDateMs(value: unknown) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveWholeNumber(value: unknown) {
  const number = Math.floor(Number(value || 0));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * One max-capacity contract for every booking-participant consumer.
 *
 * The stored open-booking snapshot is authoritative even after publication is
 * closed. Court-row cardinality is retained only as an explicit compatibility
 * fallback for booking groups that predate configured participant capacity.
 */
export function resolveBookingGroupCapacity(
  bookingRows: BookingGroupCapacityRow[],
): BookingGroupCapacityResolution {
  const rows = Array.isArray(bookingRows) ? bookingRows : [];
  const orderedRows = [
    ...rows.filter((row) => normalized(row?.open_for_more_status) === 'open'),
    ...rows.filter((row) => normalized(row?.open_for_more_status) !== 'open'),
  ];

  const publicCapacity = positiveWholeNumber(
    orderedRows.find((row) => positiveWholeNumber(row?.open_for_more_public_capacity) > 0)
      ?.open_for_more_public_capacity,
  );
  if (publicCapacity > 0) {
    return {
      capacity: publicCapacity,
      capacity_source: 'open_for_more_public_capacity',
      capacity_is_authoritative: true,
    };
  }

  const openedCapacityRow = orderedRows.find((row) =>
    positiveWholeNumber(row?.open_for_more_opened_places) > 0
  );
  const openedPlaces = positiveWholeNumber(openedCapacityRow?.open_for_more_opened_places);
  if (openedPlaces > 0) {
    const rawCommittedAtPublication = Math.floor(
      Number(openedCapacityRow?.open_for_more_committed_at_publication || 0),
    );
    const committedAtPublication = Number.isFinite(rawCommittedAtPublication)
      ? Math.max(0, rawCommittedAtPublication)
      : 0;
    return {
      capacity: committedAtPublication + openedPlaces,
      capacity_source: 'open_for_more_opened_places',
      capacity_is_authoritative: true,
    };
  }

  const legacyTotal = positiveWholeNumber(
    orderedRows.find((row) => positiveWholeNumber(row?.open_for_more_total_players) > 0)
      ?.open_for_more_total_players,
  );
  if (legacyTotal > 0) {
    return {
      capacity: legacyTotal,
      capacity_source: 'open_for_more_total_players',
      capacity_is_authoritative: true,
    };
  }

  return {
    capacity: Math.max(rows.length, 1) * BOOKING_PARTICIPANT_FALLBACK_CAPACITY_PER_ROW,
    capacity_source: 'booking_rows_fallback',
    capacity_is_authoritative: false,
  };
}

export function bookingParticipantHoldIsLive(
  hold: BookingParticipantHoldTruth | null | undefined,
  now: Date = new Date(),
) {
  return normalized(hold?.status) === 'active' && validDateMs(hold?.expires_at) > now.getTime();
}

/**
 * Canonical read projection for an individual participant intent.
 *
 * Persistent paid/free participant state is the committed place truth.
 * A live capacity hold is the only temporary reservation truth. A participant
 * row by itself never consumes capacity.
 */
export function deriveBookingParticipantOperationalState(
  participant: BookingParticipantStateInput,
  latestHold?: BookingParticipantHoldTruth | null,
  now: Date = new Date(),
): BookingParticipantOperationalProjection {
  const status = normalized(participant?.payment_status) || 'pending';
  const holdStatus = normalized(latestHold?.status);
  const identified = Boolean(participant?.customer_id || participant?.user_id);
  const projectedCoverage = participant?.entitlement_reresolution_pending === true;
  const hasFinancialEvidence = Boolean(
    participant?.booking_receipt_id || participant?.payment_stripe_session_id,
  );
  const checkedInWithoutCommitment = Boolean(participant?.checked_in_at) && !['paid', 'free'].includes(status);

  if (status === 'cancelled') {
    return {
      operational_state: 'cancelled_released',
      has_place: false,
      confirmed: false,
      reserved: false,
      reservation_expires_at: null,
      check_in_allowed: false,
      can_resume_payment: false,
      can_retry_payment: false,
      requires_attention: false,
      state_reason: 'participant_cancelled',
    };
  }

  if ((status === 'paid' || status === 'free') && !projectedCoverage) {
    const paid = status === 'paid';
    return {
      operational_state: paid ? 'confirmed_paid' : 'confirmed_included',
      has_place: true,
      confirmed: true,
      reserved: false,
      reservation_expires_at: null,
      check_in_allowed: identified,
      can_resume_payment: false,
      can_retry_payment: false,
      requires_attention: false,
      state_reason: paid ? 'participant_paid_committed' : 'participant_included_committed',
    };
  }

  if (projectedCoverage) {
    return {
      operational_state: 'confirmation_pending',
      has_place: false,
      confirmed: false,
      reserved: false,
      reservation_expires_at: null,
      check_in_allowed: false,
      can_resume_payment: false,
      can_retry_payment: true,
      requires_attention: false,
      state_reason: 'entitlement_requires_atomic_commit',
    };
  }

  if (
    holdStatus === 'conflict' ||
    checkedInWithoutCommitment ||
    hasFinancialEvidence ||
    !['pending', ''].includes(status)
  ) {
    return {
      operational_state: 'payment_attention',
      has_place: false,
      confirmed: false,
      reserved: false,
      reservation_expires_at: null,
      check_in_allowed: false,
      can_resume_payment: false,
      can_retry_payment: false,
      requires_attention: true,
      state_reason: holdStatus === 'conflict'
        ? 'paid_capacity_conflict'
        : checkedInWithoutCommitment
        ? 'uncommitted_participant_checked_in'
        : hasFinancialEvidence
        ? 'uncommitted_participant_has_financial_evidence'
        : 'unexpected_participant_payment_status',
    };
  }

  if (bookingParticipantHoldIsLive(latestHold, now)) {
    return {
      operational_state: 'payment_pending',
      has_place: false,
      confirmed: false,
      reserved: true,
      reservation_expires_at: latestHold?.expires_at || null,
      check_in_allowed: false,
      can_resume_payment: identified,
      can_retry_payment: false,
      requires_attention: false,
      state_reason: latestHold?.stripe_session_id ? 'live_checkout_capacity_hold' : 'live_capacity_hold',
    };
  }

  if (!identified && metadataOf(participant).source === 'manual_placeholder') {
    return {
      operational_state: 'identity_pending',
      has_place: false,
      confirmed: false,
      reserved: false,
      reservation_expires_at: null,
      check_in_allowed: false,
      can_resume_payment: false,
      can_retry_payment: false,
      requires_attention: false,
      state_reason: 'participant_identity_missing',
    };
  }

  return {
    operational_state: 'payment_expired',
    has_place: false,
    confirmed: false,
    reserved: false,
    reservation_expires_at: null,
    check_in_allowed: false,
    can_resume_payment: false,
    can_retry_payment: identified,
    requires_attention: false,
    state_reason: holdStatus === 'expired' || holdStatus === 'released'
      ? 'payment_hold_released_or_expired'
      : 'participant_intent_without_live_hold',
  };
}

export function projectBookingParticipantOperationalState(
  participant: BookingParticipantStateInput,
  latestHold?: BookingParticipantHoldTruth | null,
  now: Date = new Date(),
) {
  return {
    ...participant,
    ...deriveBookingParticipantOperationalState(participant, latestHold, now),
  };
}

export function bookingParticipantCountSummary(
  participants: BookingParticipantProjectedState[],
  capacity: number,
  reservedCountOverride?: number,
  capacityResolution?: BookingGroupCapacityResolution,
): BookingParticipantCountSummary {
  const safeCapacity = Math.max(0, Math.floor(Number(capacity || 0)));
  const confirmedCount = participants.filter((participant) => participant?.confirmed === true).length;
  const projectedReservedCount = participants.filter((participant) => participant?.reserved === true).length;
  const reservedCount = Math.max(
    0,
    Math.floor(Number(reservedCountOverride ?? projectedReservedCount)),
  );
  const pendingUnreservedCount = participants.filter((participant) =>
    participant?.confirmed !== true &&
    participant?.reserved !== true &&
    participant?.operational_state !== 'cancelled_released'
  ).length;
  const overCapacityCount = Math.max(0, confirmedCount + reservedCount - safeCapacity);
  const resolvedCapacity = capacityResolution || {
    capacity: safeCapacity,
    capacity_source: 'booking_rows_fallback' as const,
    capacity_is_authoritative: false,
  };

  return {
    confirmed_count: confirmedCount,
    reserved_count: reservedCount,
    available_count: Math.max(0, safeCapacity - confirmedCount - reservedCount),
    pending_unreserved_count: pendingUnreservedCount,
    capacity: safeCapacity,
    capacity_source: resolvedCapacity.capacity_source,
    capacity_is_authoritative: resolvedCapacity.capacity_is_authoritative,
    capacity_state: overCapacityCount > 0 ? 'over_capacity_attention' : 'ok',
    capacity_invariant_violation: overCapacityCount > 0,
    over_capacity_count: overCapacityCount,
  };
}

export function resolveBookingParticipantGroupCapacity(
  bookingRows: BookingGroupCapacityRow[],
  participants: BookingParticipantProjectedState[],
  options: {
    reservedCountOverride?: number;
  } = {},
): BookingParticipantCountSummary {
  const capacityResolution = resolveBookingGroupCapacity(bookingRows);
  return bookingParticipantCountSummary(
    participants,
    capacityResolution.capacity,
    options.reservedCountOverride,
    capacityResolution,
  );
}

export function bookingParticipantReservedCount(
  participants: BookingParticipantProjectedState[],
  liveHoldSourceKeys: ReadonlySet<string>,
) {
  const confirmedParticipantIds = new Set(
    participants
      .filter((participant) => participant?.confirmed === true)
      .map((participant) => String(participant?.id || ''))
      .filter(Boolean),
  );
  const reservedSourceKeys = new Set(
    [...liveHoldSourceKeys].filter((sourceKey) => !confirmedParticipantIds.has(sourceKey)),
  );

  for (const participant of participants) {
    if (participant?.reserved !== true) continue;
    const participantId = String(participant?.id || '');
    reservedSourceKeys.add(participantId || `projected:${reservedSourceKeys.size}`);
  }

  return reservedSourceKeys.size;
}

export async function loadBookingParticipantHoldTruth(
  admin: HoldTruthClient,
  venueId: string,
  groupKeys: string[],
  now: Date = new Date(),
) {
  const uniqueGroupKeys = [...new Set(groupKeys.map((key) => String(key || '').trim()).filter(Boolean))];
  const latestByParticipantId = new Map<string, BookingParticipantHoldTruth>();
  const liveCountByGroupKey = new Map<string, number>();
  const liveHoldSourceKeysByGroupKey = new Map<string, Set<string>>();
  if (!venueId || uniqueGroupKeys.length === 0) {
    return { latestByParticipantId, liveCountByGroupKey, liveHoldSourceKeysByGroupKey };
  }

  const { data, error } = await admin
    .from('capacity_holds')
    .select('id, scope_id, source_id, status, expires_at, stripe_session_id, metadata, created_at')
    .eq('venue_id', venueId)
    .eq('scope_type', 'booking_group')
    .eq('source_type', 'booking_participant')
    .in('scope_id', uniqueGroupKeys)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const hold of (data || []) as BookingParticipantHoldTruth[]) {
    const participantId = String(hold.source_id || '');
    if (participantId && !latestByParticipantId.has(participantId)) {
      latestByParticipantId.set(participantId, hold);
    }
    if (bookingParticipantHoldIsLive(hold, now)) {
      const groupKey = String(hold.scope_id || '');
      const sourceKeys = liveHoldSourceKeysByGroupKey.get(groupKey) || new Set<string>();
      sourceKeys.add(participantId || `hold:${String(hold.id || '')}`);
      liveHoldSourceKeysByGroupKey.set(groupKey, sourceKeys);
      liveCountByGroupKey.set(groupKey, sourceKeys.size);
    }
  }

  return { latestByParticipantId, liveCountByGroupKey, liveHoldSourceKeysByGroupKey };
}
