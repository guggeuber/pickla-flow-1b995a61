import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    const client = getServiceClient();

    // GET /api-event-public/detail?id=X — public event info
    if (req.method === 'GET' && path === 'detail') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { data, error: qErr } = await client.from('events')
        .select('id, name, display_name, event_type, format, start_date, end_date, status, logo_url, background_url, primary_color, secondary_color, number_of_courts, points_to_win, best_of, scoring_type, competition_type, player_info_general, venue_id, venues(id, name, address, city)')
        .eq('id', id)
        .eq('is_public', true)
        .single();

      if (qErr) return errorResponse('Event not found', 404);

      // Get player count
      const { count } = await client.from('players')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', id);

      return jsonResponse({ ...data, player_count: count || 0 }, 200, 5);
    }

    // POST /api-event-public/register — register a player for an event
    if (req.method === 'POST' && path === 'register') {
      const body = await req.json();
      const { eventId, name, email } = body;

      if (!eventId || !name) return errorResponse('Missing eventId or name');
      if (name.length > 100) return errorResponse('Name too long');
      if (email && email.length > 255) return errorResponse('Email too long');

      // Check event exists and is public
      const { data: event, error: evErr } = await client.from('events')
        .select('id, status')
        .eq('id', eventId)
        .eq('is_public', true)
        .single();

      if (evErr || !event) return errorResponse('Event not found', 404);
      if (event.status === 'completed') return errorResponse('Event is completed');

      // Check duplicate by email if provided
      if (email) {
        const { data: existing } = await client.from('players')
          .select('id')
          .eq('event_id', eventId)
          .eq('email', email)
          .maybeSingle();

        if (existing) return errorResponse('Already registered with this email');
      }

      const { data: player, error: insErr } = await client.from('players')
        .insert({
          event_id: eventId,
          name: name.trim(),
          email: email?.trim() || null,
        })
        .select()
        .single();

      if (insErr) return errorResponse(insErr.message);

      return jsonResponse({ success: true, player }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
