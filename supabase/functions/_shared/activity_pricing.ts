import { resolveCustomerIdForUser } from './customers.ts';
import { activitySessionOccurrenceInterval } from './activity_session_time.ts';

const PLAYING_HOST_ROLE = 'playing_host';
const LEGACY_HOST_COMP = 'host_comp';
const PEOPLE_ROW_THRESHOLD = 3;
const CAPACITY_SCARCITY_CUTOFF = 0.3;

function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function minorToSek(value: unknown) {
  const minor = Math.round(Number(value || 0));
  return minor > 0 ? roundSek(minor / 100) : null;
}

function applyPercentDiscount(baseAmount: number, percent: number) {
  return Math.max(0, roundSek(baseAmount * (1 - (percent / 100))));
}

function clampPercent(value: unknown) {
  return Math.min(100, Math.max(0, Math.round(Number(value || 0))));
}

function positiveInt(value: unknown) {
  const parsed = Math.round(Number(value || 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function scarcityModeFrom(value: unknown) {
  const mode = String(value || 'none');
  return mode === 'early_bird' || mode === 'capacity' ? mode : 'none';
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

async function countActivityFill(client: any, venueId: string, activitySessionId: string, sessionDate: string) {
  const { data: fillRows, error: fillError } = await client.rpc('capacity_fill', {
    p_venue_id: venueId,
    p_scope_type: 'activity_session',
    p_scope_id: activitySessionId,
    p_session_date: sessionDate,
  });
  const fill = Array.isArray(fillRows) ? fillRows[0] : fillRows;
  if (!fillError && fill) {
    return Number(fill.fill_count || 0);
  }

  // Backward-compatible fallback for deployments where the R2 capacity RPC has
  // not been applied yet. Once the migration is live, capacity_fill is the
  // single read model for scarcity/early-bird fill.
  const { count, error } = await client
    .from('session_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('activity_session_id', activitySessionId)
    .eq('session_date', sessionDate)
    .not('status', 'in', '("cancelled","refunded")');
  if (error) {
    console.error('activity registration count failed', error.message);
    return 0;
  }
  return count || 0;
}

async function countActivityEarlyBirdFill(client: any, venueId: string, activitySessionId: string, sessionDate: string) {
  const { data: fillRows, error: fillError } = await client.rpc('activity_early_bird_fill', {
    p_venue_id: venueId,
    p_activity_session_id: activitySessionId,
    p_session_date: sessionDate,
  });
  const fill = Array.isArray(fillRows) ? fillRows[0] : fillRows;
  if (!fillError && fill) return Number(fill.fill_count || 0);

  const { count, error } = await client
    .from('session_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('activity_session_id', activitySessionId)
    .eq('session_date', sessionDate)
    .in('status', ['confirmed', 'checked_in', 'no_show'])
    .eq('metadata->>pricing_reason', 'early_bird');
  if (error) {
    console.error('early-bird allocation count failed', error.message);
    return 0;
  }
  return count || 0;
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
  accessDecision: 'paid' | 'membership_included' | 'day_access_included' | 'free_day_pass' | 'entitlement_included';
  entitlementType: string;
  accessReason: string | null;
  fundingType: string | null;
  funder: string | null;
  consumptionRequired: boolean;
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
  applyEarlyBird = true,
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
  applyEarlyBird?: boolean;
}): Promise<ActivityPricingDecision> {
  const session = providedSession?.id
    ? providedSession
    : (await client
      .from('activity_sessions')
      .select('id, venue_id, name, session_type, session_date, start_time, end_time, price_sek, capacity, product_key, access_policy, metadata, early_bird_price_minor, early_bird_slots, scarcity_mode')
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
    .select('product_key, product_kind, base_price_sek, session_type, early_bird_price_minor, early_bird_slots, scarcity_mode')
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
  const fallbackBaseAmountSek = Number(requestedAmountSek || 0);
  const sessionMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const earlyBirdPriceMinor = positiveInt(
    session.early_bird_price_minor ??
    sessionMetadata.early_bird_price_minor ??
    product?.early_bird_price_minor,
  );
  const earlyBirdSlots = positiveInt(
    session.early_bird_slots ??
    sessionMetadata.early_bird_slots ??
    product?.early_bird_slots,
  );
  const configuredScarcityMode = scarcityModeFrom(
    session.scarcity_mode ??
    sessionMetadata.scarcity_mode,
  );
  const scarcityMode = configuredScarcityMode;
  const shouldCountRegistrations = purchaseKind === 'activity_ticket' && scarcityMode !== 'none';
  const registrationsCount = shouldCountRegistrations
    ? await countActivityFill(client, venueId, activitySessionId, sessionDate)
    : 0;
  const earlyBirdFill = purchaseKind === 'activity_ticket' && scarcityMode === 'early_bird'
    ? await countActivityEarlyBirdFill(client, venueId, activitySessionId, sessionDate)
    : 0;
  const earlyBirdPriceSek = minorToSek(earlyBirdPriceMinor);
  const earlyBirdRemaining = earlyBirdSlots ? Math.max(earlyBirdSlots - earlyBirdFill, 0) : 0;
  const earlyBirdActive = applyEarlyBird && purchaseKind === 'activity_ticket' &&
    scarcityMode === 'early_bird' &&
    earlyBirdPriceSek != null &&
    Boolean(earlyBirdSlots) &&
    earlyBirdRemaining > 0;
  const capacity = positiveInt(session.capacity);
  const capacityRemaining = capacity ? Math.max(capacity - registrationsCount, 0) : null;
  const capacityScarcityActive = purchaseKind === 'activity_ticket' &&
    scarcityMode === 'capacity' &&
    Boolean(capacity) &&
    registrationsCount >= PEOPLE_ROW_THRESHOLD &&
    capacityRemaining != null &&
    capacityRemaining <= Math.ceil((capacity || 0) * CAPACITY_SCARCITY_CUTOFF);
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
  let accessReason: string | null = null;
  let fundingType: string | null = null;
  let funder: string | null = null;
  let consumptionRequired = false;
  let membershipId: string | null = null;
  let membershipTierName: string | null = null;
  let sourceId: string | null = null;
  let pricingReason = 'regular_price';
  let entitlementCustomerId: string | null = null;
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
    early_bird_applied_during_resolution: applyEarlyBird,
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
    scarcity: {
      mode: scarcityMode,
      registrations_count: registrationsCount,
      capacity,
      capacity_remaining: capacityRemaining,
      capacity_active: capacityScarcityActive,
      early_bird: {
        active: earlyBirdActive,
        price_minor: earlyBirdPriceMinor,
        price_sek: earlyBirdPriceSek,
        slots: earlyBirdSlots,
        remaining: earlyBirdRemaining,
        allocated_count: earlyBirdFill,
      },
    },
  };

  if (purchaseKind === 'activity_ticket' && userId) {
    entitlementCustomerId = await resolveCustomerIdForUser(client, userId);
    if (entitlementCustomerId) {
      const { data: hostAssignment, error: hostError } = await client
        .from('activity_session_hosts')
        .select('id, customer_id')
        .eq('venue_id', venueId)
        .eq('activity_session_id', activitySessionId)
        .eq('customer_id', entitlementCustomerId)
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
        funder = 'house_comped';
        debug.playing_host = true;
        debug.host_customer_id = entitlementCustomerId;
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
      .select('id, funder')
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
      funder = String(dayAccess.funder || '') || null;
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
          funder = 'subscription';
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
          funder = 'subscription';
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

  // Existing Founder, membership and day-access semantics above remain authoritative.
  // Only the new occurrence/partner types enter through the canonical resolver, and
  // they override paid/member-discount amounts before Early Bird is considered.
  if (purchaseKind === 'activity_ticket' && userId && finalAmountSek > 0) {
    entitlementCustomerId ||= await resolveCustomerIdForUser(client, userId);
    if (entitlementCustomerId) {
      const occurrence = activitySessionOccurrenceInterval(sessionDate, session.start_time, session.end_time);
      const { data: canonicalAccess, error: canonicalError } = await client.rpc('resolve_access_entitlement', {
        p_venue_id: venueId,
        p_customer_id: entitlementCustomerId,
        p_user_id: userId,
        p_activity_session_id: activitySessionId,
        p_service_date: sessionDate,
        p_at: occurrence?.startISO || new Date().toISOString(),
        p_product_key: productKey,
        p_access_context: { entitlement_types: ['punch_card', 'partner_access'] },
      });
      if (canonicalError) {
        console.error('canonical activity entitlement lookup failed', canonicalError.message);
      } else if (canonicalAccess?.covered && ['punch_card', 'partner_access'].includes(String(canonicalAccess.entitlement_type || ''))) {
        finalAmountSek = 0;
        accessDecision = 'entitlement_included';
        entitlementType = String(canonicalAccess.entitlement_type);
        accessReason = String(canonicalAccess.access_reason || '') || null;
        fundingType = String(canonicalAccess.funding_type || '') || null;
        funder = String(canonicalAccess.funder || '') || null;
        consumptionRequired = Boolean(canonicalAccess.consumption_required);
        sourceId = String(canonicalAccess.entitlement_id || '') || null;
        pricingReason = entitlementType;
        debug.pricing_source = entitlementType;
        debug.canonical_entitlement = {
          id: sourceId,
          type: entitlementType,
          access_reason: accessReason,
          meter_type: canonicalAccess.meter_type || null,
          remaining_uses: canonicalAccess.remaining_uses ?? null,
          funding_type: fundingType,
          funder,
          consumption_required: consumptionRequired,
        };
      }
    }
  }

  if (earlyBirdActive && earlyBirdPriceSek != null && finalAmountSek > 0) {
    if (earlyBirdPriceSek < finalAmountSek) {
      debug.before_early_bird_amount_sek = finalAmountSek;
      finalAmountSek = earlyBirdPriceSek;
      pricingReason = 'early_bird';
      debug.pricing_source = 'early_bird';
    } else {
      debug.early_bird_not_applied_reason = 'member_or_channel_price_lower';
    }
  }

  finalAmountSek = roundSek(finalAmountSek);
  const checkoutLabel = finalAmountSek <= 0
    ? isPlayingHostReason(pricingReason)
      ? 'Ingår — du är värd'
      : accessDecision === 'day_access_included'
      ? 'Ingår idag'
      : accessReason || 'Ingår'
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
    accessReason,
    fundingType,
    funder,
    consumptionRequired,
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
