import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient } from '../_shared/auth.ts';
import { auditMutation, requireSuperAdmin, requireVenueRole, writeAuditLog } from '../_shared/authorization.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const ZETTLE_OAUTH_BASE_URL = 'https://oauth.zettle.com';
const ZETTLE_PURCHASE_BASE_URL = 'https://purchase.izettle.com';
const ZETTLE_SCOPES = ['READ:PURCHASE'];

const NON_AUDITED_ADMIN_POSTS = new Set(['venue-operation-impact']);
const SENSITIVE_AUDIT_KEYS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'password',
  'client_secret',
  'api_key',
]);

function adminEntityTableForPath(path: string) {
  const map: Record<string, string> = {
    venues: 'venues',
    venue: 'venues',
    staff: 'venue_staff',
    courts: 'venue_courts',
    'venue-operation-overrides': 'venue_operation_overrides',
    'activity-session-overrides': 'activity_session_overrides',
    'resource-blocks': 'event_resource_blocks',
    'display-devices': 'display_devices',
    hours: 'opening_hours',
    pricing: 'pricing_rules',
    products: 'access_products',
    'activity-series': 'activity_series',
    'activity-sessions': 'activity_sessions',
    links: 'venue_links',
    'event-categories': 'venue_event_categories',
    'zettle-connect': 'zettle_connections',
    'zettle-import': 'zettle_purchases',
  };
  return map[path] || path || 'api_admin';
}

function adminEntityIdFromRequest(path: string, method: string, body: Record<string, any>, url: URL) {
  if (path === 'venues' && method === 'POST') return body.slug || null;
  if (path === 'venue') return body.id || url.searchParams.get('venueId') || null;
  if (path === 'staff') return body.staffId || url.searchParams.get('staffId');
  if (path === 'courts') return body.courtId || url.searchParams.get('courtId');
  if (path === 'venue-operation-overrides') return body.overrideId || body.id || null;
  if (path === 'activity-session-overrides') return body.activity_session_id || body.activitySessionId || null;
  if (path === 'resource-blocks') return body.blockId || body.id || url.searchParams.get('blockId') || url.searchParams.get('blockIds');
  if (path === 'display-devices') return body.deviceId || body.id || url.searchParams.get('deviceId');
  if (path === 'hours') return body.dayOfWeek || body.day_of_week || null;
  if (path === 'pricing') return body.ruleId || url.searchParams.get('ruleId');
  if (path === 'products') return body.productId || body.product_key || url.searchParams.get('productId');
  if (path === 'activity-series') return body.seriesId || url.searchParams.get('seriesId');
  if (path === 'activity-sessions') return body.sessionId || url.searchParams.get('sessionId');
  if (path === 'links') return body.linkId || url.searchParams.get('linkId');
  if (path === 'event-categories') return body.id || body.categoryKey || url.searchParams.get('id');
  if (path === 'zettle-import') return body.date || null;
  return body.id || null;
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    sanitized[key] = SENSITIVE_AUDIT_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password')
      ? '[redacted]'
      : sanitizeAuditValue(nestedValue);
  }
  return sanitized;
}

async function isAdmin(userId: string): Promise<{ ok: boolean; venueId: string | null }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Check super_admin
  const { data: superRole } = await admin.from('user_roles')
    .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
  if (superRole) {
    const { data: vs } = await admin.from('venue_staff').select('venue_id').eq('user_id', userId).limit(1).maybeSingle();
    return { ok: true, venueId: vs?.venue_id || null };
  }

  // Check venue_admin
  const { data: vs } = await admin.from('venue_staff')
    .select('venue_id').eq('user_id', userId).eq('role', 'venue_admin').eq('is_active', true).limit(1).maybeSingle();
  if (vs) return { ok: true, venueId: vs.venue_id };

  return { ok: false, venueId: null };
}

type SoldAs = 'activity_ticket' | 'day_pass' | 'included_only';

function productKeyForActivityTicket(sessionType: string) {
  if (sessionType === 'group_training') return 'group_training';
  return 'open_play_slot';
}

function normalizeActivitySessionPayload(body: Record<string, any>) {
  const next = { ...body };
  const soldAs = String(next.sold_as || next.access_policy?.sold_as || '') as SoldAs | '';
  const sessionType = String(next.session_type || 'open_play');
  delete next.sold_as;
  delete next.included_in_day_pass;
  delete next.included_in_unlimited;

  if (soldAs) {
    if (!['activity_ticket', 'day_pass', 'included_only'].includes(soldAs)) {
      throw new Error('Invalid sold_as');
    }
    next.product_key = soldAs === 'day_pass'
      ? 'day_access'
      : soldAs === 'included_only'
      ? null
      : productKeyForActivityTicket(sessionType);

    const policy = next.access_policy && typeof next.access_policy === 'object' ? next.access_policy : {};
    next.access_policy = {
      ...policy,
      allows_day_access: soldAs === 'day_pass' ? true : Boolean(policy.allows_day_access),
      includes_day_access: soldAs === 'day_pass',
      sold_as: soldAs,
    };
  }

  const publishStatus = String(next.publish_status || 'published');
  const isPublished = publishStatus === 'published' && next.is_active !== false;
  const productKey = next.product_key || null;
  const price = Number(next.price_sek || 0);
  const capacity = next.capacity == null || next.capacity === '' ? null : Number(next.capacity);

  if (productKey && !['open_play_slot', 'group_training', 'day_access', 'event_fee'].includes(String(productKey))) {
    throw new Error(`Unknown product_key for schedule session: ${productKey}`);
  }
  if (isPublished && productKey !== null && capacity !== null && capacity <= 0) {
    throw new Error('Published paid sessions need capacity');
  }
  if (isPublished && productKey !== null && capacity === null) {
    throw new Error('Published paid sessions need capacity');
  }
  if (isPublished && productKey !== null && productKey !== 'day_access' && price <= 0) {
    throw new Error('Published activity tickets need price');
  }
  if (productKey === 'day_access' && ['open_play', 'club_night', 'pickla_open'].includes(sessionType) && soldAs !== 'day_pass') {
    throw new Error('Open Play schedule sessions must be sold as activity_ticket, not day_access');
  }

  return next;
}

function stockholmBlockRange(date: string, startTime: string, endTime: string) {
  const cleanDate = String(date || '').slice(0, 10);
  const cleanStart = String(startTime || '').slice(0, 5);
  const cleanEnd = String(endTime || '').slice(0, 5);
  if (!cleanDate || !cleanStart || !cleanEnd) throw new Error('Missing date/time');
  const startsAt = DateTime.fromISO(`${cleanDate}T${cleanStart}:00`, { zone: 'Europe/Stockholm' });
  const endsAt = DateTime.fromISO(`${cleanDate}T${cleanEnd}:00`, { zone: 'Europe/Stockholm' });
  if (!startsAt.isValid || !endsAt.isValid || endsAt <= startsAt) throw new Error('Invalid date/time');
  return {
    starts_at: startsAt.toUTC().toISO(),
    ends_at: endsAt.toUTC().toISO(),
  };
}

function stockholmDayRangeUtc(date: string) {
  const day = DateTime.fromISO(String(date || '').slice(0, 10), { zone: 'Europe/Stockholm' });
  if (!day.isValid) throw new Error('Invalid date');
  return {
    start: day.startOf('day').toUTC().toISO(),
    end: day.plus({ days: 1 }).startOf('day').toUTC().toISO(),
  };
}

function stockholmToday() {
  return DateTime.now().setZone('Europe/Stockholm').toISODate()!;
}

function localAccountingDateFromIso(value: string) {
  const parsed = DateTime.fromISO(value, { zone: 'utc' }).setZone('Europe/Stockholm');
  return parsed.isValid ? parsed.toISODate()! : stockholmToday();
}

function zettleConfig() {
  return {
    clientId: Deno.env.get('ZETTLE_CLIENT_ID') || '',
    clientSecret: Deno.env.get('ZETTLE_CLIENT_SECRET') || '',
    apiKey: Deno.env.get('ZETTLE_API_KEY') || '',
    redirectUri: Deno.env.get('ZETTLE_REDIRECT_URI') || '',
  };
}

function zettleAuthMode() {
  const { clientId, clientSecret, apiKey } = zettleConfig();
  if (clientId && apiKey) return 'api_key';
  if (clientId && clientSecret) return 'oauth';
  return 'unconfigured';
}

function zettleRedirectUri(supabaseUrl: string) {
  const configured = zettleConfig().redirectUri;
  if (configured) return configured;
  return `${supabaseUrl}/functions/v1/api-admin/zettle-callback`;
}

function safeReturnUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return 'https://playpickla.com/hub/admin';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'https://playpickla.com/hub/admin';
    return parsed.toString();
  } catch (_error) {
    return 'https://playpickla.com/hub/admin';
  }
}

function zettleStatusFromPurchase(purchase: any) {
  if (purchase.refunded === true || purchase.refund === true) return 'refunded';
  if (purchase.refundedAmount || purchase.refundAmount) return 'partially_refunded';
  return 'paid';
}

function zettlePaymentMethod(purchase: any) {
  const methods = Array.isArray(purchase.payments)
    ? purchase.payments.map((payment: any) => String(payment.type || payment.paymentType || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set(methods)).join(', ') || 'zettle';
}

function zettlePurchaseUuid(purchase: any) {
  return String(purchase.purchaseUUID || purchase.purchaseUuid || purchase.uuid || purchase.purchaseUuid1 || '').trim();
}

function zettlePurchaseNumber(purchase: any) {
  return String(purchase.purchaseNumber || purchase.globalPurchaseNumber || purchase.receiptNumber || '').trim() || null;
}

function zettleOccurredAt(purchase: any) {
  const raw = String(purchase.timestamp || purchase.created || purchase.createdAt || '').trim();
  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  return parsed.isValid ? parsed.toUTC().toISO()! : DateTime.now().toUTC().toISO()!;
}

async function exchangeZettleToken(params: Record<string, string>) {
  const { clientId, clientSecret } = zettleConfig();
  if (!clientId) throw new Error('Zettle is not configured. Missing ZETTLE_CLIENT_ID.');
  if (!clientSecret && params.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    throw new Error('Zettle OAuth is not configured. Missing ZETTLE_CLIENT_SECRET.');
  }

  const body = new URLSearchParams({
    ...params,
    client_id: clientId,
  });
  if (clientSecret && params.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    body.set('client_secret', clientSecret);
  }
  const response = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `Zettle token request failed (${response.status})`);
  }
  return json;
}

async function zettleApiKeyAccessToken() {
  const { apiKey } = zettleConfig();
  if (!apiKey) throw new Error('Zettle API key is not configured. Missing ZETTLE_API_KEY.');
  const token = await exchangeZettleToken({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: apiKey,
  });
  return token.access_token;
}

async function getZettleUserInfo(accessToken: string) {
  const response = await fetch(`${ZETTLE_OAUTH_BASE_URL}/users/self`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

async function validZettleAccessToken(admin: any, connection: any) {
  if (zettleAuthMode() === 'api_key') {
    return await zettleApiKeyAccessToken();
  }

  const expiresAt = connection.token_expires_at
    ? DateTime.fromISO(connection.token_expires_at, { zone: 'utc' })
    : null;
  if (connection.access_token && expiresAt?.isValid && expiresAt > DateTime.utc().plus({ minutes: 5 })) {
    return connection.access_token;
  }
  if (!connection.refresh_token) throw new Error('Zettle connection has no refresh token. Reconnect Zettle.');

  const token = await exchangeZettleToken({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
  });
  const tokenExpiresAt = DateTime.utc().plus({ seconds: Number(token.expires_in || 7200) }).toISO();
  const { error } = await admin
    .from('zettle_connections')
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token || connection.refresh_token,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
      last_import_error: null,
    })
    .eq('id', connection.id);
  if (error) throw new Error(error.message);
  return token.access_token;
}

