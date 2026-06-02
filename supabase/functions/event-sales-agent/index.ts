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
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pickla <hello@playpickla.com>';
const RESEND_REPLY_DOMAIN = Deno.env.get('RESEND_INBOUND_DOMAIN') || 'reply.playpickla.com';
const DEFAULT_DEPOSIT_PERCENT = 20;

function eventReplyAddress(eventId: string) {
  return `event-${eventId}@${RESEND_REPLY_DOMAIN}`;
}

function safeOrigin(req: Request) {
  const origin = req.headers.get('origin') || Deno.env.get('PUBLIC_SITE_URL') || 'https://www.playpickla.com';
  if (!/^https:\/\/([a-z0-9-]+\.)?playpickla\.com$/i.test(origin) && !/^http:\/\/localhost:\d+$/i.test(origin)) {
    return 'https://www.playpickla.com';
  }
  return origin;
}

function normalizeTime(value?: string | null) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function parsePositiveAmount(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function eventDateTimeRange(eventRow: any) {
  const date = eventRow?.start_date;
  const startTime = normalizeTime(eventRow?.start_time);
  if (!date || !startTime) return null;
  const endTime = normalizeTime(eventRow?.end_time);
  const start = DateTime.fromISO(`${date}T${startTime}:00`, { zone: 'Europe/Stockholm' });
  const end = endTime
    ? DateTime.fromISO(`${date}T${endTime}:00`, { zone: 'Europe/Stockholm' })
    : start.plus({ hours: 2 });
  if (!start.isValid || !end.isValid || end <= start) return null;
  return { start, end, startUtc: start.toUTC().toISO(), endUtc: end.toUTC().toISO() };
}

function overlapTime(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null) {
  const startA = normalizeTime(aStart);
  const endA = normalizeTime(aEnd) || (startA ? DateTime.fromISO(`2026-01-01T${startA}:00`).plus({ hours: 2 }).toFormat('HH:mm') : null);
  const startB = normalizeTime(bStart);
  const endB = normalizeTime(bEnd) || (startB ? DateTime.fromISO(`2026-01-01T${startB}:00`).plus({ hours: 2 }).toFormat('HH:mm') : null);
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

async function checkEventResourceConflicts(admin: any, eventRow: any) {
  const range = eventDateTimeRange(eventRow);
  if (!range) {
    return {
      ok: false,
      reason: 'Eventet behöver datum, starttid och rimlig sluttid innan bokning kan bekräftas.',
      conflicts: [],
      courtIds: [],
    };
  }

  const { data: eventCourts } = await admin
    .from('event_courts')
    .select('venue_court_id, venue_courts(id, name, court_number)')
    .eq('event_id', eventRow.id);
  const courtIds = (eventCourts || []).map((row: any) => row.venue_court_id).filter(Boolean);
  if (courtIds.length === 0) {
    return { ok: true, reason: null, conflicts: [], courtIds: [] };
  }

  const conflicts: any[] = [];
  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, booking_ref, venue_court_id, start_time, end_time, status, venue_courts(name, court_number)')
    .eq('venue_id', eventRow.venue_id)
    .in('venue_court_id', courtIds)
    .in('status', ['confirmed', 'checked_in', 'active'])
    .lt('start_time', range.endUtc)
    .gt('end_time', range.startUtc);

  for (const row of bookingRows || []) {
    conflicts.push({
      type: 'booking',
      id: row.id,
      label: row.booking_ref || 'Bokning',
      court: row.venue_courts?.name || row.venue_courts?.court_number || row.venue_court_id,
      start_time: row.start_time,
      end_time: row.end_time,
    });
  }

  const { data: eventRows } = await admin
    .from('events')
    .select('id, name, display_name, start_date, start_time, end_time, planning_status, event_courts(venue_court_id, venue_courts(name, court_number))')
    .eq('venue_id', eventRow.venue_id)
    .eq('start_date', eventRow.start_date)
    .neq('id', eventRow.id)
    .not('planning_status', 'in', '("cancelled","done")');

  for (const other of eventRows || []) {
    if (!overlapTime(eventRow.start_time, eventRow.end_time, other.start_time, other.end_time)) continue;
    for (const court of other.event_courts || []) {
      if (!courtIds.includes(court.venue_court_id)) continue;
      conflicts.push({
        type: 'event',
        id: other.id,
        label: other.display_name || other.name || 'Event',
        court: court.venue_courts?.name || court.venue_court_id,
        start_time: other.start_time,
        end_time: other.end_time,
      });
    }
  }

  return {
    ok: conflicts.length === 0,
    reason: conflicts.length ? 'Valda resurser är upptagna.' : null,
    conflicts,
    courtIds,
  };
}

function buildBookingConfirmationText({ lead, offer, eventRow, depositUrl, depositAmount }: any) {
  const date = eventRow.start_date || lead.preferred_date || 'enligt överenskommelse';
  const time = eventRow.start_time ? `${String(eventRow.start_time).slice(0, 5)}${eventRow.end_time ? `-${String(eventRow.end_time).slice(0, 5)}` : ''}` : 'tid enligt överenskommelse';
  return [
    `Hej ${lead.contact_name || ''},`,
    '',
    'Tack! Vi har nu lagt upp er bokning hos Pickla.',
    '',
    `Event: ${offer.title || lead.company_name || lead.contact_name}`,
    `Datum/tid: ${date} · ${time}`,
    `Antal personer: ${lead.participants_count || 'enligt offert'}`,
    `Totalpris enligt offert: ${Number(offer.total_price || lead.estimated_value || 0).toLocaleString('sv-SE')} kr`,
    `Handpenning: ${Number(depositAmount || 0).toLocaleString('sv-SE')} kr`,
    '',
    'Säkra bokningen genom att betala handpenningen här:',
    depositUrl,
    '',
    'När handpenningen är betald är bokningen bindande enligt villkoren i offerten. Slutbetalning hanteras enligt överenskommelse.',
    '',
    'Hälsningar,',
    'Pickla Event',
  ].join('\n');
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

async function createDepositCheckout({ req, stripe, lead, offer, eventRow, depositAmountSek }: any) {
  const origin = safeOrigin(req);
  const title = `Handpenning · ${offer.title || lead.company_name || lead.contact_name || 'Pickla Event'}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: lead.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'sek',
        unit_amount: Math.round(Number(depositAmountSek) * 100),
        product_data: {
          name: title.slice(0, 120),
          description: 'Handpenning för företagsevent hos Pickla',
          metadata: {
            event_lead_id: lead.id,
            event_offer_id: offer.id,
            event_id: eventRow.id,
          },
        },
      },
    }],
    metadata: {
      purchase_type: 'event_deposit',
      event_lead_id: lead.id,
      event_offer_id: offer.id,
      event_id: eventRow.id,
      venue_id: lead.venue_id,
    },
    success_url: `${origin}/hub/admin?event_deposit=success&lead=${lead.id}`,
    cancel_url: `${origin}/hub/admin?event_deposit=cancelled&lead=${lead.id}`,
  });
  return session;
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

    if (req.method === 'GET' && path === 'booking-preview') {
      const leadId = new URL(req.url).searchParams.get('leadId');
      const offerId = new URL(req.url).searchParams.get('offerId');
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const { data: offer } = offerId
        ? await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle()
        : await admin.from('event_offers').select('*').eq('event_lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (offer.event_lead_id !== lead.id) return errorResponse('Offer does not belong to lead', 403);
      if (!lead.event_id) return errorResponse('Lead has no event yet', 404);
      const { data: eventRow } = await admin.from('events').select('*').eq('id', lead.event_id).maybeSingle();
      if (!eventRow) return errorResponse('Event not found', 404);
      const resourceCheck = await checkEventResourceConflicts(admin, eventRow);
      const total = Number(offer.total_price || lead.estimated_value || 0);
      const defaultDeposit = Math.max(500, Math.min(total || 500, Math.round((total * DEFAULT_DEPOSIT_PERCENT) / 100)));
      return jsonResponse({ lead, offer, event: eventRow, resource_check: resourceCheck, default_deposit_amount: defaultDeposit });
    }

    if (req.method === 'POST' && path === 'confirm-booking') {
      const { leadId, offerId, depositAmountSek } = await req.json();
      if (!leadId) return errorResponse('Missing leadId');
      const { data: lead } = await admin.from('event_leads').select('*').eq('id', leadId).maybeSingle();
      if (!lead) return errorResponse('Lead not found', 404);
      if (!await assertVenueAdmin(admin, userId, lead.venue_id)) return errorResponse('Forbidden', 403);
      const { data: offer } = offerId
        ? await admin.from('event_offers').select('*').eq('id', offerId).maybeSingle()
        : await admin.from('event_offers').select('*').eq('event_lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!offer) return errorResponse('Offer not found', 404);
      if (offer.event_lead_id !== lead.id) return errorResponse('Offer does not belong to lead', 403);
      if (!lead.event_id) return errorResponse('Lead has no event yet', 404);
      const { data: eventRow } = await admin.from('events').select('*').eq('id', lead.event_id).maybeSingle();
      if (!eventRow) return errorResponse('Event not found', 404);

      const resourceCheck = await checkEventResourceConflicts(admin, eventRow);
      if (!resourceCheck.ok) return jsonResponse({ ok: false, blocked: true, resource_check: resourceCheck }, 409);

      const total = Number(offer.total_price || lead.estimated_value || 0);
      const fallbackDeposit = Math.max(500, Math.min(total || 500, Math.round((total * DEFAULT_DEPOSIT_PERCENT) / 100)));
      const requestedDeposit = parsePositiveAmount(depositAmountSek, fallbackDeposit);
      const deposit = Math.round(Math.max(100, Math.min(requestedDeposit, Math.max(total || fallbackDeposit, fallbackDeposit))));

      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) return errorResponse('Stripe not configured', 500);
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
      const checkout = await createDepositCheckout({ req, stripe, lead, offer, eventRow, depositAmountSek: deposit });
      if (!checkout.url) return errorResponse('Could not create deposit checkout', 500);

      const sentAt = new Date().toISOString();
      const emailBody = buildBookingConfirmationText({
        lead,
        offer,
        eventRow,
        depositUrl: checkout.url,
        depositAmount: deposit,
      });
      const subject = `Bokningsbekräftelse: ${offer.title || 'Pickla Event'}`;
      const html = emailHtmlFromText(emailBody);
      const replyTo = eventRow.id ? eventReplyAddress(eventRow.id) : undefined;
      const sendResult = await sendResendEmail({
        to: lead.email,
        subject,
        html,
        replyTo,
      });
      const providerMessageId = sendResult?.id || sendResult?.data?.id || null;

      await admin.from('events').update({
        planning_status: 'booked',
        visibility: 'internal',
        status: 'upcoming',
      }).eq('id', eventRow.id);
      await admin.from('event_leads').update({ status: 'booking_confirmed' }).eq('id', lead.id);
      const { data: updatedOffer } = await admin.from('event_offers').update({
        status: 'booking_confirmed',
        booking_confirmed_at: sentAt,
        booking_confirmed_by: userId,
        deposit_amount: deposit,
        deposit_stripe_session_id: checkout.id,
        deposit_checkout_url: checkout.url,
        deposit_sent_at: sentAt,
      }).eq('id', offer.id).select('*').single();

      await admin.from('event_communications').insert({
        event_id: eventRow.id,
        direction: 'outbound',
        channel: 'email',
        from_email: RESEND_FROM,
        to_email: lead.email,
        subject,
        body_text: emailBody,
        body_html: html,
        provider: 'resend',
        provider_message_id: providerMessageId,
        status: 'sent',
        created_by: userId,
        metadata: {
          event_lead_id: lead.id,
          event_offer_id: offer.id,
          type: 'booking_confirmation',
          deposit_amount: deposit,
          deposit_stripe_session_id: checkout.id,
        },
      });

      await admin.from('event_lead_activities').insert([
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'booking_confirmed',
          title: 'Booking confirmed',
          body: 'Eventet bekräftades efter resurskontroll.',
          actorUserId: userId,
          metadata: { event_id: eventRow.id, resource_check: resourceCheck },
        }),
        leadActivity({
          lead,
          offerId: offer.id,
          type: 'deposit_link_sent',
          title: 'Deposit link sent',
          body: `Handpenningslänk på ${Number(deposit).toLocaleString('sv-SE')} kr skickades till ${lead.email}.`,
          actorUserId: userId,
          metadata: { stripe_session_id: checkout.id, deposit_amount: deposit },
        }),
      ]);

      return jsonResponse({
        ok: true,
        lead_status: 'booking_confirmed',
        event_status: 'booked',
        offer: updatedOffer,
        checkout_url: checkout.url,
        stripe_session_id: checkout.id,
        deposit_amount: deposit,
      });
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
