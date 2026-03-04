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

    // POST /api-customers/create — Create a new customer (player_profile) by staff
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { display_name, phone, email, venue_id } = body;
      if (!display_name) return errorResponse('display_name is required');

      // Use service role to create profile without requiring auth signup
      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      // If email provided, create an auth user first, then a profile is auto-created via trigger
      if (email) {
        // Generate a random password — the user can reset later
        const tempPassword = crypto.randomUUID();
        const { data: authUser, error: authErr } = await serviceClient.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { display_name },
        });
        if (authErr) return errorResponse(authErr.message);

        // Update the auto-created profile with phone
        if (phone && authUser.user) {
          await serviceClient.from('player_profiles')
            .update({ phone, display_name })
            .eq('auth_user_id', authUser.user.id);
        }

        return jsonResponse({ id: authUser.user?.id, display_name, phone, email });
      }

      // No email — create a "guest" profile (no auth user)
      // We create a profile with a placeholder auth_user_id (the staff user's id is NOT the customer)
      // Instead, generate a UUID for tracking
      const guestId = crypto.randomUUID();
      const { data: profile, error: profErr } = await serviceClient.from('player_profiles')
        .insert({
          auth_user_id: guestId,
          display_name,
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