import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

function randomVoucherCode() {
  return `GP-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

async function getUserIdFromRequest(req: Request, adminClient: ReturnType<typeof getServiceClient>) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const { data } = await adminClient.auth.getUser(token);
  return data.user?.id || null;
}

const normalizeEmail = (value: unknown) => {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
};

const normalizePhone = (value: unknown) => {
  const phone = String(value || '').replace(/[^0-9+]/g, '').trim();
  return phone || null;
};

async function getDefaultOrganizationId(adminClient: ReturnType<typeof getServiceClient>, venueId?: string | null) {
  if (venueId) {
    const { data: venue } = await adminClient
      .from('venues')
      .select('organization_id')
      .eq('id', venueId)
      .maybeSingle();
    if (venue?.organization_id) return venue.organization_id;
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('id')
    .eq('slug', 'pickla')
    .maybeSingle();
  return org?.id || null;
}

async function resolveOrCreateCustomerForUser(
  adminClient: ReturnType<typeof getServiceClient>,
  userId: string,
  venueId?: string | null,
) {
  const existingCustomerId = await resolveCustomerIdForUser(adminClient, userId);
  if (existingCustomerId) return existingCustomerId;

  const [{ data: authResult }, { data: profile }] = await Promise.all([
    adminClient.auth.admin.getUserById(userId),
    adminClient
      .from('player_profiles')
      .select('id, display_name, first_name, last_name, phone, customer_id')
      .eq('auth_user_id', userId)
      .maybeSingle(),
  ]);

  if (profile?.customer_id) return profile.customer_id;

  const authUser = authResult?.user;
  const organizationId = await getDefaultOrganizationId(adminClient, venueId);
  if (!organizationId) throw new Error('Missing organization for customer');

  const email = normalizeEmail(authUser?.email);
  const phone = normalizePhone(profile?.phone);
  const displayName = profile?.display_name || authUser?.user_metadata?.display_name || email || 'Kund';

  const { data: existingByUser } = await adminClient
    .from('customers')
    .select('id')
    .eq('auth_user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (existingByUser?.id) return existingByUser.id;

  if (email) {
    const { data: existingByEmail } = await adminClient
      .from('customers')
      .select('id, auth_user_id')
      .eq('organization_id', organizationId)
      .eq('email_normalized', email)
      .eq('status', 'active')
      .maybeSingle();

    if (existingByEmail?.id) {
      if (!existingByEmail.auth_user_id) {
        await adminClient
          .from('customers')
          .update({
            auth_user_id: userId,
            display_name: displayName,
            primary_email: email,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingByEmail.id);
      }
      await adminClient
        .from('player_profiles')
        .update({ customer_id: existingByEmail.id })
        .eq('auth_user_id', userId)
        .is('customer_id', null);
      return existingByEmail.id;
    }
  }

  const { data: inserted, error: insertErr } = await adminClient
    .from('customers')
    .insert({
      organization_id: organizationId,
      auth_user_id: userId,
      display_name: displayName,
      first_name: profile?.first_name || null,
      last_name: profile?.last_name || null,
      primary_email: email,
      primary_phone: profile?.phone || null,
      email_normalized: email,
      phone_e164: phone,
      metadata: {
        source: 'day_pass_share_claim',
        player_profile_id: profile?.id || null,
      },
    })
    .select('id')
    .single();

  if (insertErr) {
    const { data: afterConflict } = await adminClient
      .from('customers')
      .select('id')
      .eq('auth_user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (afterConflict?.id) return afterConflict.id;
    throw new Error(insertErr.message);
  }

  const customerId = inserted.id;

  await adminClient
    .from('player_profiles')
    .update({ customer_id: customerId })
    .eq('auth_user_id', userId)
    .is('customer_id', null);

  await adminClient.from('customer_identities').insert([
    {
      customer_id: customerId,
      organization_id: organizationId,
      provider: 'auth',
      provider_id: userId,
      verified_at: new Date().toISOString(),
      metadata: { source: 'day_pass_share_claim' },
    },
    ...(email ? [{
      customer_id: customerId,
      organization_id: organizationId,
      provider: 'email',
      provider_id: email,
      email,
      verified_at: authUser?.email_confirmed_at || null,
      metadata: { source: 'day_pass_share_claim' },
    }] : []),
    ...(phone ? [{
      customer_id: customerId,
      organization_id: organizationId,
      provider: 'phone',
      provider_id: phone,
      phone: profile?.phone || phone,
      metadata: { source: 'day_pass_share_claim' },
    }] : []),
  ]).select('id');

  return customerId;
}

async function linkCustomerToVenue(
  adminClient: ReturnType<typeof getServiceClient>,
  customerId: string | null,
  venueId: string | null,
) {
  if (!customerId || !venueId) return;
  const now = new Date().toISOString();
  const { data: existing } = await adminClient
    .from('customer_venue_profiles')
    .select('id, visit_count')
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (existing?.id) {
    await adminClient
      .from('customer_venue_profiles')
      .update({
        last_seen_at: now,
        metadata: { source: 'day_pass_share_claim' },
      })
      .eq('id', existing.id);
    return;
  }

  await adminClient.from('customer_venue_profiles').insert({
    customer_id: customerId,
    venue_id: venueId,
    is_home_venue: false,
    first_seen_at: now,
    last_seen_at: now,
    visit_count: 0,
    metadata: { source: 'day_pass_share_claim' },
  });
}

async function auditDayPassShareClaim(
  adminClient: ReturnType<typeof getServiceClient>,
  input: {
    actorUserId: string;
    shareId: string;
    dayPassId: string;
    venueId: string | null;
    customerId: string | null;
  },
) {
  try {
    await adminClient.from('audit_log').insert({
      actor_user_id: input.actorUserId,
      actor_type: 'user',
      action: 'day_pass_share.claim',
      entity_table: 'day_pass_shares',
      entity_id: input.shareId,
      venue_id: input.venueId,
      metadata: {
        day_pass_id: input.dayPassId,
        customer_id: input.customerId,
      },
    });
  } catch (_) {
    // audit_log may not exist in older environments; claiming must keep working.
  }
}

async function getActiveMembershipWithBenefits(adminClient: ReturnType<typeof getServiceClient>, userId: string) {
  const { data: membership } = await adminClient
    .from('memberships')
    .select('id, tier_id, venue_id, starts_at, expires_at, membership_tiers(id, name, color, description, monthly_price, membership_entitlements(entitlement_type, value, period, sport_type))')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return membership;
}

function benefitValue(membership: any, type: string) {
  const entitlements = membership?.membership_tiers?.membership_entitlements || [];
  const entitlement = entitlements.find((row: any) => row.entitlement_type === type);
  return entitlement ? Number(entitlement.value || 0) : 0;
}

function bookingDurationHours(row: any) {
  const start = new Date(row.start_time).getTime();
  const end = new Date(row.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 36e5;
}

async function calculateIncludedCourtHoursFromBookings(
  adminClient: ReturnType<typeof getServiceClient>,
  userId: string,
  venueId: string,
  periodStart: string,
  periodEnd: string,
  sportType = 'pickleball',
) {
  const startUtc = DateTime.fromISO(`${periodStart}T00:00:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
  const endUtc = DateTime.fromISO(`${periodEnd}T23:59:59.999`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
  const { data: rows } = await adminClient
    .from('bookings')
    .select('id, start_time, end_time, total_price, included_court_hours, venue_courts(sport_type)')
    .eq('user_id', userId)
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .gte('start_time', startUtc)
    .lte('start_time', endUtc);

  return (rows || []).reduce((sum: number, row: any) => {
    const rowSport = row.venue_courts?.sport_type || 'pickleball';
    if (rowSport !== sportType) return sum;
    const included = Number(row.included_court_hours || 0);
    if (included > 0) return sum + included;

    // Legacy fallback for free membership bookings created before usage metadata.
    if (Number(row.total_price || 0) === 0) return sum + bookingDurationHours(row);
    return sum;
  }, 0);
}

async function ensureMonthlyGuestVouchers(adminClient: ReturnType<typeof getServiceClient>, membership: any, userId: string) {
  const allowed = Math.max(0, Math.round(benefitValue(membership, 'guest_day_vouchers_monthly')));
  const now = DateTime.now().setZone('Europe/Stockholm');
  const periodStart = now.startOf('month').toISODate()!;
  const periodEnd = now.endOf('month').toISODate()!;
  if (!membership?.id || !allowed) return { allowed, periodStart, periodEnd, vouchers: [] as any[] };

  const { data: existing } = await adminClient
    .from('access_vouchers')
    .select('*')
    .eq('source_type', 'membership_guest_voucher')
    .eq('source_id', membership.id)
    .eq('purchaser_user_id', userId)
    .eq('metadata->>period_start', periodStart)
    .order('created_at', { ascending: true });

  const existingSlots = new Set((existing || []).map((voucher: any) => Number(voucher.metadata?.slot || 0)));
  const inserts = [];
  for (let slot = 1; slot <= allowed; slot++) {
    if (existingSlots.has(slot)) continue;
    inserts.push({
      venue_id: membership.venue_id,
      purchaser_user_id: userId,
      code: randomVoucherCode(),
      voucher_type: 'day_access',
      status: 'unused',
      value_count: 1,
      expires_at: now.plus({ days: 90 }).toUTC().toISO(),
      source_type: 'membership_guest_voucher',
      source_id: membership.id,
      metadata: {
        benefit_key: 'founder_guest_day_vouchers',
        membership_id: membership.id,
        period_start: periodStart,
        period_end: periodEnd,
        slot,
      },
    });
  }

  if (inserts.length) {
    await adminClient.from('access_vouchers').insert(inserts);
  }

  const { data: vouchers } = await adminClient
    .from('access_vouchers')
    .select('*')
    .eq('source_type', 'membership_guest_voucher')
    .eq('source_id', membership.id)
    .eq('purchaser_user_id', userId)
    .eq('metadata->>period_start', periodStart)
    .order('created_at', { ascending: true });

  return { allowed, periodStart, periodEnd, vouchers: vouchers || [] };
}

function voucherToClient(voucher: any) {
  return {
    id: voucher.id,
    token: voucher.code,
    code: voucher.code,
    status: voucher.status,
    recipient_name: voucher.recipient_name || voucher.metadata?.recipient_name || null,
    expires_at: voucher.expires_at,
    created_at: voucher.created_at,
    claimed_by: voucher.claimed_by_user_id,
    claimed_at: voucher.claimed_at,
    redeemed_at: voucher.redeemed_at,
    share: voucher.status === 'unused' && (voucher.recipient_name || voucher.metadata?.recipient_name)
      ? {
        id: voucher.id,
        token: voucher.code,
        status: 'pending',
        recipient_name: voucher.recipient_name || voucher.metadata?.recipient_name,
      }
      : null,
    is_voucher: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const path = pathParts.pop() || '';

  try {
    // ─── PUBLIC: POST /public-purchase ───
    if (req.method === 'POST' && path === 'public-purchase') {
      return errorResponse('Day passes must be purchased through Stripe checkout', 410);
    }

    // ─── PUBLIC: POST /claim ───
    if (req.method === 'POST' && path === 'claim') {
      const body = await req.json();
      const { token } = body;
      if (!token) return errorResponse('Missing token');

      const adminClient = getServiceClient();
      const claimUserId = await getUserIdFromRequest(req, adminClient);
      if (!claimUserId) return errorResponse('Must be logged in to claim', 401);

      const { data: share, error: shareErr } = await adminClient
        .from('day_pass_shares')
        .select('*')
        .eq('token', token)
        .maybeSingle();

      if (shareErr) return errorResponse(shareErr.message, 500);

      if (share) {
        if (share.status === 'claimed') {
          if (share.claimed_by === claimUserId) {
            return jsonResponse({ success: true, dayPassId: share.day_pass_id, legacy: true, already_claimed: true });
          }
          return errorResponse('Passet har redan hämtats', 409);
        }
        if (share.status !== 'pending') return errorResponse('Passet kan inte hämtas längre', 410);

        const { data: dayPass, error: dayPassErr } = await adminClient
          .from('day_passes')
          .select('id, venue_id')
          .eq('id', share.day_pass_id)
          .maybeSingle();
        if (dayPassErr) return errorResponse(dayPassErr.message, 500);
        if (!dayPass) return errorResponse('Pass not found', 404);

        const customerId = await resolveOrCreateCustomerForUser(adminClient, claimUserId, dayPass.venue_id);
        await linkCustomerToVenue(adminClient, customerId, dayPass.venue_id);

        const { error: shareUpdateErr } = await adminClient.from('day_pass_shares')
          .update({ status: 'claimed', claimed_by: claimUserId, claimed_at: new Date().toISOString() })
          .eq('id', share.id);
        if (shareUpdateErr) return errorResponse(shareUpdateErr.message, 500);

        const { error: passUpdateErr } = await adminClient.from('day_passes')
          .update({ user_id: claimUserId, customer_id: customerId, status: 'active' })
          .eq('id', share.day_pass_id);
        if (passUpdateErr) return errorResponse(passUpdateErr.message, 500);

        await adminClient
          .from('player_profiles')
          .update({ customer_id: customerId })
          .eq('auth_user_id', claimUserId)
          .is('customer_id', null);

        await auditDayPassShareClaim(adminClient, {
          actorUserId: claimUserId,
          shareId: share.id,
          dayPassId: share.day_pass_id,
          venueId: dayPass.venue_id,
          customerId,
        });

        return jsonResponse({ success: true, dayPassId: share.day_pass_id, customerId, legacy: true });
      }

      const now = DateTime.now().setZone('Europe/Stockholm');
      const { data: voucher, error: voucherErr } = await adminClient
        .from('access_vouchers')
        .select('*')
        .eq('code', token)
        .maybeSingle();

      if (voucherErr) return errorResponse(voucherErr.message, 500);
      if (!voucher) return errorResponse('Pass not found', 404);
      if (['claimed', 'redeemed'].includes(voucher.status)) {
        if (voucher.claimed_by_user_id === claimUserId) {
          const { data: existingEntitlement } = await adminClient
            .from('access_entitlements')
            .select('id, valid_date')
            .eq('source_type', 'founder_guest_voucher')
            .eq('source_id', voucher.id)
            .eq('user_id', claimUserId)
            .eq('entitlement_type', 'day_access')
            .maybeSingle();

          return jsonResponse({
            success: true,
            voucher_id: voucher.id,
            entitlement_id: existingEntitlement?.id || null,
            valid_date: existingEntitlement?.valid_date || null,
            already_claimed: true,
          });
        }
        return errorResponse('Passet har redan hämtats', 409);
      }
      if (voucher.status === 'expired') return errorResponse('Passet har gått ut', 410);
      if (voucher.status === 'revoked') return errorResponse('Passet har dragits tillbaka', 410);
      if (voucher.status !== 'unused') return errorResponse('Passet kan inte hämtas längre', 410);
      if (voucher.expires_at && DateTime.fromISO(voucher.expires_at, { zone: 'utc' }) < now) {
        await adminClient.from('access_vouchers').update({ status: 'expired' }).eq('id', voucher.id);
        return errorResponse('Passet har gått ut', 410);
      }

      const { data: alreadyRedeemed } = await adminClient
        .from('access_entitlements')
        .select('id')
        .eq('venue_id', voucher.venue_id)
        .eq('user_id', claimUserId)
        .eq('source_type', 'founder_guest_voucher')
        .eq('entitlement_type', 'day_access')
        .limit(1)
        .maybeSingle();
      if (alreadyRedeemed) {
        return errorResponse('Du har redan använt ett gratis gästpass på Pickla.', 409);
      }

      const validDate = now.toISODate()!;
      const claimedAt = now.toUTC().toISO();
      const { data: claimedVoucher, error: claimErr } = await adminClient
        .from('access_vouchers')
        .update({
          status: 'claimed',
          claimed_by_user_id: claimUserId,
          claimed_at: claimedAt,
        })
        .eq('id', voucher.id)
        .eq('status', 'unused')
        .select('id')
        .maybeSingle();

      if (claimErr) return errorResponse(claimErr.message, 500);
      if (!claimedVoucher) {
        const { data: latestVoucher } = await adminClient
          .from('access_vouchers')
          .select('id, status, claimed_by_user_id')
          .eq('id', voucher.id)
          .maybeSingle();
        if (latestVoucher?.claimed_by_user_id === claimUserId) {
          return jsonResponse({ success: true, voucher_id: voucher.id, entitlement_id: null, valid_date: null, already_claimed: true });
        }
        return errorResponse('Passet har redan hämtats', 409);
      }

      const { data: entitlement, error: entitlementErr } = await adminClient.from('access_entitlements').insert({
        venue_id: voucher.venue_id,
        user_id: claimUserId,
        entitlement_type: 'day_access',
        status: 'active',
        source_type: 'founder_guest_voucher',
        source_id: voucher.id,
        valid_date: validDate,
        includes_session_types: ['open_play'],
        metadata: {
          voucher_code: voucher.code,
          voucher_source_type: voucher.source_type,
          purchaser_user_id: voucher.purchaser_user_id,
          claimed_as: 'founder_guest_voucher',
        },
      }).select('id').single();
      if (entitlementErr) {
        await adminClient.from('access_vouchers').update({
          status: 'unused',
          claimed_by_user_id: null,
          claimed_at: null,
        }).eq('id', voucher.id).eq('status', 'claimed').eq('claimed_by_user_id', claimUserId);

        if (entitlementErr.code === '23505') {
          return errorResponse('Du har redan använt ett gratis gästpass på Pickla.', 409);
        }
        return errorResponse(entitlementErr.message, 500);
      }

      await adminClient.from('access_vouchers').update({
        status: 'redeemed',
        redeemed_at: claimedAt,
      }).eq('id', voucher.id).eq('status', 'claimed').eq('claimed_by_user_id', claimUserId);

      return jsonResponse({ success: true, voucher_id: voucher.id, entitlement_id: entitlement.id, valid_date: validDate });
    }

    // ─── PUBLIC: GET /share-info?token=X ───
    if (req.method === 'GET' && path === 'share-info') {
      const token = url.searchParams.get('token');
      if (!token) return errorResponse('Missing token');

      const adminClient = getServiceClient();
      const { data: share } = await adminClient
        .from('day_pass_shares')
        .select('id, status, token, shared_by, recipient_name, day_pass_id')
        .eq('token', token)
        .maybeSingle();

      if (share) {
        const { data: dayPass } = await adminClient
          .from('day_passes')
          .select('valid_date, venue_id')
          .eq('id', share.day_pass_id)
          .maybeSingle();

        const { data: sharerProfile } = await adminClient
          .from('player_profiles')
          .select('display_name')
          .eq('auth_user_id', share.shared_by)
          .single();

        return jsonResponse({
          ...share,
          day_passes: dayPass || null,
          sharer_name: sharerProfile?.display_name || 'En vän',
        });
      }

      const { data: voucher } = await adminClient
        .from('access_vouchers')
        .select('id, venue_id, purchaser_user_id, claimed_by_user_id, code, status, voucher_type, expires_at, recipient_name, metadata')
        .eq('code', token)
        .maybeSingle();

      if (!voucher) return errorResponse('Not found', 404);

      const { data: sharerProfile } = await adminClient
        .from('player_profiles')
        .select('display_name')
        .eq('auth_user_id', voucher.purchaser_user_id)
        .single();

      return jsonResponse({
        id: voucher.id,
        status: voucher.status === 'unused' ? 'pending' : voucher.status,
        token: voucher.code,
        recipient_name: voucher.recipient_name || voucher.metadata?.recipient_name || null,
        is_voucher: true,
        expires_at: voucher.expires_at,
        day_passes: { valid_date: null, venue_id: voucher.venue_id },
        sharer_name: sharerProfile?.display_name || 'En vän',
      });
    }

    // ─── Authenticated routes below ───
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    const adminClient = getServiceClient();

    // ─── GET /my-passes ── unified: all passes + allowance info ───
    if (req.method === 'GET' && path === 'my-passes') {
      // Get all user's active day passes
      const { data: passes } = await adminClient
        .from('day_passes')
        .select('id, valid_date, purchase_date, price, status, shared_from, venue_id, created_at')
        .eq('user_id', userId)
        .in('status', ['active', 'used'])
        .order('created_at', { ascending: false });

      // Get shares created by this user
      const { data: shares } = await adminClient
        .from('day_pass_shares')
        .select('id, token, status, recipient_email, recipient_name, day_pass_id, claimed_by, created_at')
        .eq('shared_by', userId)
        .order('created_at', { ascending: false });

      // Map shares to their day_pass_id for easy lookup
      const sharesByPassId: Record<string, any> = {};
      (shares || []).forEach((s: any) => { sharesByPassId[s.day_pass_id] = s; });

      // Enrich passes with share info
      const enrichedPasses = (passes || []).map((p: any) => ({
        ...p,
        share: sharesByPassId[p.id] || null,
        is_free: (p.price === 0 || p.price === null),
      }));

      const membership = await getActiveMembershipWithBenefits(adminClient, userId);
      const hasMembership = !!membership;
      const openPlayUnlimited = benefitValue(membership, 'open_play_unlimited') > 0;
      const guestGrant = await ensureMonthlyGuestVouchers(adminClient, membership, userId);
      const guestVouchers = (guestGrant.vouchers || []).map(voucherToClient);
      const usableGuestVouchers = guestVouchers.filter((voucher: any) => voucher.status === 'unused');
      const now = DateTime.now().setZone('Europe/Stockholm');
      const weekStart = now.startOf('week').toISODate()!;
      const weekEnd = now.endOf('week').toISODate()!;
      const courtHoursAllowed = benefitValue(membership, 'court_hours_per_week');
      const courtHoursUsed = courtHoursAllowed > 0 && membership?.venue_id
        ? await calculateIncludedCourtHoursFromBookings(adminClient, userId, membership.venue_id, weekStart, weekEnd)
        : 0;

      const allowance = {
        has_membership: hasMembership,
        passes_allowed: guestGrant.allowed,
        passes_remaining: usableGuestVouchers.length,
      };

      // Re-fetch passes after potential grant creation
      const { data: finalPasses } = await adminClient
        .from('day_passes')
        .select('id, valid_date, purchase_date, price, status, shared_from, venue_id, created_at')
        .eq('user_id', userId)
        .in('status', ['active', 'used'])
        .order('created_at', { ascending: false });

      const finalShares: Record<string, any> = {};
      (shares || []).forEach((s: any) => { finalShares[s.day_pass_id] = s; });

      const finalEnriched = (finalPasses || []).map((p: any) => ({
        ...p,
        share: finalShares[p.id] || null,
        is_free: (p.price === 0 || p.price === null),
      }));

      return jsonResponse({
        passes: finalEnriched,
        allowance,
        shares: shares || [],
        court_hours: {
          allowed: courtHoursAllowed,
          used: courtHoursUsed,
          remaining: Math.max(courtHoursAllowed - courtHoursUsed, 0),
          period_start: weekStart,
          period_end: weekEnd,
        },
        guest_vouchers: {
          allowed: guestGrant.allowed,
          issued: guestVouchers.length,
          remaining: usableGuestVouchers.length,
          period_start: guestGrant.periodStart,
          period_end: guestGrant.periodEnd,
          vouchers: guestVouchers,
        },
        open_play_unlimited: openPlayUnlimited,
        membership: membership ? {
          id: membership.id,
          tier_id: membership.tier_id,
          venue_id: membership.venue_id,
          starts_at: membership.starts_at,
          expires_at: membership.expires_at,
          tier: membership.membership_tiers || null,
        } : null,
      });
    }

    // ─── GET /my-allowance (kept for backwards compat) ───
    if (req.method === 'GET' && path === 'my-allowance') {
      const membership = await getActiveMembershipWithBenefits(adminClient, userId);
      if (!membership) return jsonResponse({ has_membership: false, passes_allowed: 0, passes_used: 0, passes_remaining: 0 });
      const guestGrant = await ensureMonthlyGuestVouchers(adminClient, membership, userId);
      const vouchers = (guestGrant.vouchers || []).map(voucherToClient);
      const remaining = vouchers.filter((voucher: any) => voucher.status === 'unused').length;

      return jsonResponse({
        has_membership: true,
        passes_allowed: guestGrant.allowed,
        passes_used: Math.max(vouchers.length - remaining, 0),
        passes_remaining: remaining,
        shares: vouchers,
      });
    }

    // ─── POST /buy ── self-purchase a day pass ───
    if (req.method === 'POST' && path === 'buy') {
      return errorResponse('Day passes must be purchased through Stripe checkout', 410);
    }

    // ─── POST /share ── share an existing pass ───
    if (req.method === 'POST' && path === 'share') {
      const body = await req.json();
      const { day_pass_id, voucher_id, recipient_email, recipient_name } = body;
      if (!day_pass_id && !voucher_id) return errorResponse('Missing day_pass_id or voucher_id');
      const recipientName = String(recipient_name || recipient_email || '').trim();
      if (!recipientName) return errorResponse('Missing recipient_name');

      if (voucher_id) {
        const { data: voucher, error: voucherErr } = await adminClient
          .from('access_vouchers')
          .select('*')
          .eq('id', voucher_id)
          .eq('purchaser_user_id', userId)
          .eq('status', 'unused')
          .maybeSingle();
        if (voucherErr) return errorResponse(voucherErr.message, 500);
        if (!voucher) return errorResponse('Voucher not found', 404);

        const metadata = {
          ...(voucher.metadata || {}),
          recipient_name: recipientName,
          recipient_email: recipient_email || null,
          shared_at: new Date().toISOString(),
        };

        const { data: updated, error: updateErr } = await adminClient
          .from('access_vouchers')
          .update({ recipient_name: recipientName, metadata })
          .eq('id', voucher_id)
          .select('*')
          .single();
        if (updateErr) return errorResponse(updateErr.message, 500);
        return jsonResponse({ token: updated.code, voucher_id: updated.id, share_id: updated.id }, 201);
      }

      // Verify the pass belongs to the user and is active
      const { data: pass, error: passErr } = await adminClient
        .from('day_passes')
        .select('id, venue_id, status, user_id')
        .eq('id', day_pass_id)
        .single();

      if (passErr || !pass) return errorResponse('Pass not found', 404);
      if (pass.user_id !== userId) return errorResponse('Not your pass', 403);
      if (pass.status !== 'active') return errorResponse('Pass is not active');

      // Check if already shared
      const { data: existingShare } = await adminClient
        .from('day_pass_shares')
        .select('id')
        .eq('day_pass_id', day_pass_id)
        .eq('status', 'pending')
        .single();

      if (existingShare) return errorResponse('Pass is already shared');

      const token = Math.random().toString(36).substring(2, 10).toUpperCase();

      const { data: share, error: shareErr } = await adminClient.from('day_pass_shares').insert({
        day_pass_id,
        shared_by: userId,
        recipient_name: recipientName,
        recipient_email: recipient_email || null,
        token,
        status: 'pending',
      }).select().single();

      if (shareErr) return errorResponse(shareErr.message);

      // Mark pass with shared_from reference
      await adminClient.from('day_passes')
        .update({ shared_from: share.id })
        .eq('id', day_pass_id);

      return jsonResponse({ token, share_id: share.id, day_pass_id }, 201);
    }

    // ─── DELETE /revoke-share ───
    if (req.method === 'DELETE' && path === 'revoke-share') {
      const shareId = url.searchParams.get('id');
      if (!shareId) return errorResponse('Missing share id');

      const { data: share, error: sErr } = await adminClient
        .from('day_pass_shares')
        .select('id, day_pass_id, shared_by, status')
        .eq('id', shareId)
        .single();

      if (sErr || !share) return errorResponse('Share not found', 404);
      if (share.shared_by !== userId) return errorResponse('Not your share', 403);
      if (share.status === 'claimed') return errorResponse('Already claimed, cannot revoke');

      // Delete share, restore the pass
      await adminClient.from('day_pass_shares').delete().eq('id', shareId);
      await adminClient.from('day_passes')
        .update({ shared_from: null })
        .eq('id', share.day_pass_id);

      return jsonResponse({ ok: true });
    }

    // ─── GET /venue?venueId=X&date=YYYY-MM-DD ───
    if (req.method === 'GET' && path === 'venue') {
      const venueId = url.searchParams.get('venueId');
      const date = url.searchParams.get('date');
      if (!venueId) return errorResponse('Missing venueId');

      let query = client.from('day_passes').select('*').eq('venue_id', venueId);
      if (date) query = query.eq('valid_date', date);

      const { data, error: qErr } = await query.order('created_at', { ascending: false });
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // ─── POST /create ───
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { venueId, customerUserId, validDate, price } = body;
      if (!venueId || !customerUserId || !validDate) return errorResponse('Missing fields');
      const customerId = await resolveCustomerIdForUser(getServiceClient(), customerUserId);

      const { data, error: insertErr } = await client.from('day_passes').insert({
        venue_id: venueId,
        customer_id: customerId,
        user_id: customerUserId,
        valid_date: validDate,
        price: price || 0,
        sold_by: userId,
        status: 'active',
      }).select().single();

      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse(data, 201);
    }

    // ─── PATCH /update ───
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, status } = body;
      if (!id || !status) return errorResponse('Missing id or status');

      // Verify pass exists and caller is venue staff for that venue
      const { data: pass } = await adminClient.from('day_passes').select('venue_id, user_id').eq('id', id).single();
      if (!pass) return errorResponse('Day pass not found', 404);

      const { data: isStaff } = await adminClient.from('venue_staff')
        .select('id').eq('user_id', userId).eq('venue_id', pass.venue_id).eq('is_active', true).maybeSingle();
      const { data: isSuperAdmin } = await adminClient.from('user_roles')
        .select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      if (!isStaff && !isSuperAdmin) return errorResponse('Forbidden', 403);

      const { data, error: upErr } = await adminClient.from('day_passes')
        .update({ status }).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    // ─── PATCH /consume ───
    if (req.method === 'PATCH' && path === 'consume') {
      const body = await req.json();
      const { id } = body;
      if (!id) return errorResponse('Missing day pass id');

      // Verify pass exists and caller is venue staff for that venue
      const { data: pass } = await adminClient.from('day_passes').select('venue_id, user_id').eq('id', id).single();
      if (!pass) return errorResponse('Day pass not found', 404);

      const { data: isStaff } = await adminClient.from('venue_staff')
        .select('id').eq('user_id', userId).eq('venue_id', pass.venue_id).eq('is_active', true).maybeSingle();
      const { data: isSuperAdmin } = await adminClient.from('user_roles')
        .select('role').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      if (!isStaff && !isSuperAdmin) return errorResponse('Forbidden', 403);

      const { data, error: upErr } = await adminClient.from('day_passes')
        .update({ status: 'used' }).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
