export type EntitlementScopeType =
  | 'exact_session'
  | 'activity_series'
  | 'session_type'
  | 'product_key'
  | 'open_play'
  | 'venue'
  | 'selected_venues'
  | 'brand'
  | 'sport_type'
  | 'allowlist';

export type EntitlementMeterType = 'unlimited' | 'occurrences' | 'one_per_day' | 'valid_day' | 'exact_session';

export type EntitlementFundingType =
  | 'customer_prepaid'
  | 'subscription'
  | 'house_granted'
  | 'partner_funded'
  | 'legacy_import'
  | 'commerce_purchase';

export type CanonicalEntitlementFields = {
  model_version: 1 | 2;
  scope_type?: EntitlementScopeType;
  meter_type?: EntitlementMeterType;
  funding_type?: EntitlementFundingType;
  access_reason?: string;
  service_date?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  requires_consumption?: boolean;
};

export function canonicalEntitlementFields(input: {
  customerId?: string | null;
  scopeType: EntitlementScopeType;
  meterType: EntitlementMeterType;
  fundingType: EntitlementFundingType;
  accessReason: string;
  serviceDate?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  requiresConsumption?: boolean;
}): CanonicalEntitlementFields {
  // Account-later rows already have customerId. A rare pre-customer legacy path
  // remains version 1 rather than inventing ownership or provenance.
  if (!input.customerId) return { model_version: 1 };

  return {
    model_version: 2,
    scope_type: input.scopeType,
    meter_type: input.meterType,
    funding_type: input.fundingType,
    access_reason: input.accessReason,
    service_date: input.serviceDate || null,
    starts_at: input.startsAt || null,
    expires_at: input.expiresAt || null,
    requires_consumption: input.requiresConsumption ?? true,
  };
}
