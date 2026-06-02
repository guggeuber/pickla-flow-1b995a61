import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { assertVenueAdmin, buildFollowups } from '../_shared/event_agents.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);

    if (req.method === 'POST' && path === 'schedule') {
      const { leadId, offerId } = await req.json();
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const rows = buildFollowups(lead, offerId || null);
      const { data, error: insertErr } = await admin.from('event_followups').insert(rows).select('*');
      if (insertErr) return errorResponse(insertErr.message);
      return jsonResponse({ followups: data || [] });
    }

    if (req.method === 'GET' && path === 'list') {
      const url = new URL(req.url);
      const leadId = url.searchParams.get('leadId');
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('id, venue_id').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const { data, error: qErr } = await admin.from('event_followups').select('*').eq('event_lead_id', leadId).order('scheduled_at');
      if (qErr) return errorResponse(qErr.message);
      return jsonResponse(data || []);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
