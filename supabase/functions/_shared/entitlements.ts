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

export type EntitlementFunder =
  | 'self_prepaid'
  | 'subscription'
  | 'house_comped'
  | 'partner'
  | 'employer'
  | 'sponsor';

export type EntitlementConsumptionTrigger = 'on_checkin' | 'on_commitment' | 'on_session_end';
export type EntitlementNoShowPolicy = 'do_not_consume' | 'consume' | 'manual_review';
export type EntitlementOccurrenceOrigin = 'paid' | 'promotional' | 'house_comped' | 'legacy_import';
export type EntitlementScarcityClass = 'non_scarce' | 'scarce';

export type CanonicalEntitlementFields = {
  model_version: 1 | 2;
  scope_type?: EntitlementScopeType;
  meter_type?: EntitlementMeterType;
  funding_type?: EntitlementFundingType;
  funder?: EntitlementFunder;
  access_reason?: string;
  service_date?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  requires_consumption?: boolean;
  consumption_trigger?: EntitlementConsumptionTrigger;
  no_show_policy?: EntitlementNoShowPolicy;
  occurrence_origin?: EntitlementOccurrenceOrigin | null;
  constitution_version?: 1;
  scope_schema_version?: 1;
  resolution_priority?: number;
  scarcity_class?: EntitlementScarcityClass;
  resolution_origin_priority?: number;
  resolution_expiry_at?: string | null;
};

export function canonicalEntitlementFields(input: {
  customerId?: string | null;
  scopeType: EntitlementScopeType;
  meterType: EntitlementMeterType;
  fundingType: EntitlementFundingType;
  funder: EntitlementFunder | null;
  accessReason: string;
  serviceDate?: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  requiresConsumption?: boolean;
  consumptionTrigger?: EntitlementConsumptionTrigger;
  noShowPolicy?: EntitlementNoShowPolicy;
  occurrenceOrigin: EntitlementOccurrenceOrigin | null;
  resolutionPriority: number;
  scarcityClass?: EntitlementScarcityClass;
  resolutionOriginPriority?: number;
  resolutionExpiryAt?: string | null;
}): CanonicalEntitlementFields {
  // Account-later rows already have customerId. A rare pre-customer or
  // unclassified historic path remains version 1 rather than inventing an
  // owner or funder. funding_type is provenance; it never determines funder.
  if (!input.customerId || !input.funder) return { model_version: 1 };

  return {
    model_version: 2,
    scope_type: input.scopeType,
    meter_type: input.meterType,
    funding_type: input.fundingType,
    funder: input.funder,
    access_reason: input.accessReason,
    service_date: input.serviceDate || null,
    starts_at: input.startsAt || null,
    expires_at: input.expiresAt || null,
    requires_consumption: input.requiresConsumption ?? true,
    consumption_trigger: input.consumptionTrigger || 'on_checkin',
    no_show_policy: input.noShowPolicy || 'do_not_consume',
    occurrence_origin: input.occurrenceOrigin,
    constitution_version: 1,
    scope_schema_version: 1,
    resolution_priority: input.resolutionPriority,
    scarcity_class: input.scarcityClass || 'non_scarce',
    resolution_origin_priority: input.resolutionOriginPriority ?? 0,
    resolution_expiry_at: input.resolutionExpiryAt || null,
  };
}
