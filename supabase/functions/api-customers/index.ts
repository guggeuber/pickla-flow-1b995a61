import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

const cleanString = (value: unknown) => {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
};

const profileFullName = (profile: Record<string, unknown>) => {
  return cleanString([profile.first_name, profile.last_name].filter(Boolean).join(' '));
};

const buildInitialsSeed = (value: string | null) => {
  if (!value) return '?';
  const emailPrefix = value.includes('@') ? value.split('@')[0] : value;
  return emailPrefix
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
};

const fullName = (profile: Record<string, unknown> | null | undefined) => {
  if (!profile) return null;
  return cleanString([profile.first_name, profile.last_name].filter(Boolean).join(' '))
    || cleanString(profile.display_name);
};

async function assertCanListCustomers(admin: ReturnType<typeof getServiceClient>, userId: string, venueId: string) {
  const [{ data: globalRole }, { data: venueStaff }] = await Promise.all([
    admin.from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle(),
    admin.from('venue_staff')
      .select('id')
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  return Boolean(globalRole || venueStaff);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    // GET /api-customers/list?venueId=X&search=X&limit=50
    if (req.method === 'GET' && path === 'list') {
      const search = cleanString(url.searchParams.get('search')) || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
      const venueId = cleanString(url.searchParams.get('venueId'));
      const admin = getServiceClient();

      if (venueId) {
        const canList = await assertCanListCustomers(admin, userId, venueId);
        if (!canList) return errorResponse('Forbidden', 403);
      }

      const fetchLimit = search ? 500 : limit;
      const { data: profiles, error: qErr } = await admin.from('player_profiles').select('*')
        .order('pickla_rating', { ascending: false })
        .limit(fetchLimit);
      if (qErr) return errorResponse(qErr.message);

      const authUserIds = [...new Set((profiles || []).map((profile: any) => profile.auth_user_id).filter(Boolean))];

      const authUsersPromise = admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const receiptsPromise = authUserIds.length > 0
        ? admin.from('booking_receipts')
          .select('user_id, customer_name, customer_email, customer_phone, product_description, purchase_type, issued_at, created_at')
          .in('user_id', authUserIds)
          .order('issued_at', { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const membershipsPromise = venueId && authUserIds.length > 0
        ? admin.from('memberships')
          .select('user_id, status, membership_tiers(id, name, color, monthly_price, discount_percent)')
          .eq('venue_id', venueId)
          .eq('status', 'active')
          .in('user_id', authUserIds)
        : Promise.resolve({ data: [], error: null });
      const checkinsPromise = venueId && authUserIds.length > 0
        ? admin.from('venue_checkins')
          .select('user_id, entry_type, checked_in_at, session_date')
          .eq('venue_id', venueId)
          .in('user_id', authUserIds)
          .order('checked_in_at', { ascending: false })
          .limit(1000)
        : Promise.resolve({ data: [], error: null });

      const [authUsersResult, receiptsResult, membershipsResult, checkinsResult] = await Promise.all([
        authUsersPromise,
        receiptsPromise,
        membershipsPromise,
        checkinsPromise,
      ]);
      const listError = [receiptsResult.error, membershipsResult.error, checkinsResult.error].find(Boolean);
      if (listError) return errorResponse(listError.message, 500);

      const usersById = new Map((authUsersResult.data?.users || []).map((user: any) => [user.id, user]));

      const receiptByUserId = new Map<string, any>();
      for (const receipt of receiptsResult.data || []) {
        if (receipt.user_id && !receiptByUserId.has(receipt.user_id)) {
          receiptByUserId.set(receipt.user_id, receipt);
        }
      }

      const membershipByUserId = new Map<string, any>();
      for (const membership of membershipsResult.data || []) {
        if (membership.user_id && !membershipByUserId.has(membership.user_id)) {
          membershipByUserId.set(membership.user_id, membership);
        }
      }

      const checkinByUserId = new Map<string, any>();
      for (const checkin of checkinsResult.data || []) {
        if (checkin.user_id && !checkinByUserId.has(checkin.user_id)) {
          checkinByUserId.set(checkin.user_id, checkin);
        }
      }

      const enriched = (profiles || []).map((profile: any) => {
        const authUser = usersById.get(profile.auth_user_id);
        const receipt = receiptByUserId.get(profile.auth_user_id);
        const checkin = checkinByUserId.get(profile.auth_user_id);
        const displayName = cleanString(profile.display_name);
        const fullName = profileFullName(profile);
        const receiptName = cleanString(receipt?.customer_name);
        const email = cleanString(authUser?.email) || cleanString(receipt?.customer_email);
        const phone = cleanString(profile.phone) || cleanString(receipt?.customer_phone);
        const identityTitle = displayName || email || fullName || receiptName || 'Kund utan namn';
        const initialsSeed = displayName || fullName || receiptName || email;
        const membership = membershipByUserId.get(profile.auth_user_id);

        return {
          ...profile,
          email,
          phone,
          full_name: fullName || receiptName,
          identity_title: identityTitle,
          identity_initials: buildInitialsSeed(initialsSeed),
          active_membership_tier: membership?.membership_tiers || null,
          has_active_membership: Boolean(membership),
          last_purchase_at: receipt?.issued_at || receipt?.created_at || null,
          last_purchase_label: receipt?.product_description || receipt?.purchase_type || null,
          last_checkin_at: checkin?.checked_in_at || null,
          last_checkin_type: checkin?.entry_type || null,
        };
      });

      const needle = search.toLowerCase();
      const filtered = needle
        ? enriched.filter((customer: any) => [
          customer.display_name,
          customer.first_name,
          customer.last_name,
          customer.full_name,
          customer.identity_title,
          customer.email,
          customer.phone,
        ].some((value) => String(value || '').toLowerCase().includes(needle)))
        : enriched;

      return jsonResponse(filtered.slice(0, limit), 200, 10);
    }

    // GET /api-customers/profile?id=X
    if (req.method === 'GET' && path === 'profile') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { data, error: qErr } = await client.from('player_profiles')
        .select('*').eq('id', id).single();
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // GET /api-customers/360?venueId=X&userId=Y
    if (req.method === 'GET' && path === '360') {
      const venueId = cleanString(url.searchParams.get('venueId'));
      const targetUserId = cleanString(url.searchParams.get('userId'));
      if (!venueId || !targetUserId) return errorResponse('Missing venueId or userId', 400);

      const admin = getServiceClient();
      const canList = await assertCanListCustomers(admin, userId, venueId);
      if (!canList) return errorResponse('Forbidden', 403);

      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      const [
        profileResult,
        authUserResult,
        bookingsResult,
        registrationsResult,
        dayPassesResult,
        membershipsResult,
        checkinsResult,
        receiptsResult,
      ] = await Promise.all([
        admin.from('player_profiles')
          .select('*')
          .eq('auth_user_id', targetUserId)
          .maybeSingle(),
        admin.auth.admin.getUserById(targetUserId),
        admin.from('bookings')
          .select('id, booking_ref, stripe_session_id, access_code, venue_id, venue_court_id, user_id, booked_by, notes, start_time, end_time, status, total_price, currency, created_at, venue_courts(id, name, court_number, sport_type)')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .neq('status', 'cancelled')
          .gte('end_time', nowIso)
          .order('start_time', { ascending: true })
          .limit(25),
        admin.from('session_registrations')
          .select('id, venue_id, activity_session_id, session_date, user_id, status, price_paid_sek, stripe_session_id, registered_at, created_at, activity_sessions(id, name, session_type, start_time, end_time, capacity)')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .neq('status', 'cancelled')
          .gte('session_date', today)
          .order('session_date', { ascending: true })
          .limit(30),
        admin.from('day_passes')
          .select('id, venue_id, user_id, valid_date, purchase_date, status, price, currency, stripe_session_id, created_at')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .order('valid_date', { ascending: false })
          .limit(30),
        admin.from('memberships')
          .select('id, venue_id, user_id, tier_id, status, starts_at, expires_at, notes, created_at, updated_at, membership_tiers(id, name, color, discount_percent, monthly_price)')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false })
          .limit(20),
        admin.from('venue_checkins')
          .select('id, venue_id, user_id, player_name, player_phone, entry_type, entitlement_id, checked_in_at, checked_out_at, session_date, created_at')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .order('checked_in_at', { ascending: false })
          .limit(30),
        admin.from('booking_receipts')
          .select('id, receipt_number, booking_refs, stripe_session_id, venue_id, user_id, customer_name, customer_email, customer_phone, purchase_type, product_description, total_inc_vat, total_inc_vat_sek, vat_amount, vat_amount_sek, vat_rate, currency, payment_provider, payment_method, payment_status, stripe_payment_intent_id, stripe_customer_id, issued_at, created_at')
          .eq('venue_id', venueId)
          .eq('user_id', targetUserId)
          .order('issued_at', { ascending: false })
          .limit(50),
      ]);

      const firstError = [
        profileResult.error,
        bookingsResult.error,
        registrationsResult.error,
        dayPassesResult.error,
        membershipsResult.error,
        checkinsResult.error,
        receiptsResult.error,
      ].find(Boolean);
      if (firstError) return errorResponse(firstError.message, 500);

      const profile = profileResult.data || null;
      const authUser = authUserResult.data?.user || null;
      const receipts = receiptsResult.data || [];
      const registrations = registrationsResult.data || [];
      const receiptIds = Array.from(new Set(receipts.map((row: any) => row.id).filter(Boolean)));
      const stripeSessionIds = Array.from(new Set(receipts.map((row: any) => row.stripe_session_id).filter(Boolean)));
      const registrationIds = Array.from(new Set(registrations.map((row: any) => row.id).filter(Boolean)));

      const ledgerById = new Map<string, any>();
      if (receiptIds.length > 0) {
        const { data, error: ledgerErr } = await admin.from('ledger_entries')
          .select('id, venue_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
          .eq('venue_id', venueId)
          .in('booking_receipt_id', receiptIds)
          .order('occurred_at', { ascending: false });
        if (ledgerErr) return errorResponse(ledgerErr.message, 500);
        for (const row of data || []) ledgerById.set(row.id, row);
      }
      let registrationCheckins: any[] = [];
      if (registrationIds.length > 0) {
        const { data, error: checkinErr } = await admin.from('venue_checkins')
          .select('id, entitlement_id, entry_type, checked_in_at, checked_out_at')
          .eq('venue_id', venueId)
          .in('entitlement_id', registrationIds)
          .in('entry_type', ['session_ticket', 'activity_registration'])
          .order('checked_in_at', { ascending: false });
        if (checkinErr) return errorResponse(checkinErr.message, 500);
        registrationCheckins = data || [];
      }
      const checkinByRegistrationId = new Map(registrationCheckins.map((row: any) => [row.entitlement_id, row]));
      if (stripeSessionIds.length > 0) {
        const { data, error: ledgerErr } = await admin.from('ledger_entries')
          .select('id, venue_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
          .eq('venue_id', venueId)
          .in('stripe_session_id', stripeSessionIds)
          .order('occurred_at', { ascending: false });
        if (ledgerErr) return errorResponse(ledgerErr.message, 500);
        for (const row of data || []) ledgerById.set(row.id, row);
      }

      const latestReceipt = receipts[0] || null;
      const name = fullName(profile)
        || cleanString(latestReceipt?.customer_name)
        || cleanString(authUser?.user_metadata?.display_name)
        || cleanString(authUser?.email)
        || 'Kund utan namn';
      const email = cleanString(authUser?.email) || cleanString(latestReceipt?.customer_email);
      const phone = cleanString(profile?.phone) || cleanString(latestReceipt?.customer_phone);
      const activeMembership = (membershipsResult.data || []).find((row: any) => row.status === 'active') || null;

      return jsonResponse({
        customer: {
          user_id: targetUserId,
          profile_id: profile?.id || null,
          name,
          email,
          phone,
          avatar_url: profile?.avatar_url || null,
          display_name: profile?.display_name || null,
          first_name: profile?.first_name || null,
          last_name: profile?.last_name || null,
          created_at: profile?.created_at || authUser?.created_at || null,
        },
        membership_badge: activeMembership?.membership_tiers || null,
        active_membership: activeMembership,
        upcoming_bookings: bookingsResult.data || [],
        activity_registrations: registrations.map((registration: any) => {
          const checkin = checkinByRegistrationId.get(registration.id);
          return {
            ...registration,
            checked_in: Boolean(checkin) || registration.status === 'checked_in',
            checked_in_at: checkin?.checked_in_at || null,
            consumed: Boolean(checkin) || registration.status === 'checked_in',
          };
        }),
        day_passes: dayPassesResult.data || [],
        memberships: membershipsResult.data || [],
        checkins: checkinsResult.data || [],
        receipts,
        ledger_entries: Array.from(ledgerById.values()).sort((a, b) =>
          new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime()
        ),
        safe_actions: [
          'edit_contact',
          'manual_checkin',
          'assign_membership',
          'cancel_membership',
          'open_receipt',
          'open_booking',
        ],
      }, 200, 10);
    }

    // PATCH /api-customers/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, display_name, first_name, last_name, phone, bio } = body;
      if (!id) return errorResponse('Missing id');

      const updates: Record<string, any> = {};
      if (display_name !== undefined) updates.display_name = display_name;
      if (first_name !== undefined) updates.first_name = first_name;
      if (last_name !== undefined) updates.last_name = last_name;
      if (phone !== undefined) updates.phone = phone;
      if (bio !== undefined) updates.bio = bio;

      const { data, error: upErr } = await client.from('player_profiles')
        .update(updates).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    // GET /api-customers/recent?limit=10
    if (req.method === 'GET' && path === 'recent') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

      const { data, error: qErr } = await client.from('player_profiles')
        .select('id, display_name, auth_user_id')
        .order('updated_at', { ascending: false }).limit(limit);
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // POST /api-customers/create — Create a new customer (player_profile) by staff
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { display_name, first_name, last_name, phone, email, venue_id } = body;
      const firstName = String(first_name || '').trim();
      const lastName = String(last_name || '').trim();
      const displayName = String(display_name || [firstName, lastName].filter(Boolean).join(' ')).trim();
      if (!displayName) return errorResponse('display_name is required');
      if (!firstName || !lastName || !phone) return errorResponse('Staff-created customers require first_name, last_name and phone');

      // Use service role to create profile without requiring auth signup
      const serviceClient = getServiceClient();

      // If email provided, create an auth user first, then a profile is auto-created via trigger
      if (email) {
        // Generate a random password — the user can reset later
        const tempPassword = crypto.randomUUID();
        const { data: authUser, error: authErr } = await serviceClient.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { display_name: displayName },
        });
        if (authErr) return errorResponse(authErr.message);

        // Update the auto-created profile with phone
        if (authUser.user) {
          await serviceClient.from('player_profiles')
            .update({ phone, display_name: displayName, first_name: firstName, last_name: lastName })
            .eq('auth_user_id', authUser.user.id);
        }

        return jsonResponse({ id: authUser.user?.id, display_name: displayName, first_name: firstName, last_name: lastName, phone, email });
      }

      // No email — create a "guest" profile (no auth user)
      // We create a profile with a placeholder auth_user_id (the staff user's id is NOT the customer)
      // Instead, generate a UUID for tracking
      const guestId = crypto.randomUUID();
      const { data: profile, error: profErr } = await serviceClient.from('player_profiles')
        .insert({
          auth_user_id: guestId,
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
        })
        .select()
        .single();
      if (profErr) return errorResponse(profErr.message);

      // Also insert a customer role
      await serviceClient.from('user_roles').insert({
        user_id: guestId,
        role: 'customer',
      });

      return jsonResponse(profile);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
