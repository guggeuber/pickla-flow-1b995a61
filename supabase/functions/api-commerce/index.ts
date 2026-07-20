import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { requireVenueRole } from '../_shared/authorization.ts';
import { resolveActivityPricingDecision } from '../_shared/activity_pricing.ts';
import {
  resolveCustomerIdForUser,
  resolveOrCreateCustomerIdForUser,
  resolveOrCreateGuestCustomerByEmail,
} from '../_shared/customers.ts';
import { canonicalPublicOrigin } from '../_shared/canonical_origin.ts';
import { evaluateCommerceAvailability } from '../_shared/commerce_availability.ts';

const CART_TOKEN_BYTES = 32;
const MAX_CART_LINES = 25;
const MAX_QUANTITY = 100;
const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const GUEST_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StripeCheckoutSession = { id: string; url: string | null };

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

function normalizeDraftScope(value: unknown) {
  const normalized = String(value || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
  return normalized || 'default';
}

function guestDraftExpiry() {
  return new Date(Date.now() + GUEST_DRAFT_TTL_MS).toISOString();
}

async function optionalUser(req: Request) {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { userId: null as string | null };
  const auth = await getAuthenticatedClient(req);
  if (auth.error || !auth.userId) throw new Error('Unauthorized');
  return { userId: auth.userId };
}

async function loadOrderByReference(
  admin: any,
  reference: string,
  userId?: string | null,
  options: { editable?: boolean; allowReceiptToken?: boolean } = {},
) {
  const cleanReference = String(reference || '').trim();
  if (!cleanReference || cleanReference.length > 256) throw new Error('Order not found');
  const tokenHash = cleanReference.length >= 32 ? await sha256(cleanReference) : '';
  let query = admin.from('commerce_orders').select('*');
  if (userId && UUID_PATTERN.test(cleanReference)) {
    query = query.eq('id', cleanReference);
  } else if (options.allowReceiptToken) {
    query = query.or(`guest_token_hash.eq.${tokenHash},receipt_token_hash.eq.${tokenHash}`);
  } else {
    query = query.eq('guest_token_hash', tokenHash);
  }
  const { data: order, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error('Order not found');

  const receiptTokenMatches = options.allowReceiptToken
    && tokenHash
    && order.receipt_token_hash === tokenHash
    && ['paid', 'attention'].includes(order.status);
  if (receiptTokenMatches) return order;

  if (options.editable) {
    const expired = order.status === 'draft'
      && order.user_id === null
      && order.expires_at
      && new Date(order.expires_at).getTime() <= Date.now();
    if (expired) {
      await admin.from('commerce_orders')
        .update({ status: 'expired', expires_at: order.expires_at })
        .eq('id', order.id)
        .eq('status', 'draft');
      throw new Error('Order not found');
    }
    const ownerMatches = userId
      ? order.user_id === userId
      : order.user_id === null;
    if (order.status !== 'draft' || !ownerMatches) throw new Error('Order not found');
    return order;
  }

  const ownerMatches = userId
    ? order.user_id === userId
    : order.user_id === null && order.guest_token_hash === tokenHash;
  if (!ownerMatches) throw new Error('Order not found');
  return order;
}

async function loadOrderLines(admin: any, orderId: string) {
  const { data, error } = await admin
    .from('commerce_order_lines')
    .select('*')
    .eq('commerce_order_id', orderId)
    .order('sort_order')
    .order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}

function projectOrderLine(line: any) {
  return {
    id: line.id,
    product_id: line.product_id,
    product_key: line.product_key,
    product_name: line.product_name,
    commerce_kind: line.commerce_kind,
    quantity: line.quantity,
    unit_price_minor: line.unit_price_minor,
    discount_minor: line.discount_minor,
    line_total_inc_vat_minor: line.line_total_inc_vat_minor ?? line.total_inc_vat_minor,
    vat_rate: line.vat_rate,
    vat_amount_minor: line.vat_amount_minor,
    line_total_ex_vat_minor: line.line_total_ex_vat_minor ?? line.total_ex_vat_minor,
    fulfillment_type: line.fulfillment_type,
    fulfillment_status: line.fulfillment_status,
    activity_session_id: line.activity_session_id,
    session_date: line.session_date,
    session_registration_id: line.session_registration_id,
    parent_line_id: line.parent_line_id,
  };
}

function projectCommerceOrder(order: any) {
  return {
    id: order.id,
    venue_id: order.venue_id,
    draft_scope: order.draft_scope,
    status: order.status,
    version: order.version,
    currency: order.currency,
    subtotal_minor: order.subtotal_minor,
    discount_minor: order.discount_minor,
    total_inc_vat_minor: order.total_inc_vat_minor,
    total_ex_vat_minor: order.total_ex_vat_minor,
    vat_amount_minor: order.vat_amount_minor,
    contact_email_present: Boolean(order.guest_email),
    paid_at: order.paid_at,
    booking_receipt_id: order.booking_receipt_id,
  };
}

function projectReceipt(receipt: any) {
  if (!receipt) return null;
  return {
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    currency: receipt.currency,
    total_inc_vat_sek: receipt.total_inc_vat_sek,
    total_ex_vat_sek: receipt.total_ex_vat_sek,
    vat_amount_sek: receipt.vat_amount_sek,
    vat_rate: receipt.vat_rate,
    payment_status: receipt.payment_status,
    issued_at: receipt.issued_at,
  };
}

function projectReceiptLine(line: any) {
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
    vat_rate: line.vat_rate,
    vat_amount_minor: line.vat_amount_minor,
    line_total_ex_vat_minor: line.total_ex_vat_minor,
    fulfillment_type: line.fulfillment_type,
  };
}

function resolvedOrderSummary(lines: any[]) {
  return lines.reduce((summary, line) => {
    const subtotal = Math.max(0, Number(line.unit_price_minor || 0) * Number(line.quantity || 1));
    const discount = Math.max(0, Number(line.discount_minor || 0));
    const total = Math.max(0, subtotal - discount);
    const vatRate = Math.max(0, Number(line.vat_rate || 0));
    const vat = Math.round(total * vatRate / (100 + vatRate));
    summary.subtotal_minor += subtotal;
    summary.discount_minor += discount;
    summary.total_inc_vat_minor += total;
    summary.vat_amount_minor += vat;
    summary.total_ex_vat_minor += total - vat;
    return summary;
  }, {
    subtotal_minor: 0,
    discount_minor: 0,
    total_inc_vat_minor: 0,
    total_ex_vat_minor: 0,
    vat_amount_minor: 0,
  });
}

async function cartResponse(admin: any, order: any, reference?: string | null) {
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
  return {
    order: projectCommerceOrder(order),
    lines: lines.map(projectOrderLine),
    receipt: projectReceipt(receipt),
    receipt_lines: receiptLines.map(projectReceiptLine),
    ...(reference ? { draft_ref: reference } : {}),
  };
}

async function venueContext(admin: any, venueId: string) {
  const { data, error } = await admin
    .from('venues')
    .select('id, organization_id, name, slug, commerce_enabled')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) throw new Error('Venue not found');
  return data;
}

