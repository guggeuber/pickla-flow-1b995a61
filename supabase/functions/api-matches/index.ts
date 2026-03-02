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

    // GET /api-matches/event?eventId=X
    if (req.method === 'GET' && path === 'event') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const { data, error: qErr } = await client.from('matches')
        .select(`*, team1:teams!matches_team1_id_fkey(id, name, color), team2:teams!matches_team2_id_fkey(id, name, color), court:courts!matches_court_id_fkey(id, name, court_number)`)
        .eq('event_id', eventId)
        .order('round').order('match_number');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 5);
    }

    // GET /api-matches/courts?eventId=X
    if (req.method === 'GET' && path === 'courts') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const { data, error: qErr } = await client.from('courts')
        .select('*').eq('event_id', eventId).order('court_number');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // POST /api-matches/update-score
    if (req.method === 'POST' && path === 'update-score') {
      const body = await req.json();
      const { matchId, team1Score, team2Score, status } = body;
      if (!matchId) return errorResponse('Missing matchId');

      const updates: Record<string, any> = {
        team1_score: team1Score,
        team2_score: team2Score,
        status,
      };
      if (status === 'in_progress') updates.started_at = new Date().toISOString();

      const { data, error: upErr } = await client.from('matches')
        .update(updates).eq('id', matchId).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    // POST /api-matches/assign-court
    if (req.method === 'POST' && path === 'assign-court') {
      const body = await req.json();
      const { matchId, courtId } = body;
      if (!matchId || !courtId) return errorResponse('Missing matchId or courtId');

      const { data, error: upErr } = await client.from('matches')
        .update({ court_id: courtId, status: 'in_progress' as const, started_at: new Date().toISOString() })
        .eq('id', matchId).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
