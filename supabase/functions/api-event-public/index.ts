import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { choosePackage, estimateValue, leadActivity, leadSummary, sanitizeLeadInput, scoreLead } from '../_shared/event_agents.ts';
import { resolveActivityPricingDecision } from '../_shared/activity_pricing.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pickla <hello@playpickla.com>';
const RESEND_REPLY_DOMAIN = (Deno.env.get('RESEND_INBOUND_DOMAIN') || 'playpickla.com')
  .replace(/^reply\.playpickla\.com$/i, 'playpickla.com');

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

async function getOptionalUserId(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { userId } = await getAuthenticatedClient(req);
  return userId || null;
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
  const recipients = collectEmailAddresses(
    email?.to,
    email?.cc,
    email?.bcc,
    email?.recipient,
    email?.recipients,
    email?.headers?.to,
    email?.headers?.cc,
  );

  for (const recipient of recipients) {
    const match = recipient.match(/event-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i);
    if (match?.[1]) return match[1];
  }

  const subjectMatch = String(email?.subject || '').match(/\[Pickla\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i);
  return subjectMatch?.[1] || null;
}

function collectEmailAddresses(...values: any[]) {
  return values.flatMap((value) => {
    if (!value) return [];
    if (Array.isArray(value)) return collectEmailAddresses(...value);
    if (typeof value === 'string') return [value];
    if (Array.isArray(value.value)) return collectEmailAddresses(...value.value);
    if (value.email || value.address) return [emailAddressField(value)];
    if (value.text) return [String(value.text)];
    return [String(value)];
  }).filter(Boolean);
}

function emailAddressField(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.address && value.name) return `${value.name} <${value.address}>`;
  if (value.address) return String(value.address);
  if (value.email && value.name) return `${value.name} <${value.email}>`;
  if (value.email) return String(value.email);
  return String(value);
}

function inboundTextBody(email: any) {
  return String(
    email?.text ||
    email?.text_body ||
    email?.body_text ||
    email?.body?.text ||
    stripHtml(email?.html || email?.html_body || email?.body_html || email?.body?.html) ||
    ''
  ).trim();
}

function activityResourceId(sessionId: string, occurrenceDate: string | null) {
  return `activity_session:${sessionId}:${occurrenceDate || 'next'}`;
}

function nextActivityOccurrence(session: any, requestedDate?: string | null) {
  if (requestedDate) return DateTime.fromISO(requestedDate, { zone: 'Europe/Stockholm' });
  if (session?.session_date) return DateTime.fromISO(session.session_date, { zone: 'Europe/Stockholm' });

  const now = DateTime.now().setZone('Europe/Stockholm');
  const recurrenceDays = session?.recurrence_days || [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = now.plus({ days: offset });
    const jsDow = date.weekday % 7;
    if (!recurrenceDays.includes(jsDow)) continue;
    if (offset === 0 && session?.end_time) {
      const [endHour = 0, endMinute = 0] = String(session.end_time).slice(0, 5).split(':').map(Number);
      const endAt = date.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
      if (now > endAt) continue;
    }
    return date;
  }

  return now;
}

function publicActivitySubtitle(session: any, occurrence: DateTime) {
  const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : '';
  const endTime = session?.end_time ? String(session.end_time).slice(0, 5) : '';
  const now = DateTime.now().setZone('Europe/Stockholm');
  const dayLabel = occurrence.hasSame(now, 'day')
    ? 'Idag'
    : occurrence.hasSame(now.plus({ days: 1 }), 'day')
      ? 'Imorgon'
      : occurrence.toFormat('d MMM', { locale: 'sv' });
  return [dayLabel, startTime && endTime ? `${startTime}-${endTime}` : startTime].filter(Boolean).join(' · ');
}

function isLinkPreviewBot(userAgent: string | null) {
  const ua = String(userAgent || '').toLowerCase();
  return [
    'facebookexternalhit',
    'facebot',
    'whatsapp',
    'twitterbot',
    'slackbot',
    'discordbot',
    'linkedinbot',
    'telegrambot',
    'skypeuripreview',
    'applebot',
    'messages',
    'imessage',
    'bot',
    'crawler',
    'spider',
    'preview',
  ].some((needle) => ua.includes(needle));
}