async function validateCartItems(admin: any, venueId: string, items: any[], userId?: string | null) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_CART_LINES) {
    throw new Error('Order draft must contain 1-25 items');
  }
  const productIds = Array.from(new Set(items.map((item) => String(item.product_id || '')).filter(Boolean)));
  const { data: products, error: productError } = await admin
    .from('access_products')
    .select('id, venue_id, product_key, name, description, product_kind, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, commerce_enabled, is_active, status, standalone_enabled, activity_addon_enabled, category, sport, image_url')
    .eq('venue_id', venueId)
    .in('id', productIds);
  if (productError) throw new Error(productError.message);
  const productById = new Map((products || []).map((product: any) => [product.id, product]));
  if (productById.size !== productIds.length) throw new Error('Product not found');
  const venue = await venueContext(admin, venueId);

  const normalized = items.map((item, index) => {
    const product = productById.get(String(item.product_id || ''));
    const quantity = Math.min(Math.max(Math.floor(Number(item.quantity || 1)), 1), MAX_QUANTITY);
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
    throw new Error('Release 1 supports one participation per order');
  }

  for (const item of normalized) {
    if (item.product.commerce_kind === 'participation') {
      const availability = evaluateCommerceAvailability(item.product, {
        channel: 'participation',
        venueCommerceEnabled: venue.commerce_enabled === true,
      });
      if (!availability.eligible) throw new Error(availability.message || 'Product is not available');
      const sessionId = String(item.input.activity_session_id || item.input.source_id || '').trim();
      const sessionDate = String(item.input.session_date || '').slice(0, 10);
      if (!sessionId || !sessionDate) throw new Error('Participation requires session and date');
      const { data: session, error: sessionError } = await admin
        .from('activity_sessions')
        .select('id, venue_id, product_key, session_type, is_active, publish_status')
        .eq('id', sessionId)
        .eq('venue_id', venueId)
        .maybeSingle();
      if (sessionError) throw new Error(sessionError.message);
      if (!session?.is_active || session.publish_status !== 'published') throw new Error('Activity session is not available');
      const expectedKey = session.product_key || (session.session_type === 'open_play' ? 'open_play_slot' : null);
      if (expectedKey && expectedKey !== item.product.product_key) throw new Error('Product does not match activity session');
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
    },
    metadata: item.input.metadata || {},
    sort_order: item.index * 10,
  }));
}

