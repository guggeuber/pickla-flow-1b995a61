import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // PUBLIC: POST /api-day-passes/public-purchase
    // Allows anonymous day pass purchase (like public booking)
    if (req.method === 'POST' && path === 'public-purchase') {
      const body = await req.json();
      const { name, phone, price } = body;
      if (!name || !phone) return errorResponse('Missing name or phone');

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminClient = createClient(supabaseUrl, serviceKey);

      // Get first venue (single-venue setup)
      const { data: venue } = await adminClient.from('venues').select('id').limit(1).single();
      if (!venue) return errorResponse('No venue found');

      const today = new Date().toISOString().slice(0, 10);

      // Generate a simple ref
      const ref = 'DP-' + Math.random().toString(36).substring(2, 8).toUpperCase();

      // Use a placeholder user_id for anonymous purchases
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

    // Authenticated routes below
    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    // GET /api-day-passes/venue?venueId=X&date=YYYY-MM-DD
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

    // POST /api-day-passes/create
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

    // PATCH /api-day-passes/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, status } = body;
      if (!id || !status) return errorResponse('Missing id or status');

      const { data, error: upErr } = await client.from('day_passes')
        .update({ status }).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
