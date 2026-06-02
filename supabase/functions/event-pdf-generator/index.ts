import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { assertVenueAdmin, buildOfferPdfBytes } from '../_shared/event_agents.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
    const admin = getServiceClient();

    if (req.method === 'POST' && path === 'generate') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');

      const { data: offer, error: offerErr } = await admin.from('event_offers')
        .select('*, event_leads(id, venue_id)')
        .eq('id', offerId)
        .maybeSingle();
      if (offerErr || !offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);

      const payload = offer.offer_payload || {};
      const pdfBytes = await buildOfferPdfBytes(payload);
      const path = `${offer.venue_id}/${offer.event_lead_id}/${offer.id}.pdf`;

      const { error: uploadErr } = await admin.storage.from('event-offers').upload(path, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadErr) return errorResponse(uploadErr.message, 500);

      await admin.from('event_offers').update({ pdf_url: path, status: 'pdf_ready' }).eq('id', offer.id);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(path, 60 * 60 * 24 * 7);
      return jsonResponse({ ok: true, pdf_url: path, signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'signed-url') {
      const url = new URL(req.url);
      const offerId = url.searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('id, venue_id, pdf_url').eq('id', offerId).maybeSingle();
      if (!offer?.pdf_url) return errorResponse('Offer has no PDF', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(offer.pdf_url, 60 * 60);
      return jsonResponse({ signed_url: signed?.signedUrl || null });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