async function resolveLines(admin: any, order: any, lines: any[], userId?: string | null) {
  const productIds = lines.map((line) => line.product_id).filter(Boolean);
  const { data: products, error } = await admin
    .from('access_products')
    .select('id, venue_id, product_key, name, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, commerce_enabled, is_active, status, standalone_enabled, activity_addon_enabled, category, sport, image_url')
    .in('id', productIds);
  if (error) throw new Error(error.message);
  const productsById = new Map((products || []).map((product: any) => [product.id, product]));
  const venue = await venueContext(admin, order.venue_id);
  const customerId = order.customer_id
    || (userId ? await resolveCustomerIdForUser(admin, userId) : null);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const resolved: any[] = [];
  for (const line of lines) {
    const product = productsById.get(line.product_id);
    if (!product) throw new Error('Product is no longer available');
    if (product.venue_id !== order.venue_id || product.commerce_kind !== line.commerce_kind) {
      throw new Error('Product classification changed — review the purchase again');
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
      if (!relationship) throw new Error('Product relationship changed — review the purchase again');
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
      const decision = await resolveActivityPricingDecision({
        client: admin,
        venueId: order.venue_id,
        userId,
        activitySessionId: line.activity_session_id,
        sessionDate: line.session_date,
        requestedProductKey: product.product_key,
        requestedAmountSek: Number(product.base_price_sek || 0),
        purchaseKind: 'activity_ticket',
        salesChannel: 'online',
      });
      unitPriceMinor = Math.round(Number(decision.finalAmountSek || 0) * 100);
      resolverSnapshot = {
        product_key: decision.productKey,
        pricing_reason: decision.pricingReason,
        access_decision: decision.accessDecision,
        entitlement_type: decision.entitlementType,
        membership_id: decision.membershipId,
        membership_tier_name: decision.membershipTierName,
        debug: decision.debug,
      };
    }
    const subtotalMinor = unitPriceMinor * Number(line.quantity || 1);
    const discountMinor = 0;
    const lineTotalIncVatMinor = Math.max(0, subtotalMinor - discountMinor);
    const vatRate = Number(product.vat_rate || 0);
    const vatAmountMinor = Math.round(lineTotalIncVatMinor * vatRate / (100 + vatRate));
    resolved.push({
      id: line.id,
      product_key: product.product_key,
      product_name: product.name,
      commerce_kind: product.commerce_kind,
      fulfillment_type: product.fulfillment_type,
      quantity: line.quantity,
      unit_price_minor: unitPriceMinor,
      discount_minor: discountMinor,
      line_total_inc_vat_minor: lineTotalIncVatMinor,
      line_total_ex_vat_minor: lineTotalIncVatMinor - vatAmountMinor,
      vat_rate: vatRate,
      vat_amount_minor: vatAmountMinor,
      beneficiary_user_id: line.commerce_kind === 'participation' ? userId || null : null,
      beneficiary_customer_id: line.commerce_kind === 'participation' ? customerId : null,
      resolver_snapshot: resolverSnapshot,
      product_snapshot: {
        ...(line.product_snapshot || {}),
        name: product.name,
        product_key: product.product_key,
        commerce_kind: product.commerce_kind,
        fulfillment_type: product.fulfillment_type,
        vat_rate: Number(product.vat_rate || 0),
        resolver_rules: product.resolver_rules || {},
      },
    });
  }
  return resolved;
}

