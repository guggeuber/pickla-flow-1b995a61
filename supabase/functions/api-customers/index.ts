import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

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

const uniqueStrings = (values: unknown[]) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const asArrayResult = (result: any) => result?.data || [];

const uniqueRowsById = (rows: any[]) => {
  const map = new Map<string, any>();
  for (const row of rows || []) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  return Array.from(map.values());
};

function customerFullName(customer: Record<string, unknown> | null | undefined) {
  if (!customer) return null;
  return cleanString([customer.first_name, customer.last_name].filter(Boolean).join(' '))
    || cleanString(customer.display_name);
}

function identityTitleFrom(row: {
  display_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  receipt_name?: string | null;
}) {
  return cleanString(row.display_name)
    || cleanString(row.email)
    || cleanString(row.full_name)
    || cleanString(row.receipt_name)
    || 'Kund utan namn';
}

async function fetchByCustomerOrUser(admin: ReturnType<typeof getServiceClient>, table: string, select: string, params: {
  venueId?: string | null;
  customerIds?: string[];
  userIds?: string[];
  orderColumn?: string;
  ascending?: boolean;
  limit?: number;
  extra?: (query: any) => any;
}) {
  const queries: Promise<any>[] = [];
  const customerIds = uniqueStrings(params.customerIds || []);
  const userIds = uniqueStrings(params.userIds || []);

  if (customerIds.length > 0) {
    let query = admin.from(table).select(select).in('customer_id', customerIds);
    if (params.venueId) query = query.eq('venue_id', params.venueId);
    if (params.extra) query = params.extra(query);
    if (params.orderColumn) query = query.order(params.orderColumn, { ascending: params.ascending ?? false });
    if (params.limit) query = query.limit(params.limit);
    queries.push(query);
  }

  if (userIds.length > 0) {
    let query = admin.from(table).select(select).in('user_id', userIds);
    if (params.venueId) query = query.eq('venue_id', params.venueId);
    if (params.extra) query = params.extra(query);
    if (params.orderColumn) query = query.order(params.orderColumn, { ascending: params.ascending ?? false });
    if (params.limit) query = query.limit(params.limit);
    queries.push(query);
  }

  if (queries.length === 0) return { data: [], error: null };
  const results = await Promise.all(queries);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) return { data: [], error: firstError };
  const rows = new Map<string, any>();
  for (const row of results.flatMap(asArrayResult)) rows.set(row.id || `${row.customer_id || row.user_id}:${rows.size}`, row);
  return { data: Array.from(rows.values()), error: null };
}

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
      const venueProfilesResult = venueId
        ? await admin.from('customer_venue_profiles')
          .select('customer_id, first_seen_at, last_seen_at, visit_count')
          .eq('venue_id', venueId)
          .order('last_seen_at', { ascending: false, nullsFirst: false })
          .limit(fetchLimit)
        : { data: [], error: null };
      if (venueProfilesResult.error) return errorResponse(venueProfilesResult.error.message);

      const venueCustomerIds = uniqueStrings((venueProfilesResult.data || []).map((row: any) => row.customer_id));
      let authUsersResultForSearch: any = null;
      let searchMatchedUserIds: string[] = [];
      if (search) {
        authUsersResultForSearch = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const needle = search.toLowerCase();
        searchMatchedUserIds = uniqueStrings((authUsersResultForSearch.data?.users || [])
          .filter((user: any) => String(user.email || '').toLowerCase().includes(needle))
          .map((user: any) => user.id));
      }

      let customerQuery = admin
        .from('customers')
        .select('id, auth_user_id, display_name, first_name, last_name, primary_email, primary_phone, email_normalized, phone_e164, created_at, updated_at, status')
        .eq('status', 'active')
        .limit(fetchLimit);
      if (venueId) {
        if (venueCustomerIds.length > 0) {
          customerQuery = customerQuery.in('id', venueCustomerIds);
        } else {
          customerQuery = customerQuery.limit(0);
        }
      } else {
        customerQuery = customerQuery.order('updated_at', { ascending: false });
      }
      const { data: customers, error: customersErr } = await customerQuery;
      if (customersErr) return errorResponse(customersErr.message);

      let profiles: any[] = [];
      if (search) {
        const like = `%${search.replace(/[%_,]/g, ' ').trim()}%`;
        const profileQueries = [
          admin.from('player_profiles').select('*').ilike('display_name', like).limit(fetchLimit),
          admin.from('player_profiles').select('*').ilike('first_name', like).limit(fetchLimit),
          admin.from('player_profiles').select('*').ilike('last_name', like).limit(fetchLimit),
          admin.from('player_profiles').select('*').ilike('phone', like).limit(fetchLimit),
        ];
        if (searchMatchedUserIds.length) {
          profileQueries.push(admin.from('player_profiles').select('*').in('auth_user_id', searchMatchedUserIds).limit(fetchLimit));
        }
        const profileResults = await Promise.all(profileQueries);
        const profileError = profileResults.find((result) => result.error)?.error;
        if (profileError) return errorResponse(profileError.message);
        profiles = uniqueRowsById(profileResults.flatMap((result) => result.data || [])).slice(0, fetchLimit);
      } else {
        const { data: profileRows, error: qErr } = await admin.from('player_profiles').select('*')
          .order('pickla_rating', { ascending: false })
          .limit(fetchLimit);
        if (qErr) return errorResponse(qErr.message);
        profiles = profileRows || [];
      }

      const customerIds = uniqueStrings((customers || []).map((customer: any) => customer.id));
      const authUserIds = uniqueStrings([
        ...(customers || []).map((customer: any) => customer.auth_user_id),
        ...(profiles || []).map((profile: any) => profile.auth_user_id),
      ]);
      const profileByCustomerId = new Map((profiles || []).filter((profile: any) => profile.customer_id).map((profile: any) => [profile.customer_id, profile]));
      const profileByUserId = new Map((profiles || []).filter((profile: any) => profile.auth_user_id).map((profile: any) => [profile.auth_user_id, profile]));
      const venueProfileByCustomerId = new Map((venueProfilesResult.data || []).map((row: any) => [row.customer_id, row]));

      const authUsersPromise = authUsersResultForSearch
        ? Promise.resolve(authUsersResultForSearch)
        : admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const receiptsPromise = fetchByCustomerOrUser(admin, 'booking_receipts',
        'id, customer_id, user_id, customer_name, customer_email, customer_phone, product_description, purchase_type, issued_at, created_at',
        { venueId, customerIds, userIds: authUserIds, orderColumn: 'issued_at', ascending: false, limit: 1000 });
      const membershipsPromise = venueId
        ? fetchByCustomerOrUser(admin, 'memberships',
          'id, customer_id, user_id, status, membership_tiers(id, name, color, monthly_price, discount_percent)',
          { venueId, customerIds, userIds: authUserIds, extra: (query) => query.eq('status', 'active'), limit: 1000 })
        : Promise.resolve({ data: [], error: null });
      const checkinsPromise = venueId
        ? fetchByCustomerOrUser(admin, 'venue_checkins',
          'id, customer_id, user_id, entry_type, checked_in_at, session_date',
          { venueId, customerIds, userIds: authUserIds, orderColumn: 'checked_in_at', ascending: false, limit: 1000 })
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

      const receiptByKey = new Map<string, any>();
      for (const receipt of receiptsResult.data || []) {
        if (receipt.customer_id && !receiptByKey.has(`customer:${receipt.customer_id}`)) receiptByKey.set(`customer:${receipt.customer_id}`, receipt);
        if (receipt.user_id && !receiptByKey.has(`user:${receipt.user_id}`)) receiptByKey.set(`user:${receipt.user_id}`, receipt);
      }

      const membershipByKey = new Map<string, any>();
      for (const membership of membershipsResult.data || []) {
        if (membership.customer_id && !membershipByKey.has(`customer:${membership.customer_id}`)) membershipByKey.set(`customer:${membership.customer_id}`, membership);
        if (membership.user_id && !membershipByKey.has(`user:${membership.user_id}`)) membershipByKey.set(`user:${membership.user_id}`, membership);
      }

      const checkinByKey = new Map<string, any>();
      for (const checkin of checkinsResult.data || []) {
        if (checkin.customer_id && !checkinByKey.has(`customer:${checkin.customer_id}`)) checkinByKey.set(`customer:${checkin.customer_id}`, checkin);
        if (checkin.user_id && !checkinByKey.has(`user:${checkin.user_id}`)) checkinByKey.set(`user:${checkin.user_id}`, checkin);
      }

      const enrichedFromCustomers = (customers || []).map((customer: any) => {
        const profile = profileByCustomerId.get(customer.id) || profileByUserId.get(customer.auth_user_id);
        const authUser = customer.auth_user_id ? usersById.get(customer.auth_user_id) : null;
        const receipt = receiptByKey.get(`customer:${customer.id}`) || (customer.auth_user_id ? receiptByKey.get(`user:${customer.auth_user_id}`) : null);
        const checkin = checkinByKey.get(`customer:${customer.id}`) || (customer.auth_user_id ? checkinByKey.get(`user:${customer.auth_user_id}`) : null);
        const displayName = cleanString(customer.display_name) || cleanString(profile?.display_name);
        const fullName = customerFullName(customer) || profileFullName(profile || {});
        const receiptName = cleanString(receipt?.customer_name);
        const email = cleanString(customer.primary_email) || cleanString(authUser?.email) || cleanString(receipt?.customer_email);
        const phone = cleanString(customer.primary_phone) || cleanString(profile?.phone) || cleanString(receipt?.customer_phone);
        const identityTitle = identityTitleFrom({ display_name: displayName, email, full_name: fullName, receipt_name: receiptName });
        const initialsSeed = displayName || fullName || receiptName || email;
        const membership = membershipByKey.get(`customer:${customer.id}`) || (customer.auth_user_id ? membershipByKey.get(`user:${customer.auth_user_id}`) : null);
        const venueProfile = venueProfileByCustomerId.get(customer.id);

        return {
          ...(profile || {}),
          id: customer.id,
          customer_id: customer.id,
          profile_id: profile?.id || null,
          auth_user_id: customer.auth_user_id || profile?.auth_user_id || null,
          display_name: displayName,
          first_name: cleanString(customer.first_name) || profile?.first_name || null,
          last_name: cleanString(customer.last_name) || profile?.last_name || null,
          email,
          phone,
          full_name: fullName || receiptName,
          identity_title: identityTitle,
          identity_initials: buildInitialsSeed(initialsSeed),
          first_seen_at: venueProfile?.first_seen_at || null,
          last_seen_at: venueProfile?.last_seen_at || null,
          visit_count: venueProfile?.visit_count || 0,
          active_membership_tier: membership?.membership_tiers || null,
          has_active_membership: Boolean(membership),
          last_purchase_at: receipt?.issued_at || receipt?.created_at || null,
          last_purchase_label: receipt?.product_description || receipt?.purchase_type || null,
          last_checkin_at: checkin?.checked_in_at || null,
          last_checkin_type: checkin?.entry_type || null,
        };
      });

      const customerKeys = new Set([
        ...enrichedFromCustomers.map((row: any) => row.customer_id ? `customer:${row.customer_id}` : ''),
        ...enrichedFromCustomers.map((row: any) => row.auth_user_id ? `user:${row.auth_user_id}` : ''),
      ].filter(Boolean));
      const enrichedFallbackProfiles = (profiles || [])
        .filter((profile: any) => !customerKeys.has(`customer:${profile.customer_id}`) && !customerKeys.has(`user:${profile.auth_user_id}`))
        .map((profile: any) => {
          const authUser = usersById.get(profile.auth_user_id);
          const receipt = receiptByKey.get(`user:${profile.auth_user_id}`);
          const checkin = checkinByKey.get(`user:${profile.auth_user_id}`);
          const displayName = cleanString(profile.display_name);
          const fullName = profileFullName(profile);
          const receiptName = cleanString(receipt?.customer_name);
          const email = cleanString(authUser?.email) || cleanString(receipt?.customer_email);
          const phone = cleanString(profile.phone) || cleanString(receipt?.customer_phone);
          const membership = membershipByKey.get(`user:${profile.auth_user_id}`);
          return {
            ...profile,
            customer_id: profile.customer_id || null,
            profile_id: profile.id,
            email,
            phone,
            full_name: fullName || receiptName,
            identity_title: identityTitleFrom({ display_name: displayName, email, full_name: fullName, receipt_name: receiptName }),
            identity_initials: buildInitialsSeed(displayName || fullName || receiptName || email),
            active_membership_tier: membership?.membership_tiers || null,
            has_active_membership: Boolean(membership),
            last_purchase_at: receipt?.issued_at || receipt?.created_at || null,
            last_purchase_label: receipt?.product_description || receipt?.purchase_type || null,
            last_checkin_at: checkin?.checked_in_at || null,
            last_checkin_type: checkin?.entry_type || null,
          };
        });
      const enriched = [...enrichedFromCustomers, ...enrichedFallbackProfiles];

      const needle = search.toLowerCase();
      const filtered = needle
        ? enriched.filter((customer: any) => [
          customer.customer_id,
          customer.auth_user_id,
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

    // GET /api-customers/360?venueId=X&customerId=Y or userId=Y
    if (req.method === 'GET' && path === '360') {
      const venueId = cleanString(url.searchParams.get('venueId'));
      const requestedCustomerId = cleanString(url.searchParams.get('customerId')) || cleanString(url.searchParams.get('customer_id'));
      const requestedUserId = cleanString(url.searchParams.get('userId'));
      if (!venueId || (!requestedCustomerId && !requestedUserId)) return errorResponse('Missing venueId and customerId or userId', 400);

      const admin = getServiceClient();
      const canList = await assertCanListCustomers(admin, userId, venueId);
      if (!canList) return errorResponse('Forbidden', 403);

      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();
      let customer: any = null;
      let profile: any = null;
      let targetCustomerId = requestedCustomerId;
      let targetUserId = requestedUserId;

      if (targetCustomerId) {
        const { data: customerRow, error: customerErr } = await admin
          .from('customers')
          .select('id, auth_user_id, display_name, first_name, last_name, primary_email, primary_phone, created_at, status')
          .eq('id', targetCustomerId)
          .maybeSingle();
        if (customerErr) return errorResponse(customerErr.message, 500);
        if (!customerRow) return errorResponse('Customer not found', 404);
        customer = customerRow;
        targetUserId = targetUserId || cleanString(customer.auth_user_id);
      }

      if (targetUserId) {
        const { data: profileRow, error: profileErr } = await admin.from('player_profiles')
          .select('*')
          .eq('auth_user_id', targetUserId)
          .maybeSingle();
        if (profileErr) return errorResponse(profileErr.message, 500);
        profile = profileRow || null;
        targetCustomerId = targetCustomerId || cleanString(profile?.customer_id);

        if (!customer && targetCustomerId) {
          const { data: customerRow, error: customerErr } = await admin
            .from('customers')
            .select('id, auth_user_id, display_name, first_name, last_name, primary_email, primary_phone, created_at, status')
            .eq('id', targetCustomerId)
            .maybeSingle();
          if (customerErr) return errorResponse(customerErr.message, 500);
          customer = customerRow || null;
        }

        if (!customer) {
          const { data: customerRow, error: customerErr } = await admin
            .from('customers')
            .select('id, auth_user_id, display_name, first_name, last_name, primary_email, primary_phone, created_at, status')
            .eq('auth_user_id', targetUserId)
            .maybeSingle();
          if (customerErr) return errorResponse(customerErr.message, 500);
          customer = customerRow || null;
          targetCustomerId = targetCustomerId || cleanString(customer?.id);
        }
      }

      if (!profile && customer?.auth_user_id) {
        const { data: profileRow, error: profileErr } = await admin.from('player_profiles')
          .select('*')
          .eq('auth_user_id', customer.auth_user_id)
          .maybeSingle();
        if (profileErr) return errorResponse(profileErr.message, 500);
        profile = profileRow || null;
        targetUserId = targetUserId || cleanString(customer.auth_user_id);
      }

      if (!targetCustomerId && !targetUserId) return errorResponse('Customer has no linked identity yet', 404);
      const customerIds = targetCustomerId ? [targetCustomerId] : [];
      const userIds = targetUserId ? [targetUserId] : [];

      const [
        authUserResult,
        bookingsResult,
        registrationsResult,
        dayPassesResult,
        membershipsResult,
        checkinsResult,
        receiptsResult,
      ] = await Promise.all([
        targetUserId ? admin.auth.admin.getUserById(targetUserId) : Promise.resolve({ data: { user: null }, error: null }),
        fetchByCustomerOrUser(admin, 'bookings',
          'id, booking_ref, stripe_session_id, access_code, venue_id, venue_court_id, customer_id, user_id, booked_by, notes, start_time, end_time, status, total_price, currency, created_at, venue_courts(id, name, court_number, sport_type)',
          { venueId, customerIds, userIds, extra: (query) => query.neq('status', 'cancelled').gte('end_time', nowIso), orderColumn: 'start_time', ascending: true, limit: 25 }),
        fetchByCustomerOrUser(admin, 'session_registrations',
          'id, venue_id, customer_id, activity_session_id, session_date, user_id, status, price_paid_sek, stripe_session_id, registered_at, created_at, activity_sessions(id, name, session_type, start_time, end_time, capacity)',
          { venueId, customerIds, userIds, extra: (query) => query.neq('status', 'cancelled').gte('session_date', today), orderColumn: 'session_date', ascending: true, limit: 30 }),
        fetchByCustomerOrUser(admin, 'day_passes',
          'id, venue_id, customer_id, user_id, valid_date, purchase_date, status, price, currency, stripe_session_id, created_at',
          { venueId, customerIds, userIds, orderColumn: 'valid_date', ascending: false, limit: 30 }),
        fetchByCustomerOrUser(admin, 'memberships',
          'id, venue_id, customer_id, user_id, tier_id, status, starts_at, expires_at, notes, created_at, updated_at, membership_tiers(id, name, color, discount_percent, monthly_price)',
          { venueId, customerIds, userIds, orderColumn: 'created_at', ascending: false, limit: 20 }),
        fetchByCustomerOrUser(admin, 'venue_checkins',
          'id, venue_id, customer_id, user_id, player_name, player_phone, entry_type, entitlement_id, checked_in_at, checked_out_at, session_date, created_at',
          { venueId, customerIds, userIds, orderColumn: 'checked_in_at', ascending: false, limit: 30 }),
        fetchByCustomerOrUser(admin, 'booking_receipts',
          'id, receipt_number, booking_refs, stripe_session_id, stripe_invoice_id, venue_id, customer_id, user_id, customer_name, customer_email, customer_phone, purchase_type, product_description, total_inc_vat, total_inc_vat_sek, vat_amount, vat_amount_sek, vat_rate, currency, payment_provider, payment_method, payment_status, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, issued_at, created_at',
          { venueId, customerIds, userIds, orderColumn: 'issued_at', ascending: false, limit: 50 }),
      ]);

      const firstError = [
        bookingsResult.error,
        registrationsResult.error,
        dayPassesResult.error,
        membershipsResult.error,
        checkinsResult.error,
        receiptsResult.error,
      ].find(Boolean);
      if (firstError) return errorResponse(firstError.message, 500);

      const authUser = authUserResult.data?.user || null;
      const receipts = receiptsResult.data || [];
      const registrations = registrationsResult.data || [];
      const receiptIds = Array.from(new Set(receipts.map((row: any) => row.id).filter(Boolean)));
      const stripeSessionIds = Array.from(new Set(receipts.map((row: any) => row.stripe_session_id).filter(Boolean)));
      const registrationIds = Array.from(new Set(registrations.map((row: any) => row.id).filter(Boolean)));

      const ledgerById = new Map<string, any>();
      if (receiptIds.length > 0) {
        const { data, error: ledgerErr } = await admin.from('ledger_entries')
          .select('id, venue_id, customer_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
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
          .select('id, venue_id, customer_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
          .eq('venue_id', venueId)
          .in('stripe_session_id', stripeSessionIds)
          .order('occurred_at', { ascending: false });
        if (ledgerErr) return errorResponse(ledgerErr.message, 500);
        for (const row of data || []) ledgerById.set(row.id, row);
      }
      if (targetCustomerId) {
        const { data, error: ledgerErr } = await admin.from('ledger_entries')
          .select('id, venue_id, customer_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
          .eq('venue_id', venueId)
          .eq('customer_id', targetCustomerId)
          .order('occurred_at', { ascending: false })
          .limit(50);
        if (ledgerErr) return errorResponse(ledgerErr.message, 500);
        for (const row of data || []) ledgerById.set(row.id, row);
      }

      const latestReceipt = receipts[0] || null;
      const name = customerFullName(customer)
        || fullName(profile)
        || cleanString(latestReceipt?.customer_name)
        || cleanString(authUser?.user_metadata?.display_name)
        || cleanString(authUser?.email)
        || 'Kund utan namn';
      const email = cleanString(customer?.primary_email) || cleanString(authUser?.email) || cleanString(latestReceipt?.customer_email);
      const phone = cleanString(customer?.primary_phone) || cleanString(profile?.phone) || cleanString(latestReceipt?.customer_phone);
      const activeMembership = (membershipsResult.data || []).find((row: any) => row.status === 'active') || null;
      const ledgerEntries = Array.from(ledgerById.values()).sort((a, b) =>
        new Date(b.occurred_at || b.created_at).getTime() - new Date(a.occurred_at || a.created_at).getTime()
      );
      const membershipReceipts = receipts.filter((receipt: any) =>
        receipt.purchase_type === 'membership' ||
        Boolean(receipt.stripe_subscription_id) ||
        /medlemskap|membership/i.test(String(receipt.product_description || ''))
      );
      const subscriptionRows = (membershipsResult.data || []).map((membership: any) => {
        const relatedReceipts = membershipReceipts.filter((receipt: any) =>
          receipt.customer_id && membership.customer_id
            ? receipt.customer_id === membership.customer_id
            : receipt.user_id === membership.user_id
        );
        const latest = relatedReceipts[0] || null;
        const successful = relatedReceipts.find((receipt: any) =>
          ['paid', 'complete', 'succeeded'].includes(String(receipt.payment_status || '').toLowerCase())
        ) || null;
        const failed = relatedReceipts.find((receipt: any) => !['paid', 'complete', 'succeeded'].includes(String(receipt.payment_status || '').toLowerCase())) || null;
        const amountSek = Number(latest?.total_inc_vat_sek ?? membership.membership_tiers?.monthly_price ?? 0);
        const periodStart = membership.starts_at || membership.created_at || null;
        const periodEnd = membership.expires_at || (latest?.issued_at
          ? DateTime.fromISO(latest.issued_at, { zone: 'utc' }).plus({ months: 1 }).toISO()
          : null);
        const lifetimeRevenueMinor = relatedReceipts.reduce((sum: number, receipt: any) =>
          sum + Math.round(Number(receipt.total_inc_vat_sek ?? receipt.total_inc_vat ?? 0) * 100), 0);
        return {
          membership_id: membership.id,
          subscription_name: membership.membership_tiers?.name || 'Medlemskap',
          status: membership.status || 'unknown',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          next_billing_date: membership.status === 'active' ? periodEnd : null,
          last_successful_payment: successful?.issued_at || successful?.created_at || null,
          last_failed_payment: failed?.issued_at || failed?.created_at || null,
          billing_interval: membership.membership_tiers?.monthly_price ? 'monthly' : 'manual',
          amount_sek: amountSek,
          stripe_customer_id: latest?.stripe_customer_id || profile?.stripe_customer_id || null,
          stripe_subscription_id: latest?.stripe_subscription_id || null,
          payment_method: latest?.payment_method || null,
          card_brand: null,
          card_last4: null,
          cancel_at_period_end: /cancel_at_period_end/i.test(String(membership.notes || '')),
          paused: /paused/i.test(String(membership.notes || '')),
          lifetime_subscription_revenue_minor: lifetimeRevenueMinor,
          payment_history: relatedReceipts.map((receipt: any) => ({
            receipt_id: receipt.id,
            receipt_number: receipt.receipt_number,
            occurred_at: receipt.issued_at || receipt.created_at,
            amount_sek: Number(receipt.total_inc_vat_sek ?? receipt.total_inc_vat ?? 0),
            payment_status: receipt.payment_status || null,
            payment_method: receipt.payment_method || null,
            stripe_session_id: receipt.stripe_session_id || null,
            stripe_invoice_id: receipt.stripe_invoice_id || null,
          })),
          actions: {
            view_payments: relatedReceipts.length > 0,
            retry_payment: Boolean(failed),
            open_receipt: Boolean(latest?.receipt_number),
            update_payment_method: 'future',
            cancel: 'existing_safe_flow_required',
            pause: 'future',
          },
        };
      });
      const financialTimeline = [
        ...receipts.map((receipt: any) => ({
          id: `receipt:${receipt.id}`,
          occurred_at: receipt.issued_at || receipt.created_at,
          kind: 'receipt',
          title: receipt.product_description || receipt.purchase_type || 'Kvitto',
          amount_minor: Math.round(Number(receipt.total_inc_vat_sek ?? receipt.total_inc_vat ?? 0) * 100),
          status: receipt.payment_status || null,
          receipt_number: receipt.receipt_number || null,
          stripe_session_id: receipt.stripe_session_id || null,
          stripe_invoice_id: receipt.stripe_invoice_id || null,
          source: receipt,
        })),
        ...ledgerEntries.map((entry: any) => ({
          id: `ledger:${entry.id}`,
          occurred_at: entry.occurred_at || entry.created_at,
          kind: 'ledger_entry',
          title: entry.source_type || 'Ledger entry',
          amount_minor: Number(entry.amount_inc_vat_minor || 0),
          status: entry.payment_status || null,
          receipt_number: entry.receipt_number || null,
          stripe_session_id: entry.stripe_session_id || null,
          source: entry,
        })),
        ...(membershipsResult.data || []).map((membership: any) => ({
          id: `membership:${membership.id}`,
          occurred_at: membership.created_at || membership.starts_at,
          kind: 'membership',
          title: membership.membership_tiers?.name || 'Medlemskap',
          amount_minor: Math.round(Number(membership.membership_tiers?.monthly_price || 0) * 100),
          status: membership.status || null,
          receipt_number: null,
          stripe_session_id: null,
          source: membership,
        })),
      ].filter((item: any) => item.occurred_at).sort((a: any, b: any) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      );

      return jsonResponse({
        customer: {
          customer_id: targetCustomerId || null,
          user_id: targetUserId || null,
          profile_id: profile?.id || null,
          name,
          email,
          phone,
          avatar_url: profile?.avatar_url || null,
          display_name: customer?.display_name || profile?.display_name || null,
          first_name: customer?.first_name || profile?.first_name || null,
          last_name: customer?.last_name || profile?.last_name || null,
          created_at: customer?.created_at || profile?.created_at || authUser?.created_at || null,
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
        subscriptions: subscriptionRows,
        checkins: checkinsResult.data || [],
        receipts,
        ledger_entries: ledgerEntries,
        financial_timeline: financialTimeline,
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
