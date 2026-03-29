import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'CO-';
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

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

    // ── Public: self-registration request ──
    if (req.method === 'POST' && path === 'register') {
      const body = await req.json();
      const { company_name, contact_name, contact_email, contact_phone, venue_id } = body;
      if (!company_name?.trim() || !venue_id) return errorResponse('Företagsnamn och venue krävs');

      const serviceClient = getServiceClient();

      const { data: account, error: insertErr } = await serviceClient
        .from('corporate_accounts')
        .insert({
          venue_id,
          company_name: company_name.trim(),
          contact_name: contact_name?.trim() || null,
          contact_email: contact_email?.trim() || null,
          contact_phone: contact_phone?.trim() || null,
        })
        .select()
        .single();

      if (insertErr) return errorResponse(insertErr.message);

      // If the user is authenticated, make them the first admin member
      const authHeader = req.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const { data: { user: authUser } } = await serviceClient.auth.getUser(token);
        if (authUser?.id) {
          await serviceClient.from('corporate_members').insert({
            corporate_account_id: account.id,
            user_id: authUser.id,
            role: 'admin',
          });
        }
      }

      return jsonResponse({ registered: true, account_id: account.id, invite_token: account.invite_token }, 201);
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

      const { data: account } = await serviceClient
        .from('corporate_accounts')
        .select('id, company_name, venue_id')
        .eq('invite_token', token)
        .eq('is_active', true)
        .maybeSingle();

      if (!account) return errorResponse('Invalid or expired invite link', 404);

      const { data: existing } = await serviceClient
        .from('corporate_members')
        .select('id')
        .eq('corporate_account_id', account.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) return jsonResponse({ already_member: true, corporate_account_id: account.id });

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
          id, role, joined_at, monthly_hour_limit, monthly_cost_limit,
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

      const { data: membership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', accountId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership || membership.role !== 'admin') return errorResponse('Forbidden', 403);

      const [accountRes, membersRes, packagesRes, bookingsRes, ordersRes] = await Promise.all([
        serviceClient.from('corporate_accounts').select('*, venues(name, logo_url)').eq('id', accountId).single(),
        serviceClient.from('corporate_members').select('id, user_id, role, joined_at, monthly_hour_limit, monthly_cost_limit').eq('corporate_account_id', accountId),
        serviceClient.from('corporate_packages').select('*').eq('corporate_account_id', accountId),
        serviceClient.from('bookings')
          .select('id, start_time, end_time, status, venue_courts(name), user_id')
          .eq('corporate_package_id', accountId)
          .order('start_time', { ascending: false })
          .limit(50),
        serviceClient.from('corporate_orders')
          .select('*, corporate_order_items(*)')
          .eq('corporate_account_id', accountId)
          .order('created_at', { ascending: false }),
      ]);

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
        orders: ordersRes.data || [],
      });
    }

    // POST /orders — create an order (hours or recurring series)
    if (req.method === 'POST' && path === 'orders') {
      const body = await req.json();
      const { corporate_account_id, order_type, total_hours, total_price, notes, recurring_config } = body;

      if (!corporate_account_id) return errorResponse('Missing corporate_account_id');

      const serviceClient = getServiceClient();

      // Verify caller is corp admin
      const { data: membership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!membership || membership.role !== 'admin') return errorResponse('Forbidden', 403);

      // Get venue_id from account
      const { data: account } = await serviceClient
        .from('corporate_accounts')
        .select('venue_id')
        .eq('id', corporate_account_id)
        .single();

      if (!account) return errorResponse('Account not found', 404);

      // Create order
      const { data: order, error: orderErr } = await serviceClient
        .from('corporate_orders')
        .insert({
          corporate_account_id,
          venue_id: account.venue_id,
          order_type: order_type || 'hours',
          total_hours: total_hours || 0,
          total_price: total_price || 0,
          notes: notes || null,
          recurring_config: recurring_config || null,
          created_by: userId,
        })
        .select()
        .single();

      if (orderErr) return errorResponse(orderErr.message);

      // If recurring, generate order items
      if (order_type === 'recurring' && recurring_config) {
        const { slots, weeks } = recurring_config;
        // slots = [{ day_of_week: 1, start_time: "17:00", end_time: "19:00" }, ...]
        // weeks = 12
        if (Array.isArray(slots) && weeks > 0) {
          const items: any[] = [];
          const today = new Date();

          for (let week = 0; week < weeks; week++) {
            for (const slot of slots) {
              // Calculate the date for this day_of_week in this week
              const daysUntil = ((slot.day_of_week - today.getDay()) + 7) % 7;
              const slotDate = new Date(today);
              slotDate.setDate(today.getDate() + daysUntil + (week * 7));
              
              items.push({
                order_id: order.id,
                day_of_week: slot.day_of_week,
                start_time: slot.start_time,
                end_time: slot.end_time,
                week_number: week + 1,
                scheduled_date: slotDate.toISOString().split('T')[0],
                status: 'pending',
              });
            }
          }

          if (items.length > 0) {
            await serviceClient.from('corporate_order_items').insert(items);
          }

          // Calculate total hours
          let totalHrs = 0;
          for (const slot of slots) {
            const startH = parseInt(slot.start_time.split(':')[0]);
            const endH = parseInt(slot.end_time.split(':')[0]);
            totalHrs += (endH - startH) * weeks;
          }

          await serviceClient.from('corporate_orders')
            .update({ total_hours: totalHrs })
            .eq('id', order.id);
        }
      }

      // Re-fetch order with items
      const { data: fullOrder } = await serviceClient
        .from('corporate_orders')
        .select('*, corporate_order_items(*)')
        .eq('id', order.id)
        .single();

      return jsonResponse(fullOrder, 201);
    }

    // PATCH /orders — update order status (venue admin: invoiced, paid, fulfilled)
    if (req.method === 'PATCH' && path === 'orders') {
      const body = await req.json();
      const { order_id, status, notes } = body;

      if (!order_id || !status) return errorResponse('Missing order_id or status');

      const serviceClient = getServiceClient();

      // Get order to check permissions
      const { data: order } = await serviceClient
        .from('corporate_orders')
        .select('id, venue_id, corporate_account_id, status, total_hours, order_type, recurring_config')
        .eq('id', order_id)
        .single();

      if (!order) return errorResponse('Order not found', 404);

      // Allow both venue admins and corporate admins for cancellation
      const { data: venueStaff } = await serviceClient
        .from('venue_staff')
        .select('role')
        .eq('venue_id', order.venue_id)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      const isVenueAdmin = venueStaff?.role === 'venue_admin';
      const { data: superCheck } = await serviceClient.rpc('is_super_admin');

      const { data: corpMembership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', order.corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      const isCorporateAdmin = corpMembership?.role === 'admin';

      if (!isVenueAdmin && !superCheck && !isCorporateAdmin) {
        return errorResponse('Forbidden', 403);
      }

      const updateData: any = { status };
      if (notes !== undefined) updateData.notes = notes;
      if (status === 'invoiced') updateData.invoiced_at = new Date().toISOString();
      if (status === 'paid') updateData.paid_at = new Date().toISOString();
      if (status === 'fulfilled') {
        updateData.fulfilled_at = new Date().toISOString();

        // When fulfilled: if hours order, add hours to package
        if (order.order_type === 'hours' && order.total_hours > 0) {
          // Find active package or create one
          const { data: existingPkg } = await serviceClient
            .from('corporate_packages')
            .select('id, total_hours')
            .eq('corporate_account_id', order.corporate_account_id)
            .eq('status', 'active')
            .maybeSingle();

          if (existingPkg) {
            await serviceClient.from('corporate_packages')
              .update({ total_hours: existingPkg.total_hours + order.total_hours })
              .eq('id', existingPkg.id);
          } else {
            await serviceClient.from('corporate_packages').insert({
              corporate_account_id: order.corporate_account_id,
              venue_id: order.venue_id,
              total_hours: order.total_hours,
              package_type: 'hours',
            });
          }
        }

        // When fulfilled: if recurring, create actual bookings
        if (order.order_type === 'recurring') {
          const { data: items } = await serviceClient
            .from('corporate_order_items')
            .select('*')
            .eq('order_id', order.id)
            .eq('status', 'pending');

          if (items && items.length > 0) {
            // Get a default court for this venue
            const { data: courts } = await serviceClient
              .from('venue_courts')
              .select('id')
              .eq('venue_id', order.venue_id)
              .eq('is_available', true)
              .limit(1);

            const courtId = courts?.[0]?.id;
            if (!courtId) return errorResponse('No available courts to create bookings');

            // Get or create guest user for these bookings
            const { data: account } = await serviceClient
              .from('corporate_accounts')
              .select('id, company_name')
              .eq('id', order.corporate_account_id)
              .single();

            for (const item of items) {
              const startISO = `${item.scheduled_date}T${item.start_time}:00.000Z`;
              const endISO = `${item.scheduled_date}T${item.end_time}:00.000Z`;

              // Check for conflicts
              const { data: conflicts } = await serviceClient.from('bookings')
                .select('id').eq('venue_court_id', courtId)
                .neq('status', 'cancelled')
                .lt('start_time', endISO).gt('end_time', startISO);

              if (conflicts && conflicts.length > 0) {
                // Mark as conflict instead
                await serviceClient.from('corporate_order_items')
                  .update({ status: 'conflict' })
                  .eq('id', item.id);
                continue;
              }

              const { data: booking } = await serviceClient.from('bookings').insert({
                venue_id: order.venue_id,
                venue_court_id: courtId,
                user_id: userId,
                booked_by: userId,
                start_time: startISO,
                end_time: endISO,
                total_price: 0,
                status: 'confirmed',
                notes: `${account?.company_name || 'Företag'} | Serie`,
              }).select('id').single();

              if (booking) {
                await serviceClient.from('corporate_order_items')
                  .update({ booking_id: booking.id, status: 'confirmed' })
                  .eq('id', item.id);
              }
            }
          }
        }
      }

      const { error: updateErr } = await serviceClient
        .from('corporate_orders')
        .update(updateData)
        .eq('id', order_id);

      if (updateErr) return errorResponse(updateErr.message);

      return jsonResponse({ updated: true, status });
    }

    // PATCH /members — update member limits
    if (req.method === 'PATCH' && path === 'members') {
      const body = await req.json();
      const { member_id, monthly_hour_limit, monthly_cost_limit } = body;

      if (!member_id) return errorResponse('Missing member_id');

      const serviceClient = getServiceClient();

      // Get member to find corporate account
      const { data: member } = await serviceClient
        .from('corporate_members')
        .select('corporate_account_id')
        .eq('id', member_id)
        .single();

      if (!member) return errorResponse('Member not found', 404);

      // Verify caller is corp admin
      const { data: callerMembership } = await serviceClient
        .from('corporate_members')
        .select('role')
        .eq('corporate_account_id', member.corporate_account_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!callerMembership || callerMembership.role !== 'admin') return errorResponse('Forbidden', 403);

      const updateData: any = {};
      if (monthly_hour_limit !== undefined) updateData.monthly_hour_limit = monthly_hour_limit;
      if (monthly_cost_limit !== undefined) updateData.monthly_cost_limit = monthly_cost_limit;

      const { error: updateErr } = await serviceClient
        .from('corporate_members')
        .update(updateData)
        .eq('id', member_id);

      if (updateErr) return errorResponse(updateErr.message);

      return jsonResponse({ updated: true });
    }

    // GET /venues — list venues for registration
    if (req.method === 'GET' && path === 'venues') {
      const serviceClient = getServiceClient();
      const { data: venues } = await serviceClient
        .from('venues')
        .select('id, name, slug, city, logo_url')
        .eq('is_public', true)
        .eq('status', 'active')
        .order('name');

      return jsonResponse(venues || []);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
