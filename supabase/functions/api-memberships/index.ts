import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail } from '../_shared/bookings.ts';
import { resolveOrCreateCustomerIdForUser } from '../_shared/customers.ts';
import {
  membershipProductPriceMode,
  membershipProductPricePreview,
} from '../_shared/pricing_math.ts';

const PRODUCT_KEY = /^[a-z0-9_]+$/;

async function assertVenueAdmin(admin: ReturnType<typeof getServiceClient>, userId: string, venueId: string): Promise<boolean> {
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  if (role) return true;
  const { data: staff } = await admin.from('venue_staff').select('id').eq('user_id', userId).eq('venue_id', venueId).eq('is_active', true).maybeSingle();
  return !!staff;
}

function fullName(firstName?: string | null, lastName?: string | null, fallback?: string | null) {
  const structured = [firstName, lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return structured || fallback || null;
}

function splitDisplayName(displayName?: string | null) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

type TierPricingWrite = {
  tierId: string;
  productType: string;
  fixedPrice: number | null;
  discountPercent: number | null;
  product: {
    id: string;
    product_key: string;
    base_price_sek: number;
    product_kind: string;
  };
};

type MembershipProjectionRow = Record<string, unknown> & { user_id: string };
type ProfileProjectionRow = {
  auth_user_id: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};
function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function validatedTierPricingWrite(admin: ReturnType<typeof getServiceClient>, input: {
  tierId: string;
  productType: string;
  fixedPrice: unknown;
  discountPercent: unknown;
  excludeId?: string | null;
}): Promise<{ value?: TierPricingWrite; error?: string; status?: number }> {
  const { data: tier, error: tierError } = await admin.from('membership_tiers')
    .select('id, venue_id, is_active')
    .eq('id', input.tierId)
    .maybeSingle();
  if (tierError || !tier) return { error: 'Medlemsnivån finns inte', status: 404 };
  if (tier.is_active !== true) return { error: 'Medlemsnivån är inte aktiv', status: 409 };

  const productType = String(input.productType || '').trim();
  if (!PRODUCT_KEY.test(productType)) return { error: 'Produkten har en ogiltig produktnyckel', status: 400 };
  const { data: product, error: productError } = await admin.from('access_products')
    .select('id, venue_id, product_key, product_kind, base_price_sek, is_active, status')
    .eq('venue_id', tier.venue_id)
    .eq('product_key', productType)
    .maybeSingle();
  if (productError || !product) return { error: 'Produkten finns inte på medlemsnivåns anläggning', status: 404 };
  if (product.is_active !== true || product.status !== 'active') return { error: 'Produkten är inte aktiv', status: 409 };
  if (product.product_key !== productType) return { error: 'Produkten kan inte prissättas med den angivna produktnyckeln', status: 400 };

  const fixedPrice = optionalNumber(input.fixedPrice);
  const discountPercent = optionalNumber(input.discountPercent);
  if ((fixedPrice === null) === (discountPercent === null)) {
    return { error: 'Välj exakt en prismodell: fast pris eller procentuell rabatt', status: 400 };
  }
  if (fixedPrice !== null) {
    if (!Number.isFinite(fixedPrice) || fixedPrice <= 0) return { error: 'Medlemspriset måste vara högre än 0 kr', status: 400 };
    if (fixedPrice > Number(product.base_price_sek || 0)) return { error: 'Medlemspriset får inte överstiga ordinarie pris', status: 400 };
  }
  if (discountPercent !== null) {
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      return { error: 'Rabatten måste vara större än 0 och högst 100 procent', status: 400 };
    }
    if (product.product_kind === 'series_access' && discountPercent >= 100) {
      return { error: 'Serieprodukter stödjer inte gratis medlemspris; använd Friplats', status: 400 };
    }
  }

  let duplicateQuery = admin.from('membership_tier_pricing')
    .select('id')
    .eq('tier_id', input.tierId)
    .eq('product_type', productType)
    .limit(1);
  if (input.excludeId) duplicateQuery = duplicateQuery.neq('id', input.excludeId);
  const { data: duplicateRows, error: duplicateError } = await duplicateQuery;
  if (duplicateError) return { error: duplicateError.message, status: 500 };
  if (duplicateRows?.length) return { error: 'Det finns redan ett aktivt medlemspris för nivån och produkten', status: 409 };

  return {
    value: {
      tierId: input.tierId,
      productType,
      fixedPrice,
      discountPercent,
      product: {
        id: product.id,
        product_key: product.product_key,
        base_price_sek: Number(product.base_price_sek || 0),
        product_kind: product.product_kind,
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // ── PUBLIC: GET /tiers — membership plans are visible to everyone ──
    if (req.method === 'GET' && path === 'tiers') {
      const venueId = url.searchParams.get('venueId');
      const includeHidden = url.searchParams.get('includeHidden') === 'true';
      if (!venueId) return errorResponse('Missing venueId');

      const serviceClient = getServiceClient();
      let canSeeHidden = false;
      if (includeHidden) {
        const authHeader = req.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice('Bearer '.length);
          const { data: { user } } = await serviceClient.auth.getUser(token);
          canSeeHidden = !!user?.id && await assertVenueAdmin(serviceClient, user.id, venueId);
        }
      }

      let query = serviceClient.from('membership_tiers')
        .select('*')
        .eq('venue_id', venueId)
        .order('sort_order');
      if (!canSeeHidden) query = query.eq('is_active', true);

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 15);
    }

    // ── AUTHENTICATED: all mutating and sensitive endpoints ──
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    const admin = getServiceClient();

    // ── TIERS ──

    // POST /api-memberships/tiers
    if (req.method === 'POST' && path === 'tiers') {
      const body = await req.json();
      const { venueId, name, description, color, discount_percent, monthly_price, sort_order } = body;
      if (!venueId || !name) return errorResponse('Missing venueId or name');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const { data, error: iErr } = await admin.from('membership_tiers').insert({
        venue_id: venueId,
        name,
        description: description || null,
        color: color || '#E86C24',
        discount_percent: discount_percent || 0,
        monthly_price: monthly_price || 0,
        sort_order: sort_order || 0,
      }).select().single();
      if (iErr) return errorResponse(iErr.message);
      return jsonResponse(data, 201);
    }

    // PATCH /api-memberships/tiers
    if (req.method === 'PATCH' && path === 'tiers') {
      const body = await req.json();
      const { tierId, ...updates } = body;
      if (!tierId) return errorResponse('Missing tierId');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { data, error: uErr } = await admin.from('membership_tiers')
        .update(updates).eq('id', tierId).select().single();
      if (uErr) return errorResponse(uErr.message);
      return jsonResponse(data);
    }

    // DELETE /api-memberships/tiers?tierId=X
    if (req.method === 'DELETE' && path === 'tiers') {
      const tierId = url.searchParams.get('tierId');
      if (!tierId) return errorResponse('Missing tierId');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { error: dErr } = await admin.from('membership_tiers').delete().eq('id', tierId);
      if (dErr) return errorResponse(dErr.message);
      return jsonResponse({ ok: true });
    }

    // ── TIER PRICING ──

    // GET /api-memberships/tier-entitlements?tierId=X
    if (req.method === 'GET' && path === 'tier-entitlements') {
      const tierId = url.searchParams.get('tierId');
      if (!tierId) return errorResponse('Missing tierId');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { data, error: qErr } = await admin.from('membership_entitlements')
        .select('*')
        .eq('tier_id', tierId)
        .order('entitlement_type');
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data || [], 200, 15);
    }

    // PATCH /api-memberships/tier-entitlements
    if (req.method === 'PATCH' && path === 'tier-entitlements') {
      const body = await req.json();
      const { tierId, courtHoursPerWeek, openPlayUnlimited, guestDayVouchersMonthly } = body;
      if (!tierId) return errorResponse('Missing tierId');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const rows = [
        {
          tier_id: tierId,
          entitlement_type: 'court_hours_per_week',
          value: Math.max(0, Number(courtHoursPerWeek || 0)),
          period: 'week',
          sport_type: 'pickleball',
        },
        {
          tier_id: tierId,
          entitlement_type: 'open_play_unlimited',
          value: openPlayUnlimited ? 1 : 0,
          period: null,
          sport_type: 'pickleball',
        },
        {
          tier_id: tierId,
          entitlement_type: 'guest_day_vouchers_monthly',
          value: Math.max(0, Number(guestDayVouchersMonthly || 0)),
          period: 'month',
          sport_type: 'pickleball',
        },
      ];

      const { data, error: upsertErr } = await admin.from('membership_entitlements')
        .upsert(rows, { onConflict: 'tier_id,entitlement_type,sport_type' })
        .select('*');
      if (upsertErr) return errorResponse(upsertErr.message);
      return jsonResponse(data);
    }

    // GET /api-memberships/tier-pricing?tierId=X
    if (req.method === 'GET' && path === 'tier-pricing') {
      const tierId = url.searchParams.get('tierId');
      if (!tierId) return errorResponse('Missing tierId');

      const { data, error: qErr } = await client.from('membership_tier_pricing')
        .select('*').eq('tier_id', tierId);
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data);
    }

    // GET /api-memberships/series-tier-pricing?venueId=X
    // Deterministic operator preview over the same product rules consumed by
    // the scope-aware Series resolver. It never writes Series pricing fields.
    if (req.method === 'GET' && path === 'series-tier-pricing') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const [{ data: tiers, error: tierError }, { data: seriesRows, error: seriesError }] = await Promise.all([
        admin.from('membership_tiers')
          .select('id, name, color, sort_order')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name'),
        admin.from('activity_series')
          .select('id, access_product_id')
          .eq('venue_id', venueId)
          .not('format_id', 'is', null)
          .not('access_product_id', 'is', null)
          .not('status', 'eq', 'cancelled'),
      ]);
      if (tierError || seriesError) return errorResponse(tierError?.message || seriesError?.message || 'Medlemspriser kunde inte hämtas');

      const productIds = [...new Set((seriesRows || []).map((series) => series.access_product_id).filter(Boolean))];
      const { data: products, error: productError } = productIds.length
        ? await admin.from('access_products')
          .select('id, venue_id, product_key, product_kind, name, base_price_sek, is_active, status')
          .eq('venue_id', venueId)
          .in('id', productIds)
        : { data: [], error: null };
      if (productError) return errorResponse(productError.message);

      const tierIds = (tiers || []).map((tier) => tier.id);
      const productKeys = (products || []).map((product) => product.product_key);
      const { data: pricingRows, error: pricingError } = tierIds.length && productKeys.length
        ? await admin.from('membership_tier_pricing')
          .select('id, tier_id, product_type, pricing_rule_id, fixed_price, discount_percent, vat_rate, label')
          .in('tier_id', tierIds)
          .in('product_type', productKeys)
          .is('pricing_rule_id', null)
        : { data: [], error: null };
      if (pricingError) return errorResponse(pricingError.message);

      const duplicateKey = new Set<string>();
      const seen = new Set<string>();
      for (const row of pricingRows || []) {
        const key = `${row.tier_id}:${row.product_type}`;
        if (seen.has(key)) duplicateKey.add(key);
        seen.add(key);
      }
      if (duplicateKey.size) return errorResponse('Dubbla aktiva medlemsprisregler måste rättas innan Series kan redigeras', 409);

      const productById = new Map((products || []).map((product) => [product.id, product]));
      const series = (seriesRows || []).map((seriesRow) => {
        const product = productById.get(seriesRow.access_product_id);
        const basePriceSek = Number(product?.base_price_sek || 0);
        return {
          series_id: seriesRow.id,
          product: product || null,
          tiers: (tiers || []).map((tier) => {
            const rule = (pricingRows || []).find((row) => row.tier_id === tier.id && row.product_type === product?.product_key) || null;
            const preview = rule ? membershipProductPricePreview(basePriceSek, rule) : null;
            return {
              tier,
              rule: rule ? { ...rule, mode: membershipProductPriceMode(rule) } : null,
              preview: preview ? {
                ordinary_price_sek: basePriceSek,
                resolved_price_sek: preview.finalAmountSek,
                mode: preview.mode,
                value: preview.value,
              } : null,
            };
          }),
        };
      });
      return jsonResponse({ series }, 200, 0);
    }

    // POST /api-memberships/tier-pricing
    if (req.method === 'POST' && path === 'tier-pricing') {
      const body = await req.json();
      const { tierId, product_type, fixed_price, discount_percent, vat_rate, label } = body;
      if (!tierId || !product_type) return errorResponse('Missing tierId or product_type');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).maybeSingle();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);
      const validation = await validatedTierPricingWrite(admin, {
        tierId,
        productType: product_type,
        fixedPrice: fixed_price,
        discountPercent: discount_percent,
      });
      if (!validation.value) return errorResponse(validation.error || 'Ogiltig medlemsprisregel', validation.status || 400);

      const { data, error: iErr } = await admin.from('membership_tier_pricing').insert({
        tier_id: tierId,
        product_type: validation.value.productType,
        fixed_price: validation.value.fixedPrice,
        discount_percent: validation.value.discountPercent,
        vat_rate: vat_rate ?? 6,
        label: label || null,
      }).select().single();
      if (iErr) return errorResponse(iErr.code === '23505' ? 'Det finns redan ett aktivt medlemspris för nivån och produkten' : iErr.message, iErr.code === '23505' ? 409 : 400);
      return jsonResponse(data, 201);
    }

    // DELETE /api-memberships/tier-pricing?id=X
    if (req.method === 'DELETE' && path === 'tier-pricing') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { data: tp } = await admin.from('membership_tier_pricing').select('tier_id').eq('id', id).maybeSingle();
      if (!tp) return errorResponse('Pricing not found', 404);
      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tp.tier_id).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { error: dErr } = await admin.from('membership_tier_pricing').delete().eq('id', id);
      if (dErr) return errorResponse(dErr.message);
      return jsonResponse({ ok: true });
    }

    // PATCH /api-memberships/tier-pricing
    if (req.method === 'PATCH' && path === 'tier-pricing') {
      const body = await req.json();
      const { id, product_type, fixed_price, discount_percent, vat_rate, label } = body;
      if (!id) return errorResponse('Missing id');

      const { data: tp } = await admin.from('membership_tier_pricing').select('tier_id, product_type, fixed_price, discount_percent').eq('id', id).maybeSingle();
      if (!tp) return errorResponse('Pricing not found', 404);
      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tp.tier_id).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const validation = await validatedTierPricingWrite(admin, {
        tierId: tp.tier_id,
        productType: product_type === undefined ? tp.product_type : product_type,
        fixedPrice: fixed_price === undefined ? tp.fixed_price : fixed_price,
        discountPercent: discount_percent === undefined ? tp.discount_percent : discount_percent,
        excludeId: id,
      });
      if (!validation.value) return errorResponse(validation.error || 'Ogiltig medlemsprisregel', validation.status || 400);

      const updates: Record<string, unknown> = {};
      updates.product_type = validation.value.productType;
      updates.fixed_price = validation.value.fixedPrice;
      updates.discount_percent = validation.value.discountPercent;
      if (vat_rate !== undefined) updates.vat_rate = vat_rate;
      if (label !== undefined) updates.label = label || null;

      const { data, error: uErr } = await admin.from('membership_tier_pricing')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();
      if (uErr) return errorResponse(uErr.code === '23505' ? 'Det finns redan ett aktivt medlemspris för nivån och produkten' : uErr.message, uErr.code === '23505' ? 409 : 400);
      return jsonResponse(data);
    }

    // ── MEMBERSHIPS (user assignments) ──

    // GET /api-memberships/venue?venueId=X
    if (req.method === 'GET' && path === 'venue') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const { data, error: qErr } = await admin.from('memberships')
        .select('*, membership_tiers(id, name, color, discount_percent, monthly_price)')
        .eq('venue_id', venueId).eq('status', 'active')
        .order('created_at', { ascending: false });
      if (qErr) return errorResponse(qErr.message);

      const membershipRows = (data || []) as MembershipProjectionRow[];
      const userIds = Array.from(new Set(membershipRows.map((row) => row.user_id).filter(Boolean)));
      const { data: profiles } = userIds.length
        ? await admin.from('player_profiles').select('auth_user_id, display_name, first_name, last_name, phone').in('auth_user_id', userIds)
        : { data: [] };
      const profileByUserId = new Map(((profiles || []) as ProfileProjectionRow[]).map((profile) => [profile.auth_user_id, profile]));

      const authUsers = await Promise.all(userIds.map(async (id) => {
        const { data: authUser } = await admin.auth.admin.getUserById(id);
        return authUser?.user || null;
      }));
      const presentAuthUsers = authUsers.filter(
        (authUser): authUser is Exclude<(typeof authUsers)[number], null> => authUser !== null,
      );
      const emailByUserId = new Map(presentAuthUsers.map((authUser) => [authUser.id, authUser.email]));

      const enriched = membershipRows.map((row) => {
        const profile = profileByUserId.get(row.user_id);
        return {
          ...row,
          user_email: emailByUserId.get(row.user_id) || null,
          user_name: fullName(profile?.first_name, profile?.last_name, profile?.display_name),
          user_display_name: profile?.display_name || null,
          user_first_name: profile?.first_name || null,
          user_last_name: profile?.last_name || null,
          user_phone: profile?.phone || null,
          user_profile_complete: Boolean(profile?.first_name && profile?.last_name && profile?.phone),
        };
      });

      return jsonResponse(enriched, 200, 10);
    }

    // GET /api-memberships/user?userId=X&venueId=Y
    if (req.method === 'GET' && path === 'user') {
      const targetUserId = url.searchParams.get('userId');
      const venueId = url.searchParams.get('venueId');
      if (!targetUserId || !venueId) return errorResponse('Missing userId or venueId');

      const { data: membership, error: qErr } = await client.from('memberships')
        .select('*, membership_tiers(id, name, color, discount_percent, monthly_price)')
        .eq('user_id', targetUserId).eq('venue_id', venueId).eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (qErr) return errorResponse(qErr.message);

      // Also fetch tier pricing if membership exists
      let tierPricing: Array<Record<string, unknown>> = [];
      let tierEntitlements: Array<Record<string, unknown>> = [];
      if (membership?.tier_id) {
        const { data: tp } = await client.from('membership_tier_pricing')
          .select('*').eq('tier_id', membership.tier_id);
        tierPricing = tp || [];

        const { data: entitlements } = await client.from('membership_entitlements')
          .select('entitlement_type, value, period, sport_type')
          .eq('tier_id', membership.tier_id);
        tierEntitlements = entitlements || [];
      }

      const tier = membership?.membership_tiers
        ? { ...membership.membership_tiers, membership_entitlements: tierEntitlements }
        : membership?.membership_tiers;

      return jsonResponse({
        ...membership,
        membership_tiers: tier,
        tier_pricing: tierPricing,
        tier_entitlements: tierEntitlements,
      }, 200, 10);
    }

    // POST /api-memberships/assign
    if (req.method === 'POST' && path === 'assign') {
      const body = await req.json();
      const { venueId, customerUserId, tierId, expiresAt, notes } = body;
      if (!venueId || !customerUserId || !tierId) return errorResponse('Missing fields');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const { data: targetProfile } = await admin.from('player_profiles')
        .select('first_name, last_name, phone')
        .eq('auth_user_id', customerUserId)
        .maybeSingle();
      if (!targetProfile?.first_name || !targetProfile?.last_name || !targetProfile?.phone) {
        return errorResponse('Medlemskap kräver förnamn, efternamn och telefon på kunden', 400);
      }

      const { data: assignTier } = await admin.from('membership_tiers')
        .select('*')
        .eq('id', tierId)
        .single();
      if (!assignTier || assignTier.venue_id !== venueId) return errorResponse('Tier not found for venue', 404);
      if (assignTier.is_assignable === false) return errorResponse('Tier is not assignable', 403);

      await admin.from('memberships')
        .update({ status: 'cancelled' })
        .eq('user_id', customerUserId).eq('venue_id', venueId).eq('status', 'active');

      const customerId = await resolveOrCreateCustomerIdForUser(admin, customerUserId, venueId, 'admin_membership_assignment');
      if (!customerId) return errorResponse('Kunden kunde inte kopplas till medlemskapet', 409);

      const { data, error: iErr } = await admin.from('memberships').insert({
        user_id: customerUserId,
        customer_id: customerId,
        venue_id: venueId,
        tier_id: tierId,
        status: 'active',
        starts_at: new Date().toISOString().slice(0, 10),
        expires_at: expiresAt || null,
        notes: notes || null,
        assigned_by: userId,
      }).select('*, membership_tiers(id, name, color, discount_percent)').single();
      if (iErr) return errorResponse(iErr.message);
      return jsonResponse(data, 201);
    }

    // POST /api-memberships/assign-email
    if (req.method === 'POST' && path === 'assign-email') {
      const body = await req.json();
      const { venueId, email, tierId, expiresAt, notes, displayName, firstName, lastName, phone } = body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!venueId || !normalizedEmail || !tierId) return errorResponse('Missing venueId, email or tierId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const { data: tier } = await admin.from('membership_tiers').select('*').eq('id', tierId).single();
      if (!tier || tier.venue_id !== venueId) return errorResponse('Tier not found for venue', 404);
      const assignable = tier.is_assignable !== false;
      if (!assignable) return errorResponse('Tier is not assignable', 403);

      let targetUserId = '';
      const parsedName = splitDisplayName(displayName);
      const nextFirstName = String(firstName || parsedName.firstName || '').trim();
      const nextLastName = String(lastName || parsedName.lastName || '').trim();
      const nextPhone = String(phone || '').trim();
      const existing = await findAuthUserByEmail(admin, normalizedEmail);
      if (existing?.id) {
        targetUserId = existing.id;
      } else {
        if (!nextFirstName || !nextLastName || !nextPhone) {
          return errorResponse('Medlemskap kräver förnamn, efternamn och telefon på kunden', 400);
        }
        const nextDisplayName = String(displayName || fullName(nextFirstName, nextLastName) || '').trim();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
          user_metadata: nextDisplayName ? { display_name: nextDisplayName } : undefined,
        });
        if (createErr || !created?.user?.id) return errorResponse(createErr?.message || 'Could not create user', 500);
        targetUserId = created.user.id;
      }

      const { data: existingProfile } = await admin.from('player_profiles')
        .select('display_name, first_name, last_name, phone')
        .eq('auth_user_id', targetUserId)
        .maybeSingle();
      const mergedFirstName = nextFirstName || existingProfile?.first_name || '';
      const mergedLastName = nextLastName || existingProfile?.last_name || '';
      const mergedPhone = nextPhone || existingProfile?.phone || '';
      if (!mergedFirstName || !mergedLastName || !mergedPhone) {
        return errorResponse('Medlemskap kräver förnamn, efternamn och telefon på kunden', 400);
      }

      await admin.from('player_profiles').upsert({
        auth_user_id: targetUserId,
        display_name: existingProfile?.display_name || String(displayName || fullName(mergedFirstName, mergedLastName) || '').trim(),
        first_name: mergedFirstName,
        last_name: mergedLastName,
        phone: mergedPhone,
      }, { onConflict: 'auth_user_id' });

      await admin.from('memberships')
        .update({ status: 'cancelled' })
        .eq('user_id', targetUserId).eq('venue_id', venueId).eq('status', 'active');

      const customerId = await resolveOrCreateCustomerIdForUser(admin, targetUserId, venueId, 'admin_membership_assignment');
      if (!customerId) return errorResponse('Kunden kunde inte kopplas till medlemskapet', 409);

      const { data, error: iErr } = await admin.from('memberships').insert({
        user_id: targetUserId,
        customer_id: customerId,
        venue_id: venueId,
        tier_id: tierId,
        status: 'active',
        starts_at: new Date().toISOString().slice(0, 10),
        expires_at: expiresAt || null,
        notes: notes || null,
        assigned_by: userId,
      }).select('*, membership_tiers(id, name, color, discount_percent)').single();
      if (iErr) return errorResponse(iErr.message);
      return jsonResponse({ ...data, user_email: normalizedEmail }, 201);
    }

    // PATCH /api-memberships/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { membershipId, status, tierId, expiresAt, notes } = body;
      if (!membershipId) return errorResponse('Missing membershipId');

      const { data: membership } = await admin.from('memberships').select('venue_id').eq('id', membershipId).single();
      if (!membership) return errorResponse('Membership not found', 404);
      if (!await assertVenueAdmin(admin, userId, membership.venue_id)) return errorResponse('Forbidden', 403);

      const updates: Record<string, unknown> = {};
      if (status) updates.status = status;
      if (tierId) updates.tier_id = tierId;
      if (expiresAt !== undefined) updates.expires_at = expiresAt;
      if (notes !== undefined) updates.notes = notes;

      const { data, error: uErr } = await admin.from('memberships')
        .update(updates).eq('id', membershipId).select().single();
      if (uErr) return errorResponse(uErr.message);
      return jsonResponse(data);
    }

    // POST /api-memberships/cancel — user cancels their own membership
    if (req.method === 'POST' && path === 'cancel') {
      const body = await req.json();
      const { membershipId } = body;
      if (!membershipId) return errorResponse('Missing membershipId');

      const { data, error: uErr } = await admin.from('memberships')
        .update({ status: 'cancelled' })
        .eq('id', membershipId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .select('id, status')
        .maybeSingle();

      if (uErr) return errorResponse(uErr.message);
      if (!data) return errorResponse('Membership not found', 404);
      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
