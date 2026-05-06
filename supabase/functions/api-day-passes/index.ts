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

      const { data: share, error: shareErr } = await adminClient
        .from('day_pass_shares')
        .select('*, day_passes(*)')
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (shareErr || !share) return errorResponse('Pass not found or already claimed', 404);

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

      await adminClient.from('day_pass_shares')
        .update({ status: 'claimed', claimed_by: claimUserId, claimed_at: new Date().toISOString() })
        .eq('id', share.id);

      await adminClient.from('day_passes')
        .update({ user_id: claimUserId, status: 'active' })
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
        .select('id, status, token, shared_by, recipient_name, day_passes(valid_date, venue_id)')
        .eq('token', token)
        .single();

      if (!share) return errorResponse('Not found', 404);

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

      // Check membership grant info
      let allowance = { has_membership: false, passes_allowed: 0, passes_remaining: 0 };

      const { data: membership } = await adminClient
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (membership) {
        const { data: tierPricing } = await adminClient
          .from('membership_tier_pricing')
          .select('fixed_price')
          .eq('tier_id', membership.tier_id)
          .eq('product_type', 'monthly_passes')
          .single();

        const passesAllowed = tierPricing?.fixed_price ? Math.round(tierPricing.fixed_price) : 0;

        if (passesAllowed > 0) {
          const now = new Date();
          const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

          let { data: grant } = await adminClient
            .from('day_pass_grants')
            .select('*')
            .eq('membership_id', membership.id)
            .eq('month_year', monthYear)
            .single();

          if (!grant) {
            // Create grant AND auto-create free passes
            const { data: newGrant } = await adminClient.from('day_pass_grants').insert({
              membership_id: membership.id,
              venue_id: membership.venue_id,
              month_year: monthYear,
              passes_allowed: passesAllowed,
              passes_used: 0,
            }).select().single();
            grant = newGrant;

            // Auto-create day passes for this month
            const today = now.toISOString().slice(0, 10);
            const passInserts = [];
            for (let i = 0; i < passesAllowed; i++) {
              passInserts.push({
                venue_id: membership.venue_id,
                user_id: userId,
                valid_date: today,
                purchase_date: today,
                price: 0,
                status: 'active',
              });
            }
            await adminClient.from('day_passes').insert(passInserts);
          }

          allowance = {
            has_membership: true,
            passes_allowed: passesAllowed,
            passes_remaining: (grant?.passes_allowed || passesAllowed) - (grant?.passes_used || 0),
          };
        }
      }

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

      return jsonResponse({ passes: finalEnriched, allowance, shares: shares || [] });
    }

    // ─── GET /my-allowance (kept for backwards compat) ───
    if (req.method === 'GET' && path === 'my-allowance') {
      const { data: membership } = await adminClient
        .from('memberships')
        .select('id, tier_id, venue_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (!membership) return jsonResponse({ has_membership: false, passes_allowed: 0, passes_used: 0, passes_remaining: 0 });

      const { data: tierPricing } = await adminClient
        .from('membership_tier_pricing')
        .select('fixed_price')
        .eq('tier_id', membership.tier_id)
        .eq('product_type', 'monthly_passes')
        .single();

      const passesAllowed = tierPricing?.fixed_price ? Math.round(tierPricing.fixed_price) : 0;
      if (passesAllowed === 0) return jsonResponse({ has_membership: true, passes_allowed: 0, passes_used: 0, passes_remaining: 0 });

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

      const { data: shares } = await adminClient
        .from('day_pass_shares')
        .select('id, token, status, recipient_email, recipient_name, recipient_phone, claimed_by, created_at')
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

    // ─── POST /buy ── self-purchase a day pass ───
    if (req.method === 'POST' && path === 'buy') {
      return errorResponse('Day passes must be purchased through Stripe checkout', 410);
    }

    // ─── POST /share ── share an existing pass ───
    if (req.method === 'POST' && path === 'share') {
      const body = await req.json();
      const { day_pass_id, recipient_email, recipient_name } = body;
      if (!day_pass_id) return errorResponse('Missing day_pass_id');
      const recipientName = String(recipient_name || recipient_email || '').trim();
      if (!recipientName) return errorResponse('Missing recipient_name');

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