async function fetchZettlePurchases(accessToken: string, startIso: string, endIso: string) {
  const purchases: any[] = [];
  let lastPurchaseHash: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${ZETTLE_PURCHASE_BASE_URL}/purchases/v2`);
    url.searchParams.set('startDate', startIso);
    url.searchParams.set('endDate', endIso);
    url.searchParams.set('limit', '100');
    url.searchParams.set('descending', 'false');
    if (lastPurchaseHash) url.searchParams.set('lastPurchaseHash', lastPurchaseHash);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json.message || json.error || `Zettle purchase import failed (${response.status})`);
    }
    const pageRows = Array.isArray(json.purchases) ? json.purchases : [];
    purchases.push(...pageRows);
    if (!pageRows.length || !json.lastPurchaseHash || json.lastPurchaseHash === lastPurchaseHash) break;
    lastPurchaseHash = json.lastPurchaseHash;
  }
  return purchases;
}

function zettleLedgerEntry(venueId: string, purchase: any) {
  const purchaseUuid = zettlePurchaseUuid(purchase);
  const occurredAt = zettleOccurredAt(purchase);
  const amount = Math.max(0, Math.round(Number(purchase.amount || purchase.totalAmount || 0)));
  const vat = Math.max(0, Math.round(Number(purchase.vatAmount || purchase.totalVatAmount || 0)));
  const paymentMethod = zettlePaymentMethod(purchase);
  return {
    venue_id: venueId,
    source_type: 'zettle',
    source_id: purchaseUuid,
    accounting_date: localAccountingDateFromIso(occurredAt),
    occurred_at: occurredAt,
    customer_name: null,
    amount_inc_vat_minor: amount,
    vat_amount_minor: vat,
    payment_status: zettleStatusFromPurchase(purchase),
    payment_method: paymentMethod,
    stripe_session_id: null,
    receipt_number: zettlePurchaseNumber(purchase),
    booking_receipt_id: null,
    metadata: {
      provider: 'zettle',
      currency: purchase.currency || purchase.currencyId || null,
      purchase_uuid: purchaseUuid,
      purchase_number: zettlePurchaseNumber(purchase),
      products: Array.isArray(purchase.products) ? purchase.products : [],
      payments: Array.isArray(purchase.payments) ? purchase.payments : [],
      raw: purchase,
    },
  };
}

function stockholmTimeFromIso(value: string | null | undefined) {
  if (!value) return null;
  const date = DateTime.fromISO(value, { zone: 'utc' }).setZone('Europe/Stockholm');
  return date.isValid ? date.toFormat('HH:mm') : null;
}

function cleanTime(value: unknown) {
  return value ? String(value).slice(0, 5) : '';
}

function normalizeDateForResponse(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = DateTime.fromISO(raw, { zone: 'utc' });
  return parsed.isValid ? parsed.setZone('Europe/Stockholm').toISODate() : null;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function eventDisplayTitle(event: Record<string, any>) {
  return event.display_name || event.name || event.title || 'Event';
}

function createBlockRef() {
  const now = DateTime.now().setZone('Europe/Stockholm');
  const suffix = crypto.randomUUID().split('-')[0].toUpperCase();
  return `BLK-${now.toFormat('yyyy')}-${suffix}`;
}

function cleanBlockMetadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function operationRangeFromBody(body: Record<string, any>) {
  if (body.starts_at && body.ends_at) {
    const startsAt = DateTime.fromISO(String(body.starts_at));
    const endsAt = DateTime.fromISO(String(body.ends_at));
    if (!startsAt.isValid || !endsAt.isValid || endsAt <= startsAt) throw new Error('Invalid date/time');
    return {
      starts_at: startsAt.toUTC().toISO(),
      ends_at: endsAt.toUTC().toISO(),
    };
  }

  return stockholmBlockRange(body.date, body.start_time, body.end_time);
}

function normalizeOverrideType(value: unknown) {
  const overrideType = String(value || 'other');
  if (!['closed', 'maintenance', 'private_event', 'staffing', 'other'].includes(overrideType)) {
    throw new Error('Invalid override_type');
  }
  return overrideType;
}

function blockReasonForOverride(overrideType: string) {
  if (overrideType === 'maintenance') return 'maintenance';
  if (overrideType === 'private_event') return 'private';
  if (overrideType === 'staffing' || overrideType === 'closed') return 'internal';
  return 'manual';
}

function localDatesBetween(startsAtIso: string, endsAtIso: string) {
  const start = DateTime.fromISO(startsAtIso, { zone: 'utc' }).setZone('Europe/Stockholm').startOf('day');
  const end = DateTime.fromISO(endsAtIso, { zone: 'utc' }).setZone('Europe/Stockholm').startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];

  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 45) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

function localDateStringsBetween(startDate: string, endDate: string) {
  const start = DateTime.fromISO(String(startDate || '').slice(0, 10), { zone: 'Europe/Stockholm' }).startOf('day');
  const end = DateTime.fromISO(String(endDate || '').slice(0, 10), { zone: 'Europe/Stockholm' }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];

  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 14) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

function resourceForBlockRow(block: any) {
  const resource = block.event_resource_catalog;
  return Array.isArray(resource) ? resource[0] : resource;
}

function activityOverrideKey(activitySessionId: string, sessionDate: string) {
  return `${activitySessionId}:${sessionDate}`;
}

async function activityRegistrationCounts(admin: any, activitySessionIds: string[], startDate: string, endDate: string) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (!cleanIds.length || !startDate || !endDate) return counts;

  const { data, error } = await admin
    .from('session_registrations')
    .select('activity_session_id, session_date, status')
    .in('activity_session_id', cleanIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    if (row.status === 'cancelled') continue;
    const key = activityOverrideKey(row.activity_session_id, row.session_date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function activityCheckedInCounts(admin: any, venueId: string, activitySessionIds: string[], startDate: string, endDate: string) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (!cleanIds.length || !startDate || !endDate) return counts;

  const { data: registrations, error } = await admin
    .from('session_registrations')
    .select('id, activity_session_id, session_date, status')
    .eq('venue_id', venueId)
    .in('activity_session_id', cleanIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate)
    .neq('status', 'cancelled');
  if (error) throw new Error(error.message);

  const registrationIds = uniqueStrings((registrations || []).map((row: any) => row.id));
  if (!registrationIds.length) return counts;

  const { data: checkins, error: checkinError } = await admin
    .from('venue_checkins')
    .select('entitlement_id')
    .eq('venue_id', venueId)
    .in('entry_type', ['session_ticket', 'activity_registration'])
    .in('entitlement_id', registrationIds);
  if (checkinError) throw new Error(checkinError.message);

  const checkedRegistrationIds = new Set((checkins || []).map((row: any) => row.entitlement_id).filter(Boolean));
  for (const row of registrations || []) {
    if (row.status !== 'checked_in' && !checkedRegistrationIds.has(row.id)) continue;
    const key = activityOverrideKey(row.activity_session_id, row.session_date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

async function activityOverrideMap(admin: any, venueId: string, activitySessionIds: string[], startDate: string, endDate: string) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const overrides = new Map<string, any>();
  if (!cleanIds.length || !startDate || !endDate) return overrides;

  const { data, error } = await admin
    .from('activity_session_overrides')
    .select('id, activity_session_id, session_date, status, reason, venue_operation_override_id')
    .eq('venue_id', venueId)
    .in('activity_session_id', cleanIds)
    .gte('session_date', startDate)
    .lte('session_date', endDate);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    overrides.set(activityOverrideKey(row.activity_session_id, row.session_date), row);
  }
  return overrides;
}

function bookingGroupKey(row: any) {
  if (row.stripe_session_id) return `stripe:${row.stripe_session_id}`;
  if (row.access_code) return `code:${row.access_code}`;
  const notesKey = String(row.notes || row.booked_by || row.user_id || row.id).trim();
  if (notesKey && row.start_time && row.end_time) return `fallback:${row.start_time}:${row.end_time}:${notesKey}`;
  return `booking:${row.id}`;
}

function bookingNoteParts(notes?: string | null) {
  const parts = String(notes || '').split(' | ').map((part) => part.trim());
  return {
    name: parts[0] || null,
    phone: parts[1] || null,
    email: parts[2] || null,
  };
}

async function groupedCourtBookingItems(admin: any, venueId: string, startIso: string, endIso: string) {
  const { data: rows, error } = await admin
    .from('bookings')
    .select('id, booking_ref, stripe_session_id, access_code, venue_id, venue_court_id, customer_id, user_id, booked_by, notes, start_time, end_time, status, total_price, created_at, venue_courts(id, name, court_number, sport_type)')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .lt('start_time', endIso)
    .gt('end_time', startIso)
    .order('start_time', { ascending: true })
    .limit(800);
  if (error) throw new Error(error.message);
  const bookings = rows || [];
  if (!bookings.length) return [];

  const stripeIds = uniqueStrings(bookings.map((row: any) => row.stripe_session_id));
  const bookingIds = uniqueStrings(bookings.map((row: any) => row.id));
  const [receiptsResult, checkinsResult] = await Promise.all([
    stripeIds.length
      ? admin
        .from('booking_receipts')
        .select('id, customer_id, receipt_number, customer_name, customer_email, customer_phone, payment_method, payment_status, stripe_session_id, total_inc_vat_sek')
        .in('stripe_session_id', stripeIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin
        .from('venue_checkins')
        .select('id, entitlement_id, entry_type, player_name, checked_in_at, checked_out_at')
        .eq('venue_id', venueId)
        .in('entitlement_id', bookingIds)
        .is('checked_out_at', null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (receiptsResult.error) throw new Error(receiptsResult.error.message);
  if (checkinsResult.error) throw new Error(checkinsResult.error.message);

  const receiptByStripe = new Map((receiptsResult.data || []).map((receipt: any) => [receipt.stripe_session_id, receipt]));
  const checkinByBookingId = new Map((checkinsResult.data || []).map((checkin: any) => [checkin.entitlement_id, checkin]));
  const groups = new Map<string, any[]>();
  for (const row of bookings) {
    const key = bookingGroupKey(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([groupKey, groupRows]) => {
    groupRows.sort((a, b) => String(a.venue_courts?.name || '').localeCompare(String(b.venue_courts?.name || '')));
    const first = groupRows[0];
    const receipt = first.stripe_session_id ? receiptByStripe.get(first.stripe_session_id) : null;
    const noteParts = bookingNoteParts(first.notes);
    const starts = DateTime.fromISO(first.start_time, { zone: 'utc' }).setZone('Europe/Stockholm');
    const ends = DateTime.fromISO(first.end_time, { zone: 'utc' }).setZone('Europe/Stockholm');
    const amount = groupRows.reduce((sum: number, row: any) => sum + Number(row.total_price || 0), 0);
    const checkedRows = groupRows
      .map((row: any) => checkinByBookingId.get(row.id))
      .filter(Boolean);
    const courts = groupRows.map((row: any) => ({
      id: row.venue_court_id,
      name: row.venue_courts?.name || row.venue_court_id,
      court_number: row.venue_courts?.court_number || null,
      sport_type: row.venue_courts?.sport_type || null,
    }));
    const courtLabel = courts.map((court: any) => court.name).filter(Boolean).join(', ') || 'Bana';
    const customerName = receipt?.customer_name || noteParts.name || first.booked_by || 'Bokning';
    const paymentStatus = receipt?.payment_status
      || (amount <= 0 ? 'free' : first.stripe_session_id ? 'paid' : first.status === 'pending' ? 'pending' : 'unknown');

    return {
      id: `booking-${groupKey}`,
      source_id: first.id,
      source_ids: groupRows.map((row: any) => row.id),
      venue_id: first.venue_id || venueId,
      customer_id: receipt?.customer_id || first.customer_id || null,
      user_id: first.user_id || null,
      customer_user_id: first.user_id || null,
      booking_group_key: groupKey,
      booking_refs: groupRows.map((row: any) => row.booking_ref).filter(Boolean),
      date: starts.isValid ? starts.toISODate() : normalizeDateForResponse(first.start_time),
      time: starts.isValid ? starts.toFormat('HH:mm') : '--:--',
      end_time: ends.isValid ? ends.toFormat('HH:mm') : null,
      starts_at: first.start_time,
      ends_at: first.end_time,
      title: `${customerName} · ${courtLabel}`,
      kind: 'court_booking',
      tone: 'electric',
      moduleTarget: 'bookings',
      customer_name: customerName,
      customer_phone: receipt?.customer_phone || noteParts.phone || null,
      customer_email: receipt?.customer_email || noteParts.email || null,
      courts,
      court_name: courtLabel,
      amount_sek: amount,
      payment_status: paymentStatus,
      payment_method: receipt?.payment_method || (first.stripe_session_id ? 'Stripe' : null),
      receipt_number: receipt?.receipt_number || null,
      booking_receipt_id: receipt?.id || null,
      stripe_session_id: first.stripe_session_id || null,
      access_code: first.access_code || null,
      checked_in: checkedRows.length > 0,
      checked_in_at: checkedRows[0]?.checked_in_at || null,
      checked_in_count: checkedRows.length,
      status: groupRows.every((row: any) => row.status === first.status) ? first.status : 'mixed',
      notes: first.notes || null,
    };
  });
}

async function activeBookableCourtResources(admin: any, venueId: string) {
  const { data, error } = await admin
    .from('event_resource_catalog')
    .select('id, venue_court_id')
    .eq('venue_id', venueId)
    .eq('resource_type', 'court')
    .eq('is_active', true)
    .eq('is_bookable', true)
    .not('venue_court_id', 'is', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);

  const seenCourtIds = new Set<string>();
  return (data || []).filter((row: any) => {
    const courtId = String(row.venue_court_id || '');
    if (!courtId || seenCourtIds.has(courtId)) return false;
    seenCourtIds.add(courtId);
    return true;
  });
}

async function resourceIdsForCourtIds(admin: any, venueId: string, courtIds: string[]) {
  if (courtIds.length === 0) return [];

  const { data: courts, error: courtsError } = await admin
    .from('venue_courts')
    .select('id, name, court_number, sport_type')
    .eq('venue_id', venueId)
    .in('id', courtIds);
  if (courtsError) throw new Error(courtsError.message);
  if ((courts || []).length !== courtIds.length) throw new Error('One or more courts do not belong to this venue');

  const { data: existingCatalog, error: catalogError } = await admin
    .from('event_resource_catalog')
    .select('id, venue_court_id')
    .eq('venue_id', venueId)
    .eq('resource_type', 'court')
    .in('venue_court_id', courtIds);
  if (catalogError) throw new Error(catalogError.message);

  const existingByCourt = new Map((existingCatalog || []).map((row: any) => [row.venue_court_id, row.id]));
  const missingCourts = (courts || []).filter((court: any) => !existingByCourt.has(court.id));
  if (missingCourts.length) {
    const { data: inserted, error: insertError } = await admin
      .from('event_resource_catalog')
      .insert(missingCourts.map((court: any) => ({
        venue_id: venueId,
        resource_type: 'court',
        name: court.name,
        description: court.sport_type || null,
        venue_court_id: court.id,
        unit: 'event',
        is_bookable: true,
        is_active: true,
        sort_order: court.court_number || 100,
      })))
      .select('id, venue_court_id');
    if (insertError) throw new Error(insertError.message);
    for (const row of inserted || []) existingByCourt.set(row.venue_court_id, row.id);
  }

  return courtIds.map((courtId: string) => existingByCourt.get(courtId)).filter(Boolean);
}

async function analyzeOperationImpact(
  admin: any,
  venueId: string,
  startsAt: string,
  endsAt: string,
  affectsEntireVenue: boolean,
  courtIds: string[],
  overrideId?: string | null,
) {
  let bookingsQuery = admin
    .from('bookings')
    .select('id, booking_ref, start_time, end_time, status, venue_court_id, venue_courts(id, name)', { count: 'exact' })
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .lt('start_time', endsAt)
    .gt('end_time', startsAt)
    .order('start_time', { ascending: true })
    .limit(8);
  if (!affectsEntireVenue && courtIds.length) bookingsQuery = bookingsQuery.in('venue_court_id', courtIds);
  const { data: bookings, count: bookingCount, error: bookingsError } = await bookingsQuery;
  if (bookingsError) throw new Error(bookingsError.message);

  const dates = localDatesBetween(startsAt, endsAt);
  const startMs = DateTime.fromISO(startsAt, { zone: 'utc' }).toMillis();
  const endMs = DateTime.fromISO(endsAt, { zone: 'utc' }).toMillis();
  const { data: sessions, error: sessionsError } = await admin
    .from('activity_sessions')
    .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, court_ids, is_active, publish_status')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .limit(500);
  if (sessionsError) throw new Error(sessionsError.message);

  const courtSet = new Set(courtIds);
  const activitySamples: any[] = [];
  let activityCount = 0;
  for (const session of sessions || []) {
    const sessionCourtIds = Array.isArray(session.court_ids) ? session.court_ids.map((id: unknown) => String(id)) : [];
    if (!affectsEntireVenue && sessionCourtIds.length && !sessionCourtIds.some((id: string) => courtSet.has(id))) {
      continue;
    }

    for (const date of dates) {
      const isConcrete = session.session_date === date;
      const isRecurring = !session.session_date && Array.isArray(session.recurrence_days)
        && session.recurrence_days.includes(DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).weekday % 7);
      if (!isConcrete && !isRecurring) continue;

      const occurrenceStart = DateTime.fromISO(`${date}T${String(session.start_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      const occurrenceEnd = DateTime.fromISO(`${date}T${String(session.end_time).slice(0, 5)}:00`, { zone: 'Europe/Stockholm' }).toUTC();
      if (!occurrenceStart.isValid || !occurrenceEnd.isValid) continue;
      if (occurrenceStart.toMillis() < endMs && occurrenceEnd.toMillis() > startMs) {
        activityCount += 1;
        if (activitySamples.length < 8) {
          activitySamples.push({
            id: session.id,
            activity_session_id: session.id,
            name: session.name,
            session_type: session.session_type,
            session_date: date,
            start_time: String(session.start_time).slice(0, 5),
            end_time: String(session.end_time).slice(0, 5),
          });
        }
      }
    }
  }

  const sampleSessionIds = activitySamples.map((sample) => sample.activity_session_id);
  const startDate = dates[0] || '';
  const endDate = dates[dates.length - 1] || '';
  const [registrationCounts, checkedInCounts, overrides] = await Promise.all([
    activityRegistrationCounts(admin, sampleSessionIds, startDate, endDate),
    activityCheckedInCounts(admin, venueId, sampleSessionIds, startDate, endDate),
    activityOverrideMap(admin, venueId, sampleSessionIds, startDate, endDate),
  ]);
  for (const sample of activitySamples) {
    const key = activityOverrideKey(sample.activity_session_id, sample.session_date);
    const override = overrides.get(key);
    sample.registrations_count = registrationCounts.get(key) || 0;
    sample.checked_in_count = checkedInCounts.get(key) || 0;
    sample.override_status = override?.status || null;
    sample.activity_session_override_id = override?.id || null;
  }

  const resourceIds = !affectsEntireVenue && courtIds.length
    ? await resourceIdsForCourtIds(admin, venueId, courtIds)
    : [];
  let blocksQuery = admin
    .from('event_resource_blocks')
    .select('id, title, reason, status, starts_at, ends_at, metadata, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)', { count: 'exact' })
    .eq('venue_id', venueId)
    .in('status', ['hold', 'confirmed'])
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)
    .order('starts_at', { ascending: true })
    .limit(100);
  if (!affectsEntireVenue && resourceIds.length) blocksQuery = blocksQuery.or(`resource_catalog_id.is.null,resource_catalog_id.in.(${resourceIds.join(',')})`);
  const { data: blockRows, error: blocksError } = await blocksQuery;
  if (blocksError) throw new Error(blocksError.message);

  const filteredBlocks = (blockRows || []).filter((block: any) => {
    const metadata = cleanBlockMetadata(block.metadata);
    if (overrideId && metadata.venue_operation_override_id === overrideId) return false;
    if (affectsEntireVenue) return true;
    const resource = resourceForBlockRow(block);
    return !resource || courtSet.has(resource.venue_court_id);
  });

  return {
    bookings: {
      count: bookingCount ?? (bookings || []).length,
      samples: bookings || [],
    },
    activities: {
      count: activityCount,
      samples: activitySamples,
      limited: dates.length >= 45,
    },
    blocks: {
      count: filteredBlocks.length,
      samples: filteredBlocks.slice(0, 8),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  try {
    if (req.method === 'GET' && path === 'zettle-callback') {
      const state = url.searchParams.get('state') || '';
      const code = url.searchParams.get('code') || '';
      if (!state || !code) return errorResponse('Missing Zettle OAuth state or code', 400);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: connection, error: connectionErr } = await admin
        .from('zettle_connections')
        .select('*')
        .eq('oauth_state', state)
        .maybeSingle();
      if (connectionErr) return errorResponse(connectionErr.message, 500);
      if (!connection) return errorResponse('Invalid Zettle OAuth state', 400);
      const expiresAt = connection.oauth_state_expires_at
        ? DateTime.fromISO(connection.oauth_state_expires_at, { zone: 'utc' })
        : null;
      if (!expiresAt?.isValid || expiresAt < DateTime.utc()) return errorResponse('Expired Zettle OAuth state', 400);

      await writeAuditLog(admin, {
        venue_id: connection.venue_id || null,
        actor_user_id: connection.created_by || null,
        actor_type: connection.created_by ? 'user' : 'system',
        action: 'api-admin.zettle-callback.get',
        entity_table: 'zettle_connections',
        entity_id: connection.id,
        request_id: req.headers.get('x-request-id') || crypto.randomUUID(),
        metadata: { path, method: req.method, oauth_state: '[redacted]' },
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      });

      const token = await exchangeZettleToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: zettleRedirectUri(supabaseUrl),
      });
      const userInfo = token.access_token ? await getZettleUserInfo(token.access_token) : null;
      const tokenExpiresAt = DateTime.utc().plus({ seconds: Number(token.expires_in || 7200) }).toISO();
      const returnUrl = safeReturnUrl(connection.metadata?.return_url);

      const { error: updateErr } = await admin
        .from('zettle_connections')
        .update({
          status: 'connected',
          organization_uuid: userInfo?.organizationUuid || connection.organization_uuid || null,
          zettle_user_uuid: userInfo?.uuid || connection.zettle_user_uuid || null,
          oauth_state: null,
          oauth_state_expires_at: null,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_expires_at: tokenExpiresAt,
          last_import_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);
      if (updateErr) return errorResponse(updateErr.message, 500);

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}zettle=connected`,
        },
      });
    }

    const { client, userId, error } = await getAuthenticatedClient(req);
    if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

    const { ok, venueId: adminVenueId } = await isAdmin(userId);
    if (!ok) return errorResponse('Forbidden: admin only', 403);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);
    const isWriteMethod = ['POST', 'PATCH', 'DELETE'].includes(req.method);
    const mutationBody = isWriteMethod ? await req.clone().json().catch(() => ({})) : {};
    const bodyVenueId = mutationBody.venueId || mutationBody.venue_id || null;
    const venueId = url.searchParams.get('venueId') || bodyVenueId || adminVenueId;
    const isVenueScopedWrite = isWriteMethod && !(req.method === 'POST' && path === 'venues');
    const shouldAuditMutation = isWriteMethod && !NON_AUDITED_ADMIN_POSTS.has(path);

    if (!venueId && path !== 'venues') return errorResponse('No venue found', 400);

    try {
      if (req.method === 'POST' && path === 'venues') {
        await requireSuperAdmin(admin, userId);
      } else if (isVenueScopedWrite && venueId) {
        await requireVenueRole(admin, userId, venueId, ['venue_admin']);
      }

      if (shouldAuditMutation) {
        await auditMutation(admin, {
          req,
          userId,
          action: `api-admin.${path}.${req.method.toLowerCase()}`,
          entityTable: adminEntityTableForPath(path),
          entityId: adminEntityIdFromRequest(path, req.method, mutationBody, url),
          venueId: path === 'venues' ? null : venueId,
          metadata: {
            path,
            method: req.method,
            query: Object.fromEntries(url.searchParams.entries()),
            body: sanitizeAuditValue(mutationBody),
          },
        });
      }
    } catch (authOrAuditError) {
      const message = authOrAuditError instanceof Error ? authOrAuditError.message : 'Authorization failed';
      if (message.startsWith('Forbidden')) return errorResponse(message, 403);
      if (message.startsWith('Missing')) return errorResponse(message, 400);
      return errorResponse(message, 500);
    }

    // ── CHECK ROLE ──
    if (req.method === 'GET' && path === 'check') {
      // Check if super_admin
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      return jsonResponse({ isAdmin: true, venueId, isSuperAdmin: !!superRole });
    }

    // ── LIST VENUES (super_admin sees all, venue_admin sees own) ──
    if (req.method === 'GET' && path === 'venues') {
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();

      let venues;
      if (superRole) {
        const { data, error: e } = await admin.from('venues').select('id, name, slug, city, status, logo_url, primary_color').order('name');
        if (e) return errorResponse(e.message);
        venues = data;
      } else {
        const { data: staffVenues } = await admin.from('venue_staff')
          .select('venue_id').eq('user_id', userId).eq('is_active', true);
        const vIds = (staffVenues || []).map((v: any) => v.venue_id);
        const { data, error: e } = await admin.from('venues').select('id, name, slug, city, status, logo_url, primary_color').in('id', vIds).order('name');
        if (e) return errorResponse(e.message);
        venues = data;
      }
      return jsonResponse(venues, 200, 10);
    }

    // ── VENUE STATS (revenue dashboard) ──
    if (req.method === 'GET' && path === 'stats') {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      const lastWeekDay = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

      // Helper to get revenue & bookings for a date
      const getDateStats = async (date: string) => {
        const { data } = await admin.from('bookings')
          .select('id, total_price, status')
          .eq('venue_id', venueId)
          .gte('start_time', `${date}T00:00:00`)
          .lt('start_time', `${date}T23:59:59`);
        const rows = data || [];
        return {
          bookings: rows.length,
          revenue: rows.filter((b: any) => b.status !== 'cancelled')
            .reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        };
      };

      // Helper to get day pass count
      const getPassCount = async (date: string) => {
        const { count } = await admin.from('day_passes')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venueId).eq('valid_date', date).eq('status', 'active');
        return count || 0;
      };

      // Fetch all periods in parallel
      const [todayStats, yesterdayStats, lastWeekStats, todayPasses, yesterdayPasses, lastWeekPasses] = await Promise.all([
        getDateStats(today),
        getDateStats(yesterday),
        getDateStats(lastWeekDay),
        getPassCount(today),
        getPassCount(yesterday),
        getPassCount(lastWeekDay),
      ]);

      // Courts count
      const { count: totalCourts } = await admin.from('venue_courts')
        .select('id', { count: 'exact', head: true }).eq('venue_id', venueId);

      // Staff count
      const { count: activeStaff } = await admin.from('venue_staff')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      // Pricing rules count
      const { count: pricingRules } = await admin.from('pricing_rules')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      // Links count
      const { count: linksCount } = await admin.from('venue_links')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId).eq('is_active', true);

      return jsonResponse({
        totalCourts: totalCourts || 0,
        bookingsToday: todayStats.bookings,
        todayRevenue: todayStats.revenue,
        activePasses: todayPasses,
        activeStaff: activeStaff || 0,
        pricingRules: pricingRules || 0,
        linksCount: linksCount || 0,
        // Trend data
        yesterdayRevenue: yesterdayStats.revenue,
        yesterdayBookings: yesterdayStats.bookings,
        yesterdayPasses,
        lastWeekRevenue: lastWeekStats.revenue,
        lastWeekBookings: lastWeekStats.bookings,
        lastWeekPasses,
      }, 200, 5);
    }

    // ── 7-DAY HISTORY (for sparklines) ──
    if (req.method === 'GET' && path === 'history') {
      const days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
      }
      const results = await Promise.all(days.map(async (date) => {
        const [{ data: bookings }, { count: passes }] = await Promise.all([
          admin.from('bookings').select('total_price, status').eq('venue_id', venueId)
            .gte('start_time', `${date}T00:00:00`).lt('start_time', `${date}T23:59:59`),
          admin.from('day_passes').select('id', { count: 'exact', head: true })
            .eq('venue_id', venueId).eq('valid_date', date).eq('status', 'active'),
        ]);
        const rows = bookings || [];
        return {
          date,
          revenue: rows.filter((b: any) => b.status !== 'cancelled').reduce((s: number, b: any) => s + (b.total_price || 0), 0),
          bookings: rows.length,
          passes: passes || 0,
        };
      }));
      return jsonResponse(results, 200, 5);
    }

    // ── ZETTLE REVENUE MVP ──
    if (req.method === 'GET' && path === 'zettle-status') {
      const { data: connection, error: connectionErr } = await admin
        .from('zettle_connections')
        .select('id, venue_id, status, organization_uuid, zettle_user_uuid, token_expires_at, scopes, last_import_started_at, last_import_finished_at, last_import_from, last_import_to, last_import_count, last_import_error, updated_at, created_at')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (connectionErr) return errorResponse(connectionErr.message);

      const mode = zettleAuthMode();
      return jsonResponse({
        configured: mode !== 'unconfigured',
        auth_mode: mode,
        connected: mode === 'api_key' || connection?.status === 'connected',
        connection: connection || null,
        required_secrets: mode === 'api_key'
          ? ['ZETTLE_CLIENT_ID', 'ZETTLE_API_KEY']
          : ['ZETTLE_CLIENT_ID', 'ZETTLE_CLIENT_SECRET'],
        redirect_uri: zettleRedirectUri(supabaseUrl),
      }, 200, 10);
    }

    if (req.method === 'POST' && path === 'zettle-connect') {
      const body = await req.json().catch(() => ({}));
      const { clientId, clientSecret } = zettleConfig();
      if (zettleAuthMode() === 'api_key') {
        return jsonResponse({
          connected: true,
          auth_mode: 'api_key',
          message: 'Zettle API key mode is configured. OAuth connect is not required.',
        }, 200, 10);
      }
      if (!clientId || !clientSecret) {
        return errorResponse('Zettle is not configured. Add ZETTLE_CLIENT_ID and ZETTLE_CLIENT_SECRET as Supabase secrets.', 400);
      }

      const state = crypto.randomUUID();
      const returnUrl = safeReturnUrl(body.returnUrl);
      const redirectUri = zettleRedirectUri(supabaseUrl);
      const expiresAt = DateTime.utc().plus({ minutes: 15 }).toISO();
      const { error: upsertErr } = await admin
        .from('zettle_connections')
        .upsert({
          venue_id: venueId,
          status: 'pending',
          oauth_state: state,
          oauth_state_expires_at: expiresAt,
          scopes: ZETTLE_SCOPES,
          metadata: { return_url: returnUrl },
          created_by: userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'venue_id' });
      if (upsertErr) return errorResponse(upsertErr.message);

      const authorizeUrl = new URL(`${ZETTLE_OAUTH_BASE_URL}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', ZETTLE_SCOPES.join(' '));
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('state', state);

      return jsonResponse({
        authorization_url: authorizeUrl.toString(),
        redirect_uri: redirectUri,
        expires_at: expiresAt,
      }, 200, 10);
    }

    if (req.method === 'POST' && path === 'zettle-import') {
      const body = await req.json().catch(() => ({}));
      const requestedDate = String(body.date || stockholmToday()).slice(0, 10);
      const startDay = DateTime.fromISO(requestedDate, { zone: 'Europe/Stockholm' });
      if (!startDay.isValid) return errorResponse('Invalid date', 400);
      const endDay = startDay.plus({ days: 1 });
      const startIso = startDay.startOf('day').toUTC().toISO()!;
      const endIso = endDay.startOf('day').toUTC().toISO()!;

      const { data: connection, error: connectionErr } = await admin
        .from('zettle_connections')
        .select('*')
        .eq('venue_id', venueId)
        .maybeSingle();
      if (connectionErr) return errorResponse(connectionErr.message);
      const apiKeyMode = zettleAuthMode() === 'api_key';
      if (!apiKeyMode && (!connection || connection.status !== 'connected')) return errorResponse('Zettle is not connected for this venue', 400);

      let importConnection = connection;
      if (apiKeyMode && !importConnection) {
        const { data: apiKeyConnection, error: apiKeyConnectionErr } = await admin
          .from('zettle_connections')
          .upsert({
            venue_id: venueId,
            status: 'connected',
            scopes: ZETTLE_SCOPES,
            metadata: { auth_mode: 'api_key' },
            created_by: userId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'venue_id' })
          .select('*')
          .single();
        if (apiKeyConnectionErr) return errorResponse(apiKeyConnectionErr.message);
        importConnection = apiKeyConnection;
      }
      if (!importConnection) return errorResponse('Zettle connection could not be prepared', 500);

      await admin
        .from('zettle_connections')
        .update({
          last_import_started_at: new Date().toISOString(),
          last_import_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', importConnection.id);

      try {
        const accessToken = await validZettleAccessToken(admin, importConnection);
        const purchases = await fetchZettlePurchases(accessToken, startIso, endIso);
        const validPurchases = purchases.filter((purchase) => zettlePurchaseUuid(purchase));

        if (validPurchases.length) {
          const rawRows = validPurchases.map((purchase) => {
            const occurredAt = zettleOccurredAt(purchase);
            return {
              venue_id: venueId,
              connection_id: importConnection.id,
              purchase_uuid: zettlePurchaseUuid(purchase),
              purchase_number: zettlePurchaseNumber(purchase),
              occurred_at: occurredAt,
              amount_inc_vat_minor: Math.max(0, Math.round(Number(purchase.amount || purchase.totalAmount || 0))),
              vat_amount_minor: Math.max(0, Math.round(Number(purchase.vatAmount || purchase.totalVatAmount || 0))),
              currency: purchase.currency || purchase.currencyId || null,
              payment_method: zettlePaymentMethod(purchase),
              payment_status: zettleStatusFromPurchase(purchase),
              raw_payload: purchase,
              imported_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          });
          const { error: rawErr } = await admin
            .from('zettle_purchases')
            .upsert(rawRows, { onConflict: 'venue_id,purchase_uuid' });
          if (rawErr) throw new Error(rawErr.message);

          const ledgerRows = validPurchases.map((purchase) => zettleLedgerEntry(venueId!, purchase));
          const { error: ledgerErr } = await admin
            .from('ledger_entries')
            .upsert(ledgerRows, { onConflict: 'source_type,source_id', ignoreDuplicates: true });
          if (ledgerErr) throw new Error(ledgerErr.message);
        }

        await admin
          .from('zettle_connections')
          .update({
            status: 'connected',
            last_import_finished_at: new Date().toISOString(),
            last_import_from: startIso,
            last_import_to: endIso,
            last_import_count: validPurchases.length,
            last_import_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', importConnection.id);

        return jsonResponse({
          date: requestedDate,
          imported_count: validPurchases.length,
          ledger_source_type: 'zettle',
        }, 200, 10);
      } catch (importErr) {
        const message = importErr instanceof Error ? importErr.message : 'Zettle import failed';
        await admin
          .from('zettle_connections')
          .update({
            last_import_finished_at: new Date().toISOString(),
            last_import_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', importConnection.id);
        return errorResponse(message, 500);
      }
    }

    // ── REVENUE LEDGER ──
    if (req.method === 'GET' && path === 'revenue-ledger') {
      const requestedDate = url.searchParams.get('date') || stockholmToday();
      const selectedDay = DateTime.fromISO(requestedDate, { zone: 'Europe/Stockholm' });
      if (!selectedDay.isValid) return errorResponse('Invalid date', 400);
      const selectedDate = selectedDay.toISODate()!;

      const sourceLabels: Record<string, string> = {
        court_booking: 'Court Booking',
        activity_registration: 'Activity',
        day_pass: 'Day Pass',
        membership: 'Membership',
        membership_invoice: 'Membership Invoice',
        zettle: 'Zettle',
      };

      const normalizeLedgerRows = (rows: any[]) => rows.map((row) => ({
        ...row,
        source_label: sourceLabels[row.source_type] || row.source_type,
        amount_sek: Math.round(Number(row.amount_inc_vat_minor || 0)) / 100,
        vat_sek: Math.round(Number(row.vat_amount_minor || 0)) / 100,
      }));

      const sumMinor = (rows: any[], field: string) =>
        rows.reduce((sum, row) => sum + Math.round(Number(row[field] || 0)), 0);

      const receiptTotalForLocalRange = async (startDay: DateTime, endDay: DateTime) => {
        const start = startDay.startOf('day').toUTC().toISO()!;
        const end = endDay.startOf('day').toUTC().toISO()!;
        const { data, error: receiptErr } = await admin
          .from('booking_receipts')
          .select('id, total_inc_vat_sek, total_inc_vat')
          .eq('venue_id', venueId)
          .eq('payment_status', 'paid')
          .gte('issued_at', start)
          .lt('issued_at', end);
        if (receiptErr) throw new Error(receiptErr.message);
        return {
          total_minor: (data || []).reduce((sum: number, row: any) => {
            const amountSek = Number(row.total_inc_vat_sek ?? row.total_inc_vat ?? 0);
            return sum + Math.round(amountSek * 100);
          }, 0),
          count: (data || []).length,
        };
      };

      const ledgerForDateRange = async (startDate: string, endDate: string) => {
        const { data, error: ledgerErr } = await admin
          .from('ledger_entries')
          .select('id, source_type, amount_inc_vat_minor, vat_amount_minor')
          .eq('venue_id', venueId)
          .gte('accounting_date', startDate)
          .lt('accounting_date', endDate);
        if (ledgerErr) throw new Error(ledgerErr.message);
        const rows = data || [];
        const zettleRows = rows.filter((row: any) => row.source_type === 'zettle');
        const picklaRows = rows.filter((row: any) => row.source_type !== 'zettle');
        return {
          total_minor: sumMinor(rows, 'amount_inc_vat_minor'),
          vat_minor: sumMinor(rows, 'vat_amount_minor'),
          count: rows.length,
          channels: {
            pickla_minor: sumMinor(picklaRows, 'amount_inc_vat_minor'),
            pickla_count: picklaRows.length,
            zettle_minor: sumMinor(zettleRows, 'amount_inc_vat_minor'),
            zettle_count: zettleRows.length,
            total_minor: sumMinor(rows, 'amount_inc_vat_minor'),
          },
        };
      };

      const daySummary = async (day: DateTime) => {
        const start = day.toISODate()!;
        const end = day.plus({ days: 1 }).toISODate()!;
        const [ledger, receipts] = await Promise.all([
          ledgerForDateRange(start, end),
          receiptTotalForLocalRange(day, day.plus({ days: 1 })),
        ]);
        return { ledger, receipts, delta_minor: ledger.channels.pickla_minor - receipts.total_minor };
      };

      const monthStart = DateTime.now().setZone('Europe/Stockholm').startOf('month');
      const monthEnd = monthStart.plus({ months: 1 });
      const monthSummary = async () => {
        const [ledger, receipts] = await Promise.all([
          ledgerForDateRange(monthStart.toISODate()!, monthEnd.toISODate()!),
          receiptTotalForLocalRange(monthStart, monthEnd),
        ]);
        return { ledger, receipts, delta_minor: ledger.channels.pickla_minor - receipts.total_minor };
      };

      const { data: rows, error: rowsErr } = await admin
        .from('ledger_entries')
        .select('id, venue_id, customer_id, source_type, source_id, accounting_date, occurred_at, customer_name, amount_inc_vat_minor, vat_amount_minor, payment_status, payment_method, stripe_session_id, receipt_number, booking_receipt_id, metadata, created_at')
        .eq('venue_id', venueId)
        .eq('accounting_date', selectedDate)
        .order('occurred_at', { ascending: false })
        .limit(200);
      if (rowsErr) return errorResponse(rowsErr.message);

      const receiptIds = uniqueStrings((rows || []).map((row: any) => row.booking_receipt_id));
      let receiptsById = new Map<string, any>();
      if (receiptIds.length) {
        const { data: receipts, error: receiptsErr } = await admin
          .from('booking_receipts')
          .select('id, customer_id, user_id, receipt_number, customer_name, customer_email, customer_phone, product_description, purchase_type, total_inc_vat_sek, vat_amount_sek, vat_rate, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, issued_at')
          .eq('venue_id', venueId)
          .in('id', receiptIds);
        if (receiptsErr) throw new Error(receiptsErr.message);
        receiptsById = new Map((receipts || []).map((receipt: any) => [receipt.id, receipt]));
      }

      const entries = normalizeLedgerRows((rows || []).map((row: any) => ({
        ...row,
        receipt: row.booking_receipt_id ? receiptsById.get(row.booking_receipt_id) || null : null,
      })));
      const byType = Array.from(entries.reduce((map: Map<string, any>, row: any) => {
        const current = map.get(row.source_type) || {
          source_type: row.source_type,
          label: row.source_label,
          count: 0,
          total_minor: 0,
        };
        current.count += 1;
        current.total_minor += Number(row.amount_inc_vat_minor || 0);
        map.set(row.source_type, current);
        return map;
      }, new Map()).values()).map((item: any) => ({
        ...item,
        total_sek: Math.round(Number(item.total_minor || 0)) / 100,
      }));

      const now = DateTime.now().setZone('Europe/Stockholm');
      const [selected, today, yesterday, month] = await Promise.all([
        daySummary(selectedDay),
        daySummary(now),
        daySummary(now.minus({ days: 1 })),
        monthSummary(),
      ]);

      return jsonResponse({
        date: selectedDate,
        entries,
        by_type: byType,
        selected,
        summary: {
          today,
          yesterday,
          month,
        },
      }, 200, 10);
    }

    // ── ADMIN OS CALENDAR ──
    if (req.method === 'GET' && path === 'calendar') {
      const scopedVenueId = venueId!;
      const fromDate = (url.searchParams.get('from') || stockholmToday()).slice(0, 10);
      const toDate = (url.searchParams.get('to') || fromDate).slice(0, 10);
      const dates = localDateStringsBetween(fromDate, toDate);
      if (!dates.length) return errorResponse('Invalid date range', 400);

      const startRange = stockholmDayRangeUtc(dates[0]);
      const endRange = stockholmDayRangeUtc(dates[dates.length - 1]);
      const items: any[] = [];

      const bookingItems = await groupedCourtBookingItems(admin, scopedVenueId, startRange.start!, endRange.end!);
      items.push(...bookingItems);

      const { data: sessions, error: sessionsError } = await admin
        .from('activity_sessions')
        .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, is_active, publish_status, court_ids, price_sek, capacity, product_key, metadata')
        .eq('venue_id', scopedVenueId)
        .eq('is_active', true)
        .order('start_time', { ascending: true })
        .limit(800);
      if (sessionsError) return errorResponse(sessionsError.message);

      const activitySamples: any[] = [];
      for (const date of dates) {
        const weekday = DateTime.fromISO(date, { zone: 'Europe/Stockholm' }).weekday % 7;
        for (const session of sessions || []) {
          const isConcrete = session.session_date === date;
          const isRecurring = !session.session_date && Array.isArray(session.recurrence_days) && session.recurrence_days.includes(weekday);
          if (!isConcrete && !isRecurring) continue;
          activitySamples.push({
            id: `activity-${session.id}-${date}`,
            source_id: session.id,
            activity_session_id: session.id,
            date,
            time: cleanTime(session.start_time) || '--:--',
            end_time: cleanTime(session.end_time) || null,
            title: session.name || 'Aktivitet',
            kind: 'activity',
            tone: 'lime',
            session_type: session.session_type || 'open_play',
            product_key: session.product_key || null,
            price_sek: session.price_sek || 0,
            online_price_sek: Number(session.metadata?.online_price_sek ?? session.price_sek ?? 0),
            desk_price_sek: Number(session.metadata?.desk_price_sek ?? session.price_sek ?? 0),
            pricing_channel_mode: session.metadata?.pricing_channel_mode || null,
            capacity: session.capacity || null,
            moduleTarget: 'schedule',
          });
        }
      }

      const sampleSessionIds = uniqueStrings(activitySamples.map((sample) => sample.activity_session_id));
      const [registrationCounts, checkedInCounts, activityOverrides] = await Promise.all([
        activityRegistrationCounts(admin, sampleSessionIds, dates[0], dates[dates.length - 1]),
        activityCheckedInCounts(admin, scopedVenueId, sampleSessionIds, dates[0], dates[dates.length - 1]),
        activityOverrideMap(admin, scopedVenueId, sampleSessionIds, dates[0], dates[dates.length - 1]),
      ]);

      for (const activity of activitySamples) {
        const key = activityOverrideKey(activity.activity_session_id, activity.date);
        const override = activityOverrides.get(key);
        items.push({
          ...activity,
          registrations_count: registrationCounts.get(key) || 0,
          checked_in_count: checkedInCounts.get(key) || 0,
          override_status: override?.status || null,
          activity_session_override_id: override?.id || null,
        });
      }

      const { data: events, error: eventsError } = await admin
        .from('events')
        .select('id, name, display_name, start_date, start_time, end_time, planning_status, visibility, customer_name, expected_participants')
        .eq('venue_id', scopedVenueId)
        .gte('start_date', dates[0])
        .lte('start_date', dates[dates.length - 1])
        .neq('planning_status', 'cancelled')
        .order('start_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (eventsError) return errorResponse(eventsError.message);

      for (const event of events || []) {
        const date = normalizeDateForResponse(event.start_date);
        if (!date) continue;
        items.push({
          id: `event-${event.id}`,
          source_id: event.id,
          date,
          time: cleanTime(event.start_time) || '--:--',
          end_time: cleanTime(event.end_time) || null,
          title: eventDisplayTitle(event),
          kind: 'event',
          tone: 'magenta',
          planning_status: event.planning_status || null,
          visibility: event.visibility || null,
          customer_name: event.customer_name || null,
          expected_participants: event.expected_participants || null,
          moduleTarget: 'events',
        });
      }

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)')
        .eq('venue_id', scopedVenueId)
        .in('status', ['hold', 'confirmed'])
        .lt('starts_at', endRange.end)
        .gt('ends_at', startRange.start)
        .order('starts_at', { ascending: true })
        .limit(300);
      if (blocksError) return errorResponse(blocksError.message);

      for (const block of blocks || []) {
        const starts = DateTime.fromISO(block.starts_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        const resource = resourceForBlockRow(block);
        items.push({
          id: `block-${block.id}`,
          source_id: block.id,
          date: starts.isValid ? starts.toISODate() : dates[0],
          time: stockholmTimeFromIso(block.starts_at) || '--:--',
          end_time: stockholmTimeFromIso(block.ends_at) || null,
          title: block.title || resource?.name || 'Resursblockering',
          kind: 'block',
          tone: block.reason === 'event' ? 'magenta' : 'sun',
          status: block.status,
          resource_name: resource?.name || null,
          moduleTarget: 'resourceBlocks',
        });
      }

      const { data: overrides, error: overridesError } = await admin
        .from('venue_operation_overrides')
        .select('id, title, reason, override_type, starts_at, ends_at, affects_entire_venue, status')
        .eq('venue_id', scopedVenueId)
        .eq('status', 'active')
        .lt('starts_at', endRange.end)
        .gt('ends_at', startRange.start)
        .order('starts_at', { ascending: true })
        .limit(200);
      if (overridesError) return errorResponse(overridesError.message);

      for (const override of overrides || []) {
        const starts = DateTime.fromISO(override.starts_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        items.push({
          id: `drift-${override.id}`,
          source_id: override.id,
          date: starts.isValid ? starts.toISODate() : dates[0],
          time: stockholmTimeFromIso(override.starts_at) || '--:--',
          end_time: stockholmTimeFromIso(override.ends_at) || null,
          title: override.title || 'Driftavvikelse',
          kind: 'drift',
          tone: 'danger',
          override_type: override.override_type,
          affects_entire_venue: override.affects_entire_venue,
          moduleTarget: 'operations',
        });
      }

      items.sort((a, b) => {
        const ad = String(a.date || '');
        const bd = String(b.date || '');
        if (ad !== bd) return ad.localeCompare(bd);
        const at = /^\d{2}:\d{2}$/.test(a.time) ? a.time : '99:99';
        const bt = /^\d{2}:\d{2}$/.test(b.time) ? b.time : '99:99';
        return at.localeCompare(bt) || String(a.title || '').localeCompare(String(b.title || ''));
      });

      return jsonResponse({ from: dates[0], to: dates[dates.length - 1], dates, items }, 200, 5);
    }

    // ── ADMIN OS ATTENTION SIGNALS ──
    if (req.method === 'GET' && path === 'attention') {
      const scopedVenueId = venueId!;
      const today = stockholmToday();
      const tomorrow = DateTime.fromISO(today, { zone: 'Europe/Stockholm' }).plus({ days: 1 }).toISODate()!;
      const todayRange = stockholmDayRangeUtc(today);
      const tomorrowRange = stockholmDayRangeUtc(tomorrow);
      const cutoff = DateTime.now().minus({ hours: 24 }).toUTC().toISO();
      const items: any[] = [];

      const { data: leads, error: leadsError } = await admin
        .from('event_leads')
        .select('id, company_name, contact_name, status, created_at, event_id')
        .eq('venue_id', scopedVenueId)
        .lt('created_at', cutoff)
        .not('status', 'in', '("won","lost","booking_confirmed")')
        .order('created_at', { ascending: true })
        .limit(50);
      if (leadsError) return errorResponse(leadsError.message);

      const leadIds = (leads || []).map((lead: any) => lead.id);
      const respondedLeadIds = new Set<string>();
      if (leadIds.length) {
        const { data: activities, error: activitiesError } = await admin
          .from('event_lead_activities')
          .select('event_lead_id, activity_type')
          .in('event_lead_id', leadIds);
        if (activitiesError) return errorResponse(activitiesError.message);
        const outboundResponseTypes = new Set(['offer_sent', 'booking_confirmation', 'booking_confirmed', 'deposit_link_sent']);
        for (const activity of activities || []) {
          if (outboundResponseTypes.has(activity.activity_type)) respondedLeadIds.add(activity.event_lead_id);
        }
      }

      for (const lead of leads || []) {
        if (respondedLeadIds.has(lead.id)) continue;
        const created = DateTime.fromISO(lead.created_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        items.push({
          id: `lead-${lead.id}`,
          kind: 'lead',
          tone: 'warn',
          title: lead.company_name || lead.contact_name || 'Event lead',
          meta: `Inget svar till kund registrerat sedan ${created.isValid ? created.toFormat('d MMM HH:mm') : 'skapande'}`,
          moduleTarget: 'eventLeads',
          href: null,
        });
      }

      const { data: overrides, error: overridesError } = await admin
        .from('venue_operation_overrides')
        .select('id, title, override_type, starts_at, ends_at, affects_entire_venue, status')
        .eq('venue_id', scopedVenueId)
        .eq('status', 'active')
        .lt('starts_at', tomorrowRange.end)
        .gt('ends_at', todayRange.start)
        .order('starts_at', { ascending: true })
        .limit(50);
      if (overridesError) return errorResponse(overridesError.message);

      for (const override of overrides || []) {
        const starts = DateTime.fromISO(override.starts_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        const ends = DateTime.fromISO(override.ends_at, { zone: 'utc' }).setZone('Europe/Stockholm');
        const day = starts.toISODate() === today ? 'idag' : starts.toISODate() === tomorrow ? 'imorgon' : starts.toFormat('d MMM');
        items.push({
          id: `drift-${override.id}`,
          kind: 'drift',
          tone: 'warn',
          title: override.title || 'Driftavvikelse',
          meta: `${day} ${starts.toFormat('HH:mm')}–${ends.toFormat('HH:mm')}${override.affects_entire_venue ? ' · hela venue' : ''}`,
          moduleTarget: 'operations',
          href: null,
        });
      }

      const { data: events, error: eventsError } = await admin
        .from('events')
        .select('id, name, display_name, start_date, start_time, planning_status, resources, staffing')
        .eq('venue_id', scopedVenueId)
        .not('planning_status', 'in', '("done","cancelled")')
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(80);
      if (eventsError) return errorResponse(eventsError.message);

      const eventIds = (events || []).map((event: any) => event.id);
      const courtCounts = new Map<string, number>();
      if (eventIds.length) {
        const { data: courts, error: courtsError } = await admin
          .from('event_courts')
          .select('event_id, venue_court_id')
          .in('event_id', eventIds);
        if (courtsError) return errorResponse(courtsError.message);
        for (const court of courts || []) {
          courtCounts.set(court.event_id, (courtCounts.get(court.event_id) || 0) + 1);
        }
      }

      for (const event of events || []) {
        const issues: string[] = [];
        const resourceCount = Array.isArray(event.resources) ? event.resources.length : 0;
        if (resourceCount === 0 && (courtCounts.get(event.id) || 0) === 0) issues.push('resurser');
        if (!String(event.staffing || '').trim()) issues.push('personal');
        if (!['booked', 'ready', 'published'].includes(String(event.planning_status || ''))) issues.push('bekräftelse');
        if (!issues.length) continue;
        const date = event.start_date ? String(event.start_date).slice(0, 10) : 'Datum saknas';
        const time = cleanTime(event.start_time);
        items.push({
          id: `event-${event.id}`,
          kind: 'event',
          tone: 'info',
          title: eventDisplayTitle(event),
          meta: `${date}${time ? ` ${time}` : ''} · Saknar ${issues.join(', ')}`,
          moduleTarget: 'events',
          href: null,
        });
      }

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)')
        .eq('venue_id', scopedVenueId)
        .in('status', ['hold', 'confirmed'])
        .lt('starts_at', todayRange.end)
        .gt('ends_at', todayRange.start)
        .order('starts_at', { ascending: true })
        .limit(50);
      if (blocksError) return errorResponse(blocksError.message);

      for (const block of blocks || []) {
        const starts = stockholmTimeFromIso(block.starts_at) || '--:--';
        const ends = stockholmTimeFromIso(block.ends_at) || '--:--';
        const resource = resourceForBlockRow(block);
        items.push({
          id: `block-${block.id}`,
          kind: 'block',
          tone: 'warn',
          title: block.title || resource?.name || 'Resursblockering',
          meta: `${starts}–${ends} · ${block.status}`,
          moduleTarget: 'resourceBlocks',
          href: null,
        });
      }

      return jsonResponse(items, 200, 5);
    }

    // ── PICKLA AGENT INBOX ──
    if (req.method === 'GET' && path === 'agent-inbox') {
      const scopedVenueId = venueId!;
      const { data: recommendations, error: recommendationsError } = await admin
        .from('event_lead_activities')
        .select('id, event_lead_id, title, body, metadata, created_at')
        .eq('venue_id', scopedVenueId)
        .eq('activity_type', 'agent_recommendation')
        .order('created_at', { ascending: false })
        .limit(100);
      if (recommendationsError) return errorResponse(recommendationsError.message);

      const latestByLead = new Map<string, any>();
      for (const recommendation of recommendations || []) {
        if (!latestByLead.has(recommendation.event_lead_id)) {
          latestByLead.set(recommendation.event_lead_id, recommendation);
        }
      }

      const leadIds = Array.from(latestByLead.keys());
      if (!leadIds.length) return jsonResponse([], 200, 5);

      const [{ data: leads, error: leadsError }, { data: decisions, error: decisionsError }] = await Promise.all([
        admin
          .from('event_leads')
          .select('id, event_id, company_name, contact_name, status, preferred_date')
          .eq('venue_id', scopedVenueId)
          .in('id', leadIds),
        admin
          .from('event_lead_activities')
          .select('id, event_lead_id, activity_type, created_at')
          .eq('venue_id', scopedVenueId)
          .in('event_lead_id', leadIds)
          .in('activity_type', ['agent_recommendation_approved', 'agent_recommendation_rejected'])
          .order('created_at', { ascending: false }),
      ]);
      if (leadsError) return errorResponse(leadsError.message);
      if (decisionsError) return errorResponse(decisionsError.message);

      const leadById = new Map((leads || []).map((lead: any) => [lead.id, lead]));
      const latestDecisionByLead = new Map<string, any>();
      for (const decision of decisions || []) {
        if (!latestDecisionByLead.has(decision.event_lead_id)) latestDecisionByLead.set(decision.event_lead_id, decision);
      }

      const eventIds = uniqueStrings((leads || []).map((lead: any) => lead.event_id).filter(Boolean));
      const eventById = new Map<string, any>();
      if (eventIds.length) {
        const { data: events, error: eventsError } = await admin
          .from('events')
          .select('id, start_date, start_time, end_time')
          .in('id', eventIds);
        if (eventsError) return errorResponse(eventsError.message);
        for (const event of events || []) eventById.set(event.id, event);
      }

      const rows: any[] = [];
      for (const recommendation of latestByLead.values()) {
        const decision = latestDecisionByLead.get(recommendation.event_lead_id);
        if (decision && new Date(decision.created_at).getTime() > new Date(recommendation.created_at).getTime()) continue;
        const lead = leadById.get(recommendation.event_lead_id);
        if (!lead || ['won', 'lost', 'booking_confirmed'].includes(String(lead.status))) continue;
        const event = lead.event_id ? eventById.get(lead.event_id) : null;
        const metadata = cleanBlockMetadata(recommendation.metadata) as any;
        rows.push({
          id: recommendation.id,
          activity_id: recommendation.id,
          lead_id: lead.id,
          lead_name: lead.company_name || lead.contact_name || 'Event lead',
          event_date: normalizeDateForResponse(event?.start_date || metadata.recommended_schedule?.event_date || lead.preferred_date),
          event_time: cleanTime(event?.start_time || metadata.recommended_schedule?.start_time),
          summary: String(metadata.summary || recommendation.body || 'Agent recommendation'),
          risk: String(metadata.risk || 'low'),
          capacity_ok: metadata.capacity_ok !== false,
          next_action: String(metadata.next_action || 'review'),
          affected_registrations: Number(metadata.affected_registrations || 0),
          created_at: recommendation.created_at,
          moduleTarget: 'eventLeads',
        });
      }

      rows.sort((a, b) => {
        const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3)
          || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      return jsonResponse(rows.slice(0, 12), 200, 5);
    }

    // ── ADMIN OS TODAY TIMELINE ──
    if (req.method === 'GET' && path === 'todays-plan') {
      const scopedVenueId = venueId!;
      const date = url.searchParams.get('date') || stockholmToday();
      const day = DateTime.fromISO(date, { zone: 'Europe/Stockholm' });
      if (!day.isValid) return errorResponse('Invalid date', 400);
      const range = stockholmDayRangeUtc(date);
      const weekday = day.weekday % 7;
      const items: any[] = [];

      const bookingItems = await groupedCourtBookingItems(admin, scopedVenueId, range.start!, range.end!);
      for (const booking of bookingItems) {
        items.push({
          ...booking,
          kind: 'bokning',
          tone: 'electric',
          href: null,
          moduleTarget: 'bookings',
        });
      }

      const { data: sessions, error: sessionsError } = await admin
        .from('activity_sessions')
        .select('id, name, session_type, session_date, recurrence_days, start_time, end_time, is_active, publish_status')
        .eq('venue_id', scopedVenueId)
        .eq('is_active', true)
        .order('start_time', { ascending: true })
        .limit(500);
      if (sessionsError) return errorResponse(sessionsError.message);

      for (const session of sessions || []) {
        const isConcrete = session.session_date === date;
        const isRecurring = !session.session_date && Array.isArray(session.recurrence_days) && session.recurrence_days.includes(weekday);
        if (!isConcrete && !isRecurring) continue;
        const time = cleanTime(session.start_time);
        items.push({
          id: `activity-${session.id}-${date}`,
          time: time || '--:--',
          title: session.name || 'Aktivitet',
          kind: 'aktivitet',
          tone: 'lime',
          href: null,
          moduleTarget: 'schedule',
        });
      }

      const { data: dayEvents, error: dayEventsError } = await admin
        .from('events')
        .select('id, name, display_name, start_date, start_time, end_time, planning_status')
        .eq('venue_id', scopedVenueId)
        .eq('start_date', date)
        .neq('planning_status', 'cancelled')
        .order('start_time', { ascending: true });
      if (dayEventsError) return errorResponse(dayEventsError.message);

      for (const event of dayEvents || []) {
        const time = cleanTime(event.start_time);
        items.push({
          id: `event-${event.id}`,
          time: time || '--:--',
          title: eventDisplayTitle(event),
          kind: 'event',
          tone: 'magenta',
          href: null,
          moduleTarget: 'events',
        });
      }

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .select('id, title, reason, status, starts_at, ends_at, resource_catalog_id, event_resource_catalog(id, name, venue_court_id)')
        .eq('venue_id', scopedVenueId)
        .in('status', ['hold', 'confirmed'])
        .lt('starts_at', range.end)
        .gt('ends_at', range.start)
        .order('starts_at', { ascending: true })
        .limit(200);
      if (blocksError) return errorResponse(blocksError.message);

      for (const block of blocks || []) {
        const resource = resourceForBlockRow(block);
        items.push({
          id: `block-${block.id}`,
          time: stockholmTimeFromIso(block.starts_at) || '--:--',
          title: block.title || resource?.name || 'Resursblockering',
          kind: 'block',
          tone: block.reason === 'event' ? 'magenta' : 'sun',
          href: null,
          moduleTarget: 'resourceBlocks',
        });
      }

      const { data: overrides, error: overridesError } = await admin
        .from('venue_operation_overrides')
        .select('id, title, override_type, starts_at, ends_at, affects_entire_venue, status')
        .eq('venue_id', scopedVenueId)
        .eq('status', 'active')
        .lt('starts_at', range.end)
        .gt('ends_at', range.start)
        .order('starts_at', { ascending: true })
        .limit(100);
      if (overridesError) return errorResponse(overridesError.message);

      for (const override of overrides || []) {
        items.push({
          id: `drift-${override.id}`,
          time: stockholmTimeFromIso(override.starts_at) || '--:--',
          title: override.title || 'Driftavvikelse',
          kind: 'drift',
          tone: 'danger',
          href: null,
          moduleTarget: 'operations',
        });
      }

      items.sort((a, b) => {
        const at = /^\d{2}:\d{2}$/.test(a.time) ? a.time : '99:99';
        const bt = /^\d{2}:\d{2}$/.test(b.time) ? b.time : '99:99';
        return at.localeCompare(bt) || String(a.title || '').localeCompare(String(b.title || ''));
      });

      return jsonResponse(items, 200, 5);
    }

    // ── CREATE VENUE (super_admin only) ──
    if (req.method === 'POST' && path === 'venues') {
      const { data: superRole } = await admin.from('user_roles')
        .select('id').eq('user_id', userId).eq('role', 'super_admin').maybeSingle();
      if (!superRole) return errorResponse('Only super_admin can create venues', 403);

      const body = await req.json();
      if (!body.name || !body.slug) return errorResponse('Missing name or slug');

      const { data, error: e } = await admin.from('venues').insert({
        name: body.name,
        slug: body.slug,
        city: body.city || null,
        address: body.address || null,
      }).select().single();
      if (e) return errorResponse(e.message);

      // Add creator as venue_admin staff
      await admin.from('venue_staff').insert({
        venue_id: data.id, user_id: userId, role: 'venue_admin', is_active: true,
      });

      return jsonResponse(data, 201);
    }

    // ── VENUE INFO ──
    if (req.method === 'GET' && path === 'venue') {
      const { data, error: e } = await admin.from('venues').select('*').eq('id', venueId).single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 30);
    }

    if (req.method === 'PATCH' && path === 'venue') {
      const body = await req.json();
      const { data, error: e } = await admin.from('venues').update(body).eq('id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    // ── STAFF ──
    if (req.method === 'GET' && path === 'staff') {
      const { data, error: e } = await admin.from('venue_staff')
        .select('id, user_id, role, is_active, created_at')
        .eq('venue_id', venueId).order('created_at');
      if (e) return errorResponse(e.message);

      // Enrich with profile names
      const userIds = (data || []).map((s: any) => s.user_id);
      const { data: profiles } = await admin.from('player_profiles')
        .select('auth_user_id, display_name, phone').in('auth_user_id', userIds);

      const enriched = (data || []).map((s: any) => {
        const p = (profiles || []).find((p: any) => p.auth_user_id === s.user_id);
        return { ...s, display_name: p?.display_name || 'Unknown', phone: p?.phone };
      });

      return jsonResponse(enriched, 200, 10);
    }

    if (req.method === 'POST' && path === 'staff') {
      const { email, role } = await req.json();
      if (!email || !role) return errorResponse('Missing email or role');

      // Find user by email in auth
      const { data: { users }, error: authErr } = await admin.auth.admin.listUsers();
      if (authErr) return errorResponse(authErr.message);
      const user = users.find((u: any) => u.email === email);
      if (!user) return errorResponse('User not found. They must sign up first.', 404);

      const { data, error: e } = await admin.from('venue_staff').insert({
        venue_id: venueId, user_id: user.id, role, is_active: true,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'staff') {
      const { staffId, role, isActive } = await req.json();
      if (!staffId) return errorResponse('Missing staffId');
      const updates: any = {};
      if (role) updates.role = role;
      if (isActive !== undefined) updates.is_active = isActive;
      const { data, error: e } = await admin.from('venue_staff')
        .update(updates).eq('id', staffId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'staff') {
      const staffId = url.searchParams.get('staffId');
      if (!staffId) return errorResponse('Missing staffId');
      const { error: e } = await admin.from('venue_staff').delete().eq('id', staffId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── COURTS ──
    if (req.method === 'GET' && path === 'courts') {
      const { data, error: e } = await admin.from('venue_courts')
        .select('*').eq('venue_id', venueId).order('court_number');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'courts') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('venue_courts').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'courts') {
      const { courtId, ...updates } = await req.json();
      if (!courtId) return errorResponse('Missing courtId');
      const { data, error: e } = await admin.from('venue_courts')
        .update(updates).eq('id', courtId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'courts') {
      const courtId = url.searchParams.get('courtId');
      if (!courtId) return errorResponse('Missing courtId');
      const { error: e } = await admin.from('venue_courts').delete().eq('id', courtId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── VENUE OPERATION OVERRIDES ──
    if (req.method === 'GET' && path === 'venue-operation-overrides') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = admin
        .from('venue_operation_overrides')
        .select('*')
        .eq('venue_id', venueId)
        .order('starts_at', { ascending: true });
      if (from) query = query.gte('ends_at', from);
      if (to) query = query.lte('starts_at', to);

      const { data, error: e } = await query;
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'venue-operation-impact') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const affectsEntireVenue = body.affects_entire_venue !== false;
      const courtIds = Array.isArray(body.venue_court_ids)
        ? Array.from(new Set(body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)))
        : [];
      if (!affectsEntireVenue && courtIds.length === 0) return errorResponse('Select at least one court or affect the entire venue', 400);

      let range;
      try {
        range = operationRangeFromBody(body);
        if (!affectsEntireVenue) await resourceIdsForCourtIds(admin, requestedVenueId, courtIds);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid operation override', 400);
      }

      const impact = await analyzeOperationImpact(
        admin,
        requestedVenueId,
        range.starts_at!,
        range.ends_at!,
        affectsEntireVenue,
        courtIds,
        body.overrideId ? String(body.overrideId) : null,
      );
      return jsonResponse(impact);
    }

    if (req.method === 'POST' && path === 'venue-operation-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const title = String(body.title || '').trim().slice(0, 180);
      const reason = String(body.reason || '').trim().slice(0, 1000);
      const affectsEntireVenue = body.affects_entire_venue !== false;
      const courtIds = Array.isArray(body.venue_court_ids)
        ? Array.from(new Set(body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)))
        : [];
      const metadata = cleanBlockMetadata(body.metadata);
      if (!title) return errorResponse('Missing title', 400);
      if (!affectsEntireVenue && courtIds.length === 0) return errorResponse('Select at least one court or affect the entire venue', 400);

      let range;
      let overrideType;
      let resourceIds: string[] = [];
      let resolvedCourtIds = courtIds;
      try {
        range = operationRangeFromBody(body);
        overrideType = normalizeOverrideType(body.override_type);
        if (affectsEntireVenue) {
          const courtResources = await activeBookableCourtResources(admin, requestedVenueId);
          resourceIds = courtResources.map((row: any) => String(row.id)).filter(Boolean);
          resolvedCourtIds = courtResources.map((row: any) => String(row.venue_court_id)).filter(Boolean);
          if (resourceIds.length === 0) return errorResponse('No active bookable court resources found for venue', 400);
        } else {
          resourceIds = await resourceIdsForCourtIds(admin, requestedVenueId, courtIds);
        }
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid operation override', 400);
      }

      const impact = await analyzeOperationImpact(admin, requestedVenueId, range.starts_at!, range.ends_at!, affectsEntireVenue, resolvedCourtIds);
      const { data: override, error: overrideError } = await admin
        .from('venue_operation_overrides')
        .insert({
          venue_id: requestedVenueId,
          title,
          reason: reason || null,
          override_type: overrideType,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          affects_entire_venue: affectsEntireVenue,
          status: 'active',
          created_by: userId,
          metadata: {
            ...metadata,
            venue_court_ids: resolvedCourtIds,
            resource_catalog_ids: resourceIds,
            impact_snapshot: {
              bookings_count: impact.bookings.count,
              activities_count: impact.activities.count,
              blocks_count: impact.blocks.count,
            },
          },
        })
        .select()
        .single();
      if (overrideError) return errorResponse(overrideError.message);

      const blockMetadata = {
        scope: 'courts',
        affects_entire_venue: affectsEntireVenue,
        venue_operation_override_id: override.id,
        override_type: overrideType,
        venue_court_ids: resolvedCourtIds,
        resource_catalog_ids: resourceIds,
        note: reason,
      };
      const blockRows = resourceIds.map((resourceId: string) => ({
        venue_id: requestedVenueId,
        resource_catalog_id: resourceId,
        title,
        reason: blockReasonForOverride(overrideType),
        status: 'confirmed',
        starts_at: range.starts_at,
        ends_at: range.ends_at,
        blocks_public_booking: true,
        created_by: userId,
        metadata: blockMetadata,
      }));

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .insert(blockRows)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (blocksError) {
        await admin.from('venue_operation_overrides').update({ status: 'cancelled' }).eq('id', override.id).eq('venue_id', requestedVenueId);
        return errorResponse(blocksError.message);
      }

      return jsonResponse({ override, blocks: blocks || [], impact }, 201);
    }

    if (req.method === 'PATCH' && path === 'venue-operation-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);
      const overrideId = String(body.overrideId || body.id || '');
      if (!overrideId) return errorResponse('Missing overrideId', 400);

      const { data: override, error: overrideFetchError } = await admin
        .from('venue_operation_overrides')
        .select('id, status')
        .eq('id', overrideId)
        .eq('venue_id', requestedVenueId)
        .maybeSingle();
      if (overrideFetchError) return errorResponse(overrideFetchError.message);
      if (!override) return errorResponse('Override not found', 404);

      const { data, error: e } = await admin
        .from('venue_operation_overrides')
        .update({ status: 'cancelled' })
        .eq('id', overrideId)
        .eq('venue_id', requestedVenueId)
        .select()
        .single();
      if (e) return errorResponse(e.message);

      const { data: blocks, error: blocksError } = await admin
        .from('event_resource_blocks')
        .update({ status: 'cancelled', blocks_public_booking: false })
        .eq('venue_id', requestedVenueId)
        .contains('metadata', { venue_operation_override_id: overrideId })
        .select('id, status, blocks_public_booking');
      if (blocksError) return errorResponse(blocksError.message);

      return jsonResponse({ override: data, blocks: blocks || [] });
    }

    if (req.method === 'POST' && path === 'activity-session-overrides') {
      const body = await req.json();
      const requestedVenueId = url.searchParams.get('venueId') || body.venueId || adminVenueId;
      if (!requestedVenueId) return errorResponse('No venue found', 400);

      const activitySessionId = String(body.activity_session_id || body.activitySessionId || '').trim();
      const sessionDate = String(body.session_date || body.sessionDate || '').slice(0, 10);
      const status = String(body.status || '').trim();
      const reason = String(body.reason || '').trim().slice(0, 1000);
      const venueOperationOverrideId = body.venue_operation_override_id || body.venueOperationOverrideId || null;
      const metadata = cleanBlockMetadata(body.metadata);

      if (!activitySessionId) return errorResponse('Missing activity_session_id', 400);
      if (!sessionDate) return errorResponse('Missing session_date', 400);
      if (!['active', 'hidden', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);

      const { data: session, error: sessionError } = await admin
        .from('activity_sessions')
        .select('id, venue_id')
        .eq('id', activitySessionId)
        .eq('venue_id', requestedVenueId)
        .maybeSingle();
      if (sessionError) return errorResponse(sessionError.message);
      if (!session) return errorResponse('Activity session not found for venue', 404);

      const counts = await activityRegistrationCounts(admin, [activitySessionId], sessionDate, sessionDate);
      const registrationsCount = counts.get(activityOverrideKey(activitySessionId, sessionDate)) || 0;
      if (registrationsCount > 0 && body.confirm !== true) {
        return jsonResponse({
          requires_confirmation: true,
          registrations_count: registrationsCount,
          message: 'Activity occurrence has registrations. Confirm before changing visibility.',
        }, 409);
      }

      const { data, error: upsertError } = await admin
        .from('activity_session_overrides')
        .upsert({
          venue_id: requestedVenueId,
          activity_session_id: activitySessionId,
          session_date: sessionDate,
          status,
          reason: reason || null,
          venue_operation_override_id: venueOperationOverrideId || null,
          metadata: {
            ...metadata,
            registrations_count_at_change: registrationsCount,
          },
        }, { onConflict: 'venue_id,activity_session_id,session_date' })
        .select()
        .single();
      if (upsertError) return errorResponse(upsertError.message);

      return jsonResponse({ override: data, registrations_count: registrationsCount });
    }

    // ── EVENT RESOURCE BLOCKS ──
    if (req.method === 'GET' && path === 'resource-blocks') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = admin
        .from('event_resource_blocks')
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)')
        .eq('venue_id', venueId)
        .order('starts_at', { ascending: true });
      if (from) query = query.gte('ends_at', from);
      if (to) query = query.lte('starts_at', to);

      const { data, error: e } = await query;
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'resource-blocks') {
      const body = await req.json();
      const title = String(body.title || '').trim().slice(0, 180);
      const reason = String(body.reason || 'manual');
      const status = String(body.status || 'hold');
      const scope = String(body.scope || 'courts');
      const courtIds = Array.isArray(body.venue_court_ids)
        ? body.venue_court_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [];
      const explicitResourceIds = Array.isArray(body.resource_catalog_ids)
        ? body.resource_catalog_ids.map((id: unknown) => String(id)).filter(Boolean)
        : [];
      const groupId = String(body.group_id || body.metadata?.group_id || crypto.randomUUID());
      const blockRef = String(body.block_ref || body.metadata?.block_ref || createBlockRef());
      const note = String(body.note || body.metadata?.note || '').trim().slice(0, 1000);

      if (!title) return errorResponse('Missing title');
      if (!['manual', 'event', 'maintenance', 'private', 'internal'].includes(reason)) return errorResponse('Invalid reason', 400);
      if (!['hold', 'confirmed', 'released', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);

      let range;
      try {
        range = stockholmBlockRange(body.date, body.start_time, body.end_time);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid date/time', 400);
      }

      let resourceIds = [...explicitResourceIds];
      if (courtIds.length) {
        const { data: courts, error: courtsError } = await admin
          .from('venue_courts')
          .select('id, name, court_number, sport_type')
          .eq('venue_id', venueId)
          .in('id', courtIds);
        if (courtsError) return errorResponse(courtsError.message);
        if ((courts || []).length !== courtIds.length) return errorResponse('One or more courts do not belong to this venue', 400);

        const { data: existingCatalog, error: catalogError } = await admin
          .from('event_resource_catalog')
          .select('id, venue_court_id')
          .eq('venue_id', venueId)
          .eq('resource_type', 'court')
          .in('venue_court_id', courtIds);
        if (catalogError) return errorResponse(catalogError.message);

        const existingByCourt = new Map((existingCatalog || []).map((row: any) => [row.venue_court_id, row.id]));
        const missingCourts = (courts || []).filter((court: any) => !existingByCourt.has(court.id));
        if (missingCourts.length) {
          const { data: inserted, error: insertError } = await admin
            .from('event_resource_catalog')
            .insert(missingCourts.map((court: any) => ({
              venue_id: venueId,
              resource_type: 'court',
              name: court.name,
              description: court.sport_type || null,
              venue_court_id: court.id,
              unit: 'event',
              is_bookable: true,
              is_active: true,
              sort_order: court.court_number || 100,
            })))
            .select('id, venue_court_id');
          if (insertError) return errorResponse(insertError.message);
          for (const row of inserted || []) existingByCourt.set(row.venue_court_id, row.id);
        }

        resourceIds = [...resourceIds, ...courtIds.map((courtId: string) => existingByCourt.get(courtId)).filter(Boolean)];
      }

      if (scope !== 'venue' && resourceIds.length === 0) {
        return errorResponse('Select at least one resource or use venue scope', 400);
      }

      if (resourceIds.length) {
        const { data: validResources, error: validError } = await admin
          .from('event_resource_catalog')
          .select('id')
          .eq('venue_id', venueId)
          .in('id', resourceIds);
        if (validError) return errorResponse(validError.message);
        const validIds = new Set((validResources || []).map((row: any) => row.id));
        resourceIds = Array.from(new Set(resourceIds.filter((id: string) => validIds.has(id))));
      }

      const rows = scope === 'venue'
        ? [{
          venue_id: venueId,
          resource_catalog_id: null,
          title,
          reason,
          status,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          blocks_public_booking: body.blocks_public_booking !== false,
          created_by: userId,
          metadata: { scope: 'venue', group_id: groupId, block_ref: blockRef, note },
        }]
        : resourceIds.map((resourceId: string) => ({
          venue_id: venueId,
          resource_catalog_id: resourceId,
          title,
          reason,
          status,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
          blocks_public_booking: body.blocks_public_booking !== false,
          created_by: userId,
          metadata: { group_id: groupId, block_ref: blockRef, note },
        }));

      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .insert(rows)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 201);
    }

    if (req.method === 'PATCH' && path === 'resource-blocks') {
      const body = await req.json();
      const blockId = body.blockId || body.id;
      const blockIds = Array.isArray(body.blockIds)
        ? body.blockIds.map((id: unknown) => String(id)).filter(Boolean)
        : blockId ? [String(blockId)] : [];
      if (blockIds.length === 0) return errorResponse('Missing blockId');
      const updates: any = {};
      if (body.title !== undefined) updates.title = String(body.title || '').trim().slice(0, 180);
      if (body.reason !== undefined) {
        const reason = String(body.reason);
        if (!['manual', 'event', 'maintenance', 'private', 'internal'].includes(reason)) return errorResponse('Invalid reason', 400);
        updates.reason = reason;
      }
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!['hold', 'confirmed', 'released', 'cancelled'].includes(status)) return errorResponse('Invalid status', 400);
        updates.status = status;
      }
      if (body.blocks_public_booking !== undefined) updates.blocks_public_booking = Boolean(body.blocks_public_booking);
      if (body.date || body.start_time || body.end_time) {
        let range;
        try {
          range = stockholmBlockRange(body.date, body.start_time, body.end_time);
        } catch (err) {
          return errorResponse(err instanceof Error ? err.message : 'Invalid date/time', 400);
        }
        updates.starts_at = range.starts_at;
        updates.ends_at = range.ends_at;
      }
      if (body.note !== undefined || body.metadata !== undefined) {
        const { data: currentRows, error: currentError } = await admin
          .from('event_resource_blocks')
          .select('id, metadata')
          .eq('venue_id', venueId)
          .in('id', blockIds);
        if (currentError) return errorResponse(currentError.message);
        const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 1000) : undefined;
        const metadataPatch = cleanBlockMetadata(body.metadata);

        for (const row of currentRows || []) {
          const nextMetadata = {
            ...cleanBlockMetadata((row as any).metadata),
            ...metadataPatch,
            ...(note !== undefined ? { note } : {}),
          };
          const { error: metaError } = await admin
            .from('event_resource_blocks')
            .update({ ...updates, metadata: nextMetadata })
            .eq('id', (row as any).id)
            .eq('venue_id', venueId);
          if (metaError) return errorResponse(metaError.message);
        }

        const { data, error: selectError } = await admin
          .from('event_resource_blocks')
          .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)')
          .eq('venue_id', venueId)
          .in('id', blockIds);
        if (selectError) return errorResponse(selectError.message);
        return jsonResponse(data || []);
      }

      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .update(updates)
        .eq('venue_id', venueId)
        .in('id', blockIds)
        .select('*, event_resource_catalog(id, name, resource_type, venue_court_id)');
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'resource-blocks') {
      const blockId = url.searchParams.get('blockId');
      const blockIdsParam = url.searchParams.get('blockIds');
      const blockIds = blockIdsParam
        ? blockIdsParam.split(',').map((id) => id.trim()).filter(Boolean)
        : blockId ? [blockId] : [];
      if (blockIds.length === 0) return errorResponse('Missing blockId');
      const { data, error: e } = await admin
        .from('event_resource_blocks')
        .update({ status: 'released', blocks_public_booking: false })
        .eq('venue_id', venueId)
        .in('id', blockIds)
        .select('id, status, blocks_public_booking')
      ;
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    // ── DISPLAY DEVICES ──
    if (req.method === 'GET' && path === 'display-devices') {
      const { data, error: e } = await admin
        .from('display_devices')
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (e) return errorResponse(e.message);
      return jsonResponse(data || [], 200, 10);
    }

    if (req.method === 'POST' && path === 'display-devices') {
      const body = await req.json();
      const safeName = String(body.name || '').trim();
      if (safeName.length < 2) return errorResponse('Missing name');
      const externalLinks = Array.isArray(body.external_links) ? body.external_links : [];
      const { data, error: e } = await admin
        .from('display_devices')
        .insert({
          venue_id: venueId,
          venue_court_id: body.venue_court_id || null,
          name: safeName.slice(0, 120),
          mode: body.mode || 'resource_home',
          is_active: body.is_active !== false,
          external_links: externalLinks.slice(0, 8),
          instructions: body.instructions ? String(body.instructions).slice(0, 1000) : null,
        })
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'display-devices') {
      const body = await req.json();
      const deviceId = body.deviceId || body.id;
      if (!deviceId) return errorResponse('Missing deviceId');
      const updates: any = {};
      if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 120);
      if (body.venue_court_id !== undefined) updates.venue_court_id = body.venue_court_id || null;
      if (body.mode !== undefined) updates.mode = body.mode;
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
      if (body.external_links !== undefined) updates.external_links = Array.isArray(body.external_links) ? body.external_links.slice(0, 8) : [];
      if (body.instructions !== undefined) updates.instructions = body.instructions ? String(body.instructions).slice(0, 1000) : null;
      if (body.rotate_token === true) updates.device_token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '').slice(0, 16);

      const { data, error: e } = await admin
        .from('display_devices')
        .update(updates)
        .eq('id', deviceId)
        .eq('venue_id', venueId)
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'display-devices') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return errorResponse('Missing deviceId');
      const { error: e } = await admin
        .from('display_devices')
        .delete()
        .eq('id', deviceId)
        .eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── OPENING HOURS ──
    if (req.method === 'GET' && path === 'hours') {
      const { data, error: e } = await admin.from('opening_hours')
        .select('*').eq('venue_id', venueId).order('day_of_week');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 30);
    }

    if (req.method === 'POST' && path === 'hours') {
      const body = await req.json();
      // Upsert: delete old for this day, insert new
      await admin.from('opening_hours').delete().eq('venue_id', venueId).eq('day_of_week', body.dayOfWeek);
      const { data, error: e } = await admin.from('opening_hours').insert({
        venue_id: venueId,
        day_of_week: body.dayOfWeek,
        open_time: body.openTime,
        close_time: body.closeTime,
        is_closed: body.isClosed || false,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    // ── PRICING RULES ──
    if (req.method === 'GET' && path === 'pricing') {
      const { data, error: e } = await admin.from('pricing_rules')
        .select('*').eq('venue_id', venueId).order('name');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'pricing') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('pricing_rules').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'pricing') {
      const { ruleId, ...updates } = await req.json();
      if (!ruleId) return errorResponse('Missing ruleId');
      const { data, error: e } = await admin.from('pricing_rules')
        .update(updates).eq('id', ruleId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'pricing') {
      const ruleId = url.searchParams.get('ruleId');
      if (!ruleId) return errorResponse('Missing ruleId');
      const { error: e } = await admin.from('pricing_rules').delete().eq('id', ruleId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── ACCESS PRODUCTS ──
    if (req.method === 'GET' && path === 'products') {
      const { data, error: e } = await admin.from('access_products')
        .select('*').eq('venue_id', venueId).order('sort_order').order('name');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'products') {
      const { venueId: _v, product_key, name, description, product_kind, session_type, base_price_sek, vat_rate, grants, sort_order, is_active } = await req.json();
      if (!product_key || !name) return errorResponse('Missing product_key or name');
      const { data, error: e } = await admin.from('access_products').upsert({
        venue_id: venueId,
        product_key,
        name,
        description: description || null,
        product_kind: product_kind || 'day_access',
        session_type: session_type || null,
        base_price_sek: base_price_sek ?? 0,
        vat_rate: vat_rate ?? 6,
        grants: grants || {},
        sort_order: sort_order ?? 0,
        is_active: is_active ?? true,
      }, { onConflict: 'venue_id,product_key' }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'products') {
      const { productId, ...updates } = await req.json();
      if (!productId) return errorResponse('Missing productId');
      const { data, error: e } = await admin.from('access_products')
        .update(updates).eq('id', productId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'products') {
      const productId = url.searchParams.get('productId');
      if (!productId) return errorResponse('Missing productId');
      const { error: e } = await admin.from('access_products').delete().eq('id', productId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── ACTIVITY PROGRAM / SCHEDULE ──
    if (req.method === 'GET' && path === 'activity-series') {
      const { data, error: e } = await admin.from('activity_series')
        .select('*').eq('venue_id', venueId).order('created_at', { ascending: false });
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'activity-series') {
      const { venueId: _v, ...body } = await req.json();
      if (!body.name) return errorResponse('Missing name');
      const { data, error: e } = await admin.from('activity_series').insert({
        venue_id: venueId,
        name: body.name,
        description: body.description || null,
        series_type: body.series_type || 'program',
        sport_type: body.sport_type || 'pickleball',
        status: body.status || 'active',
        product_key: body.product_key || null,
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        total_sessions: body.total_sessions ?? null,
        metadata: body.metadata || {},
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'activity-series') {
      const { seriesId, ...updates } = await req.json();
      if (!seriesId) return errorResponse('Missing seriesId');
      const { data, error: e } = await admin.from('activity_series')
        .update(updates).eq('id', seriesId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'activity-series') {
      const seriesId = url.searchParams.get('seriesId');
      if (!seriesId) return errorResponse('Missing seriesId');
      const { error: e } = await admin.from('activity_series').delete().eq('id', seriesId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    if (req.method === 'GET' && path === 'activity-sessions') {
      const { data, error: e } = await admin.from('activity_sessions')
        .select('*, activity_series(id, name, series_type)')
        .eq('venue_id', venueId)
        .order('start_time', { ascending: true });
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'activity-sessions') {
      const { venueId: _v, ...body } = await req.json();
      if (!body.name || !body.start_time || !body.end_time) return errorResponse('Missing name/start_time/end_time');
      const normalized = normalizeActivitySessionPayload(body);
      const recurrenceDays = Array.isArray(body.recurrence_days) ? body.recurrence_days : null;
      const { data, error: e } = await admin.from('activity_sessions').insert({
        venue_id: venueId,
        series_id: normalized.series_id || null,
        product_key: normalized.product_key || null,
        name: normalized.name,
        session_type: normalized.session_type || 'open_play',
        sport_type: normalized.sport_type || 'pickleball',
        recurrence_days: recurrenceDays,
        session_date: normalized.session_date || null,
        start_time: normalized.start_time,
        end_time: normalized.end_time,
        price_sek: normalized.price_sek ?? 0,
        capacity: normalized.capacity ?? null,
        court_ids: Array.isArray(normalized.court_ids) ? normalized.court_ids : [],
        access_policy: normalized.access_policy || {},
        is_active: normalized.is_active ?? true,
        publish_status: normalized.publish_status || 'published',
        sort_order: normalized.sort_order ?? 0,
        metadata: normalized.metadata || {},
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'activity-sessions') {
      const { sessionId, ...updates } = await req.json();
      if (!sessionId) return errorResponse('Missing sessionId');
      const normalized = normalizeActivitySessionPayload(updates);
      const { data, error: e } = await admin.from('activity_sessions')
        .update(normalized).eq('id', sessionId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'activity-sessions') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return errorResponse('Missing sessionId');
      const { error: e } = await admin.from('activity_sessions').delete().eq('id', sessionId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── VENUE LINKS ──
    if (req.method === 'GET' && path === 'links') {
      const { data, error: e } = await admin.from('venue_links')
        .select('*').eq('venue_id', venueId).order('sort_order');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'links') {
      const { venueId: _v, ...body } = await req.json();
      const { data, error: e } = await admin.from('venue_links').insert({
        venue_id: venueId, ...body,
      }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'PATCH' && path === 'links') {
      const { linkId, ...updates } = await req.json();
      if (!linkId) return errorResponse('Missing linkId');
      const { data, error: e } = await admin.from('venue_links')
        .update(updates).eq('id', linkId).eq('venue_id', venueId).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data);
    }

    if (req.method === 'DELETE' && path === 'links') {
      const linkId = url.searchParams.get('linkId');
      if (!linkId) return errorResponse('Missing linkId');
      const { error: e } = await admin.from('venue_links').delete().eq('id', linkId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    // ── EVENT CATEGORIES ──
    if (req.method === 'GET' && path === 'event-categories') {
      const { data, error: e } = await admin.from('venue_event_categories')
        .select('*').eq('venue_id', venueId).order('category_key');
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 200, 15);
    }

    if (req.method === 'POST' && path === 'event-categories') {
      const body = await req.json();
      if (!body.categoryKey || !body.displayName) return errorResponse('Missing categoryKey or displayName');
      const { data, error: e } = await admin.from('venue_event_categories').upsert({
        venue_id: venueId,
        category_key: body.categoryKey,
        display_name: body.displayName,
        logo_url: body.logoUrl || null,
        whatsapp_url: body.whatsappUrl || null,
      }, { onConflict: 'venue_id,category_key' }).select().single();
      if (e) return errorResponse(e.message);
      return jsonResponse(data, 201);
    }

    if (req.method === 'DELETE' && path === 'event-categories') {
      const catId = url.searchParams.get('id');
      if (!catId) return errorResponse('Missing id');
      const { error: e } = await admin.from('venue_event_categories').delete().eq('id', catId).eq('venue_id', venueId);
      if (e) return errorResponse(e.message);
      return jsonResponse({ ok: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
