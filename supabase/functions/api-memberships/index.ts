import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail } from '../_shared/bookings.ts';

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

    // PATCH /api-memberships/tier-pricing
    if (req.method === 'PATCH' && path === 'tier-pricing') {
      const body = await req.json();
      const { id, product_type, fixed_price, discount_percent, vat_rate, label } = body;
      if (!id) return errorResponse('Missing id');

      const { data: tp } = await admin.from('membership_tier_pricing').select('tier_id').eq('id', id).single();
      if (!tp) return errorResponse('Pricing not found', 404);
      const { data: tier } = await admin.from('membership_tiers').select('venue_id').eq('id', tp.tier_id).single();
      if (!tier) return errorResponse('Tier not found', 404);
      if (!await assertVenueAdmin(admin, userId, tier.venue_id)) return errorResponse('Forbidden', 403);

      const updates: Record<string, any> = {};
      if (product_type !== undefined) updates.product_type = product_type;
      if (fixed_price !== undefined) updates.fixed_price = fixed_price;
      if (discount_percent !== undefined) updates.discount_percent = discount_percent;
      if (vat_rate !== undefined) updates.vat_rate = vat_rate;
      if (label !== undefined) updates.label = label || null;

      const { data, error: uErr } = await admin.from('membership_tier_pricing')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();
      if (uErr) return errorResponse(uErr.message);
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

      const userIds = Array.from(new Set((data || []).map((row: any) => row.user_id).filter(Boolean)));
      const { data: profiles } = userIds.length
        ? await admin.from('player_profiles').select('auth_user_id, display_name, first_name, last_name, phone').in('auth_user_id', userIds)
        : { data: [] };
      const profileByUserId = new Map((profiles || []).map((profile: any) => [profile.auth_user_id, profile]));

      const authUsers = await Promise.all(userIds.map(async (id) => {
        const { data: authUser } = await admin.auth.admin.getUserById(id);
        return authUser?.user || null;
      }));
      const emailByUserId = new Map(authUsers.filter(Boolean).map((authUser: any) => [authUser.id, authUser.email]));

      const enriched = (data || []).map((row: any) => {
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
      let tierPricing: any[] = [];
      let tierEntitlements: any[] = [];
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

    // POST /api-memberships/assign-email
    if (req.method === 'POST' && path === 'assign-email') {
      const body = await req.json();
      const { venueId, email, tierId, expiresAt, notes, displayName, firstName, lastName, phone } = body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!venueId || !normalizedEmail || !tierId) return errorResponse('Missing venueId, email or tierId');
      if (!await assertVenueAdmin(admin, userId, venueId)) return errorResponse('Forbidden', 403);

      const { data: tier } = await admin.from('membership_tiers').select('*').eq('id', tierId).single();
      if (!tier || tier.venue_id !== venueId) return errorResponse('Tier not found for venue', 404);
      const assignable = (tier as any).is_assignable !== false;
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

      const { data, error: iErr } = await admin.from('memberships').insert({
        user_id: targetUserId,
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
