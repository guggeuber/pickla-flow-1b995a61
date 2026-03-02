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

    // GET /api-customers/list?search=X&limit=50
    if (req.method === 'GET' && path === 'list') {
      const search = url.searchParams.get('search') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

      let query = client.from('player_profiles').select('*')
        .order('pickla_rating', { ascending: false }).limit(limit);

      if (search) {
        query = query.or(`display_name.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
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

    // PATCH /api-customers/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, display_name, phone, bio } = body;
      if (!id) return errorResponse('Missing id');

      const updates: Record<string, any> = {};
      if (display_name !== undefined) updates.display_name = display_name;
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

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
