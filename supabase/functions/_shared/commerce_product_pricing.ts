import { roundSek, selectPositiveMembershipProductPrice } from './pricing_math.ts';
import type { getServiceClient } from './auth.ts';

type CommercePricingClient = ReturnType<typeof getServiceClient>;

type MembershipPriceRow = {
  product_type: string;
  fixed_price: number | string | null;
  discount_percent: number | string | null;
};

export type CommerceProductPricingContext = {
  membershipId: string | null;
  membershipTierId: string | null;
  membershipTierName: string | null;
  rows: MembershipPriceRow[];
};

export type CommerceProductPrice = {
  public_price_minor: number;
  resolved_price_minor: number;
  discount_minor: number;
  pricing_source: 'product_base_price' | 'variant_price_override' | 'membership_tier_pricing';
  membership_id: string | null;
  membership_tier_id: string | null;
  membership_tier_name: string | null;
};

function stockholmDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function pricingIdentityUserId(client: CommercePricingClient, userId?: string | null, customerId?: string | null) {
  if (userId) return userId;
  if (!customerId) return null;
  const { data, error } = await client.from('customers')
    .select('auth_user_id').eq('id', customerId).maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.auth_user_id || '') || null;
}

/**
 * Loads the existing membership_tier_pricing contract once for a Storefront
 * request. It does not introduce Storefront-specific price rules.
 */
export async function loadCommerceProductPricingContext(input: {
  client: CommercePricingClient;
  venueId: string;
  userId?: string | null;
  customerId?: string | null;
}): Promise<CommerceProductPricingContext> {
  const pricingUserId = await pricingIdentityUserId(input.client, input.userId, input.customerId);
  if (!pricingUserId) {
    return { membershipId: null, membershipTierId: null, membershipTierName: null, rows: [] };
  }

  let membershipQuery = input.client.from('memberships')
    .select('id, tier_id, customer_id')
    .eq('user_id', pricingUserId)
    .eq('venue_id', input.venueId)
    .eq('status', 'active')
    .lte('starts_at', stockholmDate())
    .or(`expires_at.is.null,expires_at.gte.${stockholmDate()}`);
  if (input.customerId) {
    membershipQuery = membershipQuery.or(`customer_id.is.null,customer_id.eq.${input.customerId}`);
  }
  const { data: membership, error: membershipError } = await membershipQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership?.tier_id) {
    return { membershipId: null, membershipTierId: null, membershipTierName: null, rows: [] };
  }

  const [{ data: tier, error: tierError }, { data: rows, error: rowsError }] = await Promise.all([
    input.client.from('membership_tiers')
      .select('id, name, is_active, is_assignable')
      .eq('id', membership.tier_id)
      .eq('venue_id', input.venueId)
      .maybeSingle(),
    input.client.from('membership_tier_pricing')
      .select('product_type, fixed_price, discount_percent')
      .eq('tier_id', membership.tier_id)
      .is('pricing_rule_id', null),
  ]);
  if (tierError || rowsError) throw new Error(tierError?.message || rowsError?.message);
  if (!tier || (tier.is_active !== true && tier.is_assignable !== true)) {
    return { membershipId: null, membershipTierId: null, membershipTierName: null, rows: [] };
  }
  return {
    membershipId: membership.id,
    membershipTierId: tier.id,
    membershipTierName: tier.name || null,
    rows: (rows || []) as MembershipPriceRow[],
  };
}

export function resolveCommerceProductPrice(input: {
  context: CommerceProductPricingContext;
  productKey: string;
  publicPriceMinor: number;
  publicSource?: 'product_base_price' | 'variant_price_override';
}): CommerceProductPrice {
  const publicPriceMinor = Math.max(0, Math.round(Number(input.publicPriceMinor || 0)));
  const productRows = input.context.rows.filter((row) => row.product_type === input.productKey);
  const memberAmountSek = selectPositiveMembershipProductPrice(publicPriceMinor / 100, productRows);
  const resolvedPriceMinor = memberAmountSek == null
    ? publicPriceMinor
    : Math.round(roundSek(memberAmountSek) * 100);
  const memberPriceApplied = resolvedPriceMinor < publicPriceMinor;
  return {
    public_price_minor: publicPriceMinor,
    resolved_price_minor: resolvedPriceMinor,
    discount_minor: Math.max(0, publicPriceMinor - resolvedPriceMinor),
    pricing_source: memberPriceApplied
      ? 'membership_tier_pricing'
      : input.publicSource || 'product_base_price',
    membership_id: memberPriceApplied ? input.context.membershipId : null,
    membership_tier_id: memberPriceApplied ? input.context.membershipTierId : null,
    membership_tier_name: memberPriceApplied ? input.context.membershipTierName : null,
  };
}
