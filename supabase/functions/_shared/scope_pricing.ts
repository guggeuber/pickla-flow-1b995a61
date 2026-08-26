import {
  activityCustomerPricePresentation,
  resolveActivityPricingDecision,
  type ActivityPricingDecision,
  type FirstVisitEligibility,
} from './activity_pricing.ts';
import { roundSek, selectPositiveMembershipProductPrice } from './pricing_math.ts';

export type PricingScopeType = 'activity_session' | 'activity_series';

type AccessProductInput = {
  id: string;
  venue_id: string;
  product_key: string;
  product_kind?: string | null;
  base_price_sek?: number | string | null;
  scarcity_mode?: string | null;
  early_bird_price_minor?: number | string | null;
  early_bird_slots?: number | string | null;
  resolver_rules?: Record<string, unknown> | null;
};

type CommonPricingInput = {
  client: any;
  venueId: string;
  organizationId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  salesChannel?: string | null;
  effectiveAt?: string | null;
  accessProduct?: AccessProductInput | null;
};

export type ActivitySessionPricingInput = CommonPricingInput & {
  scopeType: 'activity_session';
  scopeId: string;
  sessionDate: string;
  requestedProductKey?: string | null;
  requestedAmountSek?: number | null;
  purchaseKind?: 'activity_ticket' | 'day_pass';
  session?: any | null;
  productCache?: Map<string, Promise<any>>;
  applyEarlyBird?: boolean;
  applyFirstVisit?: boolean;
  firstVisitEligibility?: FirstVisitEligibility;
};

export type ActivitySeriesPricingInput = CommonPricingInput & {
  scopeType: 'activity_series';
  scopeId: string;
  series?: any | null;
  applyEarlyBird?: boolean;
};

export type ScopeAwarePricingInput = ActivitySessionPricingInput | ActivitySeriesPricingInput;

export type SeriesFillContext = {
  capacity: number | null;
  committedCount: number;
  activeHoldsCount: number;
  fillCount: number;
  availableCount: number | null;
};

export type ScopeAwarePricingDecision = Omit<ActivityPricingDecision, 'activitySessionId' | 'sessionDate'> & {
  scopeType: PricingScopeType;
  scopeId: string;
  activitySessionId: string | null;
  activitySeriesId: string | null;
  sessionDate: string | null;
  accessProductId: string | null;
  salesChannel: string;
  listAmountSek: number;
  seriesFill: SeriesFillContext | null;
};