function publicSiteOrigin(req: Request) {
  const configured = Deno.env.get('PUBLIC_SITE_URL') || Deno.env.get('SITE_URL') || 'https://www.playpickla.com';
  try {
    return new URL(configured).origin;
  } catch {
    return new URL(req.url).origin;
  }
}

function publicPassPath(sessionId: string, sessionDate: string | null, venueSlug: string | null) {
  const params = new URLSearchParams();
  if (sessionDate) params.set('date', sessionDate);
  if (venueSlug) params.set('v', venueSlug);
  return `/p/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ''}`;
}

function programSessionPath(sessionId: string, sessionDate: string | null, venueSlug: string | null) {
  const params = new URLSearchParams();
  if (sessionDate) params.set('date', sessionDate);
  if (venueSlug) params.set('v', venueSlug);
  return `/program/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ''}`;
}

function ogTitleForActivity(session: any, occurrenceDate: string) {
  const occurrence = DateTime.fromISO(occurrenceDate, { zone: 'Europe/Stockholm' });
  const startTime = session?.start_time ? String(session.start_time).slice(0, 5) : '';
  const dayTime = [occurrence.setLocale('sv').toFormat('ccc'), startTime].filter(Boolean).join(' ');
  return `${session?.name || 'Pickla'} · ${dayTime}`;
}

function formatSek(amount: number) {
  const rounded = Math.round(Number(amount || 0) * 100) / 100;
  return `${rounded.toLocaleString('sv-SE', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function ogDescriptionForActivity(registrationsCount: number, hosts: any[] = [], scarcity?: any) {
  const earlyBird = scarcity?.early_bird || {};
  if (earlyBird.active && Number(earlyBird.remaining || 0) > 0 && Number(earlyBird.price_sek || 0) > 0) {
    return `Tidigt pris ${formatSek(Number(earlyBird.price_sek || 0))} · ${Number(earlyBird.remaining || 0)} kvar just nu — häng på!`;
  }
  if (scarcity?.mode === 'capacity' && scarcity?.capacity_active) {
    return `${Number(scarcity.registrations_count || registrationsCount || 0)} anmälda · ${Number(scarcity.capacity_remaining || 0)} platser kvar — häng på!`;
  }
  const hostFirstName = String(hosts?.[0]?.first_name || '').trim();
  if (hostFirstName) {
    return `${hostFirstName}s pass — boka plats!`;
  }
  // TODO(presence-consent): named visibility pending presence settings.
  return registrationsCount >= 3
    ? `${registrationsCount} spelare är med. Boka plats!`
    : 'Plats för fler — boka plats!';
}

function activityOgHtml({
  title,
  description,
  canonicalUrl,
  imageUrl,
}: {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeUrl = escapeHtml(canonicalUrl);
  const safeImage = escapeHtml(imageUrl);
  return `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <link rel="canonical" href="${safeUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pickla" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safeUrl}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:image:width" content="1216" />
    <meta property="og:image:height" content="640" />
    <meta property="og:locale" content="sv_SE" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImage}" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <p><a href="${safeUrl}">Öppna passet på Pickla</a></p>
    </main>
  </body>
