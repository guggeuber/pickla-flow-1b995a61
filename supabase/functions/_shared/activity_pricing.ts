import { resolveCustomerIdForUser } from './customers.ts';

const DEFAULT_DAY_ACCESS_PRICE_SEK = 199;
const PLAYING_HOST_ROLE = 'playing_host';
const LEGACY_HOST_COMP = 'host_comp';

function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function applyPercentDiscount(baseAmount: number, percent: number) {
  return Math.max(0, roundSek(baseAmount * (1 - (percent / 100))));
}

function clampPercent(value: unknown) {
  return Math.min(100, Math.max(0, Math.round(Number(value || 0))));
}

function defaultProductKeyForSession(sessionType?: string | null) {
  if (sessionType === 'open_play') return 'open_play_slot';
  if (sessionType === 'group_training') return 'group_training';
  return 'session_ticket';
}

function formatSek(amount: number) {
  return `${roundSek(amount).toLocaleString('sv-SE', {
    minimumFractionDigits: Number.isInteger(roundSek(amount)) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function isPositiveEntitlement(row: any, type: string) {
  return row?.entitlement_type === type && Number(row.value ?? 1) > 0;
}

function boolFromMetadata(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  return String(value) === 'true';
}

function isPlayingHostReason(value: unknown) {
  return value === PLAYING_HOST_ROLE || value === LEGACY_HOST_COMP;
}

function normalizeChannel(value: unknown) {
  const channel = String(value || 'online').toLowerCase();
  return ['online', 'desk', 'member', 'guest', 'corporate', 'affiliate', 'host', 'ambassador', 'promo'].includes(channel)
    ? channel
    : 'online';
}

export type ActivityPricingDecision = {
  activitySessionId: string;
  sessionDate: string;
  productKey: string;
  productKind: string | null;
  baseAmountSek: number;
  finalAmountSek: number;
  effectivePriceSek: number;
  requiresCheckout: boolean;
  checkoutLabel: string;
  pricingReason: string;
  accessDecision: 'paid' | 'membership_included' | 'day_access_included' | 'free_day_pass';
  entitlementType: string;
  membershipId: string | null;
  membershipTierName: string | null;
  sourceId: string | null;
  debug: Record<string, unknown>;
};

export async function resolveActivityPricingDecision({
  client,
  venueId,
  userId,
  activitySessionId,
  sessionDate,
  requestedProductKey,
  requestedAmountSek,
  purchaseKind = 'activity_ticket',
  salesChannel = 'online',
  session: providedSession,
  productCache,
}: {
  client: any;
  venueId: string;
  userId?: string | null;
  activitySessionId: string;
  sessionDate: string;
  requestedProductKey?: string | null;
  requestedAmountSek?: number | null;
  purchaseKind?: 'activity_ticket' | 'day_pass';
  salesChannel?: string | null;
  session?: any | null;
  productCache?: Map<string, Promise<any>>;
}): Promise<ActivityPricingDecision> {
  const session = providedSession?.id
    ? providedSession
    : (await client
      .from('activity_sessions')
      .select('id, venue_id, name, session_type, price_sek, product_key, access_policy, metadata')
      .eq('id', activitySessionId)
      .maybeSingle()).data;

  if (!session?.id || session.venue_id !== venueId) {
    throw new Error('Activity session not found for venue');
  }

  const sessionProductKey = purchaseKind === 'activity_ticket' && session.product_key === 'day_access'
    ? null
    : session.product_key;
  const productKey = String(
    purchaseKind === 'day_pass'
      ? (requestedProductKey || 'day_access')
      : (sessionProductKey || defaultProductKeyForSession(session.session_type) || requestedProductKey),
  );

  const productCacheKey = `${venueId}:${productKey}`;
  const productPromise = productCache?.get(productCacheKey) || client
    .from('access_products')
    .select('product_key, product_kind, base_price_sek, session_type')
    .eq('venue_id', venueId)
    .eq('product_key', productKey)
    .eq('is_active', true)
    .maybeSingle()
    .then((res: any) => res.data);
  if (productCache && !productCache.has(productCacheKey)) {
    productCache.set(productCacheKey, productPromise);
  }
  const product = await productPromise;

  const productBaseAmountSek = Number(product?.base_price_sek ?? 0);
  const fallbackBaseAmountSek = productKey === 'day_access'
    ? DEFAULT_DAY_ACCESS_PRICE_SEK
    : Number(requestedAmountSek || 0);
  const sessionMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const onlinePriceSek = Number(sessionMetadata.online_price_sek ?? session.price_sek ?? 0);
  const deskPriceSek = Number(sessionMetadata.desk_price_sek ?? onlinePriceSek);
  const channel = normalizeChannel(salesChannel || sessionMetadata.default_sales_channel);
  const channelBaseAmountSek = channel === 'desk' && deskPriceSek > 0
    ? deskPriceSek
    : onlinePriceSek > 0
    ? onlinePriceSek
    : 0;
  const baseAmountSek = roundSek(
    purchaseKind !== 'day_pass' && channelBaseAmountSek > 0
      ? channelBaseAmountSek
      : productBaseAmountSek > 0
      ? productBaseAmountSek
      : fallbackBaseAmountSek,
  );

  let finalAmountSek = baseAmountSek;
  let accessDecision: ActivityPricingDecision['accessDecision'] = 'paid';
  let entitlementType = '';
  let membershipId: string | null = null;
  let membershipTierName: string | null = null;
  let sourceId: string | null = null;
  let pricingReason = 'regular_price';
  const rawPricingMode = String(sessionMetadata.pricing_mode || 'standard');
  const pricingMode = rawPricingMode === 'fixed_ticket' || rawPricingMode === 'member_discount'
    ? rawPricingMode
    : 'standard';
  const memberDiscountPercent = clampPercent(sessionMetadata.member_discount_percent);
  const dayPassIncluded = pricingMode === 'standard'
    ? boolFromMetadata(sessionMetadata.day_pass_included, session.access_policy?.allows_day_access !== false)
    : false;
  const membershipIncluded = pricingMode === 'standard'
    ? boolFromMetadata(sessionMetadata.membership_included, true)
    : false;
  const debug: Record<string, unknown> = {
    session_product_key: session.product_key || null,
    requested_product_key: requestedProductKey || null,
    resolved_product_key: productKey,
    product_kind: product?.product_kind || null,
    purchase_kind: purchaseKind,
    product_base_amount_sek: product?.base_price_sek ?? null,
    base_amount_sek: baseAmountSek,
    online_price_sek: onlinePriceSek || null,
    desk_price_sek: deskPriceSek || null,
    sales_channel: channel,
    channel_price_sek: channelBaseAmountSek || null,
    channel_prices: {
      online: onlinePriceSek || null,
      desk: deskPriceSek || null,
      member: null,
      guest: onlinePriceSek || null,
      corporate: null,
      affiliate: null,
      host: null,
      ambassador: null,
      promo: null,
    },
    pricing_channel_mode: sessionMetadata.pricing_channel_mode || null,
    pricing_mode: pricingMode,
    member_discount_percent: memberDiscountPercent,
    day_pass_included: dayPassIncluded,
    membership_included: membershipIncluded,
  };

  if (purchaseKind === 'activity_ticket' && userId) {
    const customerId = await resolveCustomerIdForUser(client, userId);
    if (customerId) {
      const { data: hostAssignment, error: hostError } = await client
        .from('activity_session_hosts')
        .select('id, customer_id')
        .eq('venue_id', venueId)
        .eq('activity_session_id', activitySessionId)
        .eq('customer_id', customerId)
        .eq('status', 'active')
        .maybeSingle();

      if (hostError) {
        console.error('playing host lookup failed', hostError.message);
      }

      if (hostAssignment?.id) {
        finalAmountSek = 0;
        accessDecision = 'membership_included';
        entitlementType = PLAYING_HOST_ROLE;
        pricingReason = PLAYING_HOST_ROLE;
        sourceId = hostAssignment.id;
        debug.playing_host = true;
        debug.host_customer_id = customerId;
        debug.host_assignment_id = hostAssignment.id;
        debug.pricing_source = PLAYING_HOST_ROLE;
        debug.channel_prices = {
          ...(debug.channel_prices as Record<string, unknown>),
          host: 0,
        };
      }
    }
  }

  if (pricingMode === 'fixed_ticket' && purchaseKind === 'activity_ticket') {
    if (!isPlayingHostReason(pricingReason)) pricingReason = 'session_fixed_ticket_price';
  } else if (userId && finalAmountSek > 0) {
    const { data: dayAccess } = await client
      .from('access_entitlements')
      .select('id, source_id')
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('entitlement_type', 'day_access')
      .eq('status', 'active')
      .eq('valid_date', sessionDate)
      .limit(1)
      .maybeSingle();

    if (purchaseKind === 'activity_ticket' && dayPassIncluded && dayAccess?.id) {
      finalAmountSek = 0;
      accessDecision = 'day_access_included';
      entitlementType = 'day_access';
      pricingReason = 'active_day_access';
      sourceId = dayAccess.id;
      debug.day_access_entitlement_id = dayAccess.id;
    }

    if (purchaseKind === 'activity_ticket' && pricingMode === 'member_discount' && finalAmountSek > 0) {
      const { data: membership } = await client
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership?.tier_id) {
        membershipId = membership.id;
        const { data: tier } = await client
          .from('membership_tiers')
          .select('name')
          .eq('id', membership.tier_id)
          .maybeSingle();
        membershipTierName = tier?.name || null;
        finalAmountSek = applyPercentDiscount(baseAmountSek, memberDiscountPercent);
        if (finalAmountSek <= 0) {
          accessDecision = 'membership_included';
          entitlementType = 'session_member_discount';
        }
        pricingReason = 'session_member_discount';
        debug.membership_tier_name = membershipTierName;
        debug.pricing_source = 'session_member_discount';
      }
    }

    if (finalAmountSek > 0) {
      const { data: membership } = await client
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (membership?.tier_id) {
        membershipId = membership.id;
        const [{ data: entitlements }, { data: tierPricingRows }, { data: tier }] = await Promise.all([
          client
            .from('membership_entitlements')
            .select('entitlement_type, value, period, sport_type')
            .eq('tier_id', membership.tier_id),
          client
            .from('membership_tier_pricing')
            .select('product_type, fixed_price, discount_percent')
            .eq('tier_id', membership.tier_id)
            .eq('product_type', productKey),
          client
            .from('membership_tiers')
            .select('discount_percent, name')
            .eq('id', membership.tier_id)
            .maybeSingle(),
        ]);
        membershipTierName = tier?.name || null;
        debug.membership_tier_name = membershipTierName;

        const ents = (entitlements || []).filter((row: any) => (row.sport_type || 'pickleball') === 'pickleball');
        const openPlayUnlimited = ents.find((row: any) => isPositiveEntitlement(row, 'open_play_unlimited'));
        if (purchaseKind === 'activity_ticket' && membershipIncluded && openPlayUnlimited && (session.session_type || 'open_play') === 'open_play') {
          finalAmountSek = 0;
          accessDecision = 'membership_included';
          entitlementType = 'open_play_unlimited';
          pricingReason = 'membership_open_play_unlimited';
          debug.entitlement = 'open_play_unlimited';
        }

        if (finalAmountSek > 0 && (purchaseKind !== 'activity_ticket' || membershipIncluded)) {
          const tierPricingAmounts = (tierPricingRows || [])
            .filter((row: any) => row.fixed_price != null || row.discount_percent != null)
            .map((row: any) => {
              if (row.fixed_price != null) return roundSek(Number(row.fixed_price));
              return applyPercentDiscount(baseAmountSek, Number(row.discount_percent || 0));
            })
            .filter((amount: number) => Number.isFinite(amount) && amount >= 0);

          if (tierPricingAmounts.length > 0) {
            finalAmountSek = Math.min(...tierPricingAmounts);
            pricingReason = 'membership_tier_pricing';
            debug.pricing_source = 'membership_tier_pricing';
          } else {
            const fallbackDiscount = Number(tier?.discount_percent || 0);
            if (fallbackDiscount > 0) {
              finalAmountSek = applyPercentDiscount(baseAmountSek, fallbackDiscount);
              pricingReason = 'membership_tier_discount_percent';
              debug.pricing_source = 'membership_tier_discount_percent';
            }
          }
        }
      }
    }
  }

  finalAmountSek = roundSek(finalAmountSek);
  const checkoutLabel = finalAmountSek <= 0
    ? isPlayingHostReason(pricingReason)
      ? 'Ingår — du är värd'
      : accessDecision === 'day_access_included'
      ? 'Ingår idag'
      : 'Ingår'
    : formatSek(finalAmountSek);

  return {
    activitySessionId,
    sessionDate,
    productKey,
    productKind: product?.product_kind || null,
    baseAmountSek,
    finalAmountSek,
    effectivePriceSek: finalAmountSek,
    requiresCheckout: finalAmountSek > 0,
    checkoutLabel,
    pricingReason,
    accessDecision,
    entitlementType,
    membershipId,
    membershipTierName,
    sourceId,
    debug: {
      ...debug,
      final_amount_sek: finalAmountSek,
      access_decision: accessDecision,
      pricing_reason: pricingReason,
      entitlement_type: entitlementType,
      membership_id: membershipId,
      membership_tier_name: membershipTierName,
    },
  };
}