async function acquireParticipationHold(
  admin: any,
  order: any,
  line: any,
  userId: string | null,
  customerId: string | null,
) {
  const { data, error } = await admin.rpc('acquire_capacity_hold', {
    p_venue_id: order.venue_id,
    p_scope_type: 'activity_session',
    p_scope_id: line.activity_session_id,
    p_session_date: line.session_date,
    p_user_id: userId,
    p_customer_id: customerId,
    p_source_type: 'commerce_order',
    p_source_id: line.id,
    p_idempotency_key: `commerce:${order.id}:${line.id}:v${order.version}`,
    p_metadata: { commerce_order_id: order.id, commerce_order_line_id: line.id },
  }).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ok || !data?.hold_id) throw new Error('Platsen hann tas — välj ett annat pass.');
  return data.hold_id as string;
}

async function releaseHold(admin: any, holdId?: string | null, reason = 'commerce_checkout_failed') {
  if (!holdId) return;
  await admin.rpc('release_capacity_hold', { p_hold_id: holdId, p_reason: reason });
}

async function commitFreeParticipation(
  admin: any,
  order: any,
  line: any,
  resolvedLine: any,
  userId: string | null,
  customerId: string | null,
  holdId: string,
) {
  if (!userId && !customerId) throw new Error('Participation owner is missing');
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
  if (!data?.ok || !data?.registration_id) throw new Error(data?.reason || 'capacity_full');
  await admin.from('commerce_order_lines').update({ session_registration_id: data.registration_id }).eq('id', line.id);
  const entitlement = {
    venue_id: order.venue_id,
    user_id: userId,
    customer_id: customerId,
    entitlement_type: 'session_ticket',
    status: 'active',
    source_type: 'session_ticket',
    source_id: data.registration_id,
    activity_session_id: line.activity_session_id,
    session_date: line.session_date,
    includes_session_types: ['open_play'],
    metadata: { commerce_order_id: order.id, commerce_order_line_id: line.id },
  };
  const { error: entitlementError } = await admin.from('access_entitlements').upsert(
    entitlement,
    {
      onConflict: userId
        ? 'source_type,source_id,user_id,entitlement_type'
        : 'source_type,source_id,customer_id,entitlement_type',
    },
  );
  if (entitlementError) throw new Error(entitlementError.message);
  await admin.from('commerce_orders').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    customer_id: customerId,
    user_id: userId,
  }).eq('id', order.id);
  return data.registration_id as string;
}

