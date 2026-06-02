import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import {
  assertVenueAdmin,
  buildFollowups,
  buildOfferHtml,
  buildOfferPayload,
  buildSalesDraft,
} from '../_shared/event_agents.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
    const admin = getServiceClient();

    if (req.method === 'POST' && path === 'generate') {
      const { leadId } = await req.json();
      if (!leadId) return errorResponse('Missing leadId');

      const { data: lead, error: leadErr } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (leadErr || !lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);

      const { data: venue } = await admin.from('venues').select('id, name, email, phone, address').eq('id', lead.venue_id).maybeSingle();
      const payload = buildOfferPayload(lead, venue);
      const html = buildOfferHtml(payload);
      const sales = buildSalesDraft(payload);

      const { data: offer, error: offerErr } = await admin.from('event_offers').insert({
        venue_id: lead.venue_id,
        event_id: lead.event_id ?? null,
        event_lead_id: lead.id,
        title: payload.title,
        package_type: payload.package.key,
        price_per_person: payload.price_per_person || 0,
        total_price: payload.total_price,
        html_snapshot: html,
        email_subject: sales.subject,
        email_body: sales.emailBody,
        sms_text: sales.smsText,
        offer_payload: payload,
        status: 'draft',
      }).select('*').single();
      if (offerErr) return errorResponse(offerErr.message, 500);

      await admin.from('event_leads').update({
        status: 'offer_generated',
        package_type: payload.package.key,
        estimated_value: payload.total_price,
      }).eq('id', lead.id);

      const followups = buildFollowups(lead, offer.id);
      await admin.from('event_followups').insert(followups);

      return jsonResponse({ offer, payload, html, sales });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
