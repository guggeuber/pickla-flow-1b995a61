import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import { resolveActivityPricingDecision } from '../_shared/activity_pricing.ts';
import {
  resolveCustomerIdForUser,
  resolveOrCreateCustomerIdForUser,
  resolveOrCreateGuestCustomerByEmail,
  linkExistingCustomerToVerifiedAuth,
} from '../_shared/customers.ts';
import { canonicalPublicOrigin } from '../_shared/canonical_origin.ts';
import { evaluateCommerceAvailability, type CommerceProductLike } from '../_shared/commerce_availability.ts';
import { activitySessionOccurrenceInterval } from '../_shared/activity_session_time.ts';
import { canonicalEntitlementFields, type EntitlementFundingType } from '../_shared/entitlements.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const CART_TOKEN_BYTES = 32;
const MAX_CART_LINES = 25;
const MAX_QUANTITY = 100;
const SHOP_DRAFT_SCOPE = 'shop';
const DRAFT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const STRIPE_API_BASE = (Deno.env.get('STRIPE_API_BASE') || 'https://api.stripe.com/v1').replace(/\/$/, '');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminClient = ReturnType<typeof getServiceClient>;
type DbRecord = Record<string, unknown>;

function productMaxQuantity(product: CommerceProduct) {
  const configured = Number(product?.resolver_rules?.max_quantity ?? 20);
  return Math.max(1, Math.min(MAX_QUANTITY, Number.isFinite(configured) ? Math.floor(configured) : 20));
}

type StripeCheckoutSession = { id: string; url: string | null };

type CommerceProduct = CommerceProductLike & {
  id: string;
  venue_id: string;
  product_key: string;
  product_kind?: string | null;
  name: string;
  description?: string | null;
  commerce_kind: string;
  fulfillment_type: string;
  resolver_rules?: Record<string, unknown> | null;
};

type RpcVersionRow = {
  version: number;
  total_inc_vat_minor?: number | string | null;
};

type DeskFulfillmentOrderRow = {
  id: string;
  customer_id: string | null;
  guest_name: string | null;
  status: string;
  booking_receipts: { receipt_number: string } | Array<{ receipt_number: string }> | null;
};

type DeskFulfillmentLineRow = {
  id: string;
  commerce_order_id: string;
  product_name: string;
  quantity: number;
  fulfillment_status: string;
  fulfilled_at: string | null;
  activity_session_id: string | null;
};

type DeskFulfillmentCustomerRow = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

type DeskFulfillmentActivityRow = {
  id: string;
  name: string;
};

type DeskFulfillmentItem = {
  line_id: string;
  order_reference: string;
  customer_name: string;
  activity_title: string | null;
  product_name: string;
  quantity: number;
  order_status: string;
  fulfillment_status: string;
  fulfilled_at: string | null;
  pickup_instruction: string;
  pickup_eligible: boolean;
};

const DESK_PICKUP_INSTRUCTION = 'Hämtas vid disken.';

