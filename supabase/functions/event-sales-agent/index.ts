import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { assertVenueAdmin, buildSalesDraft } from '../_shared/event_agents.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
    const admin = getServiceClient();

    if (req.method === 'POST' && path === 'draft') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);

      const sales = buildSalesDraft(offer.offer_payload || {});
      const { data, error: updateErr } = await admin.from('event_offers').update({
        email_subject: sales.subject,
        email_body: sales.emailBody,
        sms_text: sales.smsText,
        status: offer.status === 'draft' ? 'mail_draft_ready' : offer.status,
      }).eq('id', offer.id).select('*').single();
      if (updateErr) return errorResponse(updateErr.message);
      return jsonResponse({ offer: data, sales });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
