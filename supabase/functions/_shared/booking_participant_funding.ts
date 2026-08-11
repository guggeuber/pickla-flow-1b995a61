export type BookingParticipationFundingMode =
  | 'individual_participation'
  | 'resource_funded'
  | 'unresolved';

export type BookingParticipationFunding = {
  mode: BookingParticipationFundingMode;
  sourceType: string | null;
  sourceId: string | null;
  funder: string | null;
  reason: string;
};

function normalized(value: unknown) {
  return String(value || '').trim();
}

function explicitFunding(row: any): BookingParticipationFunding | null {
  const mode = normalized(row?.participation_funding_mode) as BookingParticipationFundingMode;
  if (!['individual_participation', 'resource_funded', 'unresolved'].includes(mode)) return null;
  return {
    mode,
    sourceType: normalized(row?.participation_funding_source_type) || null,
    sourceId: normalized(row?.participation_funding_source_id) || null,
    funder: normalized(row?.participation_funder) || null,
    reason: mode === 'unresolved' ? 'explicit_unresolved' : 'explicit_provenance',
  };
}

function legacyFunding(row: any): BookingParticipationFunding {
  if (
    Number(row?.included_court_hours || 0) > 0 ||
    row?.membership_usage_entitlement_type === 'court_hours_per_week'
  ) {
    return {
      mode: 'individual_participation',
      sourceType: 'membership_entitlement',
      sourceId: normalized(row?.membership_id) || null,
      funder: 'subscription',
      reason: 'legacy_included_court_hours',
    };
  }

  if (row?.corporate_package_id) {
    return {
      mode: 'resource_funded',
      sourceType: 'corporate_package',
      sourceId: normalized(row.corporate_package_id),
      funder: 'employer',
      reason: 'legacy_corporate_package',
    };
  }

  if (row?.stripe_session_id) {
    return {
      mode: 'resource_funded',
      sourceType: 'stripe_payment',
      sourceId: normalized(row.stripe_session_id),
      funder: 'self_prepaid',
      reason: 'legacy_stripe_payment',
    };
  }

  if (Number(row?.total_price || 0) === 0 && row?.membership_id) {
    return {
      mode: 'individual_participation',
      sourceType: 'membership_entitlement',
      sourceId: normalized(row.membership_id),
      funder: 'subscription',
      reason: 'legacy_zero_price_membership',
    };
  }

  return {
    mode: 'unresolved',
    sourceType: null,
    sourceId: null,
    funder: null,
    reason: 'legacy_provenance_missing',
  };
}

export function bookingParticipationFunding(rows: any[]): BookingParticipationFunding {
  const activeRows = (rows || []).filter((row: any) => row && row.status !== 'cancelled');
  if (activeRows.length === 0) {
    return { mode: 'unresolved', sourceType: null, sourceId: null, funder: null, reason: 'booking_rows_missing' };
  }

  const resolved = activeRows.map((row: any) => explicitFunding(row) || legacyFunding(row));
  const modes = new Set(resolved.map((entry) => entry.mode));
  if (modes.size !== 1) {
    return { mode: 'unresolved', sourceType: null, sourceId: null, funder: null, reason: 'mixed_group_funding' };
  }

  const mode = resolved[0].mode;
  if (mode === 'unresolved') return resolved[0];

  const funders = new Set(resolved.map((entry) => entry.funder || ''));
  const sourceTypes = new Set(resolved.map((entry) => entry.sourceType || ''));
  if (funders.size !== 1 || sourceTypes.size !== 1) {
    return { mode: 'unresolved', sourceType: null, sourceId: null, funder: null, reason: 'mixed_group_provenance' };
  }

  const sourceIds = Array.from(new Set(resolved.map((entry) => entry.sourceId).filter(Boolean)));
  return {
    mode,
    sourceType: resolved[0].sourceType,
    sourceId: sourceIds.length === 1 ? sourceIds[0] : null,
    funder: resolved[0].funder,
    reason: resolved.every((entry) => entry.reason === 'explicit_provenance')
      ? 'explicit_group_provenance'
      : resolved[0].reason,
  };
}
