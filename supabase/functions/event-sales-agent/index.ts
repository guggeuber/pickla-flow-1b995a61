import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import {
  assertVenueAdmin,
  buildFollowups,
  buildFollowupsFromSentAt,
  buildOfferHtml,
  buildOfferPayload,
  buildOfferPdfBytes,
  buildSalesDraft,
  emailHtmlFromText,
  leadActivity,
} from '../_shared/event_agents.ts';

const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pickla <hello@playpickla.com>';
const RESEND_REPLY_DOMAIN = Deno.env.get('RESEND_INBOUND_DOMAIN') || 'reply.playpickla.com';

function eventReplyAddress(eventId: string) {
  return `event-${eventId}@${RESEND_REPLY_DOMAIN}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendResendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string }>;
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('Missing RESEND_API_KEY');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Resend email failed');
  return data;
}

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
      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'offer_generated',
          title: 'Offer generated',
          body: `${payload.package.title} skapades med totalpris ${Number(payload.total_price).toLocaleString('sv-SE')} kr.`,
          actorUserId: userId,
          metadata: { package_type: payload.package.key, total_price: payload.total_price },
        }),
        ...followups.map((row: any) => leadActivity({
          lead,
          offerId: offer.id,
          type: 'followup_scheduled',
          title: 'Follow-up scheduled',
          body: row.message,
          actorUserId: userId,
          metadata: { followup_type: row.followup_type, scheduled_at: row.scheduled_at },
        })),
      ]);

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
      await admin.from('event_lead_activities').insert(leadActivity({
        lead: { id: offer.event_lead_id, venue_id: offer.venue_id },
        offerId: offer.id,
        type: 'pdf_ready',
        title: 'PDF ready',
        body: 'Offert-PDF skapades och lagrades privat.',
        actorUserId: userId,
        metadata: { pdf_url: pdfPath },
      }));
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
      return jsonResponse({ ok: true, pdf_url: pdfPath, signed_url: signed?.signedUrl || null });
    }

    if (req.method === 'GET' && path === 'preview-send') {
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers')
        .select('*, event_leads(*)')
        .eq('id', offerId)
        .maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      const lead = Array.isArray(offer.event_leads) ? offer.event_leads[0] : offer.event_leads;
      if (!lead?.email) return errorResponse('Lead has no email');
      if (!offer.pdf_url) return errorResponse('Offer has no PDF', 404);
      const sales = buildSalesDraft(offer.offer_payload || {});
      const subject = offer.email_subject || sales.subject;
      const body = offer.email_body || sales.emailBody;
      const { data: signed } = await admin.storage.from('event-offers').createSignedUrl(offer.pdf_url, 60 * 60);
      return jsonResponse({
        offer,
        lead,
        to: lead.email,
        subject,
        email_body: body,
        html: emailHtmlFromText(body),
        pdf_url: offer.pdf_url,
        signed_url: signed?.signedUrl || null,
      });
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

    if (req.method === 'POST' && path === 'send-offer') {
      const { offerId } = await req.json();
      if (!offerId) return errorResponse('Missing offerId');
      const { data: offer } = await admin.from('event_offers')
        .select('*, event_leads(*)')
        .eq('id', offerId)
        .maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (!await assertVenueAdmin(admin, userId, offer.venue_id)) return errorResponse('Forbidden', 403);
      if (offer.status === 'sent' && offer.sent_at) return errorResponse('Offer already sent', 409);

      const lead = Array.isArray(offer.event_leads) ? offer.event_leads[0] : offer.event_leads;
      if (!lead?.email) return errorResponse('Lead has no email');
      if (!offer.pdf_url) return errorResponse('Offer has no PDF', 404);

      const { data: file, error: downloadErr } = await admin.storage.from('event-offers').download(offer.pdf_url);
      if (downloadErr || !file) return errorResponse(downloadErr?.message || 'Could not read PDF', 500);
      const pdfBytes = new Uint8Array(await file.arrayBuffer());
      const sales = buildSalesDraft(offer.offer_payload || {});
      const subject = offer.email_subject || sales.subject;
      const textBody = offer.email_body || sales.emailBody;
      const html = emailHtmlFromText(textBody);
      const replyTo = offer.event_id ? eventReplyAddress(offer.event_id) : undefined;
      const sendResult = await sendResendEmail({
        to: lead.email,
        subject,
        html,
        replyTo,
        attachments: [{
          filename: `Pickla-offert-${String(offer.id).slice(0, 8)}.pdf`,
          content: bytesToBase64(pdfBytes),
        }],
      });

      const sentAt = new Date().toISOString();
      const providerMessageId = sendResult?.id || sendResult?.data?.id || null;
      const { data: updatedOffer, error: updateErr } = await admin.from('event_offers').update({
        status: 'sent',
        sent_at: sentAt,
        sent_by: userId,
        provider_message_id: providerMessageId,
      }).eq('id', offer.id).select('*').single();
      if (updateErr) return errorResponse(updateErr.message, 500);
      await admin.from('event_leads').update({ status: 'offer_sent' }).eq('id', lead.id);

      if (lead.event_id) {
        await admin.from('event_communications').insert({
          event_id: lead.event_id,
          direction: 'outbound',
          channel: 'email',
          from_email: RESEND_FROM,
          to_email: lead.email,
          subject,
          body_text: textBody,
          body_html: html,
          provider: 'resend',
          provider_message_id: providerMessageId,
          status: 'sent',
          created_by: userId,
          metadata: { event_lead_id: lead.id, event_offer_id: offer.id, pdf_url: offer.pdf_url },
        });
      }

      await admin.from('event_followups')
        .delete()
        .eq('event_lead_id', lead.id)
        .eq('status', 'scheduled');
      const followups = buildFollowupsFromSentAt(lead, offer.id, sentAt);
      await admin.from('event_followups').insert(followups);
      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'offer_sent',
          title: 'Offer sent',
          body: `Offerten skickades till ${lead.email}.`,
          actorUserId: userId,
          metadata: { provider: 'resend', provider_message_id: providerMessageId },
        }),
        ...followups.map((row: any) => leadActivity({
          lead,
          offerId: offer.id,
          type: 'followup_scheduled',
          title: 'Follow-up scheduled',
          body: row.message,
          actorUserId: userId,
          metadata: { followup_type: row.followup_type, scheduled_at: row.scheduled_at, from_sent_at: sentAt },
        })),
      ]);

      return jsonResponse({ ok: true, offer: updatedOffer, sent_at: sentAt, provider_message_id: providerMessageId });
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
