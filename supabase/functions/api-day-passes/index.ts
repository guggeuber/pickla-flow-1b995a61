import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const path = pathParts.pop() || '';
  // For claim/:token pattern
  const parentPath = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';

  try {
    // ─── PUBLIC: POST /public-purchase ───
    if (req.method === 'POST' && path === 'public-purchase') {
      const body = await req.json();
      const { name, phone, price } = body;
      if (!name || !phone) return errorResponse('Missing name or phone');

      const adminClient = getServiceClient();
      const { data: venue } = await adminClient.from('venues').select('id').limit(1).single();
      if (!venue) return errorResponse('No venue found');

      const today = new Date().toISOString().slice(0, 10);
      const ref = 'DP-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';

      const { data, error: insertErr } = await adminClient.from('day_passes').insert({
        venue_id: venue.id,
        user_id: body.user_id || ANON_USER_ID,
        valid_date: today,
        purchase_date: today,
        price: price || 165,
        status: 'active',
      }).select('id').single();

      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse({ id: data.id, ref, name, phone, price: price || 165 }, 201);
    }

    // ─── PUBLIC: POST /claim (claim a shared pass by token) ───
    if (req.method === 'POST' && path === 'claim') {
      const body = await req.json();
      const { token } = body;
      if (!token) return errorResponse('Missing token');

      const adminClient = getServiceClient();

      // Find the share
      const { data: share, error: shareErr } = await adminClient
        .from('day_pass_shares')
        .select('*, day_passes(*)')
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (shareErr || !share) return errorResponse('Pass not found or already claimed', 404);

      // Get authenticated user if available
      const authHeader = req.headers.get('Authorization');
      let claimUserId: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const tkn = authHeader.replace('Bearer ', '');
        const { data: claimsData } = await userClient.auth.getClaims(tkn);
        if (claimsData?.claims) {
          claimUserId = claimsData.claims.sub as string;
        }
      }

      if (!claimUserId) return errorResponse('Must be logged in to claim', 401);

      // Update share status
      await adminClient.from('day_pass_shares')
        .update({ status: 'claimed', claimed_by: claimUserId, claimed_at: new Date().toISOString() })
        .eq('id', share.id);

      // Update day_pass user_id to claimed user
      await adminClient.from('day_passes')
        .update({ user_id: claimUserId })
        .eq('id', share.day_pass_id);

      return jsonResponse({ success: true, dayPassId: share.day_pass_id });
    }

    // ─── PUBLIC: GET /share-info?token=X ───
    if (req.method === 'GET' && path === 'share-info') {
      const token = url.searchParams.get('token');
      if (!token) return errorResponse('Missing token');

      const adminClient = getServiceClient();
      const { data: share } = await adminClient
        .from('day_pass_shares')
        .select('id, status, token, shared_by, day_passes(valid_date, venue_id)')
        .eq('token', token)
        .single();

      if (!share) return errorResponse('Not found', 404);

      // Get sharer name
      const { data: sharerProfile } = await adminClient
        .from('player_profiles')
        .select('display_name')
        .eq('auth_user_id', share.shared_by)
        .single();

      return jsonResponse({
        ...share,
        sharer_name: sharerProfile?.display_name || 'En vän',
      });
    }

    // ─── Authenticated routes below ───
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    const adminClient = getServiceClient();

    // ─── GET /my-allowance ───
    if (req.method === 'GET' && path === 'my-allowance') {
      // Find active membership
      const { data: membership } = await adminClient
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (!membership) return jsonResponse({ has_membership: false, passes_allowed: 0, passes_used: 0, passes_remaining: 0 });

      // Check tier pricing for monthly_passes
      const { data: tierPricing } = await adminClient
        .from('membership_tier_pricing')
        .select('fixed_price')
        .eq('tier_id', membership.tier_id)
        .eq('product_type', 'monthly_passes')
        .single();

      const passesAllowed = tierPricing?.fixed_price ? Math.round(tierPricing.fixed_price) : 0;
      if (passesAllowed === 0) return jsonResponse({ has_membership: true, passes_allowed: 0, passes_used: 0, passes_remaining: 0 });

      // Get or create grant for current month
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      let { data: grant } = await adminClient
        .from('day_pass_grants')
        .select('*')
        .eq('membership_id', membership.id)
        .eq('month_year', monthYear)
        .single();

      if (!grant) {
        const { data: newGrant } = await adminClient.from('day_pass_grants').insert({
          membership_id: membership.id,
          venue_id: membership.venue_id,
          month_year: monthYear,
          passes_allowed: passesAllowed,
          passes_used: 0,
        }).select().single();
        grant = newGrant;
      }

      // Get shares for this month
      const { data: shares } = await adminClient
        .from('day_pass_shares')
        .select('id, token, status, recipient_email, recipient_phone, claimed_by, created_at')
        .eq('shared_by', userId)
        .gte('created_at', monthYear)
        .order('created_at', { ascending: false });

      return jsonResponse({
        has_membership: true,
        passes_allowed: grant?.passes_allowed || passesAllowed,
        passes_used: grant?.passes_used || 0,
        passes_remaining: (grant?.passes_allowed || passesAllowed) - (grant?.passes_used || 0),
        grant_id: grant?.id,
        shares: shares || [],
      });
    }

    // ─── POST /share ───
    if (req.method === 'POST' && path === 'share') {
      const body = await req.json();
      const { recipient_email, recipient_phone } = body;
      if (!recipient_email && !recipient_phone) return errorResponse('Missing recipient info');

      // Get membership
      const { data: membership } = await adminClient
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (!membership) return errorResponse('No active membership');

      // Check allowance
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const { data: grant } = await adminClient
        .from('day_pass_grants')
        .select('*')
        .eq('membership_id', membership.id)
        .eq('month_year', monthYear)
        .single();

      if (!grant) return errorResponse('No grant for this month');
      if (grant.passes_used >= grant.passes_allowed) return errorResponse('No passes remaining this month');

      const today = now.toISOString().slice(0, 10);
      const token = Math.random().toString(36).substring(2, 10).toUpperCase();

      // Create day_pass owned by sharer initially; reassigned on claim
      const { data: dayPass, error: dpErr } = await adminClient.from('day_passes').insert({
        venue_id: membership.venue_id,
        user_id: userId,
        valid_date: today,
        purchase_date: today,
        price: 0,
        status: 'active',
      }).select('id').single();

      if (dpErr) return errorResponse(dpErr.message);

      // Create share record
      const { data: share, error: shareErr } = await adminClient.from('day_pass_shares').insert({
        day_pass_id: dayPass.id,
        shared_by: userId,
        recipient_email: recipient_email || null,
        recipient_phone: recipient_phone || null,
        token,
        status: 'pending',
      }).select().single();

      if (shareErr) return errorResponse(shareErr.message);

      // Update shared_from on day_pass
      await adminClient.from('day_passes')
        .update({ shared_from: share.id })
        .eq('id', dayPass.id);

      // Increment passes_used
      await adminClient.from('day_pass_grants')
        .update({ passes_used: grant.passes_used + 1 })
        .eq('id', grant.id);

      return jsonResponse({ token, share_id: share.id, day_pass_id: dayPass.id }, 201);
    }

    // ─── DELETE /revoke-share ───
    if (req.method === 'DELETE' && path === 'revoke-share') {
      const shareId = url.searchParams.get('id');
      if (!shareId) return errorResponse('Missing share id');

      // Verify ownership and status
      const { data: share, error: sErr } = await adminClient
        .from('day_pass_shares')
        .select('id, day_pass_id, shared_by, status')
        .eq('id', shareId)
        .single();

      if (sErr || !share) return errorResponse('Share not found', 404);
      if (share.shared_by !== userId) return errorResponse('Not your share', 403);
      if (share.status === 'claimed') return errorResponse('Already claimed, cannot revoke');

      // Delete share, delete the day_pass, decrement grant
      await adminClient.from('day_pass_shares').delete().eq('id', shareId);
      await adminClient.from('day_passes').delete().eq('id', share.day_pass_id);

      // Decrement passes_used on current month grant
      const now = new Date();
      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const { data: membership } = await adminClient
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (membership) {
        const { data: grant } = await adminClient
          .from('day_pass_grants')
          .select('id, passes_used')
          .eq('membership_id', membership.id)
          .eq('month_year', monthYear)
          .single();

        if (grant && grant.passes_used > 0) {
          await adminClient.from('day_pass_grants')
            .update({ passes_used: grant.passes_used - 1 })
            .eq('id', grant.id);
        }
      }

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

      const { data, error: insertErr } = await client.from('day_passes').insert({
        venue_id: venueId,
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
