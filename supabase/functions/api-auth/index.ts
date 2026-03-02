import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    // GET /api-auth/me — current user profile + roles
    if (req.method === 'GET' && path === 'me') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const [profileRes, rolesRes, staffRes] = await Promise.all([
        client.from('player_profiles').select('*').eq('auth_user_id', userId).maybeSingle(),
        client.from('user_roles').select('role').eq('user_id', userId),
        client.from('venue_staff').select('venue_id, role, is_active, venues(id, name, slug, primary_color, logo_url)').eq('user_id', userId).eq('is_active', true),
      ]);

      return jsonResponse({
        userId,
        profile: profileRes.data,
        roles: (rolesRes.data || []).map((r: any) => r.role),
        venues: staffRes.data || [],
      }, 200, 10); // cache 10s
    }

    // POST /api-auth/assign-role (super_admin only)
    if (req.method === 'POST' && path === 'assign-role') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const body = await req.json();
      const { targetUserId, role } = body;
      if (!targetUserId || !role) return errorResponse('Missing targetUserId or role');

      // Check if caller is super_admin
      const { data: isSA } = await client.rpc('has_role', { _user_id: userId, _role: 'super_admin' });
      if (!isSA) return errorResponse('Forbidden', 403);

      const serviceClient = getServiceClient();
      const { error: insertErr } = await serviceClient.from('user_roles').upsert(
        { user_id: targetUserId, role },
        { onConflict: 'user_id,role' }
      );
      if (insertErr) return errorResponse(insertErr.message);

      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
