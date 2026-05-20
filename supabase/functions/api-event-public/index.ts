import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pickla <hello@playpickla.com>';
const RESEND_REPLY_DOMAIN = Deno.env.get('RESEND_INBOUND_DOMAIN') || 'reply.playpickla.com';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function eventReplyAddress(eventId: string) {
  return `event-${eventId}@${RESEND_REPLY_DOMAIN}`;
}

function formatSubject(base: string, eventId: string) {
  const token = `[Pickla ${eventId}]`;
  return base.includes(token) ? base : `${base} ${token}`;
}

function stripHtml(html: string | null | undefined) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function verifyResendWebhook(req: Request) {
  const raw = await req.text();
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) throw new Error('Missing RESEND_WEBHOOK_SECRET');

  const id = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signatureHeader = req.headers.get('svix-signature') || '';
  if (!id || !timestamp || !signatureHeader) throw new Error('Missing webhook signature headers');

  const signedContent = `${id}.${timestamp}.${raw}`;
  const keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent)));
  const signatures = signatureHeader.split(' ').flatMap((part) => part.split(',')).filter((part) => part && part !== 'v1');
  const isValid = signatures.some((sig) => constantTimeEqual(base64ToBytes(sig), expected));
  if (!isValid) throw new Error('Invalid webhook signature');
  return JSON.parse(raw);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function fetchReceivedEmail(emailId: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) throw new Error('Missing RESEND_API_KEY');

  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  if (!res.ok) throw new Error(`Could not fetch received email: ${await res.text()}`);
  const body = await res.json();
  return body?.data || body;
}

async function sendResendEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
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
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Resend email failed');
  return data;
}

function findEventIdFromInbound(email: any) {
  const recipients = [
    ...(Array.isArray(email?.to) ? email.to : []),
    ...(Array.isArray(email?.cc) ? email.cc : []),
  ].map((value) => emailAddressField(value));

  for (const recipient of recipients) {
    const match = recipient.match(/event-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i);
    if (match?.[1]) return match[1];
  }

  const subjectMatch = String(email?.subject || '').match(/\[Pickla\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i);
  return subjectMatch?.[1] || null;
}

function emailAddressField(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.email && value.name) return `${value.name} <${value.email}>`;
  if (value.email) return String(value.email);
  return String(value);
}