function formatSek(amount: number) {
  const rounded = roundSek(amount);
  return `${rounded.toLocaleString('sv-SE', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function normalizeChannel(value: unknown) {
  const channel = String(value || 'online').toLowerCase();
  return ['online', 'desk', 'member', 'guest', 'corporate', 'affiliate', 'host', 'ambassador', 'promo'].includes(channel)
    ? channel
    : 'online';
}

function stockholmCalendarDate(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function seriesFillContext(client: any, venueId: string, series: any): Promise<SeriesFillContext> {
  const { data, error } = await client.rpc('capacity_fill', {
    p_venue_id: venueId,
    p_scope_type: 'activity_series',
    p_scope_id: series.id,
    p_session_date: series.start_date,
  });
  if (error) throw new Error(error.message);
  const fill = Array.isArray(data) ? data[0] : data;
  return {
    capacity: fill?.capacity == null ? null : Number(fill.capacity),
    committedCount: Number(fill?.committed_count || 0),
    activeHoldsCount: Number(fill?.active_holds_count || 0),
    fillCount: Number(fill?.fill_count || 0),
    availableCount: fill?.available_count == null ? null : Number(fill.available_count),
  };
}

async function membershipIdentityUserId(client: any, userId?: string | null, customerId?: string | null) {
  if (userId) return userId;
  if (!customerId) return null;
  const { data, error } = await client
    .from('customers')
    .select('auth_user_id')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.auth_user_id || '') || null;
}

async function resolveSeriesPricingDecision(input: ActivitySeriesPricingInput): Promise<ScopeAwarePricingDecision> {
  const series = input.series?.id
    ? input.series
    : (await input.client
      .from('activity_series')
      .select('id, venue_id, access_product_id, start_date, end_date, capacity')
      .eq('id', input.scopeId)
      .eq('venue_id', input.venueId)
      .maybeSingle()).data;
  if (!series?.id || series.venue_id !== input.venueId || !series.start_date) {
    throw new Error('Activity series not found for venue');
  }

  const product = input.accessProduct?.id
    ? input.accessProduct
    : (await input.client
      .from('access_products')
      .select('id, venue_id, product_key, product_kind, base_price_sek, scarcity_mode, early_bird_price_minor, early_bird_slots, resolver_rules')
      .eq('id', series.access_product_id)
      .eq('venue_id', input.venueId)
      .maybeSingle()).data;
  if (!product?.id || product.venue_id !== input.venueId || product.id !== series.access_product_id) {
    throw new Error('Series access product not found for venue');
  }

  const baseAmountSek = roundSek(Number(product.base_price_sek || 0));
  if (baseAmountSek <= 0) throw new Error('Series access product has no price');
  const channel = normalizeChannel(input.salesChannel);
  const fill = await seriesFillContext(input.client, input.venueId, series);
  const pricingUserId = await membershipIdentityUserId(input.client, input.userId, input.customerId);

  let finalAmountSek = baseAmountSek;
  let pricingReason = 'series_product_base_price';
  const accessDecision: ActivityPricingDecision['accessDecision'] = 'paid';
  let membershipId: string | null = null;
  let membershipTierName: string | null = null;
  if (pricingUserId) {
    const pricingDate = stockholmCalendarDate(input.effectiveAt);
    let membershipQuery = input.client
      .from('memberships')
      .select('id, tier_id, customer_id, starts_at, expires_at')
      .eq('user_id', pricingUserId)
      .eq('venue_id', input.venueId)
      .eq('status', 'active')
      .lte('starts_at', pricingDate)
      .or(`expires_at.is.null,expires_at.gte.${pricingDate}`);
    if (input.customerId) {
      membershipQuery = membershipQuery.or(`customer_id.is.null,customer_id.eq.${input.customerId}`);
    }
    const { data: membership, error: membershipError } = await membershipQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (membership?.tier_id) {
      const [{ data: tierPricingRows, error: pricingError }, { data: tier, error: tierError }] = await Promise.all([
        input.client
          .from('membership_tier_pricing')
          .select('fixed_price, discount_percent')
          .eq('tier_id', membership.tier_id)
          .eq('product_type', product.product_key)
          .is('pricing_rule_id', null),
        input.client
          .from('membership_tiers')
          .select('name, is_active, is_assignable')
          .eq('id', membership.tier_id)
          .maybeSingle(),
      ]);
      if (pricingError) throw new Error(pricingError.message);
      if (tierError) throw new Error(tierError.message);
      const tierEligible = tier?.is_active === true || tier?.is_assignable === true;
      const memberAmountSek = tierEligible
        ? selectPositiveMembershipProductPrice(baseAmountSek, tierPricingRows || [])
        : null;
      if (memberAmountSek != null) {
        finalAmountSek = memberAmountSek;
        pricingReason = 'membership_tier_pricing';
        membershipId = membership.id;
        membershipTierName = tier?.name || null;
      }
    }
  }

  const earlyBirdPriceMinor = Math.round(Number(product.early_bird_price_minor || 0));
  const earlyBirdSlots = Math.floor(Number(product.early_bird_slots || 0));
  const earlyBirdConfigured = product.scarcity_mode === 'early_bird';
  if (earlyBirdConfigured && (
    earlyBirdPriceMinor <= 0
    || earlyBirdSlots < 1
    || earlyBirdPriceMinor >= Math.round(baseAmountSek * 100)
    || (fill.capacity != null && earlyBirdSlots > fill.capacity)
  )) {
    throw new Error('Series Early Bird configuration is invalid');
  }
  let earlyBirdAllocatedCount = 0;
  let earlyBirdRemaining = 0;
  let earlyBirdApplied = false;
  if (earlyBirdConfigured) {
    const { data: earlyBirdFillRows, error: earlyBirdFillError } = await input.client.rpc('series_early_bird_fill', {
      p_venue_id: input.venueId,
      p_activity_series_id: series.id,
    });
    if (earlyBirdFillError) throw new Error(earlyBirdFillError.message);
    const earlyBirdFill = Array.isArray(earlyBirdFillRows) ? earlyBirdFillRows[0] : earlyBirdFillRows;
    earlyBirdAllocatedCount = Number(earlyBirdFill?.fill_count || 0);
    earlyBirdRemaining = Math.max(earlyBirdSlots - earlyBirdAllocatedCount, 0);
    if (input.applyEarlyBird !== false && earlyBirdRemaining > 0 && earlyBirdPriceMinor < Math.round(finalAmountSek * 100)) {
      finalAmountSek = roundSek(earlyBirdPriceMinor / 100);
      pricingReason = 'early_bird';
      earlyBirdApplied = true;
    }
  }

  const checkoutLabel = formatSek(finalAmountSek);
  const customerPresentation = activityCustomerPricePresentation({
    identifiedCustomer: Boolean(input.userId || input.customerId),
    finalAmountSek,
    baseAmountSek,
    checkoutLabel,
    firstVisitApplied: false,
    firstVisitPriceSek: 0,
    firstVisitRegularPriceSek: finalAmountSek,
  });
  const debug = {
    scope_type: 'activity_series',
    scope_id: series.id,
    activity_series_id: series.id,
    organization_id: input.organizationId || null,
    access_product_id: product.id,
    product_key: product.product_key,
    product_kind: product.product_kind || null,
    product_base_amount_sek: baseAmountSek,
    base_amount_sek: baseAmountSek,
    final_amount_sek: finalAmountSek,
    sales_channel: channel,
    pricing_reason: pricingReason,
    pricing_source: pricingReason,
    access_decision: accessDecision,
    membership_id: membershipId,
    membership_tier_name: membershipTierName,
    early_bird: {
      configured: earlyBirdConfigured,
      active: earlyBirdConfigured && earlyBirdRemaining > 0,
      applied: earlyBirdApplied,
      price_minor: earlyBirdConfigured ? earlyBirdPriceMinor : null,
      slots: earlyBirdConfigured ? earlyBirdSlots : null,
      allocated_count: earlyBirdAllocatedCount,
      remaining: earlyBirdConfigured ? earlyBirdRemaining : null,
      superseded_by: earlyBirdConfigured && !earlyBirdApplied && earlyBirdRemaining > 0
        ? pricingReason
        : null,
    },
    effective_at: input.effectiveAt || new Date().toISOString(),
    series_fill: {
      capacity: fill.capacity,
      committed_count: fill.committedCount,
      active_holds_count: fill.activeHoldsCount,
      fill_count: fill.fillCount,
      available_count: fill.availableCount,
    },
    entitlement_scope_support: 'series_purchase_entitlement_not_applied_without_commitment_funding_contract',
    future_rules: ['series_channel_price', 'series_promo'],
  };

  return {
    scopeType: 'activity_series',
    scopeId: series.id,
    activitySessionId: null,
    activitySeriesId: series.id,
    sessionDate: null,
    accessProductId: product.id,
    salesChannel: channel,
    productKey: product.product_key,
    productKind: product.product_kind || null,
    baseAmountSek,
    listAmountSek: baseAmountSek,
    finalAmountSek,
    effectivePriceSek: finalAmountSek,
    requiresCheckout: true,
    checkoutLabel,
    pricingReason,
    accessDecision,
    entitlementType: '',
    accessReason: null,
    fundingType: null,
    funder: null,
    consumptionRequired: false,
    membershipId,
    membershipTierName,
    sourceId: null,
    customerPresentation,
    seriesFill: fill,
    debug,
  };
}

export async function resolveScopeAwarePricingDecision(
  input: ScopeAwarePricingInput,
): Promise<ScopeAwarePricingDecision> {
  if (input.scopeType === 'activity_series') return resolveSeriesPricingDecision(input);

  const decision = await resolveActivityPricingDecision({
    client: input.client,
    venueId: input.venueId,
    userId: input.userId,
    customerId: input.customerId,
    activitySessionId: input.scopeId,
    sessionDate: input.sessionDate,
    requestedProductKey: input.requestedProductKey,
    requestedAmountSek: input.requestedAmountSek,
    purchaseKind: input.purchaseKind,
    salesChannel: input.salesChannel,
    session: input.session,
    productCache: input.productCache,
    applyEarlyBird: input.applyEarlyBird,
    applyFirstVisit: input.applyFirstVisit,
    firstVisitEligibility: input.firstVisitEligibility,
  });
  return {
    ...decision,
    scopeType: 'activity_session',
    scopeId: input.scopeId,
    activitySessionId: input.scopeId,
    activitySeriesId: null,
    sessionDate: input.sessionDate,
    accessProductId: input.accessProduct?.id || null,
    salesChannel: normalizeChannel(input.salesChannel),
    listAmountSek: decision.baseAmountSek,
    seriesFill: null,
  };
}
