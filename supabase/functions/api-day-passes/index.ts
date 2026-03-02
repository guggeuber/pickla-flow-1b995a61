import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
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