</html>`;
}

function safePreviewMessage(message: any) {
  const metadata = message?.metadata || {};
  if (metadata?.channel === 'email') return null;
  if (metadata?.type === 'image' || metadata?.type === 'gif') return null;
  if (!['text', 'bot'].includes(message?.message_type)) return null;

  const content = String(message?.content || '').trim();
  if (!content) return null;
  if (/@/.test(content) || /\+?\d[\d\s-]{6,}/.test(content)) return null;

  return {
    id: message.id,
    room_id: message.room_id,
    user_id: null,
    message_type: message.message_type,
    content: content.length > 240 ? `${content.slice(0, 240)}...` : content,
    metadata: {},
    created_at: message.created_at,
  };
}

async function buildActivityPreview(client: any, {
  roomId,
  sessionId,
  date,
  venueSlug,
  includeChatPreview = false,
  timings,
}: {
  roomId?: string | null;
  sessionId?: string | null;
  date?: string | null;
  venueSlug?: string | null;
  includeChatPreview?: boolean;
  timings?: Record<string, number>;
}) {
  let room: any = null;
  let resolvedSessionId = sessionId || null;
  let occurrenceDate = date || null;

  if (roomId) {
    const { data: roomRow, error: roomErr } = await client.from('chat_rooms')
      .select('id, venue_id, room_type, title, subtitle, emoji, resource_id, is_public, session_date, updated_at, venues(id, slug, is_public)')
      .eq('id', roomId)
      .maybeSingle();
    if (roomErr || !roomRow) throw new Error('Activity room not found');
    if (roomRow.room_type !== 'event' || roomRow.is_public !== true || !String(roomRow.resource_id || '').startsWith('activity_session:')) {
      throw new Error('Activity room not public');
    }
    if (roomRow.venues?.is_public !== true) throw new Error('Venue not public');
    if (venueSlug && roomRow.venues?.slug !== venueSlug) throw new Error('Venue mismatch');
    room = roomRow;

    const match = String(roomRow.resource_id || '').match(/^activity_session:([^:]+):([^:]+)$/);
    resolvedSessionId = match?.[1] || null;
    occurrenceDate = match?.[2] && match[2] !== 'next' ? match[2] : null;
  }

  if (!resolvedSessionId) throw new Error('Missing sessionId');

  const sessionStartedAt = performance.now();
  const sessionQuery = client.from('activity_sessions')
    .select('id, venue_id, name, session_type, session_date, recurrence_days, start_time, end_time, capacity, price_sek, product_key, access_policy, metadata, early_bird_price_minor, early_bird_slots, scarcity_mode, is_active, publish_status, activity_series(id, name, series_type), venues(id, slug, name, is_public)')
    .eq('id', resolvedSessionId)
    .maybeSingle();
  const { data: session, error: sessionErr } = await sessionQuery;
  if (timings) timings.sessionLookupMs = Math.round(performance.now() - sessionStartedAt);
  if (sessionErr || !session) throw new Error('Activity session not found');
  if (session.is_active !== true || session.publish_status !== 'published') throw new Error('Activity session is not public');
  if (session.venues?.is_public !== true) throw new Error('Venue not public');
  if (venueSlug && session.venues?.slug !== venueSlug) throw new Error('Venue mismatch');

  const occurrence = nextActivityOccurrence(session, occurrenceDate);
  occurrenceDate = occurrence.toISODate();
  const override = await activityOccurrenceOverride(client, session.venue_id, session.id, occurrenceDate);
  if (override?.status === 'hidden' || override?.status === 'cancelled') {
    throw new Error('Activity occurrence is not available');
  }
  const resourceId = activityResourceId(session.id, occurrenceDate);

  if (!room && includeChatPreview) {
    const { data: existingRoom } = await client.from('chat_rooms')
      .select('id, venue_id, room_type, title, subtitle, emoji, resource_id, is_public, session_date, updated_at')
      .eq('resource_id', resourceId)
      .eq('room_type', 'event')
      .maybeSingle();

    if (existingRoom?.id) {
      room = existingRoom;
    }
  }

  const messagesResult = await (includeChatPreview && room?.id
      ? client.from('chat_messages')
        .select('id, room_id, user_id, message_type, content, metadata, created_at')
        .eq('room_id', room.id)
        .in('message_type', ['text', 'bot'])
        .order('created_at', { ascending: false })
        .limit(12)
      : Promise.resolve({ data: [] }));

  const messages = (messagesResult.data || [])
    .map(safePreviewMessage)
    .filter(Boolean)
    .reverse()
    .slice(-6);
  const hosts = await publicActivitySessionHosts(client, [session.id]);

  return {
    room,
    activity_session: {
      id: session.id,
      venue_id: session.venue_id,
      name: session.name,
      session_type: session.session_type,
      session_date: session.session_date,
      recurrence_days: session.recurrence_days,
      start_time: session.start_time,
      end_time: session.end_time,
      capacity: session.capacity,
      price_sek: session.price_sek,
      product_key: session.product_key,
      access_policy: session.access_policy,
      metadata: session.metadata,
      early_bird_price_minor: session.early_bird_price_minor,
      early_bird_slots: session.early_bird_slots,
      scarcity_mode: session.scarcity_mode,
      occurrence_date: occurrenceDate,
      activity_series: session.activity_series,
      venue_slug: session.venues?.slug || null,
      hosts: hosts.filter((host) => host.activity_session_id === session.id),
    },
    registrations: { count: 0 },
    messages,
  };
}

async function publicActivitySessionHosts(client: any, sessionIds: string[]) {
  const cleanIds = [...new Set(sessionIds.filter(Boolean))];
  if (!cleanIds.length) return [];
  // Host first name is public because host assignment is an explicit public-facing role.
  const { data, error } = await client.rpc('get_public_activity_session_hosts', { session_ids: cleanIds });
  if (error) {
    console.error('public host lookup failed', error.message);
    return [];
  }
  return data || [];
}

async function activityRegistrationCount(client: any, activitySessionId: string, sessionDate: string) {
  const { count } = await client.from('session_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('activity_session_id', activitySessionId)
    .eq('session_date', sessionDate)
    .not('status', 'in', '("cancelled","refunded")');
  return count || 0;
}

async function activityOccurrenceOverride(client: any, venueId: string, activitySessionId: string, sessionDate: string) {
  const { data, error } = await client.from('activity_session_overrides')
    .select('id, status, reason')
    .eq('venue_id', venueId)
    .eq('activity_session_id', activitySessionId)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function activityInterestState(client: any, {
  activitySessionId,
  sessionDate,
  userId,
}: {
  activitySessionId: string;
  sessionDate: string;
  userId?: string | null;
}) {
  const [{ count }, ownResult] = await Promise.all([
    client.from('activity_session_interests')
      .select('id', { count: 'exact', head: true })
      .eq('activity_session_id', activitySessionId)
      .eq('session_date', sessionDate)
      .eq('status', 'interested'),
    userId
      ? client.from('activity_session_interests')
          .select('id')
          .eq('activity_session_id', activitySessionId)
          .eq('session_date', sessionDate)
          .eq('user_id', userId)
          .eq('status', 'interested')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    interested_count: count || 0,
    user_is_interested: Boolean((ownResult as any)?.data?.id),
  };
}

async function activitySocialProof(client: any, {
  venueSlug,
  sessionIds,
  startDate,
  endDate,
  userId,
}: {
  venueSlug?: string | null;
  sessionIds: string[];
  startDate: string;
  endDate: string;
  userId?: string | null;
}) {
  const cleanSessionIds = [...new Set(sessionIds.filter(Boolean))];
  if (!venueSlug) throw new Error('Missing venueSlug');
  if (!startDate || !endDate) throw new Error('Missing date range');
  if (!cleanSessionIds.length) return { occurrences: [] };

  const { data: venue, error: venueErr } = await client.from('venues')
    .select('id, slug, is_public')
    .eq('slug', venueSlug)
    .maybeSingle();
  if (venueErr || !venue?.id || venue.is_public !== true) throw new Error('Venue not public');

  const { data: sessions, error: sessionsErr } = await client.from('activity_sessions')
    .select('id')
    .eq('venue_id', venue.id)
    .eq('is_active', true)
    .eq('publish_status', 'published')
    .in('id', cleanSessionIds);
  if (sessionsErr) throw sessionsErr;

  const allowedIds = new Set((sessions || []).map((session: any) => session.id));
  if (!allowedIds.size) return { occurrences: [] };
  const allowedSessionIds = cleanSessionIds.filter((id) => allowedIds.has(id));

  const [registrationsResult, interestsResult] = await Promise.all([
    client.from('session_registrations')
      .select('activity_session_id, session_date, status, user_id')
      .in('activity_session_id', allowedSessionIds)
      .gte('session_date', startDate)
      .lte('session_date', endDate),
    client.from('activity_session_interests')
      .select('activity_session_id, session_date, status, user_id')
      .in('activity_session_id', allowedSessionIds)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .eq('status', 'interested'),
  ]);

  if (registrationsResult.error) throw registrationsResult.error;
  if (interestsResult.error) throw interestsResult.error;

  const byKey = new Map<string, {
    activity_session_id: string;
    session_date: string;
    registrations_count: number;
    interested_count: number;
    user_is_interested: boolean;
  }>();
  const getRow = (activitySessionId: string, sessionDate: string) => {
    const key = `${activitySessionId}:${sessionDate}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const row = {
      activity_session_id: activitySessionId,
      session_date: sessionDate,
      registrations_count: 0,
      interested_count: 0,
      user_is_interested: false,
    };
    byKey.set(key, row);
    return row;
  };

  for (const row of registrationsResult.data || []) {
    if (row.status === 'cancelled' || row.status === 'refunded') continue;
    getRow(row.activity_session_id, row.session_date).registrations_count += 1;
  }

  for (const row of interestsResult.data || []) {
    const proof = getRow(row.activity_session_id, row.session_date);
    proof.interested_count += 1;
    if (userId && row.user_id === userId) proof.user_is_interested = true;
  }

  return { occurrences: Array.from(byKey.values()) };
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

      let fetchError: string | null = null;
      let email = event?.data || {};
      try {
        email = {
          ...email,
          ...await fetchReceivedEmail(emailId),
        };
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
        console.error('Received email fetch failed, using webhook payload fallback:', fetchError);
      }
      const eventId = findEventIdFromInbound(email);
      if (!eventId) return errorResponse('Could not route inbound email', 404);

      const { data: eventRow, error: eventErr } = await client.from('events')
        .select('id, venue_id, customer_email')
        .eq('id', eventId)
        .maybeSingle();
      if (eventErr || !eventRow) return errorResponse('Event not found', 404);

      const { data: eventLead } = await client.from('event_leads')
        .select('id, venue_id, status, contact_name, email')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: room } = await client.from('chat_rooms')
        .select('id')
        .eq('resource_id', eventId)
        .eq('room_type', 'event')
        .maybeSingle();

      const textBody = inboundTextBody(email);
      const content = textBody.length > 4000 ? `${textBody.slice(0, 4000)}...` : textBody;
      const fromEmail = emailAddressField(email?.from || event?.data?.from) || null;
      const subject = email?.subject || event?.data?.subject || null;
      const toEmail = collectEmailAddresses(email?.to, email?.recipient, email?.recipients).join(', ') || null;

      const { data: communication, error: commErr } = await client.from('event_communications')
        .insert({
          event_id: eventId,
          room_id: room?.id || null,
          direction: 'inbound',
          channel: 'email',
          from_email: fromEmail,
          to_email: toEmail,
          subject,
          body_text: textBody || null,
          body_html: email?.html || email?.html_body || email?.body_html || email?.body?.html || null,
          provider: 'resend',
          provider_message_id: emailId,
          provider_event_id: providerEventId,
          status: 'received',
          metadata: {
            message_id: email?.message_id || event?.data?.message_id || null,
            cc: email?.cc || [],
            attachments: email?.attachments || [],
            event_lead_id: eventLead?.id || null,
            used_webhook_payload_fallback: !!fetchError,
            fetch_error: fetchError,
          },
        })
        .select('id')
        .single();

      if (commErr) {
        if (commErr.code === '23505') return jsonResponse({ success: true, duplicate: true });
        return errorResponse(commErr.message, 500);
      }

      if (eventLead?.id) {
        if (!['booking_confirmed', 'lost', 'won'].includes(eventLead.status)) {
          await client.from('event_leads').update({ status: 'customer_replied' }).eq('id', eventLead.id);
        }
        await client.from('event_lead_activities').insert({
          venue_id: eventLead.venue_id || eventRow.venue_id,
          event_lead_id: eventLead.id,
          activity_type: 'customer_reply_received',
          title: 'Customer replied',
          body: content || subject || 'Kunden svarade på mail.',
          metadata: {
            event_id: eventId,
            communication_id: communication.id,
            from: fromEmail,
            subject,
          },
        });
      }

      if (room?.id) {
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
            event_lead_id: eventLead?.id || null,
            from: fromEmail,
            subject,
          },
        });
      }

      return jsonResponse({ success: true, communication_id: communication.id, event_lead_id: eventLead?.id || null, mirrored_to_chat: !!room?.id });
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

    // GET /api-event-public/activity-og?sessionId=X&date=YYYY-MM-DD&v=venue-slug — bot-safe OG HTML
    if (req.method === 'GET' && path === 'activity-og') {
      const sessionId = String(url.searchParams.get('sessionId') || url.searchParams.get('id') || '').trim();
      const sessionDate = String(url.searchParams.get('date') || '').trim() || null;
      const venueSlug = String(url.searchParams.get('venueSlug') || url.searchParams.get('v') || '').trim() || null;
      if (!sessionId) return errorResponse('Missing sessionId', 400);

      const browserPath = programSessionPath(sessionId, sessionDate, venueSlug);
      if (!isLinkPreviewBot(req.headers.get('User-Agent'))) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: browserPath,
            'Cache-Control': 'no-store',
          },
        });
      }

      try {
        const preview = await buildActivityPreview(client, {
          sessionId,
          date: sessionDate,
          venueSlug,
        });
        const registrationCount = await activityRegistrationCount(
          client,
          preview.activity_session.id,
          preview.activity_session.occurrence_date,
        );
        const activityTicketPricing = await resolveActivityPricingDecision({
          client,
          venueId: preview.activity_session.venue_id,
          userId: null,
          activitySessionId: preview.activity_session.id,
          sessionDate: preview.activity_session.occurrence_date,
          requestedProductKey: preview.activity_session.product_key,
          requestedAmountSek: preview.activity_session.price_sek,
          purchaseKind: 'activity_ticket',
          session: preview.activity_session,
        });
        const scarcity = activityTicketPricing.debug?.scarcity || null;
        const origin = publicSiteOrigin(req);
        const canonicalPath = publicPassPath(preview.activity_session.id, preview.activity_session.occurrence_date, preview.activity_session.venue_slug || venueSlug);
        const canonicalUrl = `${origin}${canonicalPath}`;
        const imageUrl = `${origin}/og-pickla.jpg`;
        const html = activityOgHtml({
          title: ogTitleForActivity(preview.activity_session, preview.activity_session.occurrence_date),
          description: ogDescriptionForActivity(registrationCount, preview.activity_session.hosts || [], scarcity),
          canonicalUrl,
          imageUrl,
        });
        return new Response(new Blob([html], { type: 'text/html; charset=utf-8' }), {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120',
          },
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Activity OG preview not found', 404);
      }
    }

    // GET /api-event-public/activity-preview?id=X — public activity info
    if (req.method === 'GET' && path === 'activity-preview') {
      try {
        const totalStartedAt = performance.now();
        const timings: Record<string, number> = {};
        const userStartedAt = performance.now();
        const userId = await getOptionalUserId(req);
        timings.authMs = Math.round(performance.now() - userStartedAt);
        const preview = await buildActivityPreview(client, {
          roomId: url.searchParams.get('roomId'),
          sessionId: url.searchParams.get('sessionId'),
          date: url.searchParams.get('date'),
          venueSlug: url.searchParams.get('venueSlug') || url.searchParams.get('v'),
          includeChatPreview: !!url.searchParams.get('roomId'),
          timings,
        });
        const productCache = new Map<string, Promise<any>>();
        const socialProofPromise = (async () => {
          const socialProofStartedAt = performance.now();
          const [registrationCount, interests] = await Promise.all([
            activityRegistrationCount(client, preview.activity_session.id, preview.activity_session.occurrence_date),
            activityInterestState(client, {
              activitySessionId: preview.activity_session.id,
              sessionDate: preview.activity_session.occurrence_date,
              userId,
            }),
          ]);
          timings.socialProofMs = Math.round(performance.now() - socialProofStartedAt);
          return { registrationCount, interests };
        })();
        const pricingPromise = (async () => {
          const pricingStartedAt = performance.now();
          const [activityTicketPricing, dayPassPricing] = await Promise.all([
            resolveActivityPricingDecision({
              client,
              venueId: preview.activity_session.venue_id,
              userId,
              activitySessionId: preview.activity_session.id,
              sessionDate: preview.activity_session.occurrence_date,
              requestedProductKey: preview.activity_session.product_key,
              requestedAmountSek: preview.activity_session.price_sek,
              purchaseKind: 'activity_ticket',
              session: preview.activity_session,
              productCache,
            }),
            resolveActivityPricingDecision({
              client,
              venueId: preview.activity_session.venue_id,
              userId,
              activitySessionId: preview.activity_session.id,
              sessionDate: preview.activity_session.occurrence_date,
              requestedProductKey: 'day_access',
              requestedAmountSek: null,
              purchaseKind: 'day_pass',
              session: preview.activity_session,
              productCache,
            }),
          ]);
          timings.pricingMs = Math.round(performance.now() - pricingStartedAt);
          return { activityTicketPricing, dayPassPricing };
        })();
        const [
          { registrationCount, interests },
          { activityTicketPricing, dayPassPricing },
        ] = await Promise.all([socialProofPromise, pricingPromise]);
        const upgradeDeltaSek = Math.max(0, Number(dayPassPricing.effectivePriceSek || 0) - Number(activityTicketPricing.effectivePriceSek || 0));
        const recommendedOption = activityTicketPricing.requiresCheckout === false
          ? 'activity_ticket'
          : upgradeDeltaSek > 0 && upgradeDeltaSek <= 40
          ? 'day_pass'
          : 'activity_ticket';
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        if (supabaseUrl.includes('ptnvhbniiiapzbyofctg')) {
          timings.totalMs = Math.round(performance.now() - totalStartedAt);
          console.log('activity-preview-timing', {
            userId: userId || null,
            membershipTier: activityTicketPricing.membershipTierName,
            activitySessionId: activityTicketPricing.activitySessionId,
            sessionDate: activityTicketPricing.sessionDate,
            pricingBranch: activityTicketPricing.pricingReason,
            activityTicketPriceSek: activityTicketPricing.effectivePriceSek,
            dayPassPriceSek: dayPassPricing.effectivePriceSek,
            recommendedOption,
            timings,
          });
        }
        preview.interests = interests;
        preview.registrations = { count: registrationCount };
        preview.activityTicketPricing = activityTicketPricing;
        preview.dayPassPricing = dayPassPricing;
        preview.scarcity = activityTicketPricing.debug?.scarcity || null;
        preview.recommendedOption = recommendedOption;
        preview.upgradeDeltaSek = upgradeDeltaSek;
        preview.pricing = activityTicketPricing;
        return jsonResponse(preview, 200, userId ? 0 : 5);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Activity preview not found', 404);
      }
    }

    // GET /api-event-public/activity-social-proof — public aggregated counts per activity occurrence
    if (req.method === 'GET' && path === 'activity-social-proof') {
      try {
        const userId = await getOptionalUserId(req);
        const sessionIds = (url.searchParams.get('sessionIds') || '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        const result = await activitySocialProof(client, {
          venueSlug: url.searchParams.get('venueSlug') || url.searchParams.get('v'),
          sessionIds,
          startDate: String(url.searchParams.get('startDate') || ''),
          endDate: String(url.searchParams.get('endDate') || ''),
          userId,
        });
        return jsonResponse(result, 200, 5);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Could not load activity social proof', 404);
      }
    }

    // POST /api-event-public/activity-interest — toggle interest for a public activity occurrence
    if (req.method === 'POST' && path === 'activity-interest') {
      const { userId, error: authError } = await getAuthenticatedClient(req);
      if (authError || !userId) return errorResponse(authError || 'Unauthorized', 401);

      const body = await req.json();
      const sessionId = String(body.sessionId || body.activity_session_id || '').trim();
      const sessionDate = String(body.date || body.session_date || '').trim();
      const venueSlug = String(body.venueSlug || body.v || '').trim();
      if (!sessionId) return errorResponse('Missing sessionId');
      if (!sessionDate) return errorResponse('Missing session_date');

      let preview: any;
      try {
        preview = await buildActivityPreview(client, {
          sessionId,
          date: sessionDate,
          venueSlug,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Activity session not found', 404);
      }

      const activitySessionId = preview.activity_session.id;
      const occurrenceDate = preview.activity_session.occurrence_date;
      const venueId = preview.activity_session.venue_id;

      const { data: existing } = await client.from('activity_session_interests')
        .select('id')
        .eq('user_id', userId)
        .eq('activity_session_id', activitySessionId)
        .eq('session_date', occurrenceDate)
        .maybeSingle();

      let interested = false;
      if (existing?.id) {
        await client.from('activity_session_interests')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', userId);
      } else {
        const { error: insertErr } = await client.from('activity_session_interests')
          .insert({
            user_id: userId,
            activity_session_id: activitySessionId,
            session_date: occurrenceDate,
            venue_id: venueId,
            status: 'interested',
          });
        if (insertErr && insertErr.code !== '23505') return errorResponse(insertErr.message, 500);
        interested = true;

        if (preview.room?.id) {
          const { data: profile } = await client.from('player_profiles')
            .select('display_name, first_name')
            .eq('auth_user_id', userId)
            .maybeSingle();
          const name = profile?.display_name || profile?.first_name || 'En spelare';
          await client.from('chat_messages').insert({
            room_id: preview.room.id,
            user_id: userId,
            message_type: 'bot',
            content: `${name} är intresserad`,
            metadata: {
              type: 'interest',
              activity_session_id: activitySessionId,
              session_date: occurrenceDate,
            },
          });
        }
      }

      const state = await activityInterestState(client, {
        activitySessionId,
        sessionDate: occurrenceDate,
        userId,
      });

      return jsonResponse({
        success: true,
        interested,
        ...state,
      });
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

      const leadInput = sanitizeLeadInput({
        venueId: venue.id,
        company_name: normalizedType === 'company' || normalizedType === 'team' ? cleanName : null,
        contact_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        participants_count: participantCount,
        preferred_date: requestedDate,
        preferred_time: timeLabel,
        event_type: normalizedType,
        activities: selectedActivities,
        resources: selectedResources,
        message: cleanNotes,
        source: 'public_group_inquiry',
      });
      const leadScore = scoreLead(leadInput);
      const suggestedPackage = choosePackage(leadInput);
      const estimatedValue = estimateValue(leadInput, suggestedPackage);

      const { data: eventLead, error: leadErr } = await client.from('event_leads').insert({
        venue_id: venue.id,
        event_id: event.id,
        company_name: leadInput.companyName,
        contact_name: leadInput.contactName,
        email: leadInput.email,
        phone: leadInput.phone,
        participants_count: leadInput.participants,
        preferred_date: leadInput.preferredDate,
        preferred_time: leadInput.preferredTime,
        event_type: leadInput.eventType,
        activities: leadInput.activities,
        resources: leadInput.resources,
        message: leadInput.message,
        source: leadInput.source,
        lead_score: leadScore,
        status: 'new_event_lead',
        package_type: suggestedPackage.key,
        estimated_value: estimatedValue,
        agent_summary: leadSummary(leadInput, suggestedPackage),
      }).select('*').single();

      if (leadErr) return errorResponse(leadErr.message, 500);

      await client.from('event_lead_activities').insert(leadActivity({
        lead: eventLead,
        type: 'lead_created',
        title: 'Lead created',
        body: `${leadInput.contactName} skickade en gruppförfrågan.`,
        metadata: { source: leadInput.source, package_type: suggestedPackage.key, lead_score: leadScore },
      }));

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

      return jsonResponse({ success: true, event_id: event.id, lead_id: eventLead.id, room_id: roomId }, 201);
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
