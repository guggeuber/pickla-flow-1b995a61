import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import {
  assertVenueAdmin,
  buildFollowups,
  buildOfferHtml,
  buildOfferPayload,
  buildOfferPdfBytes,
  buildSalesDraft,
} from '../_shared/event_agents.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const path = new URL(req.url).pathname.split('/').pop() || '';

  try {
    const { userId, error } = await getAuthenticatedClient(req);
    if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
    const admin = getServiceClient();

    if (req.method === 'POST' && path === 'generate-offer') {
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

    if (req.method === 'POST' && path === 'generate-pdf') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');

      const { data: offer, error: offerErr } = await admin.from('event_offers')
        .select('*, event_leads(id, venue_id)')
        .eq('id', offerId)
        .maybeSingle();
      if (offerErr || !offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);

      const pdfBytes = await buildOfferPdfBytes(offer.offer_payload || {});
      const pdfPath = `${offer.venue_id}/${offer.event_lead_id}/${offer.id}.pdf`;
      const { error: uploadErr } = await admin.storage.from('event-offers').upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadErr) return errorResponse(uploadErr.message, 500);

      await admin.from('event_offers').update({ pdf_url: pdfPath, status: 'pdf_ready' }).eq('id', offer.id);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
      return jsonResponse({ ok: true, pdf_url: pdfPath, signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'signed-url') {
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers').select('id, venue_id, pdf_url').eq('id', offerId).maybeSingle();
      if (!offer?.pdf_url) return errorResponse('Offer has no PDF', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(offer.pdf_url, 60 * 60);
      return jsonResponse({ signed_url: signed?.signedUrl || null });
    }

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
