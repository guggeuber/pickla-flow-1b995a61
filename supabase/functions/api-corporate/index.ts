import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // ── Public: lookup by invite token (no auth) ──
    if (req.method === 'GET' && path === 'invite-info') {
      const token = url.searchParams.get('token');
      if (!token) return errorResponse('Missing token');

      const serviceClient = getServiceClient();
      const { data, error } = await serviceClient
        .from('corporate_accounts')
        .select('id, company_name, venue_id, venues(name, logo_url, primary_color)')
        .eq('invite_token', token)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) return errorResponse('Invalid or expired invite link', 404);
      return jsonResponse(data);
    }

    // ── Authenticated endpoints ──
    const { client, userId, error: authErr } = await getAuthenticatedClient(req);
    if (authErr || !client || !userId) return errorResponse(authErr || 'Unauthorized', 401);

    // POST /join — join via invite token
    if (req.method === 'POST' && path === 'join') {
      const body = await req.json();
      const { token } = body;
      if (!token) return errorResponse('Missing token');

      const serviceClient = getServiceClient();

      // Lookup account
      const { data: account } = await serviceClient
        .from('corporate_accounts')
        .select('id, company_name, venue_id')
        .eq('invite_token', token)
        .eq('is_active', true)
        .maybeSingle();

      if (!account) return errorResponse('Invalid or expired invite link', 404);

      // Check if already a member
      const { data: existing } = await serviceClient
        .from('corporate_members')
        .select('id')
        .eq('corporate_account_id', account.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) return jsonResponse({ already_member: true, corporate_account_id: account.id });

      // Count existing members to determine role
      const { count } = await serviceClient
        .from('corporate_members')
        .select('id', { count: 'exact', head: true })
        .eq('corporate_account_id', account.id);

      const role = (count === 0) ? 'admin' : 'member';

      const { error: insertErr } = await serviceClient
        .from('corporate_members')
        .insert({ corporate_account_id: account.id, user_id: userId, role });

      if (insertErr) return errorResponse(insertErr.message);

      return jsonResponse({ joined: true, role, corporate_account_id: account.id, company_name: account.company_name });
    }

    // GET /my — get user's corporate memberships
    if (req.method === 'GET' && path === 'my') {
      const serviceClient = getServiceClient();
      const { data: memberships } = await serviceClient
        .from('corporate_members')
        .select(`
          id, role, joined_at,
          corporate_accounts(id, company_name, venue_id, invite_token, venues(name, logo_url))
        `)
        .eq('user_id', userId);

      if (!memberships?.length) return jsonResponse({ memberships: [], packages: [] });

      const accountIds = memberships.map((m: any) => m.corporate_accounts?.id).filter(Boolean);

      const { data: packages } = await serviceClient
        .from('corporate_packages')
        .select('*')
        .in('corporate_account_id', accountIds)
        .eq('status', 'active');

      return jsonResponse({ memberships, packages: packages || [] });
    }

    // GET /dashboard — corporate admin dashboard
    if (req.method === 'GET' && path === 'dashboard') {
      const accountId = url.searchParams.get('accountId');
      if (!accountId) return errorResponse('Missing accountId');

      const serviceClient = getServiceClient();

      // Verify caller is corp admin
      const { data: membership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', accountId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership || membership.role !== 'admin') return errorResponse('Forbidden', 403);

      const [accountRes, membersRes, packagesRes, bookingsRes] = await Promise.all([
        serviceClient.from('corporate_accounts').select('*, venues(name, logo_url)').eq('id', accountId).single(),
        serviceClient.from('corporate_members').select('id, user_id, role, joined_at').eq('corporate_account_id', accountId),
        serviceClient.from('corporate_packages').select('*').eq('corporate_account_id', accountId),
        serviceClient.from('bookings')
          .select('id, start_time, end_time, status, venue_courts(name), user_id')
          .eq('corporate_package_id', accountId)
          .order('start_time', { ascending: false })
          .limit(50),
      ]);

      // Get member profiles
      const memberUserIds = (membersRes.data || []).map((m: any) => m.user_id);
      const { data: profiles } = await serviceClient
        .from('player_profiles')
        .select('auth_user_id, display_name, phone, avatar_url')
        .in('auth_user_id', memberUserIds);

      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.auth_user_id, p]));
      const membersWithProfiles = (membersRes.data || []).map((m: any) => ({
        ...m,
        profile: profileMap[m.user_id] || null,
      }));

      return jsonResponse({
        account: accountRes.data,
        members: membersWithProfiles,
        packages: packagesRes.data || [],
        recent_bookings: bookingsRes.data || [],
      });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