async function findAuthenticatedDraft(
  admin: any,
  venueId: string,
  userId: string,
  draftScope: string,
) {
  const { data, error } = await admin.from('commerce_orders')
    .select('*')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .eq('draft_scope', draftScope)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function insertCommerceDraft(
  admin: any,
  input: {
    venue: any;
    userId: string | null;
    customerId: string | null;
    tokenHash: string;
    draftScope: string;
    source: string;
    guestName?: string | null;
    guestEmail?: string | null;
    guestPhone?: string | null;
  },
) {
  const { data, error } = await admin.from('commerce_orders').insert({
    organization_id: input.venue.organization_id,
    venue_id: input.venue.id,
    customer_id: input.customerId,
    user_id: input.userId,
    guest_token_hash: input.tokenHash,
    guest_name: input.guestName || null,
    guest_email: input.guestEmail
      ? String(input.guestEmail).trim().toLowerCase()
      : null,
    guest_phone: input.guestPhone || null,
    draft_scope: input.draftScope,
    expires_at: input.userId ? null : guestDraftExpiry(),
    metadata: {
      source: input.source,
      draft_scope: input.draftScope,
    },
  }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
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
          .select('id, venue_id, product_key, name, description, commerce_kind, fulfillment_type, fulfillment_presentation, base_price_sek, vat_rate, resolver_rules, sort_order, status, is_active, standalone_enabled, activity_addon_enabled, category, sport, image_url')
          .eq('venue_id', venueId).eq('status', 'active').eq('is_active', true).order('sort_order'),
        admin.from('product_relationships')
          .select('id, source_product_id, target_product_id, relationship_type, sort_order')
          .eq('venue_id', venueId).eq('is_active', true).order('sort_order'),
      ]);
      if (productError || relationshipError) throw new Error(productError?.message || relationshipError?.message);
      const relatedProductIds = new Set((relationships || []).map((relationship: any) => relationship.target_product_id));
      const availableProducts = (products || []).filter((product: any) => {
        if (product.commerce_kind === 'participation') {
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
      }).map((product: any) => ({
        ...product,
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

    if (req.method === 'GET' && path === 'draft') {
      if (!userId) return errorResponse('Unauthorized', 401);
      const venueId = String(url.searchParams.get('venueId') || '').trim();
      const draftScope = normalizeDraftScope(url.searchParams.get('scope'));
      if (!venueId) return errorResponse('Missing venueId', 400);
      const order = await findAuthenticatedDraft(admin, venueId, userId, draftScope);
      if (!order) return errorResponse('Order not found', 404);
      return jsonResponse(await cartResponse(admin, order, order.id), 200, 0);
    }

    if (req.method === 'POST' && path === 'cart') {
      const body = await req.json();
      const venueId = String(body.venue_id || '').trim();
      const venue = await venueContext(admin, venueId);
      const source = String(body.source || 'commerce_order_draft').trim().slice(0, 80);
      const draftScope = normalizeDraftScope(body.draft_scope || source);
      const customerId = userId
        ? await resolveOrCreateCustomerIdForUser(admin, userId, venueId, 'commerce_draft')
        : null;
      let order: any = null;
      let draftReference = '';
      let created = false;

      if (userId) {
        order = await findAuthenticatedDraft(admin, venueId, userId, draftScope);
        draftReference = order?.id || '';
      } else {
        const suppliedReference = String(body.draft_ref || body.token || '').trim();
        if (suppliedReference) {
          try {
            const candidate = await loadOrderByReference(
              admin,
              suppliedReference,
              null,
              { editable: true },
            );
            if (candidate.venue_id === venueId && candidate.draft_scope === draftScope) {
              order = candidate;
              draftReference = suppliedReference;
            }
          } catch {
            // A missing, expired, revoked, or foreign guest reference starts a
            // separate browser-session draft without revealing why it failed.
          }
        }
      }

      if (!order) {
        const token = newCartToken();
        order = await insertCommerceDraft(admin, {
          venue,
          userId,
          customerId,
          tokenHash: await sha256(token),
          draftScope,
          source,
          guestName: body.guest_name,
          guestEmail: body.guest_email,
          guestPhone: body.guest_phone,
        });
        draftReference = userId ? order.id : token;
        created = true;
      }

      try {
        const lines = await validateCartItems(admin, venueId, body.items, userId);
        const { data: replaced, error: replaceError } = await admin.rpc('replace_commerce_cart_lines', {
          p_order_id: order.id,
          p_expected_version: order.version,
          p_lines: lines,
          p_guest_name: body.guest_name || null,
          p_guest_email: body.guest_email || null,
          p_guest_phone: body.guest_phone || null,
        }).maybeSingle();
        if (replaceError) throw new Error(replaceError.message);
        order.version = replaced.version;
        order.guest_name = body.guest_name || order.guest_name;
        order.guest_email = body.guest_email
          ? String(body.guest_email).trim().toLowerCase()
          : order.guest_email;
        order.guest_phone = body.guest_phone || order.guest_phone;
        if (!userId) {
          order.expires_at = guestDraftExpiry();
          const { error: expiryError } = await admin.from('commerce_orders').update({
            expires_at: order.expires_at,
          }).eq('id', order.id).eq('status', 'draft');
          if (expiryError) throw new Error(expiryError.message);
        }
      } catch (error) {
        if (created) {
          await admin.from('commerce_orders').delete().eq('id', order.id).eq('status', 'draft');
        }
        throw error;
      }
      return jsonResponse(
        await cartResponse(admin, order, draftReference),
        created ? 201 : 200,
        0,
      );
    }

    if (req.method === 'PUT' && path === 'cart') {
      const body = await req.json();
      const draftReference = String(body.draft_ref || body.token || '');
      const order = await loadOrderByReference(
        admin,
        draftReference,
        userId,
        { editable: true },
      );
      const lines = await validateCartItems(admin, order.venue_id, body.items, userId);
      const { data, error } = await admin.rpc('replace_commerce_cart_lines', {
        p_order_id: order.id,
        p_expected_version: Number(body.expected_version),
        p_lines: lines,
        p_guest_name: body.guest_name || null,
        p_guest_email: body.guest_email || null,
        p_guest_phone: body.guest_phone || null,
      }).maybeSingle();
      if (error) throw new Error(error.message);
      order.version = data.version;
      if (!userId) {
        order.expires_at = guestDraftExpiry();
        const { error: expiryError } = await admin.from('commerce_orders')
          .update({ expires_at: order.expires_at })
          .eq('id', order.id)
          .eq('status', 'draft');
        if (expiryError) throw new Error(expiryError.message);
      }
      return jsonResponse(await cartResponse(admin, order, draftReference), 200, 0);
    }

    if (req.method === 'GET' && path === 'order') {
      const reference = url.searchParams.get('ref') || url.searchParams.get('token') || '';
      const order = await loadOrderByReference(
        admin,
        reference,
        userId,
        { allowReceiptToken: true },
      );
      return jsonResponse(await cartResponse(admin, order), 200, 0);
    }

    if (req.method === 'POST' && path === 'resolve') {
      const body = await req.json();
      const order = await loadOrderByReference(
        admin,
        String(body.draft_ref || body.token || ''),
        userId,
        { editable: true },
      );
      const lines = await loadOrderLines(admin, order.id);
      const resolved = await resolveLines(admin, order, lines, userId);
      return jsonResponse({
        order: {
          id: order.id,
          version: order.version,
          currency: order.currency,
          ...resolvedOrderSummary(resolved),
        },
        lines: resolved.map(projectOrderLine),
      }, 200, 0);
    }

    if (req.method === 'POST' && path === 'checkout') {
      const body = await req.json();
      const draftReference = String(body.draft_ref || body.token || '');
      const order = await loadOrderByReference(
        admin,
        draftReference,
        userId,
        { editable: true },
      );
      if (order.version !== Number(body.expected_version)) {
        return errorResponse('Köpet ändrades — kontrollera det igen.', 409);
      }
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
      const participation = lines.filter((line) => line.commerce_kind === 'participation');
      if (participation.length > 1) {
        return errorResponse('Release 1 supports one participation per order', 409);
      }

      let customerId = order.customer_id || null;
      if (userId) {
        customerId = await resolveOrCreateCustomerIdForUser(admin, userId, order.venue_id, 'commerce_checkout');
        await admin.from('commerce_orders').update({ user_id: userId, customer_id: customerId }).eq('id', order.id).eq('status', 'draft');
      } else if (participation.length > 0) {
        if (!checkoutGuestEmail) {
          return errorResponse('E-post krävs för kvitto och biljett.', 400);
        }
        customerId = await resolveOrCreateGuestCustomerByEmail(admin, {
          venueId: order.venue_id,
          email: checkoutGuestEmail,
          displayName: checkoutGuestName,
          source: 'commerce_guest_participation',
        });
        const { error: ownerUpdateError } = await admin.from('commerce_orders')
          .update({ customer_id: customerId })
          .eq('id', order.id)
          .eq('status', 'draft')
          .is('user_id', null);
        if (ownerUpdateError) throw new Error(ownerUpdateError.message);
      }
      order.customer_id = customerId;
      const resolved = await resolveLines(admin, order, lines, userId);
      let holdId: string | null = null;
      if (participation[0]) {
        holdId = await acquireParticipationHold(
          admin,
          order,
          participation[0],
          userId || null,
          customerId,
        );
        const resolvedParticipation = resolved.find((line) => line.id === participation[0].id);
        if (resolvedParticipation) resolvedParticipation.capacity_hold_id = holdId;
      }

      const { data: frozen, error: freezeError } = await admin.rpc('freeze_commerce_order', {
        p_order_id: order.id,
        p_expected_version: order.version,
        p_lines: resolved,
      }).maybeSingle();
      if (freezeError) {
        await releaseHold(admin, holdId, 'commerce_freeze_failed');
        throw new Error(freezeError.message);
      }

      if (Number(frozen.total_inc_vat_minor || 0) === 0) {
        try {
          if (!participation[0] || !holdId || (!userId && !customerId)) {
            throw new Error('Free order has no participation owner');
          }
          const resolvedParticipation = resolved.find((line) => line.id === participation[0].id);
          const registrationId = await commitFreeParticipation(
            admin,
            order,
            participation[0],
            resolvedParticipation,
            userId || null,
            customerId,
            holdId,
          );
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
        await admin.rpc('reopen_commerce_order_after_checkout_failure', { p_order_id: order.id, p_version: frozen.version });
        return errorResponse('E-post krävs för kvitto och uthämtning.', 400);
      }

      const origin = canonicalPublicOrigin(req);
      const successPath = safeLocalPath(body.success_path, '/commerce/confirmed');
      const cancelPath = safeLocalPath(body.cancel_path, '/cart');
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
            commerce_order_version: String(frozen.version),
          },
          success_url: `${origin}${successPath}${successPath.includes('?') ? '&' : '?'}session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}${cancelPath}`,
        });
      } catch (error) {
        await releaseHold(admin, holdId, 'commerce_stripe_create_failed');
        await admin.rpc('reopen_commerce_order_after_checkout_failure', { p_order_id: order.id, p_version: frozen.version });
        throw error;
      }

      const { data: attached, error: attachError } = await admin.rpc('attach_commerce_order_stripe_session', {
        p_order_id: order.id,
        p_version: frozen.version,
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
      return jsonResponse({ url: stripeSession.url, order_id: order.id, version: frozen.version });
    }

    if (req.method === 'DELETE' && path === 'draft') {
      const reference = url.searchParams.get('ref') || '';
      const order = await loadOrderByReference(
        admin,
        reference,
        userId,
        { editable: true },
      );
      const { error } = await admin.from('commerce_orders').update({
        status: 'expired',
        expires_at: new Date().toISOString(),
      }).eq('id', order.id).eq('status', 'draft');
      if (error) throw new Error(error.message);
      return jsonResponse({ revoked: true }, 200, 0);
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
      const { data: orders, error: orderError } = await admin
        .from('commerce_orders')
        .select('id, venue_id, customer_id, guest_name, guest_email, guest_phone, status, paid_at, booking_receipt_id')
        .eq('venue_id', venueId)
        .in('status', ['paid', 'attention']);
      if (orderError) throw new Error(orderError.message);
      const orderIds = (orders || []).map((order: any) => order.id);
      const { data: lines, error: lineError } = orderIds.length
        ? await admin.from('commerce_order_lines').select('*').in('commerce_order_id', orderIds)
          .eq('fulfillment_type', 'desk_pickup').eq('fulfillment_status', status).order('created_at')
        : { data: [], error: null };
      if (lineError) throw new Error(lineError.message);
      const orderById = new Map((orders || []).map((order: any) => [order.id, order]));
      return jsonResponse({ items: (lines || []).map((line: any) => ({ ...line, order: orderById.get(line.commerce_order_id) })) }, 200, 5);
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
      const { data, error } = await admin.rpc('transition_commerce_fulfillment', {
        p_line_id: body.line_id,
        p_next_status: body.status,
        p_actor_user_id: userId,
        p_request_id: req.headers.get('x-request-id') || crypto.randomUUID(),
        p_metadata: { source: 'api-commerce' },
      });
      if (error) throw new Error(error.message);
      return jsonResponse({ item: data }, 200, 0);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected commerce error';
    console.error('api-commerce', path, message);
    if (message === 'Unauthorized') return errorResponse(message, 401);
    if (message === 'Forbidden') return errorResponse(message, 403);
    if (message.includes('stale_cart_version')) {
      return errorResponse('Köpet ändrades — kontrollera det igen.', 409);
    }
    if (message.includes('not found') || message.includes('not_found')) return errorResponse(message, 404);
    if (message.includes('Platsen hann tas')) return errorResponse(message, 409);
    return errorResponse(message, 400);
  }
});
