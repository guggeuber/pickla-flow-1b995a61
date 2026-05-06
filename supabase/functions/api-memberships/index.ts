import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

async function assertVenueAdmin(admin: ReturnType<typeof getServiceClient>, userId: string, venueId: string): Promise<boolean> {
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  if (role) return true;
  const { data: staff } = await admin.from('venue_staff').select('id').eq('user_id', userId).eq('venue_id', venueId).eq('is_active', true).maybeSingle();
  return !!staff;
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
      if (!venueId) return errorResponse('Missing venueId');

      const serviceClient = getServiceClient();
      const { data, error: qErr } = await serviceClient.from('membership_tiers')
        .select('*').eq('venue_id', venueId).order('sort_order');
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

    // GET /api-memberships/tier-pricing?tierId=X
    if (req.method === 'GET' && path === 'tier-pricing') {
      const tierId = url.searchParams.get('tierId');
      if (!tierId) return errorResponse('Missing tierId');

      const { data, error: qErr } = await client.from('membership_tier_pricing')
        .select('*').eq('tier_id', tierId);
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 15);
    }

    // POST /api-memberships/tier-pricing
    if (req.method === 'POST' && path === 'tier-pricing') {
      const body = await req.json();
      const { tierId, product_type, fixed_price, discount_percent, vat_rate, label } = body;
      if (!tierId || !product_type) return errorResponse('Missing tierId or product_type');

      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tierId).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { data, error: iErr } = await admin.from('membership_tier_pricing').insert({
        tier_id: tierId,
        product_type,
        fixed_price: fixed_price ?? null,
        discount_percent: discount_percent ?? null,
        vat_rate: vat_rate ?? 6,
        label: label || null,
      }).select().single();
      if (iErr) return errorResponse(iErr.message);
      return jsonResponse(data, 201);
    }

    // DELETE /api-memberships/tier-pricing?id=X
    if (req.method === 'DELETE' && path === 'tier-pricing') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { data: tp } = await admin.from('membership_tier_pricing').select('tier_id').eq('id', id).single();
      if (!tp) return errorResponse('Pricing not found', 404);
      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tp.tier_id).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const { error: dErr } = await admin.from('membership_tier_pricing').delete().eq('id', id);
      if (dErr) return errorResponse(dErr.message);
      return jsonResponse({ ok: true });
    }

    // ── MEMBERSHIPS (user assignments) ──

    // GET /api-memberships/venue?venueId=X
    if (req.method === 'GET' && path === 'venue') {
      const venueId = url.searchParams.get('venueId');
      if (!venueId) return errorResponse('Missing venueId');

      const { data, error: qErr } = await client.from('memberships')
        .select('*, membership_tiers(id, name, color, discount_percent)')
        .eq('venue_id', venueId).eq('status', 'active')
        .order('created_at', { ascending: false });
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 10);
    }

    // GET /api-memberships/user?userId=X&venueId=Y
    if (req.method === 'GET' && path === 'user') {
      const targetUserId = url.searchParams.get('userId');
      const venueId = url.searchParams.get('venueId');
      if (!targetUserId || !venueId) return errorResponse('Missing userId or venueId');

      const { data: membership, error: qErr } = await client.from('memberships')
        .select('*, membership_tiers(id, name, color, discount_percent, monthly_price)')
        .eq('user_id', targetUserId).eq('venue_id', venueId).eq('status', 'active')
        .maybeSingle();
      if (qErr) return errorResponse(qErr.message);

      // Also fetch tier pricing if membership exists
      let tierPricing: any[] = [];
      if (membership?.tier_id) {
        const { data: tp } = await client.from('membership_tier_pricing')
          .select('*').eq('tier_id', membership.tier_id);
        tierPricing = tp || [];
      }

      return jsonResponse({ ...membership, tier_pricing: tierPricing }, 200, 10);
    }

    // POST /api-memberships/assign
    if (req.method === 'POST' && path === 'assign') {
      const body = await req.json();
      const { venueId, customerUserId, tierId, expiresAt, notes } = body;
      if (!venueId || !customerUserId || !tierId) return errorResponse('Missing fields');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      await admin.from('memberships')
        .update({ status: 'cancelled' })
        .eq('user_id', customerUserId).eq('venue_id', venueId).eq('status', 'active');

      const { data, error: iErr } = await admin.from('memberships').insert({
        user_id: customerUserId,
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

    // PATCH /api-memberships/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { membershipId, status, tierId, expiresAt, notes } = body;
      if (!membershipId) return errorResponse('Missing membershipId');

      const { data: membership } = await admin.from('memberships').select('venue_id').eq('id', membershipId).single();
      if (!membership) return errorResponse('Membership not found', 404);
      if (!await assertVenueAdmin(admin, userId, membership.venue_id)) return errorResponse('Forbidden', 403);

      const updates: Record<string, any> = {};
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
