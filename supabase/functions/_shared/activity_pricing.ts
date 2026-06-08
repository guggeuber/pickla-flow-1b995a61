import { DateTime } from 'https://esm.sh/luxon@3.5.0';

function roundSek(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function applyPercentDiscount(baseAmount: number, percent: number) {
  return Math.max(0, roundSek(baseAmount * (1 - (percent / 100))));
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
}: {
  client: any;
  venueId: string;
  userId?: string | null;
  activitySessionId: string;
  sessionDate: string;
  requestedProductKey?: string | null;
  requestedAmountSek?: number | null;
  purchaseKind?: 'activity_ticket' | 'day_pass';
}): Promise<ActivityPricingDecision> {
  const { data: session } = await client
    .from('activity_sessions')
    .select('id, venue_id, name, session_type, price_sek, product_key, access_policy')
    .eq('id', activitySessionId)
    .maybeSingle();

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

  const { data: product } = await client
    .from('access_products')
    .select('product_key, product_kind, base_price_sek, session_type')
    .eq('venue_id', venueId)
    .eq('product_key', productKey)
    .eq('is_active', true)
    .maybeSingle();

  const baseAmountSek = roundSek(
    purchaseKind !== 'day_pass' && session.price_sek != null
      ? Number(session.price_sek)
      : product?.base_price_sek != null
      ? Number(product.base_price_sek)
      : Number(requestedAmountSek || 0),
  );

  let finalAmountSek = baseAmountSek;
  let accessDecision: ActivityPricingDecision['accessDecision'] = 'paid';
  let entitlementType = '';
  let membershipId: string | null = null;
  let membershipTierName: string | null = null;
  let sourceId: string | null = null;
  let pricingReason = 'regular_price';
  const debug: Record<string, unknown> = {
    session_product_key: session.product_key || null,
    requested_product_key: requestedProductKey || null,
    resolved_product_key: productKey,
    product_kind: product?.product_kind || null,
    purchase_kind: purchaseKind,
    base_amount_sek: baseAmountSek,
  };

  if (userId) {
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

    if (dayAccess?.id) {
      finalAmountSek = 0;
      accessDecision = 'day_access_included';
      entitlementType = 'day_access';
      pricingReason = 'active_day_access';
      sourceId = dayAccess.id;
      debug.day_access_entitlement_id = dayAccess.id;
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
        if (openPlayUnlimited && (session.session_type || 'open_play') === 'open_play') {
          finalAmountSek = 0;
          accessDecision = 'membership_included';
          entitlementType = 'open_play_unlimited';
          pricingReason = 'membership_open_play_unlimited';
          debug.entitlement = 'open_play_unlimited';
        }

        if (finalAmountSek > 0) {
          const freePass = ents.find((row: any) => isPositiveEntitlement(row, 'free_day_pass_monthly'));
          const productKind = product?.product_kind || '';
          const canUseMonthlyFreePass = purchaseKind === 'day_pass' && (productKind === 'day_access' || productKind === 'session_with_day_access');

          if (freePass && canUseMonthlyFreePass) {
            const dt = DateTime.fromISO(sessionDate, { zone: 'Europe/Stockholm' });
            const monthStart = dt.startOf('month').toISODate()!;
            const { data: usage } = await client
              .from('membership_usage')
              .select('used_value')
              .eq('user_id', userId)
              .eq('venue_id', venueId)
              .eq('entitlement_type', 'free_day_pass_monthly')
              .eq('period_start', monthStart)
              .maybeSingle();

            if (Number(usage?.used_value || 0) < Number(freePass.value || 0)) {
              finalAmountSek = 0;
              accessDecision = 'free_day_pass';
              entitlementType = 'free_day_pass_monthly';
              pricingReason = 'membership_free_day_pass_monthly';
              debug.entitlement = 'free_day_pass_monthly';
              debug.free_pass_period_start = monthStart;
              debug.free_pass_period_end = dt.endOf('month').toISODate();
            }
          }
        }

        if (finalAmountSek > 0) {
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
    ? accessDecision === 'day_access_included'
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
