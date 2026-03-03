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

    // GET /api-events/list?venueId=X&status=active,upcoming
    if (req.method === 'GET' && path === 'list') {
      const venueId = url.searchParams.get('venueId');
      const statuses = url.searchParams.get('status')?.split(',') || ['active', 'in_progress', 'upcoming'];

      let query = client.from('events')
        .select('*')
        .in('status', statuses)
        .order('start_date', { ascending: false });

      if (venueId) query = query.eq('venue_id', venueId);

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // GET /api-events/detail?id=X
    if (req.method === 'GET' && path === 'detail') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { data, error: qErr } = await client.from('events')
        .select('*, venues(id, name, slug)')
        .eq('id', id)
        .single();
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // GET /api-events/teams?eventId=X
    if (req.method === 'GET' && path === 'teams') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const { data, error: qErr } = await client.from('teams')
        .select('*')
        .eq('event_id', eventId)
        .order('name');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 15);
    }

    // GET /api-events/standings?eventId=X
    if (req.method === 'GET' && path === 'standings') {
      const eventId = url.searchParams.get('eventId');
      if (!eventId) return errorResponse('Missing eventId');

      const { data, error: qErr } = await client.from('standings')
        .select('*, team:teams(id, name, color)')
        .eq('event_id', eventId)
        .order('rank');
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 5);
    }

    // POST /api-events/create
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { name, eventType, format, venueId, startDate, endDate, numberOfCourts, pointsToWin, bestOf, winByTwo, matchDurationDefault, isPublic, scoringType, scoringFormat, competitionType, templateId } = body;

      if (!name || !eventType || !format) return errorResponse('Missing name, eventType, or format');

      // If templateId provided, fetch template and inherit locked fields
      let templateFields: Record<string, any> = {};
      if (templateId) {
        const { data: tpl, error: tplErr } = await client.from('event_templates')
          .select('*').eq('id', templateId).single();
        if (tplErr || !tpl) return errorResponse('Template not found', 404);

        templateFields = {
          template_id: tpl.id,
          logo_url: tpl.logo_url,
          background_url: tpl.background_url,
          primary_color: tpl.primary_color,
          secondary_color: tpl.secondary_color,
          scoring_type: tpl.scoring_type,
          scoring_format: tpl.scoring_format,
          points_to_win: tpl.points_to_win,
          best_of: tpl.best_of,
          win_by_two: tpl.win_by_two || false,
          match_duration_default: tpl.match_duration_default,
          competition_type: tpl.competition_type,
          is_drop_in: tpl.is_drop_in || false,
          is_public: tpl.is_public !== false,
          registration_fields: tpl.registration_fields,
          whatsapp_url: tpl.whatsapp_url,
          category: tpl.category,
          description: tpl.description,
          display_name: tpl.display_name,
        };
      }

      const { data, error: insertErr } = await client.from('events').insert({
        name,
        event_type: eventType,
        format,
        venue_id: venueId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        number_of_courts: numberOfCourts || 1,
        points_to_win: pointsToWin || null,
        best_of: bestOf || null,
        win_by_two: winByTwo || false,
        match_duration_default: matchDurationDefault || null,
        is_public: isPublic !== false,
        scoring_type: scoringType || null,
        scoring_format: scoringFormat || null,
        competition_type: competitionType || null,
        status: 'upcoming',
        // Template fields override defaults but manual fields take precedence
        ...templateFields,
        // Always use the user-provided name
        name,
        event_type: eventType,
        format,
        venue_id: venueId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        number_of_courts: numberOfCourts || 1,
      }).select().single();

      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse(data, 201);
    }

    // PATCH /api-events/update
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, ...updates } = body;
      if (!id) return errorResponse('Missing id');

      // Map camelCase to snake_case for allowed fields
      const fieldMap: Record<string, string> = {
        name: 'name', displayName: 'display_name', eventType: 'event_type', format: 'format',
        venueId: 'venue_id', startDate: 'start_date', endDate: 'end_date',
        numberOfCourts: 'number_of_courts', pointsToWin: 'points_to_win', bestOf: 'best_of',
        winByTwo: 'win_by_two', matchDurationDefault: 'match_duration_default',
        isPublic: 'is_public', status: 'status', scoringType: 'scoring_type',
        scoringFormat: 'scoring_format', competitionType: 'competition_type',
        logoUrl: 'logo_url', backgroundUrl: 'background_url',
        primaryColor: 'primary_color', secondaryColor: 'secondary_color',
        playerInfoGeneral: 'player_info_general',
        thirdPlaceEnabled: 'third_place_enabled',
        showOnSticker: 'show_on_sticker',
        description: 'description', category: 'category',
        isDropIn: 'is_drop_in', registrationFields: 'registration_fields',
        whatsappUrl: 'whatsapp_url', slug: 'slug',
      };

      const dbUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        const dbKey = fieldMap[key];
        if (dbKey) dbUpdates[dbKey] = val;
      }

      if (Object.keys(dbUpdates).length === 0) return errorResponse('No valid fields to update');

      const { data, error: upErr } = await client.from('events')
        .update(dbUpdates).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);

      return jsonResponse(data);
    }

    // DELETE /api-events/delete?id=X
    if (req.method === 'DELETE' && path === 'delete') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');

      const { error: delErr } = await client.from('events').delete().eq('id', id);
      if (delErr) return errorResponse(delErr.message);

      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
