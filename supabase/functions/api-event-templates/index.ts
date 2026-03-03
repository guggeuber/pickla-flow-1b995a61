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

    // GET /api-event-templates/list — all active templates
    if (req.method === 'GET' && path === 'list') {
      const { data, error: qErr } = await client.from('event_templates')
        .select('*')
        .order('name');
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 15);
    }

    // GET /api-event-templates/detail?id=X
    if (req.method === 'GET' && path === 'detail') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');
      const { data, error: qErr } = await client.from('event_templates')
        .select('*').eq('id', id).single();
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data, 200, 10);
    }

    // POST /api-event-templates/create (super_admin only via RLS)
    if (req.method === 'POST' && path === 'create') {
      const body = await req.json();
      const { name, displayName, eventType, format, category, entryFee, currency, vatRate,
        logoUrl, backgroundUrl, primaryColor, secondaryColor,
        scoringType, scoringFormat, pointsToWin, bestOf, winByTwo,
        matchDurationDefault, competitionType, isDropIn, isPublic,
        registrationFields, whatsappUrl, description } = body;

      if (!name || !eventType || !format) return errorResponse('Missing name, eventType or format');

      const { data, error: insErr } = await client.from('event_templates').insert({
        name,
        display_name: displayName || null,
        description: description || null,
        event_type: eventType,
        format,
        category: category || 'tournament',
        entry_fee: entryFee ?? 0,
        currency: currency || 'SEK',
        vat_rate: vatRate ?? 6,
        logo_url: logoUrl || null,
        background_url: backgroundUrl || null,
        primary_color: primaryColor || null,
        secondary_color: secondaryColor || null,
        scoring_type: scoringType || null,
        scoring_format: scoringFormat || null,
        points_to_win: pointsToWin || null,
        best_of: bestOf || null,
        win_by_two: winByTwo || false,
        match_duration_default: matchDurationDefault || null,
        competition_type: competitionType || null,
        is_drop_in: isDropIn || false,
        is_public: isPublic !== false,
        registration_fields: registrationFields || ['name', 'phone'],
        whatsapp_url: whatsappUrl || null,
      }).select().single();

      if (insErr) return errorResponse(insErr.message);
      return jsonResponse(data, 201);
    }

    // PATCH /api-event-templates/update (super_admin only via RLS)
    if (req.method === 'PATCH' && path === 'update') {
      const body = await req.json();
      const { id, ...updates } = body;
      if (!id) return errorResponse('Missing id');

      const fieldMap: Record<string, string> = {
        name: 'name', displayName: 'display_name', description: 'description',
        eventType: 'event_type', format: 'format', category: 'category',
        entryFee: 'entry_fee', currency: 'currency', vatRate: 'vat_rate',
        logoUrl: 'logo_url', backgroundUrl: 'background_url',
        primaryColor: 'primary_color', secondaryColor: 'secondary_color',
        scoringType: 'scoring_type', scoringFormat: 'scoring_format',
        pointsToWin: 'points_to_win', bestOf: 'best_of', winByTwo: 'win_by_two',
        matchDurationDefault: 'match_duration_default', competitionType: 'competition_type',
        isDropIn: 'is_drop_in', isPublic: 'is_public',
        registrationFields: 'registration_fields', whatsappUrl: 'whatsapp_url',
        isActive: 'is_active',
      };

      const dbUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        const dbKey = fieldMap[key];
        if (dbKey) dbUpdates[dbKey] = val;
      }
      if (Object.keys(dbUpdates).length === 0) return errorResponse('No valid fields');

      const { data, error: upErr } = await client.from('event_templates')
        .update(dbUpdates).eq('id', id).select().single();
      if (upErr) return errorResponse(upErr.message);
      return jsonResponse(data);
    }

    // DELETE /api-event-templates/delete?id=X
    if (req.method === 'DELETE' && path === 'delete') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse('Missing id');
      const { error: delErr } = await client.from('event_templates').delete().eq('id', id);
      if (delErr) return errorResponse(delErr.message);
      return jsonResponse({ success: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
