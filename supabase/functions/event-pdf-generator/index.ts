import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { assertVenueAdmin, buildOfferPdfBytes } from '../_shared/event_agents.ts';
import {
  assertCanonicalEventOfferObjectPath,
  canonicalEventOfferObjectPath,
  EVENT_OFFER_SIGNED_URL_TTL_SECONDS,
} from '../_shared/event_offer_storage.ts';

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

      let pdfPath: string | null = null;
      try {
        const payload = offer.offer_payload || {};
        const pdfBytes = await buildOfferPdfBytes(payload);
        pdfPath = await canonicalEventOfferObjectPath(admin, offer);
        const { error: uploadErr } = await admin.storage.from('event-offers').upload(pdfPath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });
        if (uploadErr) throw uploadErr;

        const { error: updateErr } = await admin.from('event_offers')
          .update({ pdf_url: pdfPath, status: 'pdf_ready' })
          .eq('id', offer.id);
        if (updateErr) throw updateErr;
      } catch (pdfError) {
        const message = pdfError instanceof Error ? pdfError.message : 'PDF generation failed';
        await admin.from('event_lead_activities').insert({
          event_lead_id: offer.event_lead_id,
          event_offer_id: offer.id,
          venue_id: offer.venue_id,
          activity_type: 'pdf_generation_failed',
          title: 'PDF generation failed',
          body: 'Offert-PDF kunde inte skapas vid manuell retry.',
          metadata: { pdf_path: pdfPath, error: message },
        });
        return errorResponse(message, 500);
      }

      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(pdfPath, EVENT_OFFER_SIGNED_URL_TTL_SECONDS);
      return jsonResponse({ ok: true, pdf_url: pdfPath, signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'signed-url') {
      const url = new URL(req.url);
      const offerId = url.searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('id, venue_id, event_lead_id, pdf_url').eq('id', offerId).maybeSingle();
      if (!offer?.pdf_url) return errorResponse('Offer has no PDF', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const canonicalPath = await assertCanonicalEventOfferObjectPath(admin, offer);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(canonicalPath, EVENT_OFFER_SIGNED_URL_TTL_SECONDS);
      return jsonResponse({ signed_url: signed?.signedUrl || null });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Server error', 500);
  }
});
