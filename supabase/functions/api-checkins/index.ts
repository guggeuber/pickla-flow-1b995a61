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

    // GET /api-checkins/event?eventId=X&date=YYYY-MM-DD
    if (req.method === 'GET' && path === 'event') {
      const eventId = url.searchParams.get('eventId');
      const date = url.searchParams.get('date');
      if (!eventId || !date) return errorResponse('Missing eventId or date');

      const { data, error: qErr } = await client.from('event_checkins')
        .select('*').eq('event_id', eventId).eq('session_date', date);
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 5);
    }

    // GET /api-checkins/players?eventId=X
    if (req.method === 'GET' && path === 'players') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const { data, error: qErr } = await client.from('players')
        .select('*, team:teams(id, name, color)')
        .eq('event_id', eventId).order('name');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 15);
    }

    // POST /api-checkins/toggle
    if (req.method === 'POST' && path === 'toggle') {
      const body = await req.json();
      const { eventId, playerId, sessionDate, checkedIn } = body;
      if (!eventId || !playerId || !sessionDate) return errorResponse('Missing fields');

      if (checkedIn) {
        const { error: upErr } = await client.from('event_checkins').upsert(
          { event_id: eventId, player_id: playerId, session_date: sessionDate, checked_in: true, checked_in_at: new Date().toISOString() },
          { onConflict: 'event_id,player_id,session_date' }
        );
        if (upErr) return errorResponse(upErr.message);
      } else {
        const { error: upErr } = await client.from('event_checkins')
          .update({ checked_in: false, checked_in_at: null })
          .eq('event_id', eventId).eq('player_id', playerId).eq('session_date', sessionDate);
        if (upErr) return errorResponse(upErr.message);
      }

      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