function appendStripeFormValue(body: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendStripeFormValue(body, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendStripeFormValue(body, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  body.append(key, String(value));
}

async function createStripeCheckoutSession(stripeKey: string, data: Record<string, unknown>) {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => appendStripeFormValue(body, key, value));
  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe API error ${response.status}`);
  return payload as StripeCheckoutSession;
}

async function createStripeRefund(stripeKey: string, paymentIntentId: string, orderId: string) {
  const body = new URLSearchParams({
    payment_intent: paymentIntentId,
    reason: 'requested_by_customer',
    'metadata[commerce_order_id]': orderId,
  });
  const response = await fetch(`${STRIPE_API_BASE}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `commerce-cancel-${orderId}`,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe API error ${response.status}`);
  return payload as { id: string; status?: string };
}

function safeLocalPath(value: unknown, fallback: string) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  return path.slice(0, 600);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function newCartToken() {
  const bytes = new Uint8Array(CART_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

const CLIENT_COMMERCE_EVENTS = new Set(['activity_sheet_opened', 'logged_out_cta_clicked']);

async function recordCommerceEvent(admin: AdminClient, input: {
  eventName: string;
  venueId?: string | null;
  orderId?: string | null;
  activitySessionId?: string | null;
  journeyId?: string | null;
  journeyHash?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const journey = String(input.journeyId || '').trim().slice(0, 120);
  const safeMetadata = Object.fromEntries(Object.entries(input.metadata || {}).filter(([key, value]) => (
    ['source', 'authenticated', 'within_7d', 'within_30d', 'outcome'].includes(key)
    && ['string', 'number', 'boolean'].includes(typeof value)
  )));
  const { error } = await admin.from('commerce_events').insert({
    venue_id: input.venueId || null,
    commerce_order_id: input.orderId || null,
    activity_session_id: input.activitySessionId || null,
    event_name: input.eventName,
    journey_id_hash: input.journeyHash || (journey ? await sha256(journey) : null),
    duration_ms: input.durationMs == null ? null : Math.max(0, Math.floor(input.durationMs)),
    metadata: safeMetadata,
  });
  if (error) console.error('commerce event failed', input.eventName, error.message);
}

function normalizeActivityDraftScope(value: unknown) {
  const scope = String(value || '').trim().toLowerCase().slice(0, 160);
  return /^activity:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/.test(scope) ? scope : '';
}

function normalizeStandaloneIdempotencyKey(value: unknown) {
  const key = String(value || '').trim().slice(0, 200);
  return key.length >= 32 ? key : '';
}

function standaloneDraftExpiry() {
  return new Date(Date.now() + DRAFT_LIFETIME_MS).toISOString();
}

async function expireStandaloneDraftIfNeeded(admin: AdminClient, order: any) {
  if (order?.draft_scope !== SHOP_DRAFT_SCOPE || order?.status !== 'draft') return false;
  if (!order.expires_at || new Date(order.expires_at).getTime() > Date.now()) return false;
  const { error } = await admin.from('commerce_orders').update({
    status: 'expired',
    metadata: { ...(order.metadata || {}), expiry_reason: 'commerce_r1b_stale_shop_draft' },
  }).eq('id', order.id).eq('status', 'draft');
  if (error) throw new Error(error.message);
  return true;
}

async function findStandaloneDraft(
  admin: AdminClient,
  venueId: string,
  userId: string | null,
  idempotencyKeyHash: string,
) {
  let query = admin.from('commerce_orders')
    .select('*')
    .eq('venue_id', venueId)
    .eq('draft_scope', SHOP_DRAFT_SCOPE)
    .eq('status', 'draft');
  query = userId
    ? query.eq('user_id', userId)
    : query.is('user_id', null).eq('draft_idempotency_key_hash', idempotencyKeyHash);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { order: null, expired: false };
  if (await expireStandaloneDraftIfNeeded(admin, data)) return { order: null, expired: true };
  return { order: data, expired: false };
}

async function claimStandaloneGuestDraft(admin: AdminClient, order: any, userId?: string | null) {
  if (!userId || order?.draft_scope !== SHOP_DRAFT_SCOPE || order?.status !== 'draft' || order?.user_id) {
    return order;
  }
  const existing = await findStandaloneDraft(
    admin,
    String(order.venue_id),
    userId,
    String(order.draft_idempotency_key_hash || ''),
  );
  if (existing.order && existing.order.id !== order.id) throw new Error('Shop cart owner conflict');
  const customerId = await resolveOrCreateCustomerIdForUser(admin, userId, order.venue_id, 'commerce_shop_cart_claim');
  const { data, error } = await admin.from('commerce_orders')
    .update({ user_id: userId, customer_id: customerId })
    .eq('id', order.id)
    .eq('status', 'draft')
    .is('user_id', null)
    .select('*')
    .maybeSingle();
  if (error?.code === '23505') throw new Error('Shop cart owner conflict');
  if (error) throw new Error(error.message);
  return data || order;
}

async function optionalUser(req: Request) {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { userId: null as string | null };
  const auth = await getAuthenticatedClient(req);
  if (auth.error || !auth.userId) throw new Error('Unauthorized');
  return { userId: auth.userId };
}

async function loadOrderByToken(admin: AdminClient, token: string, userId?: string | null, allowReceiptToken = false) {
  if (!token || token.length < 32) throw new Error('Invalid cart token');
  const tokenHash = await sha256(token);
  let query = admin.from('commerce_orders').select('*');
  query = allowReceiptToken
    ? query.or(`guest_token_hash.eq.${tokenHash},receipt_token_hash.eq.${tokenHash}`)
    : query.eq('guest_token_hash', tokenHash);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Cart not found');
  const order = await claimStandaloneGuestDraft(admin, data, userId);
  const receiptTokenMatches = allowReceiptToken && order.receipt_token_hash === tokenHash && ['paid', 'attention'].includes(order.status);
  if (order.user_id && order.user_id !== userId && !receiptTokenMatches) throw new Error('Forbidden');
  if (await expireStandaloneDraftIfNeeded(admin, order)) throw new Error('Cart expired');
  return order;
}

async function loadOrderByReference(admin: AdminClient, reference: string, userId?: string | null, allowReceiptToken = false) {
  const cleanReference = String(reference || '').trim();
  if (userId && UUID_PATTERN.test(cleanReference)) {
    const { data: order, error } = await admin.from('commerce_orders')
      .select('*')
      .eq('id', cleanReference)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error('Cart not found');
    if (order.user_id !== userId) throw new Error('Forbidden');
    if (await expireStandaloneDraftIfNeeded(admin, order)) throw new Error('Cart expired');
    return order;
  }
  return loadOrderByToken(admin, cleanReference, userId, allowReceiptToken);
}

async function findAuthenticatedActivityDraft(admin: AdminClient, venueId: string, userId: string, draftScope: string) {
  const { data, error } = await admin.from('commerce_orders')
    .select('*')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .eq('draft_scope', draftScope)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    await admin.from('commerce_orders').update({
      status: 'expired',
      metadata: { ...(data.metadata || {}), expiry_reason: 'commerce_r1_stale_activity_draft' },
    }).eq('id', data.id).eq('status', 'draft');
    return null;
  }
  return data;
}

async function loadOrderLines(admin: AdminClient, orderId: string): Promise<DbRecord[]> {
  const { data, error } = await admin
    .from('commerce_order_lines')
    .select('*')
    .eq('commerce_order_id', orderId)
    .order('sort_order')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data || []) as DbRecord[];
}

function projectOrderLine(line: DbRecord) {
  const resolver = (line.resolver_snapshot || {}) as DbRecord;
  const debug = (resolver.debug || {}) as DbRecord;
  const productSnapshot = (line.product_snapshot || {}) as DbRecord;
  return {
    id: line.id,
    product_id: line.product_id,
    product_key: line.product_key,
    product_name: line.product_name,
    commerce_kind: line.commerce_kind,
    quantity: line.quantity,
    unit_price_minor: line.unit_price_minor,
    discount_minor: line.discount_minor,
    line_total_inc_vat_minor: line.line_total_inc_vat_minor,
    line_total_ex_vat_minor: line.line_total_ex_vat_minor,
    vat_rate: line.vat_rate,
    vat_amount_minor: line.vat_amount_minor,
    fulfillment_type: line.fulfillment_type,
    fulfillment_status: line.fulfillment_status,
    activity_session_id: line.activity_session_id,
    session_date: line.session_date,
    session_registration_id: line.session_registration_id,
    parent_line_id: line.parent_line_id,
    product_snapshot: {
      base_price_sek: Number(productSnapshot.base_price_sek || 0),
      customer_instruction_code: productSnapshot.customer_instruction_code || null,
      max_quantity: productMaxQuantity({ resolver_rules: productSnapshot.resolver_rules || {} } as CommerceProduct),
    },
    resolver_snapshot: {
      pricing_reason: resolver.pricing_reason || null,
      purchase_kind: resolver.purchase_kind || 'activity_ticket',
      applied_price_type: resolver.applied_price_type || resolver.pricing_reason || null,
      final_price_minor: Number(resolver.final_price_minor ?? line.unit_price_minor ?? 0),
      early_bird_remaining: resolver.early_bird_remaining == null ? null : Number(resolver.early_bird_remaining),
      quote_changed: resolver.quote_changed === true,
      access_decision: resolver.access_decision || null,
      entitlement_type: resolver.entitlement_type || null,
      membership_tier_name: resolver.membership_tier_name || null,
      debug: {
        base_amount_sek: Number(debug.base_amount_sek || productSnapshot.base_price_sek || 0),
        pricing_reason: debug.pricing_reason || resolver.pricing_reason || null,
        access_decision: debug.access_decision || resolver.access_decision || null,
        membership_tier_name: debug.membership_tier_name || resolver.membership_tier_name || null,
      },
    },
  };
}

function projectReceiptLine(line: DbRecord) {
  return {
    id: line.id,
    product_id: line.product_id,
    product_key: line.product_key,
    product_name: line.product_name,
    commerce_kind: line.commerce_kind,
    quantity: line.quantity,
    unit_price_minor: line.unit_price_minor,
    discount_minor: line.discount_minor,
    line_total_inc_vat_minor: line.total_inc_vat_minor,
    line_total_ex_vat_minor: line.total_ex_vat_minor,
    vat_rate: line.vat_rate,
    vat_amount_minor: line.vat_amount_minor,
    fulfillment_type: line.fulfillment_type,
  };
}

async function cartResponse(admin: AdminClient, order: any, token?: string | null) {
  const lines = await loadOrderLines(admin, order.id);
  let receipt = null;
  let receiptLines: any[] = [];
  if (order.booking_receipt_id) {
    const [{ data: receiptRow }, { data: lineRows }] = await Promise.all([
      admin.from('booking_receipts')
        .select('id, receipt_number, total_inc_vat_sek, total_ex_vat_sek, vat_amount_sek, vat_rate, currency, issued_at, payment_status')
        .eq('id', order.booking_receipt_id)
        .maybeSingle(),
      admin.from('commerce_receipt_lines')
        .select('*')
        .eq('booking_receipt_id', order.booking_receipt_id)
        .order('sort_order'),
    ]);
    receipt = receiptRow || null;
    receiptLines = lineRows || [];
  }
  const participation = lines.find((line) => line.commerce_kind === 'participation');
  let activityAccess = null;
  if (participation?.activity_session_id) {
    const [{ data: activity }, { data: registration }, { data: venue }] = await Promise.all([
      admin.from('activity_sessions')
        .select('id, venue_id, name, start_time, end_time')
        .eq('id', participation.activity_session_id)
        .eq('venue_id', order.venue_id)
        .maybeSingle(),
      participation.session_registration_id
        ? admin.from('session_registrations')
            .select('id, status')
            .eq('id', participation.session_registration_id)
            .eq('customer_id', order.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('venues').select('name, slug').eq('id', order.venue_id).maybeSingle(),
    ]);
    activityAccess = activity ? {
      activity_session_id: activity.id,
      session_date: participation.session_date,
      name: activity.name,
      start_time: activity.start_time,
      end_time: activity.end_time,
      venue_name: venue?.name || null,
      venue_slug: venue?.slug || null,
      registration_id: registration?.id || null,
      registration_status: registration?.status || null,
    } : null;
  }
  return {
    order: {
      id: order.id,
      venue_id: order.venue_id,
      status: order.status,
      version: order.version,
      currency: order.currency,
      subtotal_minor: order.subtotal_minor,
      discount_minor: order.discount_minor,
      total_inc_vat_minor: order.total_inc_vat_minor,
      total_ex_vat_minor: order.total_ex_vat_minor,
      vat_amount_minor: order.vat_amount_minor,
      draft_scope: order.draft_scope || null,
      contact_email_present: Boolean(order.guest_email),
      guest_claimed: Boolean(order.guest_claimed_at),
      requires_guest_claim: !order.user_id && !order.guest_claimed_at,
      account_claimed: Boolean(order.claimed_user_id || order.user_id),
      claim_expires_at: order.claim_expires_at || null,
      cancellation_pending: Boolean(order.metadata?.cancellation_requested_at),
      paid_at: order.paid_at,
      expires_at: order.expires_at || null,
      booking_receipt_id: order.booking_receipt_id,
      customer_name: ['paid', 'refunded', 'cancelled'].includes(String(order.status))
        ? order.guest_name || null
        : null,
    },
    lines: lines.map(projectOrderLine),
    receipt,
    receipt_lines: receiptLines.map(projectReceiptLine),
    activity_access: activityAccess,
    ...(token ? { cart_token: token } : {}),
  };
}

async function venueContext(admin: AdminClient, venueId: string) {
  const { data, error } = await admin
    .from('venues')
    .select('id, organization_id, name, slug, commerce_enabled')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) throw new Error('Venue not found');
  return data;
}

async function validateCartItems(
  admin: AdminClient,
  venueId: string,
  items: any[],
  userId?: string | null,
  options: { allowEmpty?: boolean } = {},
) {
  if (!Array.isArray(items) || items.length > MAX_CART_LINES || (!options.allowEmpty && items.length === 0)) {
    throw new Error(options.allowEmpty ? 'Cart must contain 0-25 items' : 'Cart must contain 1-25 items');
  }
  if (items.length === 0) return [];
  const productIds = Array.from(new Set(items.map((item) => String(item.product_id || '')).filter(Boolean)));
  const { data: products, error: productError } = await admin
    .from('access_products')
    .select('id, venue_id, product_key, name, description, product_kind, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, commerce_enabled, is_active, status, standalone_enabled, activity_addon_enabled, category, sport, image_url')
    .eq('venue_id', venueId)
    .in('id', productIds);
  if (productError) throw new Error(productError.message);
  const productById = new Map<string, CommerceProduct>(
    (products || []).map((product: CommerceProduct) => [String(product.id), product]),
  );
  if (productById.size !== productIds.length) throw new Error('Product not found');
  const venue = await venueContext(admin, venueId);

  const normalized = items.map((item, index) => {
    const product = productById.get(String(item.product_id || ''));
    if (!product) throw new Error('Product not found');
    const maximum = productMaxQuantity(product);
    const requestedQuantity = Math.floor(Number(item.quantity || 1));
    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > maximum) {
      throw new Error(`Quantity must be between 1 and ${maximum}`);
    }
    const quantity = requestedQuantity;
    if (product.commerce_kind === 'participation' && quantity !== 1) throw new Error('Participation quantity must be one');
    return {
      input: item,
      index,
      id: crypto.randomUUID(),
      product,
      quantity,
      parentLineId: null as string | null,
    };
  });

  const participationItems = normalized.filter((item) => item.product.commerce_kind === 'participation');
  if (participationItems.length > 1) {
    throw new Error('Release 1 supports one participation per cart');
  }

  for (const item of normalized) {
    if (item.product.commerce_kind === 'participation') {
      const availability = evaluateCommerceAvailability(item.product, {
        channel: 'participation',
        venueCommerceEnabled: venue.commerce_enabled === true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Product is not available');
      const isDayPassProduct = item.product.product_key === 'day_access' || item.product.product_kind === 'day_access';
      if (isDayPassProduct && Number(item.product.base_price_sek || 0) <= 0) throw new Error('Heldagspass saknar pris i Admin.');
      const sessionId = String(item.input.activity_session_id || item.input.source_id || '').trim();
      const sessionDate = String(item.input.session_date || '').slice(0, 10);
      if (!sessionId || !sessionDate) throw new Error('Participation requires session and date');
      const { data: session, error: sessionError } = await admin
        .from('activity_sessions')
        .select('id, venue_id, product_key, session_type, access_policy, is_active, publish_status')
        .eq('id', sessionId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (sessionError) throw new Error(sessionError.message);
      if (!session?.is_active || session.publish_status !== 'published') throw new Error('Activity session is not available');
      const expectedKey = session.product_key && session.product_key !== 'day_access'
        ? session.product_key
        : session.session_type === 'open_play' ? 'open_play_slot' : 'session_ticket';
      const dayPassAllowed = isDayPassProduct
        && session.session_type === 'open_play'
        && session.access_policy?.allows_day_access !== false;
      if (!dayPassAllowed && expectedKey && expectedKey !== item.product.product_key) throw new Error('Product does not match activity session');
      item.input.activity_session_id = sessionId;
      item.input.session_date = sessionDate;
      item.input.source_type = 'activity_session';
      item.input.source_id = sessionId;
    }

    if (item.product.commerce_kind !== 'participation') {
      const parentProductId = String(item.input.parent_product_id || '').trim();
      if (!parentProductId) {
        const availability = evaluateCommerceAvailability(item.product, {
          channel: 'standalone',
          venueCommerceEnabled: venue.commerce_enabled === true,
        });
        if (!availability.eligible) throw new Error(availability.message || 'Product is not available as a standalone purchase');
        continue;
      }
      const parent = normalized.find((candidate) => candidate.product.id === parentProductId && candidate.product.commerce_kind === 'participation');
      if (!parent) throw new Error('Add-on must belong to a participation');
      const { data: relation, error: relationError } = await admin
        .from('product_relationships')
        .select('id')
        .eq('venue_id', venueId)
        .eq('source_product_id', parent.product.id)
        .eq('target_product_id', item.product.id)
        .eq('relationship_type', 'offered_with')
        .eq('is_active', true)
        .maybeSingle();
      if (relationError) throw new Error(relationError.message);
      if (!relation) throw new Error('Invalid addon relationship');
      const availability = evaluateCommerceAvailability(item.product, {
        channel: 'activity_addon',
        venueCommerceEnabled: venue.commerce_enabled === true,
        hasActiveRelationship: true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Product is not available with activities');
      item.parentLineId = parent.id;
      item.input.activity_session_id = parent.input.activity_session_id;
      item.input.session_date = parent.input.session_date;
      item.input.source_type = 'activity_addon';
      item.input.source_id = parent.input.activity_session_id;
    }
  }

  return normalized.map((item) => ({
    id: item.id,
    product_id: item.product.id,
    product_key: item.product.product_key,
    product_name: item.product.name,
    commerce_kind: item.product.commerce_kind,
    fulfillment_type: item.product.fulfillment_type,
    vat_rate: Number(item.product.vat_rate || 0),
    quantity: item.quantity,
    source_type: item.input.source_type || 'catalog',
    source_id: item.input.source_id || null,
    activity_session_id: item.input.activity_session_id || null,
    session_date: item.input.session_date || null,
    beneficiary_user_id: item.product.commerce_kind === 'participation' ? userId || null : null,
    beneficiary_customer_id: null,
    parent_line_id: item.parentLineId,
    product_snapshot: {
      description: item.product.description || null,
      base_price_sek: Number(item.product.base_price_sek || 0),
      vat_rate: Number(item.product.vat_rate || 0),
      resolver_rules: item.product.resolver_rules || {},
      customer_instruction_code: String(item.product.resolver_rules?.customer_instruction_code || (
        item.product.commerce_kind === 'rental'
        && item.product.fulfillment_type === 'desk_pickup'
        && /racket|hyrrack/i.test(`${item.product.product_key} ${item.product.name}`)
          ? 'desk_pickup_racket_by_name'
          : ''
      )) || null,
    },
    metadata: item.input.metadata || {},
    sort_order: item.index * 10,
  }));
}

async function resolveLines(
  admin: AdminClient,
  order: any,
  lines: any[],
  userId?: string | null,
  resolvedCustomerId?: string | null,
  options: { applyEarlyBird?: boolean } = {},
) {
  const productIds = lines.map((line) => line.product_id).filter(Boolean);
  const { data: products, error } = await admin
    .from('access_products')
    .select('id, venue_id, product_key, product_kind, name, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, commerce_enabled, is_active, status, standalone_enabled, activity_addon_enabled, category, sport, image_url')
    .in('id', productIds);
  if (error) throw new Error(error.message);
  const productsById = new Map<string, CommerceProduct>(
    (products || []).map((product: CommerceProduct) => [String(product.id), product]),
  );
  const venue = await venueContext(admin, order.venue_id);
  const customerId = resolvedCustomerId ?? (userId ? await resolveCustomerIdForUser(admin, userId) : order.customer_id || null);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const resolved: any[] = [];
  for (const line of lines) {
    const product = productsById.get(line.product_id);
    if (!product) throw new Error('Product is no longer available');
    if (product.venue_id !== order.venue_id || product.commerce_kind !== line.commerce_kind) {
      throw new Error('Product classification changed — review the cart again');
    }
    if (line.commerce_kind !== 'participation' && line.parent_line_id) {
      const parent = lineById.get(line.parent_line_id);
      if (!parent || parent.commerce_kind !== 'participation') throw new Error('Add-on has no participation');
      const { data: relationship, error: relationshipError } = await admin
        .from('product_relationships')
        .select('id')
        .eq('venue_id', order.venue_id)
        .eq('source_product_id', parent.product_id)
        .eq('target_product_id', line.product_id)
        .eq('relationship_type', 'offered_with')
        .eq('is_active', true)
        .maybeSingle();
      if (relationshipError) throw new Error(relationshipError.message);
      if (!relationship) throw new Error('Product relationship changed — review the cart again');
      const availability = evaluateCommerceAvailability(product, {
        channel: 'activity_addon',
        venueCommerceEnabled: venue.commerce_enabled === true,
        hasActiveRelationship: true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Product is no longer available with activities');
    } else if (line.commerce_kind !== 'participation') {
      const availability = evaluateCommerceAvailability(product, {
        channel: 'standalone',
        venueCommerceEnabled: venue.commerce_enabled === true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Product is no longer available as a standalone purchase');
    } else {
      const availability = evaluateCommerceAvailability(product, {
        channel: 'participation',
        venueCommerceEnabled: venue.commerce_enabled === true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Participation is no longer available');
    }
    let unitPriceMinor = Math.round(Number(product.base_price_sek || 0) * 100);
    let resolverSnapshot: Record<string, unknown> = { pricing_source: 'product_base_price' };
    if (line.commerce_kind === 'participation') {
      const purchaseKind = product.product_key === 'day_access' || product.product_kind === 'day_access'
        ? 'day_pass'
        : 'activity_ticket';
      if (purchaseKind === 'day_pass' && Number(product.base_price_sek || 0) <= 0) {
        throw new Error('Heldagspass saknar pris i Admin.');
      }
      const decision = await resolveActivityPricingDecision({
        client: admin,
        venueId: order.venue_id,
        userId,
        activitySessionId: line.activity_session_id,
        sessionDate: line.session_date,
        requestedProductKey: product.product_key,
        requestedAmountSek: Number(product.base_price_sek || 0),
        purchaseKind,
        salesChannel: 'online',
        applyEarlyBird: options.applyEarlyBird !== false,
      });
      unitPriceMinor = Math.round(Number(decision.finalAmountSek || 0) * 100);
      resolverSnapshot = {
        product_key: decision.productKey,
        purchase_kind: purchaseKind,
        pricing_reason: decision.pricingReason,
        access_decision: decision.accessDecision,
        entitlement_type: decision.entitlementType,
        membership_id: decision.membershipId,
        membership_tier_name: decision.membershipTierName,
        applied_price_type: decision.pricingReason,
        final_price_minor: unitPriceMinor,
        early_bird_remaining: (decision.debug?.scarcity as any)?.early_bird?.remaining ?? null,
        quote_changed: false,
        debug: decision.debug,
      };
    }
    resolved.push({
      id: line.id,
      product_id: product.id,
      product_key: product.product_key,
      product_name: product.name,
      commerce_kind: product.commerce_kind,
      fulfillment_type: product.fulfillment_type,
      quantity: line.quantity,
      activity_session_id: line.activity_session_id,
      session_date: line.session_date,
      session_registration_id: line.session_registration_id,
      parent_line_id: line.parent_line_id,
      unit_price_minor: unitPriceMinor,
      discount_minor: 0,
      vat_rate: Number(product.vat_rate || 0),
      beneficiary_user_id: line.commerce_kind === 'participation' ? userId || null : null,
      beneficiary_customer_id: line.commerce_kind === 'participation' ? customerId : null,
      resolver_snapshot: resolverSnapshot,
      product_snapshot: {
        ...(line.product_snapshot || {}),
        name: product.name,
        product_key: product.product_key,
        product_kind: product.product_kind || null,
        commerce_kind: product.commerce_kind,
        fulfillment_type: product.fulfillment_type,
        vat_rate: Number(product.vat_rate || 0),
        resolver_rules: product.resolver_rules || {},
      },
    });
  }
  return resolved;
}

async function assertParticipationCapacityAvailable(admin: AdminClient, order: any, lines: any[]) {
  const participation = lines.find((line) => line.commerce_kind === 'participation');
  if (!participation?.activity_session_id || !participation?.session_date) return;
  const { data, error } = await admin.rpc('capacity_fill', {
    p_venue_id: order.venue_id,
    p_scope_type: 'activity_session',
    p_scope_id: participation.activity_session_id,
    p_session_date: participation.session_date,
  });
  if (error) throw new Error(error.message);
  const fill = Array.isArray(data) ? data[0] : data;
  if (fill?.available_count !== null && Number(fill?.available_count ?? 0) <= 0) {
    throw new Error('Platsen hann tas — välj ett annat pass.');
  }
}

async function acquireParticipationHold(
  admin: AdminClient,
  order: any,
  line: any,
  regularResolvedLine: any,
  quotedResolvedLine: any,
  userId: string | null,
  customerId: string | null,
) {
  const regularPriceType = String(regularResolvedLine?.resolver_snapshot?.pricing_reason || 'regular_price');
  const { data, error } = await admin.rpc('acquire_activity_pricing_hold', {
    p_venue_id: order.venue_id,
    p_activity_session_id: line.activity_session_id,
    p_session_date: line.session_date,
    p_user_id: userId,
    p_customer_id: customerId,
    p_source_type: 'commerce_order',
    p_source_id: line.id,
    p_idempotency_key: `commerce:${order.id}:${line.id}:v${order.version}`,
    p_regular_price_minor: Number(regularResolvedLine?.unit_price_minor || 0),
    p_regular_price_type: regularPriceType,
    p_quoted_price_minor: Number(quotedResolvedLine?.unit_price_minor || 0),
    p_metadata: {
      commerce_order_id: order.id,
      commerce_order_line_id: line.id,
      purchase_kind: regularResolvedLine?.resolver_snapshot?.purchase_kind || 'activity_ticket',
    },
  }).maybeSingle();
  if (error) throw new Error(error.message);
  const hold = (data || {}) as {
    ok?: boolean;
    hold_id?: string;
    final_price_minor?: number;
    applied_price_type?: string;
    early_bird_remaining?: number | null;
    quote_changed?: boolean;
  };
  if (!hold.ok || !hold.hold_id) throw new Error('Platsen hann tas — välj ett annat pass.');
  return hold;
}

async function releaseHold(admin: AdminClient, holdId?: string | null, reason = 'commerce_checkout_failed') {
  if (!holdId) return;
  await admin.rpc('release_capacity_hold', { p_hold_id: holdId, p_reason: reason });
}

async function commitFreeParticipation(admin: AdminClient, order: any, line: any, resolvedLine: any, userId: string | null, customerId: string | null, holdId: string) {
  const { data, error } = await admin.rpc('commit_activity_registration_capacity', {
    p_venue_id: order.venue_id,
    p_activity_session_id: line.activity_session_id,
    p_session_date: line.session_date,
    p_user_id: userId,
    p_customer_id: customerId,
    p_status: 'confirmed',
    p_price_paid_sek: 0,
    p_stripe_session_id: null,
    p_source_type: 'commerce_order',
    p_source_id: line.id,
    p_metadata: { commerce_order_id: order.id, commerce_order_line_id: line.id, ...(resolvedLine.resolver_snapshot || {}) },
    p_hold_id: holdId,
  }).maybeSingle();
  if (error) throw new Error(error.message);
  const committed = (data || {}) as { ok?: boolean; registration_id?: string; reason?: string };
  if (!committed.ok || !committed.registration_id) throw new Error(committed.reason || 'capacity_full');
  await admin.from('commerce_order_lines').update({ session_registration_id: committed.registration_id }).eq('id', line.id);
  const purchaseKind = String(resolvedLine?.resolver_snapshot?.purchase_kind || 'activity_ticket');
  let sourceType = 'session_ticket';
  let sourceId = committed.registration_id;
  let entitlementType = 'session_ticket';
  let activitySessionId: string | null = line.activity_session_id;
  let entitlementSessionDate: string | null = line.session_date;
  let validDate: string | null = null;
  let entitlementMetadata: Record<string, unknown> = { commerce_order_id: order.id, commerce_order_line_id: line.id };
  if (purchaseKind === 'day_pass') {
    const { data: dayPass, error: dayPassError } = await admin.from('day_passes').upsert({
      commerce_order_id: order.id,
      venue_id: order.venue_id,
      user_id: userId,
      customer_id: customerId,
      valid_date: line.session_date,
      price: 0,
      status: 'active',
    }, { onConflict: 'commerce_order_id' }).select('id').single();
    if (dayPassError || !dayPass?.id) throw new Error(dayPassError?.message || 'Commerce day pass could not be delivered');
    sourceType = 'commerce_order';
    sourceId = order.id;
    entitlementType = 'day_access';
    activitySessionId = null;
    entitlementSessionDate = null;
    validDate = line.session_date;
    entitlementMetadata = { ...entitlementMetadata, day_pass_id: dayPass.id };
  }
  const entitlement = {
    venue_id: order.venue_id,
    user_id: userId,
    customer_id: customerId,
    entitlement_type: entitlementType,
    status: 'active',
    source_type: sourceType,
    source_id: sourceId,
    activity_session_id: activitySessionId,
    session_date: entitlementSessionDate,
    valid_date: validDate,
    includes_session_types: ['open_play'],
    metadata: entitlementMetadata,
    ...canonicalEntitlementFields({
      customerId,
      scopeType: purchaseKind === 'day_pass' ? 'open_play' : 'exact_session',
      meterType: purchaseKind === 'day_pass' ? 'valid_day' : 'exact_session',
      fundingType: (() => {
        const pricingReason = String(resolvedLine?.resolver_snapshot?.pricing_reason || '');
        if (pricingReason === 'playing_host' || pricingReason === 'host_comp') return 'house_granted';
        if (pricingReason.includes('membership')) return 'subscription';
        if (pricingReason === 'active_day_access') return 'customer_prepaid';
        return 'commerce_purchase';
      })() as EntitlementFundingType,
      accessReason: purchaseKind === 'day_pass'
        ? 'Heldagspass'
        : String(resolvedLine?.resolver_snapshot?.membership_tier_name || '').toLowerCase() === 'founder'
          ? 'Founder'
          : String(resolvedLine?.resolver_snapshot?.pricing_reason || '').includes('membership')
            ? 'Ingår i ditt medlemskap'
            : 'Personlig plats',
      serviceDate: line.session_date,
      requiresConsumption: true,
    }),
  };
  await admin.from('access_entitlements').upsert(entitlement, {
    onConflict: userId
      ? 'source_type,source_id,user_id,entitlement_type'
      : 'source_type,source_id,customer_id,entitlement_type',
  });
  await admin.from('commerce_orders').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    customer_id: customerId,
    user_id: userId,
    claim_expires_at: userId ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq('id', order.id);
  return committed.registration_id;
}

function deskOrderReference(order: DeskFulfillmentOrderRow) {
  const receipt = Array.isArray(order.booking_receipts) ? order.booking_receipts[0] : order.booking_receipts;
  return receipt?.receipt_number || 'Butiksköp';
}

function serializeDeskFulfillmentItem(
  line: DeskFulfillmentLineRow,
  order: DeskFulfillmentOrderRow,
  customerName: string,
  activity: DeskFulfillmentActivityRow | null,
): DeskFulfillmentItem {
  return {
    line_id: line.id,
    order_reference: deskOrderReference(order),
    customer_name: customerName,
    activity_title: activity?.name || null,
    product_name: line.product_name,
    quantity: line.quantity,
    order_status: order.status,
    fulfillment_status: line.fulfillment_status,
    fulfilled_at: line.fulfilled_at,
    pickup_instruction: DESK_PICKUP_INSTRUCTION,
    pickup_eligible: ['paid', 'attention'].includes(order.status)
      && ['pending_pickup', 'attention'].includes(line.fulfillment_status),
  };
}

async function loadDeskFulfillmentItems(
  admin: AdminClient,
  venueId: string,
  filter: { status?: string; lineId?: string } = {},
): Promise<DeskFulfillmentItem[]> {
  const { data: orderData, error: orderError } = await admin
    .from('commerce_orders')
    .select('id, customer_id, guest_name, status, booking_receipts!commerce_orders_booking_receipt_id_fkey(receipt_number)')
    .eq('venue_id', venueId)
    .in('status', ['paid', 'attention']);
  if (orderError) throw new Error(orderError.message);
  const orders = (orderData || []) as DeskFulfillmentOrderRow[];
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length === 0) return [];

  let lineQuery = admin.from('commerce_order_lines')
    .select('id, commerce_order_id, product_name, quantity, fulfillment_status, fulfilled_at, activity_session_id')
    .in('commerce_order_id', orderIds)
    .eq('fulfillment_type', 'desk_pickup')
    .order('created_at');
  if (filter.status) lineQuery = lineQuery.eq('fulfillment_status', filter.status);
  if (filter.lineId) lineQuery = lineQuery.eq('id', filter.lineId);
  const { data: lineData, error: lineError } = await lineQuery;
  if (lineError) throw new Error(lineError.message);
  const lines = (lineData || []) as DeskFulfillmentLineRow[];
  if (lines.length === 0) return [];

  const customerIds = Array.from(new Set(orders.map((order) => order.customer_id).filter((id): id is string => Boolean(id))));
  const { data: customerData, error: customerError } = customerIds.length
    ? await admin.from('customers').select('id, display_name, first_name, last_name').in('id', customerIds)
    : { data: [], error: null };
  if (customerError) throw new Error(customerError.message);
  const customerById = new Map(((customerData || []) as DeskFulfillmentCustomerRow[]).map((customer) => [customer.id, customer]));

  const activityIds = Array.from(new Set(lines.map((line) => line.activity_session_id).filter((id): id is string => Boolean(id))));
  const { data: activityData, error: activityError } = activityIds.length
    ? await admin.from('activity_sessions').select('id, name').in('id', activityIds)
    : { data: [], error: null };
  if (activityError) throw new Error(activityError.message);
  const activityById = new Map(((activityData || []) as DeskFulfillmentActivityRow[]).map((activity) => [activity.id, activity]));
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return lines.flatMap((line) => {
    const order = orderById.get(line.commerce_order_id);
    if (!order) return [];
    const customer = order.customer_id ? customerById.get(order.customer_id) : null;
    const customerName = order.guest_name || customer?.display_name
      || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ')
      || 'Kund';
    const activity = line.activity_session_id ? activityById.get(line.activity_session_id) || null : null;
    return [serializeDeskFulfillmentItem(line, order, customerName, activity)];
  });
}

const commerceHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean).pop() || '';
  const admin = getServiceClient();

  try {
    const { userId } = await optionalUser(req);

    if (req.method === 'GET' && path === 'catalog') {
      const venueId = url.searchParams.get('venueId') || '';
      if (!venueId) return errorResponse('Missing venueId', 400);
      const [venue, { data: products, error: productError }, { data: relationships, error: relationshipError }] = await Promise.all([
        venueContext(admin, venueId),
        admin.from('access_products')
          .select('id, venue_id, product_key, product_kind, name, description, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, sort_order, status, is_active, standalone_enabled, activity_addon_enabled, category, sport, image_url')
          .eq('venue_id', venueId).eq('status', 'active').eq('is_active', true).order('sort_order'),
        admin.from('product_relationships')
          .select('id, source_product_id, target_product_id, relationship_type, sort_order')
          .eq('venue_id', venueId).eq('is_active', true).order('sort_order'),
      ]);
      if (productError || relationshipError) throw new Error(productError?.message || relationshipError?.message);
      const relatedProductIds = new Set((relationships || []).map((relationship: any) => relationship.target_product_id));
      const availableProducts = (products || []).filter((product) => {
        if (product.commerce_kind === 'participation') {
          if ((product.product_key === 'day_access' || product.product_kind === 'day_access') && Number(product.base_price_sek || 0) <= 0) {
            return false;
          }
          return evaluateCommerceAvailability(product, {
            channel: 'participation',
            venueCommerceEnabled: venue.commerce_enabled === true,
          }).eligible;
        }
        const store = evaluateCommerceAvailability(product, {
          channel: 'standalone',
          venueCommerceEnabled: venue.commerce_enabled === true,
        });
        const addon = evaluateCommerceAvailability(product, {
          channel: 'activity_addon',
          venueCommerceEnabled: venue.commerce_enabled === true,
          hasActiveRelationship: relatedProductIds.has(product.id),
        });
        return store.eligible || addon.eligible;
      }).map((product) => ({
        ...product,
        max_quantity: productMaxQuantity(product),
        store_eligible: evaluateCommerceAvailability(product, {
          channel: 'standalone',
          venueCommerceEnabled: venue.commerce_enabled === true,
        }).eligible,
      }));
      return jsonResponse({
        commerce_available: venue.commerce_enabled === true,
        message: venue.commerce_enabled === true ? null : 'Pickla Store är inte aktiverad för denna anläggning.',
        products: availableProducts,
        relationships: relationships || [],
      }, 200, 0);
    }

    if (req.method === 'POST' && path === 'event') {
      const body = await req.json();
      const eventName = String(body.event_name || '').trim();
      const venueId = String(body.venue_id || '').trim();
      const activitySessionId = String(body.activity_session_id || '').trim();
      const journeyId = String(body.journey_id || '').trim();
      if (!CLIENT_COMMERCE_EVENTS.has(eventName)) return errorResponse('Unsupported event', 400);
      if (!venueId || !activitySessionId || journeyId.length < 16) return errorResponse('Invalid event scope', 400);
      await venueContext(admin, venueId);
      const { data: activity } = await admin.from('activity_sessions')
        .select('id')
        .eq('id', activitySessionId)
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .eq('publish_status', 'published')
        .maybeSingle();
      if (!activity) return errorResponse('Activity not found', 404);
      await recordCommerceEvent(admin, {
        eventName,
        venueId,
        activitySessionId,
        journeyId,
        metadata: { authenticated: Boolean(userId), source: 'activity_drawer' },
      });
      return jsonResponse({ recorded: true }, 202, 0);
    }

    if (req.method === 'GET' && path === 'draft') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const venueId = String(url.searchParams.get('venueId') || '').trim();
      const draftScope = normalizeActivityDraftScope(url.searchParams.get('scope'));
      if (!venueId || !draftScope) return errorResponse('Invalid activity draft scope', 400);
      const order = await findAuthenticatedActivityDraft(admin, venueId, userId, draftScope);
      if (!order) return errorResponse('Cart not found', 404);
      return jsonResponse(await cartResponse(admin, order, order.id), 200, 0);
    }

    if (req.method === 'POST' && path === 'cart') {
      const body = await req.json();
      const venueId = String(body.venue_id || '').trim();
      const venue = await venueContext(admin, venueId);
      const shopScopeRequested = String(body.draft_scope || '').trim().toLowerCase() === SHOP_DRAFT_SCOPE;
      const lines = await validateCartItems(admin, venueId, body.items, userId, { allowEmpty: shopScopeRequested });

      if (shopScopeRequested) {
        if (lines.some((line) => line.commerce_kind === 'participation')) {
          return errorResponse('Activity products require an activity draft', 409);
        }
        const idempotencyKey = normalizeStandaloneIdempotencyKey(body.idempotency_key);
        if (!idempotencyKey) return errorResponse('Standalone cart idempotency key is required', 400);
        const idempotencyKeyHash = await sha256(idempotencyKey);
        const journeyId = String(body.journey_id || '').trim().slice(0, 120);
        const journeyIdHash = journeyId.length >= 16 ? await sha256(journeyId) : null;
        const customerId = userId
          ? await resolveOrCreateCustomerIdForUser(admin, userId, venueId, 'commerce_shop_cart')
          : null;
        const found = await findStandaloneDraft(admin, venueId, userId || null, idempotencyKeyHash);
        if (found.expired && !userId) return errorResponse('Cart expired', 410);
        let order = found.order;
        let created = false;
        const token = userId ? newCartToken() : idempotencyKey;
        if (!order) {
          const { data: insertedOrder, error: orderError } = await admin.from('commerce_orders').insert({
            organization_id: venue.organization_id,
            venue_id: venueId,
            customer_id: customerId,
            user_id: userId,
            guest_token_hash: await sha256(token),
            draft_scope: SHOP_DRAFT_SCOPE,
            draft_idempotency_key_hash: idempotencyKeyHash,
            expires_at: standaloneDraftExpiry(),
            guest_name: body.guest_name || null,
            guest_email: body.guest_email ? String(body.guest_email).trim().toLowerCase() : null,
            guest_phone: body.guest_phone || null,
            metadata: { source: body.source || 'commerce_shop', journey_id_hash: journeyIdHash },
          }).select('*').single();
          if (orderError?.code === '23505') {
            const converged = await findStandaloneDraft(admin, venueId, userId || null, idempotencyKeyHash);
            order = converged.order;
          } else if (orderError) {
            throw new Error(orderError.message);
          } else {
            order = insertedOrder;
            created = true;
          }
        }
        if (!order) throw new Error('Cart not found');

        const existingLines = created ? [] : await loadOrderLines(admin, order.id);
        const shouldReplace = created || (existingLines.length === 0 && lines.length > 0);
        try {
          if (shouldReplace) {
            const { data: replaced, error: replaceError } = await admin.rpc('replace_commerce_cart_lines', {
              p_order_id: order.id,
              p_expected_version: order.version,
              p_lines: lines,
              p_guest_name: body.guest_name || null,
              p_guest_email: body.guest_email || null,
              p_guest_phone: body.guest_phone || null,
            }).maybeSingle();
            const replacedRow = replaced as RpcVersionRow | null;
            if (replaceError || replacedRow?.version == null) {
              if (String(replaceError?.message || '').includes('stale_cart_version')) {
                const converged = await findStandaloneDraft(admin, venueId, userId || null, idempotencyKeyHash);
                if (!converged.order) throw new Error('Cart update failed');
                order = converged.order;
              } else {
                throw new Error(replaceError?.message || 'Cart update failed');
              }
            } else {
              order.version = replacedRow.version;
            }
          }
          const expiresAt = standaloneDraftExpiry();
          const { error: expiryError } = await admin.from('commerce_orders')
            .update({ expires_at: expiresAt })
            .eq('id', order.id)
            .eq('status', 'draft');
          if (expiryError) throw new Error(expiryError.message);
          order.expires_at = expiresAt;
        } catch (error) {
          if (created) await admin.from('commerce_orders').delete().eq('id', order.id).eq('status', 'draft');
          throw error;
        }
        const reference = userId ? order.id : idempotencyKey;
        return jsonResponse(await cartResponse(admin, order, reference), created ? 201 : 200, 0);
      }

      const suppliedDraftScope = normalizeActivityDraftScope(body.draft_scope);
      if (body.draft_scope && !suppliedDraftScope) return errorResponse('Invalid activity draft scope', 400);
      if (suppliedDraftScope && !userId) return errorResponse('Unauthorized', 401);
      const participation = lines.find((line) => line.commerce_kind === 'participation');
      const canonicalDraftScope = participation
        ? `activity:${participation.activity_session_id}:${participation.session_date}`.toLowerCase()
        : '';
      if (suppliedDraftScope && suppliedDraftScope !== canonicalDraftScope) {
        return errorResponse('Activity draft scope does not match cart', 409);
      }
      const persistentDraftScope = userId ? suppliedDraftScope : '';
      const token = newCartToken();
      const tokenHash = await sha256(token);
      const journeyId = String(body.journey_id || '').trim().slice(0, 120);
      const journeyIdHash = journeyId.length >= 16 ? await sha256(journeyId) : null;
      const customerId = userId ? await resolveOrCreateCustomerIdForUser(admin, userId, venueId, 'commerce_cart') : null;
      let order = persistentDraftScope
        ? await findAuthenticatedActivityDraft(admin, venueId, userId!, persistentDraftScope)
        : null;
      let created = false;
      if (!order) {
        const { data: insertedOrder, error: orderError } = await admin.from('commerce_orders').insert({
          organization_id: venue.organization_id,
          venue_id: venueId,
          customer_id: customerId,
          user_id: userId,
          guest_token_hash: tokenHash,
          draft_scope: persistentDraftScope || null,
          expires_at: persistentDraftScope ? standaloneDraftExpiry() : null,
          guest_name: body.guest_name || null,
          guest_email: body.guest_email ? String(body.guest_email).trim().toLowerCase() : null,
          guest_phone: body.guest_phone || null,
          metadata: { source: body.source || 'commerce_cart', journey_id_hash: journeyIdHash },
        }).select('*').single();
        if (orderError?.code === '23505' && persistentDraftScope) {
          order = await findAuthenticatedActivityDraft(admin, venueId, userId!, persistentDraftScope);
        } else if (orderError) {
          throw new Error(orderError.message);
        } else {
          order = insertedOrder;
          created = true;
        }
      }
      if (!order) throw new Error('Cart not found');
      try {
        const { data: replaced, error: replaceError } = await admin.rpc('replace_commerce_cart_lines', {
          p_order_id: order.id,
          p_expected_version: order.version,
          p_lines: lines,
          p_guest_name: body.guest_name || null,
          p_guest_email: body.guest_email || null,
          p_guest_phone: body.guest_phone || null,
        }).maybeSingle();
        const replacedRow = replaced as RpcVersionRow | null;
        if (replaceError || replacedRow?.version == null) throw new Error(replaceError?.message || 'Cart update failed');
        order.version = replacedRow.version;
        if (persistentDraftScope) {
          await admin.from('commerce_orders').update({
            expires_at: standaloneDraftExpiry(),
          }).eq('id', order.id).eq('status', 'draft');
        }
      } catch (error) {
        if (created) await admin.from('commerce_orders').delete().eq('id', order.id).eq('status', 'draft');
        throw error;
      }
      const reference = persistentDraftScope ? order.id : token;
      return jsonResponse(await cartResponse(admin, order, reference), created ? 201 : 200, 0);
    }

    if (req.method === 'PUT' && path === 'cart') {
      const body = await req.json();
      const order = await loadOrderByReference(admin, String(body.token || ''), userId);
      const standaloneShopDraft = order.draft_scope === SHOP_DRAFT_SCOPE;
      const lines = await validateCartItems(admin, order.venue_id, body.items, userId, { allowEmpty: standaloneShopDraft });
      const { data, error } = await admin.rpc('replace_commerce_cart_lines', {
        p_order_id: order.id,
        p_expected_version: Number(body.expected_version),
        p_lines: lines,
        p_guest_name: body.guest_name || null,
        p_guest_email: body.guest_email || null,
        p_guest_phone: body.guest_phone || null,
      }).maybeSingle();
      const updatedRow = data as RpcVersionRow | null;
      if (error || updatedRow?.version == null) throw new Error(error?.message || 'Cart update failed');
      order.version = updatedRow.version;
      if (standaloneShopDraft) {
        const expiresAt = standaloneDraftExpiry();
        const { error: expiryError } = await admin.from('commerce_orders')
          .update({ expires_at: expiresAt })
          .eq('id', order.id)
          .eq('status', 'draft');
        if (expiryError) throw new Error(expiryError.message);
        order.expires_at = expiresAt;
        if (lines.length === 0) {
          order.subtotal_minor = 0;
          order.discount_minor = 0;
          order.total_inc_vat_minor = 0;
          order.total_ex_vat_minor = 0;
          order.vat_amount_minor = 0;
        }
      }
      return jsonResponse(await cartResponse(admin, order, String(body.token || '')), 200, 0);
    }

    if (req.method === 'GET' && path === 'order') {
      const token = url.searchParams.get('token') || '';
      const order = await loadOrderByReference(admin, token, userId, true);
      return jsonResponse(await cartResponse(admin, order), 200, 0);
    }

    if (req.method === 'POST' && path === 'claim') {
      const body = await req.json();
      const reference = String(body.token || body.reference || '').trim();
      const displayName = String(body.display_name || body.displayName || '').trim().slice(0, 120);
      if (!displayName) return errorResponse('Namn krävs', 400);
      const order = await loadOrderByToken(admin, reference, userId, true);
      if (!['paid', 'attention'].includes(order.status)) return errorResponse('Köpet är inte klart ännu', 409);
      if (!order.customer_id) return errorResponse('Kund saknas', 409);
      if (order.claim_expires_at && new Date(order.claim_expires_at).getTime() <= Date.now()) {
        return errorResponse('Claim expired', 410);
      }
      const wasClaimed = Boolean(order.guest_claimed_at);
      const { data: claimed, error: claimError } = await admin.rpc('confirm_commerce_guest_identity', {
        p_order_id: order.id,
        p_customer_id: order.customer_id,
        p_display_name: displayName,
      }).maybeSingle();
      if (claimError || !claimed) throw new Error(claimError?.message || 'Claim failed');
      if (!wasClaimed) {
        await recordCommerceEvent(admin, {
          eventName: 'claim_completed',
          venueId: order.venue_id,
          orderId: order.id,
          activitySessionId: String((await loadOrderLines(admin, order.id)).find((line) => line.commerce_kind === 'participation')?.activity_session_id || '') || null,
          durationMs: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() : null,
          metadata: {
            within_7d: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() <= 7 * 86400000 : false,
            within_30d: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() <= 30 * 86400000 : false,
          },
        });
      }
      const refreshed = await loadOrderByToken(admin, reference, userId, true);
      return jsonResponse(await cartResponse(admin, refreshed), 200, 0);
    }

    if (req.method === 'POST' && path === 'claim-account') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const body = await req.json();
      const reference = String(body.token || body.reference || '').trim();
      const order = await loadOrderByToken(admin, reference, userId, true);
      if (!['paid', 'attention'].includes(order.status)) return errorResponse('Köpet är inte klart ännu', 409);
      if (!order.customer_id || !order.guest_email) return errorResponse('Kund saknas', 409);
      if (order.claim_expires_at && new Date(order.claim_expires_at).getTime() <= Date.now()) return errorResponse('Claim expired', 410);
      const { data: authResult, error: authResultError } = await admin.auth.admin.getUserById(userId);
      if (authResultError) throw new Error(authResultError.message);
      const authUser = authResult?.user;
      if (!authUser?.email_confirmed_at) return errorResponse('Bekräfta din e-post innan köpet kopplas.', 409);
      if (String(authUser.email || '').trim().toLowerCase() !== String(order.guest_email).trim().toLowerCase()) {
        return errorResponse('Logga in med samma e-postadress som användes vid köpet.', 403);
      }
      const alreadyClaimed = order.claimed_user_id === userId;
      const { data: claimed, error: claimError } = await admin.rpc('claim_commerce_activity_order', {
        p_order_id: order.id,
        p_customer_id: order.customer_id,
        p_user_id: userId,
      }).maybeSingle();
      if (claimError || !claimed) throw new Error(claimError?.message || 'Account claim failed');
      const customerId = await linkExistingCustomerToVerifiedAuth(admin, {
        customerId: order.customer_id,
        userId,
        venueId: order.venue_id,
        source: 'commerce_account_claim',
      });
      if (customerId !== order.customer_id) throw new Error('Customer identity mismatch after claim');
      const { error: passClaimError } = await admin.from('day_passes')
        .update({ user_id: userId })
        .eq('commerce_order_id', order.id)
        .eq('customer_id', order.customer_id);
      if (passClaimError) throw new Error(passClaimError.message);
      const { error: accessClaimError } = await admin.from('access_entitlements')
        .update({ user_id: userId })
        .eq('customer_id', order.customer_id)
        .eq('source_type', 'commerce_order')
        .eq('source_id', order.id);
      if (accessClaimError) throw new Error(accessClaimError.message);
      if (!alreadyClaimed) {
        await recordCommerceEvent(admin, {
          eventName: 'account_activated',
          venueId: order.venue_id,
          orderId: order.id,
          activitySessionId: String((await loadOrderLines(admin, order.id)).find((line) => line.commerce_kind === 'participation')?.activity_session_id || '') || null,
          durationMs: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() : null,
          metadata: {
            within_7d: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() <= 7 * 86400000 : false,
            within_30d: order.paid_at ? Date.now() - new Date(order.paid_at).getTime() <= 30 * 86400000 : false,
          },
        });
      }
      const refreshed = await loadOrderByReference(admin, order.id, userId, true);
      return jsonResponse(await cartResponse(admin, refreshed), 200, 0);
    }

    if (req.method === 'POST' && path === 'guest-checkin') {
      const body = await req.json();
      const reference = String(body.token || body.reference || '').trim();
      const order = await loadOrderByToken(admin, reference, userId, true);
      if (!['paid', 'attention'].includes(order.status) || !order.guest_claimed_at || !order.customer_id) {
        return errorResponse('Biljetten är inte klar', 409);
      }
      const lines = await loadOrderLines(admin, order.id);
      const participation = lines.find((line) => line.commerce_kind === 'participation');
      if (!participation?.session_registration_id) return errorResponse('Biljetten saknas', 404);
      const purchaseKind = String((participation.resolver_snapshot as any)?.purchase_kind || (
        participation.product_key === 'day_access' ? 'day_pass' : 'activity_ticket'
      ));
      const { data: activity, error: activityError } = await admin.from('activity_sessions')
        .select('id, start_time, end_time')
        .eq('id', participation.activity_session_id)
        .eq('venue_id', order.venue_id)
        .maybeSingle();
      if (activityError || !activity) return errorResponse('Aktiviteten saknas', 404);
      const interval = activitySessionOccurrenceInterval(participation.session_date, activity.start_time, activity.end_time);
      const now = DateTime.now().setZone('Europe/Stockholm');
      if (!interval || now < interval.start.minus({ minutes: 30 }) || now >= interval.end) {
        return errorResponse('Check-in är inte öppen', 409);
      }
      const { data: registration } = await admin.from('session_registrations')
        .select('id, status')
        .eq('id', participation.session_registration_id)
        .eq('customer_id', order.customer_id)
        .maybeSingle();
      if (!registration || !['confirmed', 'checked_in'].includes(registration.status)) return errorResponse('Biljetten är inte giltig', 409);
      const { data: dayAccess } = purchaseKind === 'day_pass'
        ? await admin.from('access_entitlements')
            .select('id')
            .eq('customer_id', order.customer_id)
            .eq('source_type', 'commerce_order')
            .eq('source_id', order.id)
            .eq('entitlement_type', 'day_access')
            .eq('status', 'active')
            .eq('valid_date', participation.session_date)
            .maybeSingle()
        : { data: null };
      const entryType = purchaseKind === 'day_pass' ? 'day_access' : 'session_ticket';
      const entitlementId = purchaseKind === 'day_pass' ? dayAccess?.id : registration.id;
      if (!entitlementId) return errorResponse('Tillträdet saknas', 404);
      const { data: existingCheckin } = await admin.from('venue_checkins')
        .select('*')
        .eq('venue_id', order.venue_id)
        .eq('entry_type', entryType)
        .eq('entitlement_id', entitlementId)
        .is('checked_out_at', null)
        .maybeSingle();
      if (!existingCheckin) {
        const { error: checkinError } = await admin.from('venue_checkins').insert({
          venue_id: order.venue_id,
          customer_id: order.customer_id,
          user_id: order.user_id || null,
          player_name: order.guest_name || 'Spelare',
          entry_type: entryType,
          entitlement_id: entitlementId,
          checked_in_by: null,
          session_date: participation.session_date,
        });
        if (checkinError && checkinError.code !== '23505') throw new Error(checkinError.message);
      }
      await admin.from('session_registrations').update({ status: 'checked_in' }).eq('id', registration.id).neq('status', 'cancelled');
      return jsonResponse({ checked_in: true, registration_id: registration.id }, existingCheckin ? 200 : 201, 0);
    }

    if (req.method === 'POST' && path === 'cancel') {
      const body = await req.json();
      const reference = String(body.token || body.reference || '').trim();
      const order = await loadOrderByReference(admin, reference, userId, true);
      if (order.status === 'cancelled') return jsonResponse(await cartResponse(admin, order), 200, 0);
      if (!['paid', 'attention'].includes(order.status)) return errorResponse('Köpet kan inte avbokas', 409);
      if (order.metadata?.cancellation_requested_at) {
        return jsonResponse({ ...(await cartResponse(admin, order)), cancellation_pending: true }, 202, 0);
      }
      if (order.status === 'attention') return errorResponse('Köpet behöver hanteras av Pickla innan det kan avbokas.', 409);
      const lines = await loadOrderLines(admin, order.id);
      const participation = lines.find((line) => line.commerce_kind === 'participation');
      if (!participation?.activity_session_id || !participation.session_date) {
        return errorResponse('Endast aktivitetsköp kan avbokas här', 409);
      }
      const { data: activity, error: activityError } = await admin.from('activity_sessions')
        .select('id, start_time, end_time')
        .eq('id', participation.activity_session_id)
        .eq('venue_id', order.venue_id)
        .maybeSingle();
      if (activityError || !activity) return errorResponse('Aktiviteten saknas', 404);
      const interval = activitySessionOccurrenceInterval(participation.session_date, activity.start_time, activity.end_time);
      if (!interval || DateTime.now().setZone('Europe/Stockholm') >= interval.start) {
        return errorResponse('Aktiviteten har redan startat', 409);
      }

      if (Number(order.total_inc_vat_minor || 0) === 0) {
        if (participation.session_registration_id) {
          const { error: registrationCancelError } = await admin.from('session_registrations')
            .update({ status: 'cancelled' })
            .eq('id', participation.session_registration_id)
            .in('status', ['confirmed', 'checked_in', 'no_show']);
          if (registrationCancelError) throw new Error(registrationCancelError.message);
          const dayPassPurchase = participation.product_key === 'day_access'
            || (participation.resolver_snapshot as any)?.purchase_kind === 'day_pass';
          let entitlementQuery = admin.from('access_entitlements').update({ status: 'revoked' }).neq('status', 'revoked');
          entitlementQuery = dayPassPurchase
            ? entitlementQuery.eq('source_type', 'commerce_order').eq('source_id', order.id)
            : entitlementQuery.eq('source_type', 'session_ticket').eq('source_id', participation.session_registration_id);
          const { error: entitlementRevokeError } = await entitlementQuery;
          if (entitlementRevokeError) throw new Error(entitlementRevokeError.message);
          if (dayPassPurchase) {
            const { error: dayPassCancelError } = await admin.from('day_passes')
              .update({ status: 'cancelled' })
              .eq('commerce_order_id', order.id)
              .neq('status', 'cancelled');
            if (dayPassCancelError) throw new Error(dayPassCancelError.message);
          }
        }
        const { error: pickupCancelError } = await admin.from('commerce_order_lines')
          .update({ fulfillment_status: 'not_collected' })
          .eq('commerce_order_id', order.id)
          .eq('fulfillment_type', 'desk_pickup')
          .eq('fulfillment_status', 'pending_pickup');
        if (pickupCancelError) throw new Error(pickupCancelError.message);
        const { data: cancelled, error: cancelError } = await admin.from('commerce_orders')
          .update({ status: 'cancelled', metadata: { ...(order.metadata || {}), cancelled_at: new Date().toISOString(), cancellation_source: 'customer' } })
          .eq('id', order.id)
          .in('status', ['paid', 'attention'])
          .select('*')
          .maybeSingle();
        if (cancelError) throw new Error(cancelError.message);
        return jsonResponse(await cartResponse(admin, cancelled || { ...order, status: 'cancelled' }), 200, 0);
      }

      if (!order.stripe_payment_intent_id) return errorResponse('Betalningsreferens saknas', 409);
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) throw new Error('Stripe not configured');
      const refund = await createStripeRefund(stripeKey, order.stripe_payment_intent_id, order.id);
      const { data: pending, error: pendingError } = await admin.from('commerce_orders')
        .update({
          metadata: {
            ...(order.metadata || {}),
            cancellation_requested_at: order.metadata?.cancellation_requested_at || new Date().toISOString(),
            cancellation_source: 'customer',
            stripe_refund_id: refund.id,
          },
        })
        .eq('id', order.id)
        .in('status', ['paid', 'attention'])
        .select('*')
        .maybeSingle();
      if (pendingError) throw new Error(pendingError.message);
      return jsonResponse({ ...(await cartResponse(admin, pending || order)), cancellation_pending: true }, 202, 0);
    }

    if (req.method === 'POST' && path === 'resolve') {
      const body = await req.json();
      const order = await loadOrderByReference(admin, String(body.token || ''), userId);
      if (order.status !== 'draft') return errorResponse('Cart is not editable', 409);
      const lines = await loadOrderLines(admin, order.id);
      if (lines.length === 0 && order.draft_scope === SHOP_DRAFT_SCOPE) {
        return jsonResponse({
          order: { id: order.id, version: order.version, currency: order.currency },
          lines: [],
          checkout_ready: false,
        }, 200, 0);
      }
      const resolved = await resolveLines(admin, order, lines, userId);
      await assertParticipationCapacityAvailable(admin, order, lines);
      return jsonResponse({ order: { id: order.id, version: order.version, currency: order.currency }, lines: resolved.map(projectOrderLine), checkout_ready: true }, 200, 0);
    }

    if (req.method === 'POST' && path === 'checkout') {
      const body = await req.json();
      const token = String(body.token || '');
      const order = await loadOrderByReference(admin, token, userId);
      if (order.status !== 'draft') return errorResponse('Cart is not editable', 409);
      if (order.version !== Number(body.expected_version)) return errorResponse('Cart changed — review it again.', 409);
      const checkoutGuestEmail = body.guest_email ? String(body.guest_email).trim().toLowerCase() : order.guest_email;
      const checkoutGuestName = body.guest_name ? String(body.guest_name).trim() : order.guest_name;
      if (checkoutGuestEmail !== order.guest_email || checkoutGuestName !== order.guest_name) {
        const { error: guestUpdateError } = await admin.from('commerce_orders').update({
          guest_email: checkoutGuestEmail || null,
          guest_name: checkoutGuestName || null,
        }).eq('id', order.id).eq('status', 'draft');
        if (guestUpdateError) throw new Error(guestUpdateError.message);
        order.guest_email = checkoutGuestEmail || null;
        order.guest_name = checkoutGuestName || null;
      }
      const lines = await loadOrderLines(admin, order.id);
      if (lines.length === 0) return errorResponse('Cart is empty', 409);
      const participation = lines.filter((line) => line.commerce_kind === 'participation');
      if (participation.length > 1) return errorResponse('Release 1 supports one participation per cart', 409);

      let customerId = order.customer_id || null;
      if (userId) {
        if (order.user_id && order.user_id !== userId) return errorResponse('Forbidden', 403);
        customerId = await resolveOrCreateCustomerIdForUser(admin, userId, order.venue_id, 'commerce_checkout');
        await admin.from('commerce_orders').update({ user_id: userId, customer_id: customerId }).eq('id', order.id).eq('status', 'draft');
      } else if (participation.length > 0) {
        if (!checkoutGuestEmail) return errorResponse('E-post krävs för kvitto och biljett.', 400);
        customerId = await resolveOrCreateGuestCustomerByEmail(admin, {
          venueId: order.venue_id,
          email: checkoutGuestEmail,
          displayName: checkoutGuestName,
          source: 'commerce_activity_checkout',
        });
        const { data: existingRegistration, error: existingRegistrationError } = await admin
          .from('session_registrations')
          .select('id')
          .eq('activity_session_id', participation[0].activity_session_id)
          .eq('session_date', participation[0].session_date)
          .eq('customer_id', customerId)
          .in('status', ['confirmed', 'checked_in', 'no_show'])
          .maybeSingle();
        if (existingRegistrationError) throw new Error(existingRegistrationError.message);
        if (existingRegistration) return errorResponse('Du har redan en plats till den här aktiviteten.', 409);
        await admin.from('commerce_orders').update({ customer_id: customerId }).eq('id', order.id).eq('status', 'draft');
      }
      const quoted = await resolveLines(admin, order, lines, userId, customerId);
      const resolved = participation[0]
        ? await resolveLines(admin, order, lines, userId, customerId, { applyEarlyBird: false })
        : quoted;
      let holdId: string | null = null;
      if (participation[0]) {
        const resolvedParticipation = resolved.find((line) => line.id === participation[0].id);
        const quotedParticipation = quoted.find((line) => line.id === participation[0].id);
        const pricingHold = await acquireParticipationHold(
          admin,
          order,
          participation[0],
          resolvedParticipation,
          quotedParticipation,
          userId || null,
          customerId,
        );
        holdId = pricingHold.hold_id || null;
        if (pricingHold.quote_changed) {
          await releaseHold(admin, holdId, 'commerce_quote_changed');
          return jsonResponse({
            error: 'Priset uppdaterades medan du gick till kassan. Kontrollera den nya summan.',
            quote_changed: true,
            pricing: {
              applied_price_type: pricingHold.applied_price_type || 'regular_price',
              final_price_minor: Number(pricingHold.final_price_minor || 0),
              early_bird_remaining: pricingHold.early_bird_remaining ?? null,
              quote_changed: true,
            },
          }, 409, 0);
        }
        if (resolvedParticipation) {
          resolvedParticipation.capacity_hold_id = holdId;
          resolvedParticipation.unit_price_minor = Number(pricingHold.final_price_minor || 0);
          resolvedParticipation.resolver_snapshot = {
            ...(resolvedParticipation.resolver_snapshot || {}),
            pricing_reason: pricingHold.applied_price_type || resolvedParticipation.resolver_snapshot?.pricing_reason,
            applied_price_type: pricingHold.applied_price_type || resolvedParticipation.resolver_snapshot?.pricing_reason,
            final_price_minor: Number(pricingHold.final_price_minor || 0),
            early_bird_remaining: pricingHold.early_bird_remaining ?? null,
            quote_changed: false,
          };
        }
      }

      const { data: frozen, error: freezeError } = await admin.rpc('freeze_commerce_order', {
        p_order_id: order.id,
        p_expected_version: order.version,
        p_lines: resolved,
      }).maybeSingle();
      const frozenOrder = frozen as RpcVersionRow | null;
      if (freezeError || frozenOrder?.version == null) {
        await releaseHold(admin, holdId, 'commerce_freeze_failed');
        throw new Error(freezeError?.message || 'Cart freeze failed');
      }

      if (Number(frozenOrder.total_inc_vat_minor || 0) === 0) {
        try {
          if (!participation[0] || !holdId || (!userId && !customerId)) throw new Error('Free order has no participation owner');
          const resolvedParticipation = resolved.find((line) => line.id === participation[0].id);
          const registrationId = await commitFreeParticipation(admin, order, participation[0], resolvedParticipation, userId || null, customerId, holdId);
          await recordCommerceEvent(admin, {
            eventName: 'checkout_started',
            venueId: order.venue_id,
            orderId: order.id,
            activitySessionId: String(participation[0].activity_session_id || '') || null,
            journeyId: body.journey_id,
          });
          if (!userId) {
            await recordCommerceEvent(admin, {
              eventName: 'guest_purchase_succeeded',
              venueId: order.venue_id,
              orderId: order.id,
              activitySessionId: String(participation[0].activity_session_id || '') || null,
              journeyId: body.journey_id,
              metadata: { source: 'free_checkout' },
            });
          }
          return jsonResponse({ free: true, order_id: order.id, registration_id: registrationId, redirect: safeLocalPath(body.success_path, '/my') });
        } catch (error) {
          await admin.from('commerce_orders').update({ status: 'attention' }).eq('id', order.id);
          throw error;
        }
      }

      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) throw new Error('Stripe not configured');
      let customerEmail = order.guest_email || null;
      if (userId && !customerEmail) {
        const { data: authUser } = await admin.auth.admin.getUserById(userId);
        customerEmail = authUser?.user?.email || null;
      }
      if (!customerEmail) {
        await releaseHold(admin, holdId, 'commerce_missing_email');
        await admin.rpc('reopen_commerce_order_after_checkout_failure', { p_order_id: order.id, p_version: frozenOrder.version });
        return errorResponse('E-post krävs för kvitto och uthämtning.', 400);
      }

      const origin = canonicalPublicOrigin(req);
      const successPath = safeLocalPath(body.success_path, `/commerce/confirmed?token=${encodeURIComponent(token)}`);
      const cancelPath = safeLocalPath(body.cancel_path, `/today`);
      let stripeSession: StripeCheckoutSession;
      try {
        stripeSession = await createStripeCheckoutSession(stripeKey, {
          payment_method_types: ['card'],
          mode: 'payment',
          customer_email: customerEmail,
          client_reference_id: order.id,
          line_items: resolved
            .filter((line) => Number(line.unit_price_minor || 0) * Number(line.quantity || 1) > 0)
            .map((line) => ({
              price_data: {
                currency: String(order.currency || 'SEK').toLowerCase(),
                product_data: { name: line.product_name },
                unit_amount: Number(line.unit_price_minor),
                tax_behavior: 'inclusive',
              },
              quantity: Number(line.quantity || 1),
            })),
          metadata: {
            commerce_order_id: order.id,
            commerce_order_version: String(frozenOrder.version),
          },
          success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}${cancelPath}`,
        });
      } catch (error) {
        await releaseHold(admin, holdId, 'commerce_stripe_create_failed');
        await admin.rpc('reopen_commerce_order_after_checkout_failure', { p_order_id: order.id, p_version: frozenOrder.version });
        throw error;
      }

      const { data: attached, error: attachError } = await admin.rpc('attach_commerce_order_stripe_session', {
        p_order_id: order.id,
        p_version: frozenOrder.version,
        p_stripe_session_id: stripeSession.id,
      });
      if (attachError || !attached) throw new Error(attachError?.message || 'Could not attach Stripe session');
      if (holdId) {
        const { error: holdAttachError } = await admin.rpc('attach_capacity_hold_stripe_session', {
          p_hold_id: holdId,
          p_stripe_session_id: stripeSession.id,
        });
        if (holdAttachError) throw new Error(holdAttachError.message);
      }
      await recordCommerceEvent(admin, {
        eventName: 'checkout_started',
        venueId: order.venue_id,
        orderId: order.id,
        activitySessionId: String(participation[0]?.activity_session_id || '') || null,
        journeyId: body.journey_id,
      });
      return jsonResponse({ url: stripeSession.url, order_id: order.id, version: frozenOrder.version });
    }

    if (req.method === 'GET' && path === 'my-orders') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const customerId = await resolveCustomerIdForUser(admin, userId);
      let query = admin.from('commerce_orders').select('*').order('created_at', { ascending: false }).limit(50);
      query = customerId ? query.or(`user_id.eq.${userId},customer_id.eq.${customerId}`) : query.eq('user_id', userId);
      const { data: orders, error } = await query;
      if (error) throw new Error(error.message);
      const orderIds = (orders || []).map((order: any) => order.id);
      const { data: lines } = orderIds.length
        ? await admin.from('commerce_order_lines').select('*').in('commerce_order_id', orderIds).order('sort_order')
        : { data: [] };
      return jsonResponse({ orders: orders || [], lines: lines || [] }, 200, 15);
    }

    if (req.method === 'GET' && path === 'registration-order') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const registrationId = url.searchParams.get('registrationId') || '';
      if (!UUID_PATTERN.test(registrationId)) return errorResponse('Missing registrationId', 400);
      const { data: registration, error: registrationError } = await admin.from('session_registrations')
        .select('id, user_id, status, activity_session_id, session_date')
        .eq('id', registrationId)
        .maybeSingle();
      if (registrationError || !registration) return errorResponse('Registration not found', 404);
      if (registration.user_id !== userId) return errorResponse('Forbidden', 403);
      const { data: participationLine, error: lineError } = await admin.from('commerce_order_lines')
        .select('id, commerce_order_id')
        .eq('session_registration_id', registrationId)
        .eq('commerce_kind', 'participation')
        .maybeSingle();
      if (lineError) throw new Error(lineError.message);
      if (!participationLine) return jsonResponse({ available: false, state: 'unmanaged' }, 200, 15);
      const order = await loadOrderByReference(admin, participationLine.commerce_order_id, userId, true);
      const [{ data: activity }, { data: receipt }] = await Promise.all([
        admin.from('activity_sessions').select('id, start_time, end_time')
          .eq('id', registration.activity_session_id).eq('venue_id', order.venue_id).maybeSingle(),
        order.booking_receipt_id
          ? admin.from('booking_receipts').select('id, payment_status').eq('id', order.booking_receipt_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const interval = activity
        ? activitySessionOccurrenceInterval(registration.session_date, activity.start_time, activity.end_time)
        : null;
      const started = !interval || DateTime.now().setZone('Europe/Stockholm') >= interval.start;
      const cancellationPending = Boolean(order.metadata?.cancellation_requested_at);
      const refunded = receipt?.payment_status === 'refunded';
      let state = 'paid';
      if (refunded) state = 'refunded';
      else if (order.status === 'cancelled' || registration.status === 'cancelled') state = 'cancelled';
      else if (cancellationPending) state = 'refund_pending';
      else if (order.status === 'attention') state = 'attention';
      else if (started) state = 'started';
      else if (order.status === 'checkout_pending' || order.status === 'draft') state = 'pending';
      else if (Number(order.total_inc_vat_minor || 0) === 0) state = 'free';
      return jsonResponse({
        available: true,
        state,
        order_id: order.id,
        registration_id: registration.id,
        paid: Number(order.total_inc_vat_minor || 0) > 0,
        cancellation_pending: cancellationPending,
        receipt_payment_status: receipt?.payment_status || null,
        policy: 'before_activity_start',
      }, 200, 0);
    }

    if (req.method === 'GET' && path === 'participation-items') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const registrationId = url.searchParams.get('registrationId') || '';
      if (!registrationId) return errorResponse('Missing registrationId', 400);
      const { data: registration, error: registrationError } = await admin
        .from('session_registrations')
        .select('id, user_id')
        .eq('id', registrationId)
        .maybeSingle();
      if (registrationError || !registration) return errorResponse('Registration not found', 404);
      if (registration.user_id !== userId) return errorResponse('Forbidden', 403);
      const { data: participationLine, error: lineError } = await admin
        .from('commerce_order_lines')
        .select('id, commerce_order_id')
        .eq('session_registration_id', registrationId)
        .eq('commerce_kind', 'participation')
        .maybeSingle();
      if (lineError) throw new Error(lineError.message);
      if (!participationLine) return jsonResponse({ items: [] }, 200, 15);
      const { data: items, error: itemError } = await admin
        .from('commerce_order_lines')
        .select('id, product_name, quantity, fulfillment_status, fulfillment_type')
        .eq('commerce_order_id', participationLine.commerce_order_id)
        .eq('parent_line_id', participationLine.id)
        .in('commerce_kind', ['rental', 'merchandise'])
        .order('sort_order');
      if (itemError) throw new Error(itemError.message);
      return jsonResponse({ items: items || [] }, 200, 15);
    }

    if (req.method === 'GET' && path === 'fulfillment') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const venueId = url.searchParams.get('venueId') || '';
      await requireVenueRole(admin, userId, venueId, ['venue_admin', 'desk_staff']);
      const status = url.searchParams.get('status') || 'pending_pickup';
      const items = await loadDeskFulfillmentItems(admin, venueId, { status });
      return jsonResponse({ items }, 200, 5);
    }

    if (req.method === 'PATCH' && path === 'fulfillment') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const body = await req.json();
      const venueId = String(body.venue_id || '').trim();
      await requireVenueRole(admin, userId, venueId, ['venue_admin', 'desk_staff']);
      const { data: line, error: lineError } = await admin.from('commerce_order_lines')
        .select('id, commerce_order_id, commerce_orders(venue_id)')
        .eq('id', body.line_id).maybeSingle();
      if (lineError || !line) return errorResponse('Fulfillment line not found', 404);
      const linkedOrder = Array.isArray(line.commerce_orders) ? line.commerce_orders[0] : line.commerce_orders;
      if (linkedOrder?.venue_id !== venueId) return errorResponse('Forbidden', 403);
      const { error } = await admin.rpc('transition_commerce_fulfillment', {
        p_line_id: body.line_id,
        p_next_status: body.status,
        p_actor_user_id: userId,
        p_request_id: req.headers.get('x-request-id') || crypto.randomUUID(),
        p_metadata: { source: 'api-commerce' },
      });
      if (error) throw new Error(error.message);
      const [item] = await loadDeskFulfillmentItems(admin, venueId, { lineId: body.line_id });
      if (!item) throw new Error('Fulfillment line not found');
      return jsonResponse({ item }, 200, 0);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected commerce error';
    console.error('api-commerce', path, message);
    if (message === 'Unauthorized') return errorResponse(message, 401);
    if (message === 'Forbidden') return errorResponse(message, 403);
    if (message === 'Cart expired') return errorResponse(message, 410);
    if (message === 'Shop cart owner conflict') return errorResponse(message, 409);
    if (message.includes('stale_cart_version')) return errorResponse('Cart changed — review it again.', 409);
    if (message.includes('not found') || message.includes('not_found')) return errorResponse(message, 404);
    if (message.includes('Platsen hann tas')) return errorResponse(message, 409);
    return errorResponse(message, 400);
  }
};

const localFunctionPort = Number(Deno.env.get('FUNCTION_PORT') || 0);
if (localFunctionPort > 0) Deno.serve({ port: localFunctionPort }, commerceHandler);
else Deno.serve(commerceHandler);