async function sendGroupInquiryEmail({
  to,
  eventId,
  name,
  venueName,
  typeLabel,
  preferredDate,
  preferredTime,
  participants,
}: {
  to: string | null;
  eventId: string;
  name: string;
  venueName: string;
  typeLabel: string;
  preferredDate: string | null;
  preferredTime: string;
  participants: number;
}) {
  if (!to) return null;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
      <h1 style="font-size:26px;margin:0 0 12px">Vi har fått din förfrågan</h1>
      <p style="margin:0 0 16px">Hej ${escapeHtml(name)}, tack! Vi har tagit emot din gruppbokning hos ${escapeHtml(venueName)}.</p>
      <div style="border:1px solid #e5e7eb;border-radius:18px;padding:18px;background:#fafafa">
        <p style="margin:0 0 8px"><strong>Typ:</strong> ${escapeHtml(typeLabel)}</p>
        <p style="margin:0 0 8px"><strong>Antal:</strong> ${participants} personer</p>
        <p style="margin:0 0 8px"><strong>Datum:</strong> ${escapeHtml(preferredDate || 'Flexibelt')}</p>
        <p style="margin:0"><strong>Tid:</strong> ${escapeHtml(preferredTime || 'Flexibelt')}</p>
      </div>
      <p style="margin:16px 0 0">Vi återkommer med upplägg, tider och offert.</p>
      <p style="margin:8px 0 0">Du kan svara direkt på det här mailet så hamnar svaret hos vårt team.</p>
      <p style="margin:18px 0 0;color:#6b7280;font-size:13px">Pickla</p>
    </div>
  `;

  return await sendResendEmail({
    to,
    subject: formatSubject(`Vi har fått din förfrågan till ${venueName}`, eventId),
    html,
    replyTo: eventReplyAddress(eventId),
  });
}

async function createInquiryRoom({
  client,
  venueId,
  eventId,
  title,
  subtitle,
  message,
}: {
  client: any;
  venueId: string;
  eventId: string;
  title: string;
  subtitle: string;
  message: string;
}) {
  const { data: existingRoom } = await client.from('chat_rooms')
    .select('id')
    .eq('resource_id', eventId)
    .maybeSingle();

  const roomResult = existingRoom?.id
    ? await client.from('chat_rooms')
        .update({ title, subtitle, updated_at: new Date().toISOString() })
        .eq('id', existingRoom.id)
        .select('id')
        .maybeSingle()
    : await client.from('chat_rooms')
        .insert({
          venue_id: venueId,
          resource_id: eventId,
          room_type: 'event',
          title,
          subtitle,
          emoji: '📩',
          is_public: false,
        })
        .select('id')
        .maybeSingle();

  const room = roomResult.data;
  const roomErr = roomResult.error;

  if (roomErr || !room?.id) {
    console.error('Failed to create inquiry room:', roomErr?.message);
    return null;
  }

  await client.from('chat_messages').insert({
    room_id: room.id,
    user_id: null,
    message_type: 'bot',
    content: message,
    metadata: { source: 'group_inquiry', event_id: eventId },
  });

  const { data: staff } = await client.from('venue_staff')
    .select('user_id')
    .eq('venue_id', venueId)
    .eq('is_active', true);

  const participants = (staff || [])
    .map((row: any) => row.user_id)
    .filter(Boolean)
    .map((userId: string) => ({ room_id: room.id, user_id: userId }));

  if (participants.length) {
    await client.from('chat_participants').upsert(participants, { onConflict: 'room_id,user_id' });
  }

  return room.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    const client = getServiceClient();

    // POST /api-event-public/email-webhook — Resend inbound email webhook
    if (req.method === 'POST' && path === 'email-webhook') {
      let event: any;
      try {
        event = await verifyResendWebhook(req);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid webhook signature', 401);
      }

      if (event?.type !== 'email.received') {
        return jsonResponse({ received: true, ignored: true }, 200);
      }

      const providerEventId = req.headers.get('svix-id') || null;
      if (providerEventId) {
        const { data: existing } = await client.from('event_communications')
          .select('id')
          .eq('provider', 'resend')
          .eq('provider_event_id', providerEventId)
          .maybeSingle();
        if (existing?.id) return jsonResponse({ success: true, duplicate: true });
      }

      const emailId = event?.data?.email_id || event?.data?.id;
      if (!emailId) return errorResponse('Missing email id', 400);

      const email = await fetchReceivedEmail(emailId);
      const eventId = findEventIdFromInbound(email);
      if (!eventId) return errorResponse('Could not route inbound email', 404);

      const { data: eventRow, error: eventErr } = await client.from('events')
        .select('id, venue_id, customer_email')
        .eq('id', eventId)
        .maybeSingle();
      if (eventErr || !eventRow) return errorResponse('Event not found', 404);

      const { data: room } = await client.from('chat_rooms')
        .select('id')
        .eq('resource_id', eventId)
        .eq('room_type', 'event')
        .maybeSingle();
      if (!room?.id) return errorResponse('Event room not found', 404);

      const textBody = String(email?.text || stripHtml(email?.html) || '').trim();
      const content = textBody.length > 4000 ? `${textBody.slice(0, 4000)}...` : textBody;

      const { data: communication, error: commErr } = await client.from('event_communications')
        .insert({
          event_id: eventId,
          room_id: room.id,
          direction: 'inbound',
          channel: 'email',
          from_email: emailAddressField(email?.from || event?.data?.from) || null,
          to_email: Array.isArray(email?.to) ? email.to.map(emailAddressField).filter(Boolean).join(', ') : null,
          subject: email?.subject || event?.data?.subject || null,
          body_text: textBody || null,
          body_html: email?.html || null,
          provider: 'resend',
          provider_message_id: emailId,
          provider_event_id: providerEventId,
          status: 'received',
          metadata: {
            message_id: email?.message_id || event?.data?.message_id || null,
            cc: email?.cc || [],
            attachments: email?.attachments || [],
          },
        })
        .select('id')
        .single();

      if (commErr) {
        if (commErr.code === '23505') return jsonResponse({ success: true, duplicate: true });
        return errorResponse(commErr.message, 500);
      }

      await client.from('chat_messages').insert({
        room_id: room.id,
        user_id: null,
        message_type: 'text',
        content: content || '(tomt mailsvar)',
        metadata: {
          channel: 'email',
          direction: 'inbound',
          communication_id: communication.id,
          event_id: eventId,
          from: emailAddressField(email?.from || event?.data?.from) || null,
          subject: email?.subject || event?.data?.subject || null,
        },
      });

      return jsonResponse({ success: true, communication_id: communication.id });
    }

    // POST /api-event-public/customer-message — staff email response from inquiry room
    if (req.method === 'POST' && path === 'customer-message') {
      const { userId, error: authError } = await getAuthenticatedClient(req);
      if (authError || !userId) return errorResponse(authError || 'Unauthorized', 401);

      const body = await req.json();
      const eventId = String(body.event_id || '').trim();
      const message = String(body.message || '').trim();
      if (!eventId) return errorResponse('Missing event_id');
      if (message.length < 2) return errorResponse('Missing message');
      if (message.length > 5000) return errorResponse('Message too long');

      const { data: eventRow, error: eventErr } = await client.from('events')
        .select('id, venue_id, name, display_name, customer_name, customer_email, customer_phone, venues(name)')
        .eq('id', eventId)
        .maybeSingle();
      if (eventErr || !eventRow) return errorResponse('Event not found', 404);
      if (!eventRow.customer_email) return errorResponse('Kunden saknar email', 400);

      const { data: staff } = await client.from('venue_staff')
        .select('id')
        .eq('venue_id', eventRow.venue_id)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      if (!staff?.id) return errorResponse('Forbidden', 403);

      const { data: room } = await client.from('chat_rooms')
        .select('id')
        .eq('resource_id', eventId)
        .eq('room_type', 'event')
        .maybeSingle();
      if (!room?.id) return errorResponse('Event room not found', 404);

      const venueName = (eventRow.venues as any)?.name || 'Pickla';
      const subject = formatSubject(
        String(body.subject || '').trim() || `Angående din förfrågan till ${venueName}`,
        eventId,
      );
      const htmlMessage = escapeHtml(message).replaceAll('\n', '<br>');
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.55">
          <p style="margin:0 0 16px">Hej ${escapeHtml(eventRow.customer_name || '')},</p>
          <div style="font-size:15px">${htmlMessage}</div>
          <p style="margin:20px 0 0;color:#6b7280;font-size:13px">Svara direkt på detta mail om du har frågor.</p>
          <p style="margin:8px 0 0;color:#111827;font-weight:700">${escapeHtml(venueName)}</p>
        </div>
      `;

      const { data: pendingCommunication, error: pendingErr } = await client.from('event_communications')
        .insert({
          event_id: eventId,
          room_id: room.id,
          direction: 'outbound',
          channel: 'email',
          from_email: RESEND_FROM,
          to_email: eventRow.customer_email,
          subject,
          body_text: message,
          body_html: html,
          provider: 'resend',
          status: 'pending',
          created_by: userId,
        })
        .select('id')
        .single();
      if (pendingErr) return errorResponse(pendingErr.message, 500);

      let sendResult: any;
      try {
        sendResult = await sendResendEmail({
          to: eventRow.customer_email,
          subject,
          html,
          replyTo: eventReplyAddress(eventId),
        });
      } catch (err) {
        await client.from('event_communications')
          .update({ status: 'failed', metadata: { error: err instanceof Error ? err.message : String(err) } })
          .eq('id', pendingCommunication.id);
        return errorResponse(err instanceof Error ? err.message : 'Email failed', 502);
      }

      await client.from('event_communications')
        .update({
          status: 'sent',
          provider_message_id: sendResult?.id || null,
          metadata: { resend_response: sendResult },
        })
        .eq('id', pendingCommunication.id);

      await client.from('chat_messages').insert({
        room_id: room.id,
        user_id: userId,
        message_type: 'text',
        content: message,
        metadata: {
          channel: 'email',
          direction: 'outbound',
          communication_id: pendingCommunication.id,
          event_id: eventId,
          to: eventRow.customer_email,
          subject,
        },
      });

      return jsonResponse({ success: true, communication_id: pendingCommunication.id });
    }

    // GET /api-event-public/detail?id=X or ?slug=X — public event info
    if (req.method === 'GET' && path === 'detail') {
      const id = url.searchParams.get('id');
      const slug = url.searchParams.get('slug');
      if (!id && !slug) return errorResponse('Missing id or slug');

      const selectFields = 'id, name, display_name, description, event_type, format, category, start_date, end_date, start_time, end_time, entry_fee, entry_fee_type, status, logo_url, background_url, primary_color, secondary_color, number_of_courts, points_to_win, best_of, scoring_type, competition_type, player_info_general, whatsapp_url, is_drop_in, registration_fields, slug, venue_id, template_id, venues(id, name, address, city)';

      let query = client.from('events').select(selectFields).eq('is_public', true);
      if (slug) {
        query = query.eq('slug', slug);
      } else {
        query = query.eq('id', id!);
      }

      const { data, error: qErr } = await query.single();
      if (qErr) return errorResponse('Event not found', 404);

      // Get player count, category config, event pricing, template, courts, and tier pricing in parallel
      const [playerResult, catResult, pricingResult, templateResult, courtsResult, tierPricingResult] = await Promise.all([
        client.from('players')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', data.id),
        data.venue_id
          ? client.from('venue_event_categories')
              .select('*')
              .eq('venue_id', data.venue_id)
              .eq('category_key', data.category)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        data.venue_id
          ? client.from('pricing_rules')
              .select('id, name, price, vat_rate')
              .eq('venue_id', data.venue_id)
              .eq('type', 'event')
              .eq('is_active', true)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        data.template_id
          ? client.from('event_templates')
              .select('id, name, entry_fee, currency, vat_rate, logo_url, display_name')
              .eq('id', data.template_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        client.from('event_courts')
          .select('venue_court_id, venue_courts(id, name, court_number)')
          .eq('event_id', data.id),
        data.venue_id
          ? client.from('membership_tier_pricing')
              .select('tier_id, product_type, fixed_price, discount_percent, label, membership_tiers(id, name, color, sort_order)')
              .in('product_type', ['event_fee', 'day_pass'])
          : Promise.resolve({ data: null }),
      ]);

      const categoryConfig = catResult.data || null;
      const eventPricing = pricingResult.data || null;
      const template = templateResult.data || null;

      // Template pricing takes precedence over venue pricing rules
      const effectivePricing = template && template.entry_fee != null && template.entry_fee > 0
        ? { price: template.entry_fee, vat_rate: template.vat_rate || 6, source: 'template', currency: template.currency || 'SEK' }
        : data.entry_fee != null && data.entry_fee > 0
          ? { price: data.entry_fee, vat_rate: 6, source: 'event', currency: 'SEK' }
          : eventPricing
            ? { ...eventPricing, source: 'venue_rule' }
            : null;

      // Build tier pricing map
      const tierPricing = (tierPricingResult.data || []).map((tp: any) => ({
        tier_id: tp.tier_id,
        tier_name: tp.membership_tiers?.name || '',
        tier_color: tp.membership_tiers?.color || '#666',
        sort_order: tp.membership_tiers?.sort_order || 0,
        product_type: tp.product_type,
        fixed_price: tp.fixed_price,
        discount_percent: tp.discount_percent,
        label: tp.label,
      }));

      return jsonResponse({
        ...data,
        player_count: playerResult.count || 0,
        category_config: categoryConfig,
        event_pricing: effectivePricing,
        template,
        event_courts: (courtsResult.data || []).map((c: any) => c.venue_courts || { id: c.venue_court_id }),
        tier_pricing: tierPricing,
      }, 200, 5);
    }

    // GET /api-event-public/list?venueId=X — list public events
    if (req.method === 'GET' && path === 'list') {
      const venueId = url.searchParams.get('venueId');
      const category = url.searchParams.get('category');
      const excludeId = url.searchParams.get('excludeId');
      const today = url.searchParams.get('today'); // pass 'true' to filter today's events

      let query = client.from('events')
        .select('id, name, display_name, category, start_date, end_date, start_time, end_time, entry_fee, entry_fee_type, status, logo_url, primary_color, is_drop_in, format, venue_id, venues(id, name)')
        .eq('is_public', true)
        .in('status', ['active', 'upcoming', 'in_progress'])
        .order('start_date', { ascending: true })
        .limit(20);

      if (venueId) query = query.eq('venue_id', venueId);
      if (category) query = query.eq('category', category);
      if (excludeId) query = query.neq('id', excludeId);

      const { data, error: qErr } = await query;
      if (qErr) return errorResponse(qErr.message);

      return jsonResponse(data, 200, 10);
    }

    // POST /api-event-public/group-inquiry — lightweight public lead for corporate/group bookings
    if (req.method === 'POST' && path === 'group-inquiry') {
      const body = await req.json();
      const {
        slug,
        eventType,
        participants,
        preferredDate,
        preferredTime,
        activities,
        resources,
        name,
        email,
        phone,
        notes,
      } = body;

      if (!slug) return errorResponse('Missing slug');
      if (!name || String(name).trim().length < 2) return errorResponse('Missing name');
      if (!phone || String(phone).trim().length < 5) return errorResponse('Missing phone');
      if (!email || String(email).trim().length < 5) return errorResponse('Missing email');
      if (email && String(email).length > 255) return errorResponse('Email too long');

      const participantCount = Math.max(1, Math.min(Number(participants || 1), 500));
      const requestedDate = typeof preferredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
        ? preferredDate
        : null;
      const selectedActivities = Array.isArray(activities)
        ? activities.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
        : [];
      const selectedResources = Array.isArray(resources)
        ? resources.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 12)
        : [];
      const resourceList = Array.from(new Set([...selectedActivities, ...selectedResources]));
      const normalizedType = String(eventType || 'company');
      const typeLabelMap: Record<string, string> = {
        company: 'Företagsevent',
        team: 'Teamaktivitet',
        birthday: 'Födelsedag',
        bachelorette: 'Möhippa / svensexa',
        private: 'Privat grupp',
        other: 'Gruppbokning',
      };
      const timeMap: Record<string, string> = {
        morning: '10:00',
        lunch: '12:00',
        afternoon: '15:00',
        evening: '18:00',
      };
      const typeLabel = typeLabelMap[normalizedType] || 'Gruppbokning';
      const timeLabel = String(preferredTime || '').trim();
      const startTime = timeMap[timeLabel] || (/^\d{2}:\d{2}$/.test(timeLabel) ? timeLabel : null);
      const cleanName = String(name).trim().slice(0, 160);
      const cleanPhone = String(phone).trim().slice(0, 50);
      const cleanEmail = email ? String(email).trim().slice(0, 255) : null;
      const cleanNotes = notes ? String(notes).trim().slice(0, 1200) : '';

      const { data: venue, error: venueErr } = await client.from('venues')
        .select('id, name, email')
        .eq('slug', slug)
        .eq('is_public', true)
        .maybeSingle();
      if (venueErr || !venue) return errorResponse('Venue not found', 404);

      const partnerNotes = [
        `Källa: publik gruppbokningsförfrågan`,
        `Typ: ${typeLabel}`,
        `Önskat datum: ${requestedDate || 'Flexibelt'}`,
        `Önskad tid: ${timeLabel || 'Flexibelt'}`,
        `Aktiviteter/resurser: ${resourceList.length ? resourceList.join(', ') : 'Ej valt'}`,
        `Kontakt: ${cleanName}${cleanEmail ? ` · ${cleanEmail}` : ''} · ${cleanPhone}`,
        cleanNotes ? `Övrigt: ${cleanNotes}` : null,
      ].filter(Boolean).join('\n');

      const eventPayload = {
        venue_id: venue.id,
        name: `${typeLabel} · ${cleanName}`,
        display_name: `${typeLabel} · ${participantCount} pers`,
        event_type: 'corporate_event',
        format: 'custom',
        category: 'corporate',
        status: 'upcoming',
        is_public: false,
        planning_status: 'inquiry',
        visibility: 'internal',
        number_of_courts: 1,
        start_date: requestedDate,
        end_date: requestedDate,
        start_time: startTime,
        end_time: null,
        customer_name: cleanName,
        customer_email: cleanEmail,
        customer_phone: cleanPhone,
        expected_participants: participantCount,
        owner_name: null,
        partner_notes: partnerNotes,
        internal_notes: cleanNotes || null,
        resources: resourceList,
      };

      let { data: event, error: insertErr } = await client.from('events').insert(eventPayload).select('id').single();

      if (insertErr && insertErr.message?.includes('invalid input value for enum event_format')) {
        const fallbackPayload = { ...eventPayload, format: 'team_vs_team' };
        const fallback = await client.from('events').insert(fallbackPayload).select('id').single();
        event = fallback.data;
        insertErr = fallback.error;
      }

      if (insertErr) return errorResponse(insertErr.message, 500);

      const roomId = await createInquiryRoom({
        client,
        venueId: venue.id,
        eventId: event.id,
        title: `${typeLabel} · ${cleanName}`,
        subtitle: `${participantCount} pers · ${requestedDate || 'datum flexibelt'}`,
        message: partnerNotes,
      });

      const confirmationSubject = formatSubject(`Vi har fått din förfrågan till ${venue.name || 'Pickla'}`, event.id);
      await sendGroupInquiryEmail({
        to: cleanEmail,
        eventId: event.id,
        name: cleanName,
        venueName: venue.name || 'Pickla',
        typeLabel,
        preferredDate: requestedDate,
        preferredTime: timeLabel,
        participants: participantCount,
      }).then(async (result) => {
        if (!result || !roomId) return;
        await client.from('event_communications').insert({
          event_id: event.id,
          room_id: roomId,
          direction: 'outbound',
          channel: 'email',
          from_email: RESEND_FROM,
          to_email: cleanEmail,
          subject: confirmationSubject,
          body_text: `Vi har fått din förfrågan till ${venue.name || 'Pickla'}. Vi återkommer med upplägg, tider och offert.`,
          provider: 'resend',
          provider_message_id: result?.id || null,
          status: 'sent',
          metadata: { source: 'group_inquiry_confirmation' },
        });
      }).catch((err) => console.error('Confirmation email failed:', err?.message || err));

      return jsonResponse({ success: true, event_id: event.id, room_id: roomId }, 201);
    }

    // POST /api-event-public/register — register a player + auto-create account
    if (req.method === 'POST' && path === 'register') {
      const body = await req.json();
      const { eventId, name, phone, email, level } = body;

      if (!eventId || !name) return errorResponse('Missing eventId or name');
      if (name.length > 100) return errorResponse('Name too long');
      if (phone && phone.length > 20) return errorResponse('Phone too long');
      if (email && email.length > 255) return errorResponse('Email too long');

      // Check event exists and is public
      const { data: event, error: evErr } = await client.from('events')
        .select('id, status, is_drop_in')
        .eq('id', eventId)
        .eq('is_public', true)
        .single();

      if (evErr || !event) return errorResponse('Event not found', 404);
      if (event.status === 'completed') return errorResponse('Event is completed');

      // Check duplicate registration
      const identifier = phone?.trim() || email?.trim() || null;
      if (identifier) {
        const { data: existing } = await client.from('players')
          .select('id')
          .eq('event_id', eventId)
          .eq('email', identifier)
          .maybeSingle();
        if (existing) return errorResponse('Redan anmäld');
      } else {
        const { data: existing } = await client.from('players')
          .select('id')
          .eq('event_id', eventId)
          .eq('name', name.trim())
          .maybeSingle();
        if (existing) return errorResponse('Redan anmäld med detta namn');
      }

      // Auto-create auth account with phone as identifier
      let authUserId: string | null = null;
      if (phone) {
        const { data: existingProfile } = await client.from('player_profiles')
          .select('auth_user_id')
          .eq('phone', phone)
          .maybeSingle();

        if (existingProfile) {
          authUserId = existingProfile.auth_user_id;
        } else if (email) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const adminClient = createClient(supabaseUrl, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });

          const { data: newUser, error: authErr } = await adminClient.auth.admin.createUser({
            email,
            phone,
            user_metadata: { display_name: name.trim() },
            email_confirm: true,
          });

          if (!authErr && newUser?.user) {
            authUserId = newUser.user.id;
            await client.from('player_profiles')
              .update({ phone: phone.trim(), display_name: name.trim() })
              .eq('auth_user_id', authUserId);
          }
        }
      }

      const { data: player, error: insErr } = await client.from('players')
        .insert({
          event_id: eventId,
          name: name.trim(),
          email: phone?.trim() || email?.trim() || null,
          auth_user_id: authUserId,
        })
        .select()
        .single();

      if (insErr) return errorResponse(insErr.message);

      return jsonResponse({ success: true, player }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
