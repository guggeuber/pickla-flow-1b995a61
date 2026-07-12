// Deploy with: supabase functions deploy api-stripe-webhook --no-verify-jwt
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Configure the webhook endpoint in the Stripe dashboard:
//   https://<project>.supabase.co/functions/v1/api-stripe-webhook
// Events to listen for: checkout.session.completed, invoice.paid

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail, generateAccessCode, getOrCreatePublicBookingUserId } from '../_shared/bookings.ts';
import { resolveCustomerIdForUser } from '../_shared/customers.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

const BOOKING_PARTICIPANT_SOURCE_TYPE = 'booking_participant';
const BOOKING_PARTICIPANT_MAX_PER_COURT = 4;

// Deno-native Stripe webhook signature verification.
// Do not use the Stripe Node SDK in Supabase Edge Runtime here; it can trigger
// Deno.core.runMicrotasks()/process.nextTick crashes on subscription events.
async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): Promise<void> {
  const parts = signatureHeader.split(',').reduce((acc: Record<string, string[]>, part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return acc;
    acc[key] = acc[key] || [];
    acc[key].push(value);
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid Stripe signature header');
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new Error('Invalid Stripe signature timestamp');
  }

  const toleranceSeconds = 300;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    throw new Error('Stripe signature timestamp outside tolerance');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!signatures.some((sig) => timingSafeEqual(sig, expected))) {
    throw new Error('No matching Stripe signature');
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return errorResponse('Stripe not configured', 500);
  }

  // Verify Stripe signature — security gate
  const signature = req.headers.get('stripe-signature');
  if (!signature) return errorResponse('Missing stripe-signature', 400);

  const rawBody = await req.text();

  let event: any;
  try {
    await verifyStripeSignature(rawBody, signature, webhookSecret);
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return errorResponse(`Webhook signature error: ${(err as Error).message}`, 400);
  }

  const serviceClient = getServiceClient();
  const eventId = String(event.id || '');
  if (!eventId) {
    return errorResponse('Missing Stripe event id', 400);
  }

  const { error: eventInsertError } = await serviceClient.from('stripe_events').insert({
    id: eventId,
    type: String(event.type || 'unknown'),
    payload: event,
    status: 'received',
  });
  if (eventInsertError) {
    if (eventInsertError.code === '23505') {
      const { data: existingEvent, error: existingEventError } = await serviceClient
        .from('stripe_events')
        .select('status')
        .eq('id', eventId)
        .maybeSingle();
      if (existingEventError) {
        console.error('Failed to inspect duplicate Stripe event:', existingEventError.message);
        return errorResponse('Failed to inspect duplicate Stripe event', 500);
      }
      if (['processed', 'skipped'].includes(String(existingEvent?.status || ''))) {
        return jsonResponse({ received: true, duplicate: true }, 200);
      }
      const { error: retryEventError } = await serviceClient
        .from('stripe_events')
        .update({
          type: String(event.type || 'unknown'),
          payload: event,
          status: 'received',
          processed_at: null,
          error: null,
        })
        .eq('id', eventId);
      if (retryEventError) {
        console.error('Failed to prepare Stripe event retry:', retryEventError.message);
        return errorResponse('Failed to prepare Stripe event retry', 500);
      }
    }
    if (eventInsertError.code !== '23505') {
      console.error('Failed to record Stripe event:', eventInsertError.message);
      return errorResponse('Failed to record Stripe event', 500);
    }
  }

  if (event.type === 'invoice.paid') {
    try {
      await handleInvoicePaid(event.data.object, serviceClient);
      await serviceClient.from('stripe_events')
        .update({ status: 'processed', processed_at: new Date().toISOString(), error: null })
        .eq('id', eventId);
      return jsonResponse({ received: true }, 200);
    } catch (err) {
      console.error('Error processing invoice.paid webhook:', err);
      await serviceClient.from('stripe_events')
        .update({ status: 'failed', processed_at: new Date().toISOString(), error: (err as Error).message })
        .eq('id', eventId);
      return errorResponse((err as Error).message, 500);
    }
  }

  if (event.type !== 'checkout.session.completed') {
    await serviceClient.from('stripe_events')
      .update({ status: 'skipped', processed_at: new Date().toISOString() })
      .eq('id', eventId);
    return jsonResponse({ received: true, skipped: true }, 200);
  }

  const session = event.data.object;
  const meta = session.metadata || {};
  const { product_type } = meta;

  if (!product_type) {
    console.error('Missing product_type in session', session.id);
    await serviceClient.from('stripe_events')
      .update({ status: 'failed', processed_at: new Date().toISOString(), error: 'Missing session metadata' })
      .eq('id', eventId);
    return jsonResponse({ received: true, failed: true, error: 'Missing session metadata' }, 200);
  }

  try {
    if (product_type === 'court_booking') {
      await handleCourtBooking(session, meta, serviceClient);
    } else if (product_type === 'day_pass') {
      await handleDayPass(session, meta, serviceClient);
    } else if (product_type === 'activity_ticket') {
      await handleActivityTicket(session, meta, serviceClient);
    } else if (product_type === BOOKING_PARTICIPANT_SOURCE_TYPE) {
      await handleBookingParticipant(session, meta, serviceClient);
    } else if (product_type === 'membership') {
      await handleMembership(session, meta, serviceClient);
    }
    await serviceClient.from('stripe_events')
      .update({ status: 'processed', processed_at: new Date().toISOString(), error: null })
      .eq('id', eventId);
  } catch (err) {
    console.error('Error processing webhook:', err);
    await serviceClient.from('stripe_events')
      .update({ status: 'failed', processed_at: new Date().toISOString(), error: (err as Error).message })
      .eq('id', eventId);
    return errorResponse((err as Error).message, 500);
  }

  return jsonResponse({ received: true }, 200);
});

// ── Court booking ─────────────────────────────────────────────────────────────

function vatPartsFromIncludedTotal(totalIncVat: number, vatRate = 6) {
  const vatAmount = Math.round(totalIncVat * vatRate / (100 + vatRate) * 100) / 100;
  return {
    totalIncVat,
    vatRate,
    vatAmount,
    totalExVat: Math.round(Math.max(totalIncVat - vatAmount, 0) * 100) / 100,
  };
}

function vatMinorFromIncludedMinor(totalIncVatMinor: number, vatRate = 6) {
  return Math.round(totalIncVatMinor * vatRate / (100 + vatRate));
}

function receiptPaymentMethod(session: any) {
  const types = Array.isArray(session.payment_method_types) ? session.payment_method_types : [];
  if (types.includes('card')) return 'Kort via Stripe';
  return types.length ? `${types.join(', ')} via Stripe` : 'Stripe';
}

function bookingGroupKey(row: any) {
  if (row?.stripe_session_id) return `stripe:${row.stripe_session_id}`;
  if (row?.access_code) return `code:${row.access_code}:${row.start_time}:${row.end_time}`;
  return `booking:${row?.id || row?.booking_ref || crypto.randomUUID()}`;
}

function bookingParticipantCapacity(rows: any[]) {
  return Math.max(rows.length, 1) * BOOKING_PARTICIPANT_MAX_PER_COURT;
}

function openBookingCapacity(rows: any[]) {
  const representative = rows.find((row: any) => row?.open_for_more_status === 'open') || rows[0] || {};
  if (representative?.open_for_more_status !== 'open') return 0;
  const publicCapacity = Number(representative?.open_for_more_public_capacity || 0);
  if (publicCapacity > 0) return publicCapacity;
  const openedPlaces = Number(representative?.open_for_more_opened_places || 0);
  const committedAtPublication = Number(representative?.open_for_more_committed_at_publication || 0);
  if (openedPlaces > 0) return committedAtPublication + openedPlaces;
  const legacyTotal = Number(representative?.open_for_more_total_players || 0);
  return legacyTotal > 0 ? legacyTotal : 0;
}

function bookingGroupIsOpenForMore(rows: any[]) {
  return rows.some((row: any) => row?.open_for_more_status === 'open');
}

function bookingParticipantCapacityLimit(rows: any[]) {
  return bookingGroupIsOpenForMore(rows) ? openBookingCapacity(rows) : bookingParticipantCapacity(rows);
}

function bookingSessionDate(row: any) {
  const iso = row?.start_time;
  if (!iso) return DateTime.now().setZone('Europe/Stockholm').toISODate()!;
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Stockholm').toISODate()!;
}

type CapacityRpcResult = {
  ok: boolean;
  hold_id?: string | null;
  registration_id?: string | null;
  participant_id?: string | null;
  reason?: string | null;
  available_count?: number | null;
};

async function rpcSingle(serviceClient: any, fn: string, args: Record<string, unknown>): Promise<CapacityRpcResult> {
  const { data, error } = await serviceClient.rpc(fn, args).maybeSingle();
  if (error) throw new Error(error.message);
  return data || { ok: false, reason: 'empty_rpc_result' };
}

async function commitActivityRegistrationCapacity(serviceClient: any, args: Record<string, unknown>) {
  return rpcSingle(serviceClient, 'commit_activity_registration_capacity', args);
}

async function commitBookingParticipantCapacity(serviceClient: any, args: Record<string, unknown>) {
  return rpcSingle(serviceClient, 'commit_booking_participant_capacity', args);
}

async function recordPaidCapacityConflict(serviceClient: any, params: {
  venueId: string;
  scopeType: string;
  scopeId: string;
  sessionDate?: string | null;
  stripeSessionId: string;
  paymentIntentId?: string | null;
  receiptId?: string | null;
  ledgerSourceType?: string | null;
  ledgerSourceId?: string | null;
  customerId?: string | null;
  userId?: string | null;
  title: string;
  metadata?: Record<string, unknown>;
}) {
  const agentKey = `paid_capacity_conflict:${params.stripeSessionId}`;
  const incidentMetadata = {
    type: 'paid_capacity_conflict',
    agent_key: agentKey,
    scope_type: params.scopeType,
    scope_id: params.scopeId,
    session_date: params.sessionDate || null,
    stripe_session_id: params.stripeSessionId,
    stripe_payment_intent_id: params.paymentIntentId || null,
    booking_receipt_id: params.receiptId || null,
    ledger_source_type: params.ledgerSourceType || null,
    ledger_source_id: params.ledgerSourceId || null,
    customer_id: params.customerId || null,
    user_id: params.userId || null,
    ...(params.metadata || {}),
  };

  const { data: existing } = await serviceClient
    .from('ops_incidents')
    .select('id')
    .eq('venue_id', params.venueId)
    .contains('metadata', { agent_key: agentKey })
    .neq('status', 'resolved')
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await serviceClient.from('ops_incidents')
      .update({
        status: 'open',
        severity: 'P1',
        title: params.title,
        impact: 'Betalning mottagen men ingen spelrätt kunde levereras eftersom kapaciteten var full.',
        metadata: incidentMetadata,
      })
      .eq('id', existing.id);
  } else {
    await serviceClient.from('ops_incidents').insert({
      venue_id: params.venueId,
      severity: 'P1',
      title: params.title,
      status: 'open',
      owner_name: 'Desk',
      impact: 'Betalning mottagen men ingen spelrätt kunde levereras eftersom kapaciteten var full.',
      containment: 'Blockera automatisk incheckning och lös manuellt innan spel.',
      affected_ids: [params.scopeId, params.stripeSessionId, params.receiptId].filter(Boolean).join(','),
      metadata: incidentMetadata,
    });
  }

  await serviceClient.from('ops_signals')
    .upsert({
      venue_id: params.venueId,
      signal_key: 'bookings',
      status: 'red',
      note: 'Betald plats kunde inte levereras på grund av full kapacitet.',
      source: 'stripe_webhook',
      details: incidentMetadata,
      last_auto_checked_at: new Date().toISOString(),
    }, { onConflict: 'venue_id,signal_key' });

  await serviceClient.from('audit_log').insert({
    venue_id: params.venueId,
    actor_type: 'webhook',
    action: 'capacity.paid_capacity_conflict',
    entity_table: 'ops_incidents',
    request_id: params.stripeSessionId,
    after: incidentMetadata,
    metadata: incidentMetadata,
  });
}

function bookingContactFromNotes(notes?: string | null) {
  const parts = String(notes || '').split(' | ').map((part) => part.trim());
  return {
    name: parts[0] || null,
    phone: parts[1] || null,
    email: parts[2] || null,
  };
}

function isFounderBookingGroup(rows: any[]) {
  return rows.some((row: any) =>
    Number(row?.included_court_hours || 0) > 0 ||
    row?.membership_usage_entitlement_type === 'court_hours_per_week'
  );
}

async function getBookingGroupRows(serviceClient: any, booking: any) {
  let query = serviceClient
    .from('bookings')
    .select('id, booking_ref, venue_id, venue_court_id, user_id, customer_id, start_time, end_time, total_price, status, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at')
    .eq('venue_id', booking.venue_id)
    .neq('status', 'cancelled');

  if (booking.stripe_session_id) {
    query = query.eq('stripe_session_id', booking.stripe_session_id);
  } else if (booking.access_code) {
    query = query.eq('access_code', booking.access_code).eq('start_time', booking.start_time).eq('end_time', booking.end_time);
  } else {
    query = query.eq('start_time', booking.start_time).eq('end_time', booking.end_time).eq('notes', booking.notes);
  }

  const { data, error } = await query.order('start_time', { ascending: true });
  if (error) throw new Error(error.message);
  return data?.length ? data : [booking];
}

async function ensureBookerParticipant(serviceClient: any, bookingRows: any[]) {
  const booking = bookingRows[0];
  if (!booking?.user_id) return null;
  const groupKey = bookingGroupKey(booking);
  const { data: existingRows } = await serviceClient
    .from('booking_participants')
    .select('id, user_id, role')
    .eq('venue_id', booking.venue_id)
    .eq('booking_group_key', groupKey)
    .neq('payment_status', 'cancelled');
  if ((existingRows || []).some((row: any) => row.role === 'booker' || row.user_id === booking.user_id)) return null;

  const customerId = booking.customer_id || await resolveCustomerIdForUser(serviceClient, booking.user_id);
  const contact = bookingContactFromNotes(booking.notes);
  const paymentStatus = Number((bookingRows || []).reduce((sum: number, row: any) => sum + Number(row.total_price || 0), 0)) <= 0
    ? 'free'
    : booking.stripe_session_id
    ? 'paid'
    : 'pending';

  if (!['paid', 'free'].includes(paymentStatus)) return null;

  const result = await commitBookingParticipantCapacity(serviceClient, {
    p_venue_id: booking.venue_id,
    p_booking_id: booking.id,
    p_booking_group_key: groupKey,
    p_session_date: bookingSessionDate(booking),
    p_capacity: bookingParticipantCapacity(bookingRows),
    p_customer_id: customerId,
    p_user_id: booking.user_id,
    p_display_name: contact.name || 'Bokare',
    p_email: contact.email || null,
    p_phone: contact.phone || null,
    p_role: 'booker',
    p_price_minor: 0,
    p_payment_status: paymentStatus,
    p_payment_method: booking.stripe_session_id ? 'stripe' : null,
    p_metadata: {
      source: 'booking_owner',
      founder_booking: isFounderBookingGroup(bookingRows),
    },
  });
  return result.participant_id ? { id: result.participant_id } : null;
}

function stripeId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'id' in value) return String((value as any).id || '') || null;
  return null;
}

function invoiceSubscriptionId(invoice: any): string | null {
  return stripeId(invoice.subscription)
    || stripeId(invoice.subscription_details?.subscription)
    || stripeId(invoice.parent?.subscription_details?.subscription)
    || stripeId(invoice.lines?.data?.find((line: any) => line?.subscription)?.subscription)
    || null;
}

function invoiceMetadata(invoice: any): Record<string, string> {
  const merged = {
    ...(invoice.subscription_details?.metadata || {}),
    ...(invoice.parent?.subscription_details?.metadata || {}),
    ...(invoice.lines?.data?.find((line: any) => line?.metadata && Object.keys(line.metadata).length)?.metadata || {}),
  };
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, String(value ?? '')]));
}

function invoicePaymentIntentId(invoice: any): string | null {
  return stripeId(invoice.payment_intent)
    || stripeId(invoice.payments?.data?.find((payment: any) => payment?.payment?.payment_intent)?.payment?.payment_intent)
    || null;
}

async function createLedgerEntryFromReceipt({
  session,
  meta,
  serviceClient,
  sourceType,
  sourceId,
  receipt,
  amountIncVatMinor,
  metadata = {},
}: {
  session: any;
  meta: Record<string, string>;
  serviceClient: any;
  sourceType: string;
  sourceId: string;
  receipt?: any;
  amountIncVatMinor: number;
  metadata?: Record<string, unknown>;
}) {
  if (!meta.venue_id || !sourceId || amountIncVatMinor <= 0) return;

  const stripeInvoiceId = String(metadata.stripe_invoice_id || '').trim();
  if (sourceType === 'membership' && stripeInvoiceId) {
    const { data: existingInvoiceLedger } = await serviceClient
      .from('ledger_entries')
      .select('id')
      .eq('source_type', 'membership_invoice')
      .eq('source_id', stripeInvoiceId)
      .maybeSingle();
    if (existingInvoiceLedger?.id) return;
  }

  const occurredAt = receipt?.issued_at || new Date().toISOString();
  const accountingDate = DateTime
    .fromISO(occurredAt, { zone: 'utc' })
    .setZone('Europe/Stockholm')
    .toISODate();
  if (!accountingDate) throw new Error('Could not resolve ledger accounting date');

  const entry = {
    venue_id: meta.venue_id,
    source_type: sourceType,
    source_id: sourceId,
    accounting_date: accountingDate,
    occurred_at: occurredAt,
    customer_id: receipt?.customer_id || null,
    customer_name: receipt?.customer_name || meta.customer_name || meta.name || session.customer_details?.name || null,
    amount_inc_vat_minor: amountIncVatMinor,
    vat_amount_minor: vatMinorFromIncludedMinor(amountIncVatMinor, Number(receipt?.vat_rate || 6)),
    payment_status: receipt?.payment_status || session.payment_status || 'paid',
    payment_method: receipt?.payment_method || receiptPaymentMethod(session),
    stripe_session_id: session.id,
    receipt_number: receipt?.receipt_number || null,
    booking_receipt_id: receipt?.id || null,
    metadata: {
      product_type: meta.product_type || sourceType,
      purchase_type: receipt?.purchase_type || null,
      product_description: receipt?.product_description || null,
      stripe_payment_intent_id: session.payment_intent || receipt?.stripe_payment_intent_id || null,
      stripe_customer_id: session.customer || receipt?.stripe_customer_id || null,
      stripe_invoice_id: stripeInvoiceId || receipt?.stripe_invoice_id || null,
      ...metadata,
    },
  };

  const { error } = await serviceClient.from('ledger_entries').insert(entry);
  if (error) {
    if (error.code === '23505') return;
    throw new Error(`Failed to create ledger entry: ${error.message}`);
  }
}

async function createPurchaseReceipt({
  session,
  meta,
  serviceClient,
  userId,
  bookingRefs = [],
  totalSek,
  purchaseType,
  productDescription,
}: {
  session: any;
  meta: Record<string, string>;
  serviceClient: any;
  userId: string | null;
  bookingRefs?: string[];
  totalSek: number;
  purchaseType: string;
  productDescription: string;
}) {
  if (totalSek <= 0) return null;

  const checkoutInvoiceId = stripeId(session.invoice);
  if (purchaseType === 'membership' && checkoutInvoiceId) {
    const { data: invoiceReceipt } = await serviceClient
      .from('booking_receipts')
      .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id, metadata')
      .eq('stripe_invoice_id', checkoutInvoiceId)
      .maybeSingle();
    if (invoiceReceipt) {
      if (!invoiceReceipt.stripe_session_id) {
        const { data: updated } = await serviceClient
          .from('booking_receipts')
          .update({
            stripe_session_id: session.id,
            stripe_subscription_id: invoiceReceipt.stripe_subscription_id || session.subscription || null,
          })
          .eq('id', invoiceReceipt.id)
          .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id, metadata')
          .maybeSingle();
        return updated || invoiceReceipt;
      }
      return invoiceReceipt;
    }
  }

  const { data: existing } = await serviceClient
    .from('booking_receipts')
    .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();
  if (existing) return existing;

  const vat = vatPartsFromIncludedTotal(totalSek, 6);
  const customerId = await resolveCustomerIdForUser(serviceClient, userId);
  const customerName = meta.customer_name || meta.name || session.customer_details?.name || null;
  const customerEmail = session.customer_details?.email || meta.customer_email || null;
  const customerPhone = meta.customer_phone || meta.phone || session.customer_details?.phone || null;

  const { data: receipt, error } = await serviceClient.from('booking_receipts').insert({
    booking_refs: bookingRefs,
    stripe_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_invoice_id: checkoutInvoiceId,
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: session.subscription || null,
    venue_id: meta.venue_id || null,
    customer_id: customerId,
    user_id: userId || null,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    purchase_type: purchaseType,
    product_description: productDescription,
    payment_method: receiptPaymentMethod(session),
    total_inc_vat: Math.round(vat.totalIncVat),
    total_ex_vat: Math.round(vat.totalExVat),
    vat_amount: Math.round(vat.vatAmount),
    total_inc_vat_sek: vat.totalIncVat,
    total_ex_vat_sek: vat.totalExVat,
    vat_amount_sek: vat.vatAmount,
    vat_rate: vat.vatRate,
    currency: (session.currency || 'sek').toUpperCase(),
    payment_provider: 'stripe',
    payment_status: session.payment_status || 'paid',
    metadata: {
      product_type: meta.product_type || purchaseType,
      product_key: meta.product_key || null,
      date: meta.date || null,
      start_time: meta.start_time || null,
      end_time: meta.end_time || null,
      activity_session_id: meta.activity_session_id || meta.open_play_session_id || null,
      tier_id: meta.tier_id || null,
    },
  }).select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id').single();

  if (error) {
    console.error('Failed to create receipt:', error.message);
    return null;
  }

  return receipt;
}

async function resolveInvoiceCustomerContext(invoice: any, serviceClient: any) {
  const stripeCustomerId = stripeId(invoice.customer);
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);
  const meta = invoiceMetadata(invoice);
  let latestReceipt: any = null;

  if (stripeSubscriptionId) {
    const { data } = await serviceClient
      .from('booking_receipts')
      .select('id, customer_id, user_id, venue_id, customer_name, customer_email, customer_phone, product_description, stripe_customer_id, stripe_subscription_id, stripe_session_id, issued_at, metadata')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .eq('purchase_type', 'membership')
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestReceipt = data || null;
  }

  let userId = latestReceipt?.user_id || String(meta.user_id || '').trim() || null;
  let customerId = latestReceipt?.customer_id || null;
  let venueId = latestReceipt?.venue_id || String(meta.venue_id || '').trim() || null;
  let tierId = String(meta.tier_id || latestReceipt?.metadata?.tier_id || '').trim() || null;
  let tierName = String(meta.tier_name || latestReceipt?.metadata?.tier_name || latestReceipt?.product_description || '').trim() || null;
  let customerName = latestReceipt?.customer_name || invoice.customer_name || String(meta.customer_name || '').trim() || null;
  let customerEmail = latestReceipt?.customer_email || invoice.customer_email || String(meta.customer_email || '').trim() || null;
  let customerPhone = latestReceipt?.customer_phone || invoice.customer_phone || String(meta.customer_phone || '').trim() || null;

  if (stripeCustomerId && (!userId || !customerId || !customerName || !customerPhone)) {
    const { data: profile } = await serviceClient
      .from('player_profiles')
      .select('auth_user_id, customer_id, display_name, first_name, last_name, phone')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();
    if (profile) {
      userId = userId || profile.auth_user_id || null;
      customerId = customerId || profile.customer_id || null;
      customerName = customerName || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.display_name || null;
      customerPhone = customerPhone || profile.phone || null;
    }
  }

  if (stripeCustomerId && !customerId) {
    const { data: identity } = await serviceClient
      .from('customer_identities')
      .select('customer_id')
      .eq('provider', 'stripe')
      .eq('provider_id', stripeCustomerId)
      .limit(1)
      .maybeSingle();
    customerId = identity?.customer_id || null;
  }

  if (customerId && (!userId || !customerName || !customerEmail || !customerPhone)) {
    const { data: customer } = await serviceClient
      .from('customers')
      .select('auth_user_id, display_name, first_name, last_name, primary_email, primary_phone')
      .eq('id', customerId)
      .maybeSingle();
    if (customer) {
      userId = userId || customer.auth_user_id || null;
      customerName = customerName || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.display_name || null;
      customerEmail = customerEmail || customer.primary_email || null;
      customerPhone = customerPhone || customer.primary_phone || null;
    }
  }

  if (!customerId && userId) {
    customerId = await resolveCustomerIdForUser(serviceClient, userId);
  }

  return {
    latestReceipt,
    userId,
    customerId,
    venueId,
    tierId,
    tierName,
    customerName,
    customerEmail,
    customerPhone,
    stripeCustomerId,
    stripeSubscriptionId,
    metadata: meta,
  };
}

async function createLedgerEntryFromInvoice({
  invoice,
  serviceClient,
  receipt,
  context,
  amountIncVatMinor,
  issuedAt,
}: {
  invoice: any;
  serviceClient: any;
  receipt: any;
  context: any;
  amountIncVatMinor: number;
  issuedAt: string;
}) {
  if (!context.venueId || !invoice.id || amountIncVatMinor <= 0) return;

  const accountingDate = DateTime
    .fromISO(issuedAt, { zone: 'utc' })
    .setZone('Europe/Stockholm')
    .toISODate();
  if (!accountingDate) throw new Error('Could not resolve invoice ledger accounting date');

  const entry = {
    venue_id: context.venueId,
    source_type: 'membership_invoice',
    source_id: invoice.id,
    accounting_date: accountingDate,
    occurred_at: issuedAt,
    customer_id: context.customerId || receipt?.customer_id || null,
    customer_name: context.customerName || receipt?.customer_name || null,
    amount_inc_vat_minor: amountIncVatMinor,
    vat_amount_minor: vatMinorFromIncludedMinor(amountIncVatMinor, Number(receipt?.vat_rate || 6)),
    payment_status: 'paid',
    payment_method: 'Kort via Stripe',
    stripe_session_id: null,
    receipt_number: receipt?.receipt_number || null,
    booking_receipt_id: receipt?.id || null,
    metadata: {
      product_type: 'membership',
      purchase_type: 'membership',
      product_description: receipt?.product_description || context.tierName || 'Medlemskap',
      stripe_invoice_id: invoice.id,
      stripe_invoice_number: invoice.number || null,
      stripe_payment_intent_id: invoicePaymentIntentId(invoice),
      stripe_customer_id: context.stripeCustomerId,
      stripe_subscription_id: context.stripeSubscriptionId,
      billing_reason: invoice.billing_reason || null,
      hosted_invoice_url: invoice.hosted_invoice_url || null,
      invoice_pdf: invoice.invoice_pdf || null,
      period_start: invoice.period_start ? new Date(Number(invoice.period_start) * 1000).toISOString() : null,
      period_end: invoice.period_end ? new Date(Number(invoice.period_end) * 1000).toISOString() : null,
      tier_id: context.tierId || null,
      tier_name: context.tierName || null,
    },
  };

  const { error } = await serviceClient.from('ledger_entries').insert(entry);
  if (error) {
    if (error.code === '23505') return;
    throw new Error(`Failed to create subscription invoice ledger entry: ${error.message}`);
  }
}

async function hasLedgerForReceiptOrSession(serviceClient: any, receipt: any): Promise<boolean> {
  if (receipt?.id) {
    const { data } = await serviceClient
      .from('ledger_entries')
      .select('id')
      .eq('booking_receipt_id', receipt.id)
      .limit(1)
      .maybeSingle();
    if (data?.id) return true;
  }

  if (receipt?.stripe_session_id) {
    const { data } = await serviceClient
      .from('ledger_entries')
      .select('id')
      .eq('stripe_session_id', receipt.stripe_session_id)
      .limit(1)
      .maybeSingle();
    if (data?.id) return true;
  }

  return false;
}

async function handleInvoicePaid(invoice: any, serviceClient: any): Promise<void> {
  if (!invoice?.id) throw new Error('Missing Stripe invoice id');
  if (invoice.paid === false || invoice.status !== 'paid') {
    console.log('Ignoring invoice.paid with non-paid invoice state', invoice.id, invoice.status);
    return;
  }

  const amountPaidMinor = Number(invoice.amount_paid || 0);
  if (amountPaidMinor <= 0) {
    console.log('Ignoring zero-value paid invoice', invoice.id);
    return;
  }

  const context = await resolveInvoiceCustomerContext(invoice, serviceClient);
  if (!context.stripeCustomerId && !context.stripeSubscriptionId) {
    throw new Error(`Invoice ${invoice.id} has no Stripe customer/subscription id`);
  }
  if (!context.venueId) {
    throw new Error(`Could not resolve venue for paid subscription invoice ${invoice.id}`);
  }
  if (!context.tierId && !context.tierName) {
    throw new Error(`Could not resolve membership tier snapshot for paid subscription invoice ${invoice.id}`);
  }

  const paidAt = invoice.status_transitions?.paid_at
    ? new Date(Number(invoice.status_transitions.paid_at) * 1000).toISOString()
    : invoice.created
    ? new Date(Number(invoice.created) * 1000).toISOString()
    : new Date().toISOString();

  const { data: existingInvoiceReceipt } = await serviceClient
    .from('booking_receipts')
    .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle();

  if (existingInvoiceReceipt) {
    if (await hasLedgerForReceiptOrSession(serviceClient, existingInvoiceReceipt)) return;
    await createLedgerEntryFromInvoice({
      invoice,
      serviceClient,
      receipt: existingInvoiceReceipt,
      context,
      amountIncVatMinor: amountPaidMinor,
      issuedAt: existingInvoiceReceipt.issued_at || paidAt,
    });
    return;
  }

  if (invoice.billing_reason === 'subscription_create' && context.stripeSubscriptionId) {
    const { data: checkoutReceipt } = await serviceClient
      .from('booking_receipts')
      .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id, metadata')
      .eq('stripe_subscription_id', context.stripeSubscriptionId)
      .eq('purchase_type', 'membership')
      .not('stripe_session_id', 'is', null)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (checkoutReceipt) {
      let linkedReceipt = checkoutReceipt;
      if (!checkoutReceipt.stripe_invoice_id) {
        const { data: updated, error: updateErr } = await serviceClient
          .from('booking_receipts')
          .update({
            stripe_invoice_id: invoice.id,
            stripe_payment_intent_id: checkoutReceipt.stripe_payment_intent_id || invoicePaymentIntentId(invoice),
            metadata: {
              ...(checkoutReceipt.metadata || {}),
              stripe_invoice_id: invoice.id,
              stripe_invoice_number: invoice.number || null,
              billing_reason: invoice.billing_reason || null,
              hosted_invoice_url: invoice.hosted_invoice_url || null,
              invoice_pdf: invoice.invoice_pdf || null,
            },
          })
          .eq('id', checkoutReceipt.id)
          .select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id')
          .maybeSingle();
        if (updateErr) throw new Error(`Failed to link initial subscription invoice receipt: ${updateErr.message}`);
        linkedReceipt = updated || checkoutReceipt;
      }

      if (await hasLedgerForReceiptOrSession(serviceClient, linkedReceipt)) return;

      await createLedgerEntryFromInvoice({
        invoice,
        serviceClient,
        receipt: linkedReceipt,
        context,
        amountIncVatMinor: amountPaidMinor,
        issuedAt: linkedReceipt.issued_at || paidAt,
      });
      return;
    }
  }

  const amountSek = Math.round((amountPaidMinor / 100) * 100) / 100;
  const vat = vatPartsFromIncludedTotal(amountSek, 6);
  const description = context.tierName ? `Medlemskap · ${context.tierName}` : 'Medlemskap';

  const { data: receipt, error } = await serviceClient.from('booking_receipts').insert({
    booking_refs: [],
    stripe_session_id: null,
    stripe_invoice_id: invoice.id,
    stripe_payment_intent_id: invoicePaymentIntentId(invoice),
    stripe_customer_id: context.stripeCustomerId,
    stripe_subscription_id: context.stripeSubscriptionId,
    venue_id: context.venueId,
    customer_id: context.customerId || null,
    user_id: context.userId || null,
    customer_name: context.customerName || null,
    customer_email: context.customerEmail || invoice.customer_email || null,
    customer_phone: context.customerPhone || invoice.customer_phone || null,
    purchase_type: 'membership',
    product_description: description,
    payment_method: 'Kort via Stripe',
    total_inc_vat: Math.round(vat.totalIncVat),
    total_ex_vat: Math.round(vat.totalExVat),
    vat_amount: Math.round(vat.vatAmount),
    total_inc_vat_sek: vat.totalIncVat,
    total_ex_vat_sek: vat.totalExVat,
    vat_amount_sek: vat.vatAmount,
    vat_rate: vat.vatRate,
    currency: String(invoice.currency || 'sek').toUpperCase(),
    payment_provider: 'stripe',
    payment_status: 'paid',
    issued_at: paidAt,
    metadata: {
      product_type: 'membership',
      tier_id: context.tierId || null,
      tier_name: context.tierName || null,
      stripe_invoice_id: invoice.id,
      stripe_invoice_number: invoice.number || null,
      billing_reason: invoice.billing_reason || null,
      hosted_invoice_url: invoice.hosted_invoice_url || null,
      invoice_pdf: invoice.invoice_pdf || null,
      period_start: invoice.period_start ? new Date(Number(invoice.period_start) * 1000).toISOString() : null,
      period_end: invoice.period_end ? new Date(Number(invoice.period_end) * 1000).toISOString() : null,
    },
  }).select('id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id').single();

  if (error) {
    if (error.code === '23505') return;
    throw new Error(`Failed to create subscription invoice receipt: ${error.message}`);
  }

  await createLedgerEntryFromInvoice({
    invoice,
    serviceClient,
    receipt,
    context,
    amountIncVatMinor: amountPaidMinor,
    issuedAt: paidAt,
  });
}

async function createCourtBookingReceipt({
  session,
  meta,
  serviceClient,
  bookingUserId,
  bookingRefs,
  totalSek,
}: {
  session: any;
  meta: Record<string, string>;
  serviceClient: any;
  bookingUserId: string;
  bookingRefs: string[];
  totalSek: number;
}) {
  return await createPurchaseReceipt({
    session,
    meta,
    serviceClient,
    userId: bookingUserId,
    bookingRefs,
    totalSek,
    purchaseType: 'booking',
    productDescription: `Banbokning${meta.date ? ` ${meta.date}` : ''}${meta.start_time ? ` ${meta.start_time}-${meta.end_time || ''}` : ''}`,
  });
}

async function handleCourtBooking(
  session: any,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { venue_id, court_ids, date, start_time, end_time, name, phone, user_id, customer_email } = meta;

  let courtIds: string[];
  try {
    courtIds = JSON.parse(court_ids || '[]');
  } catch {
    throw new Error(`Invalid court_ids JSON: ${court_ids}`);
  }

  if (!courtIds.length || !date || !start_time || !end_time) {
    throw new Error(`Missing metadata fields: date=${date} start=${start_time} end=${end_time} courts=${court_ids}`);
  }

  // Convert Stockholm local time → UTC for storage
  const startISO = DateTime.fromISO(`${date}T${start_time}:00`, { zone: 'Europe/Stockholm' }).toUTC().toISO()!;
  const endISO   = DateTime.fromISO(`${date}T${end_time}:00`,   { zone: 'Europe/Stockholm' }).toUTC().toISO()!;

  // Resolve user — use authenticated user, Checkout email, metadata email, or fall back to shared guest user.
  const bookingUserId = await resolveUserId(session, user_id, serviceClient, customer_email);

  // Distribute total evenly across courts (Stripe amount is in ören)
  const totalSek = Math.round((session.amount_total || 0) / 100);
  const pricePerCourt = Math.round(totalSek / courtIds.length);
  const notes = [name, phone].filter(Boolean).join(' | ');
  const { data: existingSessionBooking } = await serviceClient
    .from('bookings')
    .select('access_code')
    .eq('stripe_session_id', session.id)
    .not('access_code', 'is', null)
    .limit(1)
    .maybeSingle();
  const sharedAccessCode = existingSessionBooking?.access_code ||
    (await generateAccessCode(serviceClient, venue_id, date));
  let insertedAnyBooking = false;
  const includedCourtHours = Number(meta.included_court_hours || 0);
  const paidCourtHours = Number(meta.paid_court_hours || 0);
  const includedHoursPerCourt = courtIds.length > 0 ? includedCourtHours / courtIds.length : 0;
  const paidHoursPerCourt = courtIds.length > 0 ? paidCourtHours / courtIds.length : 0;

  for (const courtId of courtIds) {
    // Idempotency: skip if already created for this session + court
    const { data: existing } = await serviceClient
      .from('bookings')
      .select('id')
      .eq('stripe_session_id', session.id)
      .eq('venue_court_id', courtId)
      .maybeSingle();
    if (existing) continue;

    const { data: conflicts } = await serviceClient
      .from('bookings')
      .select('id, stripe_session_id')
      .eq('venue_id', venue_id)
      .eq('venue_court_id', courtId)
      .neq('status', 'cancelled')
      .lt('start_time', endISO)
      .gt('end_time', startISO)
      .limit(1);
    const conflictingBooking = (conflicts || []).find((b: any) => b.stripe_session_id !== session.id);
    if (conflictingBooking) {
      throw new Error(`Court ${courtId} is already booked for this time`);
    }

    const { error } = await serviceClient.from('bookings').insert({
      venue_id,
      venue_court_id:         courtId,
      user_id:                bookingUserId,
      booked_by:              bookingUserId,
      start_time:             startISO,
      end_time:               endISO,
      total_price:            pricePerCourt,
      status:                 'confirmed',
      notes:                  notes || null,
      access_code:            sharedAccessCode,
      access_code_expires_at: endISO,
      stripe_session_id:      session.id,
      membership_id:          meta.membership_id || null,
      included_court_hours:   includedHoursPerCourt,
      paid_court_hours:       paidHoursPerCourt,
      membership_usage_entitlement_type: includedHoursPerCourt > 0 ? 'court_hours_per_week' : null,
      membership_usage_period_start: includedHoursPerCourt > 0 ? meta.entitlement_period_start : null,
      membership_usage_period_end:   includedHoursPerCourt > 0 ? meta.entitlement_period_end : null,
    });

    if (error) throw new Error(`Failed to insert booking for court ${courtId}: ${error.message}`);
    insertedAnyBooking = true;
  }

  const { data: sessionBookings, error: refsErr } = await serviceClient
    .from('bookings')
    .select('id, booking_ref, venue_id, venue_court_id, user_id, customer_id, start_time, end_time, total_price, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at')
    .eq('stripe_session_id', session.id)
    .neq('status', 'cancelled');

  if (refsErr) {
    console.error('Failed to fetch booking refs for receipt:', refsErr.message);
    return;
  }

  try {
    await ensureBookerParticipant(serviceClient, sessionBookings || []);
  } catch (participantErr) {
    console.error('Failed to ensure booking participant for Stripe booking:', (participantErr as Error).message);
  }

  const bookingRefs = (sessionBookings || []).map((b: any) => b.booking_ref).filter(Boolean);
  const receipt = await createCourtBookingReceipt({
    session,
    meta,
    serviceClient,
    bookingUserId,
    bookingRefs,
    totalSek,
  });
  await createLedgerEntryFromReceipt({
    session,
    meta,
    serviceClient,
    sourceType: 'court_booking',
    sourceId: session.id,
    receipt,
    amountIncVatMinor: Number(session.amount_total || 0),
    metadata: {
      booking_ids: (sessionBookings || []).map((b: any) => b.id).filter(Boolean),
      booking_refs: bookingRefs,
      court_ids: courtIds,
      date,
      start_time,
      end_time,
      included_court_hours: includedCourtHours,
      paid_court_hours: paidCourtHours,
    },
  });

  if (insertedAnyBooking && includedCourtHours > 0 && meta.entitlement_period_start && meta.entitlement_period_end) {
    const { data: usage } = await serviceClient
      .from('membership_usage')
      .select('used_value')
      .eq('user_id', bookingUserId)
      .eq('venue_id', venue_id)
      .eq('entitlement_type', 'court_hours_per_week')
      .eq('period_start', meta.entitlement_period_start)
      .maybeSingle();

    await serviceClient.from('membership_usage').upsert({
      user_id: bookingUserId,
      venue_id,
      entitlement_type: 'court_hours_per_week',
      period_start: meta.entitlement_period_start,
      period_end: meta.entitlement_period_end,
      used_value: Number(usage?.used_value || 0) + includedCourtHours,
    }, { onConflict: 'user_id,venue_id,entitlement_type,period_start' });
  }
}

async function handleBookingParticipant(
  session: any,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const participantId = String(meta.booking_participant_id || '').trim();
  if (!participantId) throw new Error('Missing booking_participant_id');

  const { data: participant, error: participantErr } = await serviceClient
    .from('booking_participants')
    .select('id, venue_id, booking_id, booking_group_key, customer_id, user_id, display_name, email, phone, price_minor, payment_status, booking_receipt_id, metadata, bookings(booking_ref, venue_id, start_time, end_time, access_code, stripe_session_id, notes, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at)')
    .eq('id', participantId)
    .maybeSingle();
  if (participantErr) throw new Error(participantErr.message);
  if (!participant) throw new Error('Booking participant not found');

  const booking = Array.isArray(participant.bookings) ? participant.bookings[0] : participant.bookings;
  const amountMinor = Number(session.amount_total || 0);
  if (amountMinor <= 0) throw new Error('Booking participant payment amount must be positive');

  const resolvedUserId = participant.user_id || meta.user_id || null;
  const paidMeta = {
    ...meta,
    venue_id: participant.venue_id,
    customer_name: participant.display_name || meta.customer_name || '',
    customer_email: session.customer_details?.email || participant.email || meta.customer_email || '',
    customer_phone: participant.phone || meta.customer_phone || '',
    product_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
  };

  const receipt = await createPurchaseReceipt({
    session,
    meta: paidMeta,
    serviceClient,
    userId: resolvedUserId,
    bookingRefs: booking?.booking_ref ? [booking.booking_ref] : [],
    totalSek: Math.round((amountMinor / 100) * 100) / 100,
    purchaseType: BOOKING_PARTICIPANT_SOURCE_TYPE,
    productDescription: 'Medspelarplats · Banbokning',
  });

  const { data: representativeBooking } = await serviceClient
    .from('bookings')
    .select('id, booking_ref, venue_id, venue_court_id, user_id, customer_id, start_time, end_time, total_price, status, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at')
    .eq('id', participant.booking_id)
    .maybeSingle();
  const bookingForCapacity = representativeBooking || booking;
  const groupedRows = bookingForCapacity ? await getBookingGroupRows(serviceClient, bookingForCapacity) : [];
  const participantMetadata = participant.metadata && typeof participant.metadata === 'object' ? participant.metadata : {};
  const stableOpenBookingCapacity = Number(
    meta.open_booking_public_capacity ||
    meta.open_booking_total_players ||
    participantMetadata.open_booking_public_capacity ||
    participantMetadata.open_booking_total_players ||
    0
  );
  const capacity = stableOpenBookingCapacity > 0
    ? stableOpenBookingCapacity
    : bookingParticipantCapacityLimit(groupedRows);
  const commit = await commitBookingParticipantCapacity(serviceClient, {
    p_venue_id: participant.venue_id,
    p_booking_id: participant.booking_id,
    p_booking_group_key: participant.booking_group_key,
    p_session_date: bookingSessionDate(bookingForCapacity),
    p_capacity: capacity,
    p_customer_id: participant.customer_id || receipt?.customer_id || null,
    p_user_id: resolvedUserId,
    p_display_name: participant.display_name || paidMeta.customer_name || 'Spelare',
    p_email: session.customer_details?.email || participant.email || null,
    p_phone: participant.phone || null,
    p_role: 'player',
    p_price_minor: amountMinor,
    p_payment_status: 'paid',
    p_payment_method: receiptPaymentMethod(session),
    p_payment_stripe_session_id: session.id,
    p_booking_receipt_id: receipt?.id || null,
    p_metadata: {
      ...(participant.metadata || {}),
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent || null,
    },
    p_hold_id: meta.capacity_hold_id || null,
    p_participant_id: participant.id,
  });

  if (!commit.ok) {
    await createLedgerEntryFromReceipt({
      session,
      meta: paidMeta,
      serviceClient,
      sourceType: 'stripe_payment',
      sourceId: session.id,
      receipt,
      amountIncVatMinor: amountMinor,
      metadata: {
        intended_source_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
        delivery_status: 'capacity_conflict',
        booking_participant_id: participant.id,
        booking_id: participant.booking_id,
        booking_group_key: participant.booking_group_key,
        booking_ref: booking?.booking_ref || null,
        open_booking_context: meta.open_booking_context || participantMetadata.source || null,
        open_booking_opened_places: Number(meta.open_booking_opened_places || participantMetadata.open_booking_opened_places || 0) || null,
        open_booking_public_capacity: stableOpenBookingCapacity || null,
        open_booking_committed_at_publication: Number(meta.open_booking_committed_at_publication || participantMetadata.open_booking_committed_at_publication || 0) || null,
        open_booking_total_players: stableOpenBookingCapacity || null,
      },
    });
    await recordPaidCapacityConflict(serviceClient, {
      venueId: participant.venue_id,
      scopeType: 'booking_group',
      scopeId: participant.booking_group_key,
      sessionDate: bookingSessionDate(bookingForCapacity),
      stripeSessionId: session.id,
      paymentIntentId: session.payment_intent || null,
      receiptId: receipt?.id || null,
      ledgerSourceType: 'stripe_payment',
      ledgerSourceId: session.id,
      customerId: participant.customer_id || receipt?.customer_id || null,
      userId: resolvedUserId,
      title: `Betald medspelarplats kunde inte levereras: ${participant.display_name || 'Spelare'}`,
      metadata: {
        product_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
        booking_participant_id: participant.id,
        booking_group_key: participant.booking_group_key,
        booking_id: participant.booking_id,
        open_booking_context: meta.open_booking_context || participantMetadata.source || null,
        open_booking_opened_places: Number(meta.open_booking_opened_places || participantMetadata.open_booking_opened_places || 0) || null,
        open_booking_public_capacity: stableOpenBookingCapacity || null,
        open_booking_committed_at_publication: Number(meta.open_booking_committed_at_publication || participantMetadata.open_booking_committed_at_publication || 0) || null,
        open_booking_total_players: stableOpenBookingCapacity || null,
      },
    });
    return;
  }

  await createLedgerEntryFromReceipt({
    session,
    meta: paidMeta,
    serviceClient,
    sourceType: BOOKING_PARTICIPANT_SOURCE_TYPE,
    sourceId: participant.id,
    receipt,
    amountIncVatMinor: amountMinor,
    metadata: {
      booking_participant_id: participant.id,
      booking_id: participant.booking_id,
      booking_group_key: participant.booking_group_key,
      booking_ref: booking?.booking_ref || null,
      open_booking_context: meta.open_booking_context || participantMetadata.source || null,
      open_booking_opened_places: Number(meta.open_booking_opened_places || participantMetadata.open_booking_opened_places || 0) || null,
      open_booking_public_capacity: stableOpenBookingCapacity || null,
      open_booking_committed_at_publication: Number(meta.open_booking_committed_at_publication || participantMetadata.open_booking_committed_at_publication || 0) || null,
      open_booking_total_players: stableOpenBookingCapacity || null,
    },
  });
}

// ── Shared: resolve a real user from metadata + Stripe customer_details ──────
//
// Priority:
//   1. user_id from metadata (set when buyer was already logged in)
//   2. Look up auth.users by customer_details.email (Stripe-verified)
//   3. Create a new confirmed user with that email
//   4. Fall back to the shared guest user (no email available)

async function resolveUserId(
  session: any,
  metaUserId: string,
  serviceClient: any,
  metaEmail = '',
): Promise<string> {
  // 1. Explicit user_id from metadata — most reliable path
  if (metaUserId) return metaUserId;

  // 2 & 3. Use Stripe's verified customer email
  const email = session.customer_details?.email || metaEmail;
  if (email) {
    // Try to find existing user
    const existing = await findAuthUserByEmail(serviceClient, email);
    if (existing?.id) return existing.id;

    // Create a new confirmed user — they can set a password later via magic link
    const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (created?.user?.id) return created.user.id;
    console.error('Failed to create user for email', email, createErr?.message);
  }

  // 4. No email — fall back to shared guest user
  return getOrCreatePublicBookingUserId(serviceClient);
}

// ── Day pass ─────────────────────────────────────────────────────────────────

async function handleDayPass(
  session: any,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { venue_id, date, user_id, activity_session_id, open_play_session_id, session_type, includes_day_access } = meta;

  if (!date) throw new Error('Missing date in day_pass metadata');

  const { data: existing } = await serviceClient
    .from('day_passes')
    .select('id, user_id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  const resolvedUserId = existing?.user_id || await resolveUserId(session, user_id, serviceClient);
  const priceSek = Math.round((session.amount_total || 0) / 100);
  const paidSek = Math.round(((session.amount_total || 0) / 100) * 100) / 100;

  let dayPass = existing;
  if (!dayPass) {
    const { data: insertedDayPass, error } = await serviceClient.from('day_passes').insert({
      venue_id,
      user_id:           resolvedUserId,
      valid_date:        date,
      price:             priceSek,
      status:            'active',
      stripe_session_id: session.id,
    }).select('id, user_id').single();

    if (error) throw new Error(`Failed to insert day_pass: ${error.message}`);
    dayPass = insertedDayPass;
  }

  const receipt = await createPurchaseReceipt({
    session,
    meta: { ...meta, venue_id },
    serviceClient,
    userId: resolvedUserId,
    totalSek: paidSek,
    purchaseType: 'day_pass',
    productDescription: meta.session_name ? `Dagsmedlemskap · ${meta.session_name}` : 'Dagsmedlemskap',
  });
  await createLedgerEntryFromReceipt({
    session,
    meta: { ...meta, venue_id },
    serviceClient,
    sourceType: 'day_pass',
    sourceId: session.id,
    receipt,
    amountIncVatMinor: Number(session.amount_total || 0),
    metadata: {
      day_pass_id: dayPass?.id || null,
      activity_session_id: activity_session_id || open_play_session_id || null,
      session_date: date,
      session_type: session_type || 'open_play',
    },
  });

  if (existing) return;

  const activitySessionId = activity_session_id || open_play_session_id || null;
  const kind = session_type || 'open_play';
  const includesDayAccess = includes_day_access !== 'false';

  if (activitySessionId) {
    const commit = await commitActivityRegistrationCapacity(serviceClient, {
      p_venue_id: venue_id,
      p_activity_session_id: activitySessionId,
      p_session_date: date,
      p_user_id: resolvedUserId,
      p_customer_id: receipt?.customer_id || null,
      p_status: 'confirmed',
      p_price_paid_sek: priceSek,
      p_stripe_session_id: session.id,
      p_source_type: 'day_pass',
      p_source_id: dayPass.id,
      p_metadata: {
        session_type: kind,
        session_name: meta.session_name || null,
        pricing_reason: meta.pricing_reason || null,
        scarcity_mode: meta.scarcity_mode || null,
        early_bird_price_minor: meta.early_bird_price_minor || null,
        early_bird_slots: meta.early_bird_slots || null,
        early_bird_remaining_at_checkout: meta.early_bird_remaining_at_checkout || null,
      },
      p_hold_id: meta.capacity_hold_id || null,
    });
    if (!commit.ok) {
      await recordPaidCapacityConflict(serviceClient, {
        venueId: venue_id,
        scopeType: 'activity_session',
        scopeId: activitySessionId,
        sessionDate: date,
        stripeSessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        receiptId: receipt?.id || null,
        ledgerSourceType: 'day_pass',
        ledgerSourceId: session.id,
        customerId: receipt?.customer_id || null,
        userId: resolvedUserId,
        title: `Betald dagsaccess kunde inte levereras: ${meta.session_name || 'Aktivitet'}`,
        metadata: { product_type: 'day_pass', day_pass_id: dayPass?.id || null },
      });
      return;
    }
  }

  if (dayPass?.id) {
    await serviceClient.from('access_entitlements').upsert({
      venue_id,
      user_id: resolvedUserId,
      entitlement_type: includesDayAccess ? 'day_access' : 'session_ticket',
      status: 'active',
      source_type: 'day_pass',
      source_id: dayPass.id,
      activity_session_id: activitySessionId,
      session_date: activitySessionId ? date : null,
      valid_date: includesDayAccess ? date : null,
      includes_session_types: includesDayAccess ? ['open_play'] : [kind],
      metadata: {
        legacy_day_pass_id: dayPass.id,
        session_name: meta.session_name || null,
        session_type: kind,
        stripe_session_id: session.id,
      },
    }, { onConflict: 'source_type,source_id,user_id,entitlement_type' });
  }

  if (activitySessionId && meta.chat_room_id) {
    await announceActivityRegistration(serviceClient, {
      roomId: meta.chat_room_id,
      userId: resolvedUserId,
      activitySessionId,
      sessionDate: date,
      stripeSessionId: session.id,
    });
  }
}

async function handleActivityTicket(
  session: any,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { venue_id, date, user_id, activity_session_id, open_play_session_id, session_type } = meta;
  const activitySessionId = activity_session_id || open_play_session_id || null;

  if (!venue_id) throw new Error('Missing venue_id in activity_ticket metadata');
  if (!date) throw new Error('Missing date in activity_ticket metadata');
  if (!activitySessionId) throw new Error('Missing activity_session_id in activity_ticket metadata');

  const { data: existing } = await serviceClient
    .from('session_registrations')
    .select('id, user_id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  const resolvedUserId = existing?.user_id || await resolveUserId(session, user_id, serviceClient, meta.customer_email);
  const priceSek = Math.round((session.amount_total || 0) / 100);
  const paidSek = Math.round(((session.amount_total || 0) / 100) * 100) / 100;
  const kind = session_type || 'open_play';

  const receipt = await createPurchaseReceipt({
    session,
    meta: { ...meta, venue_id },
    serviceClient,
    userId: resolvedUserId,
    totalSek: paidSek,
    purchaseType: 'activity_session',
    productDescription: meta.session_name || 'Aktivitetsbiljett',
  });

  if (existing) {
    await createLedgerEntryFromReceipt({
      session,
      meta: { ...meta, venue_id },
      serviceClient,
      sourceType: 'activity_registration',
      sourceId: session.id,
      receipt,
      amountIncVatMinor: Number(session.amount_total || 0),
      metadata: {
        session_registration_id: existing.id,
        activity_session_id: activitySessionId,
        session_date: date,
        session_type: kind,
      },
    });
    return;
  }

  const commit = await commitActivityRegistrationCapacity(serviceClient, {
    p_venue_id: venue_id,
    p_activity_session_id: activitySessionId,
    p_session_date: date,
    p_user_id: resolvedUserId,
    p_customer_id: receipt?.customer_id || null,
    p_status: 'confirmed',
    p_price_paid_sek: priceSek,
    p_stripe_session_id: session.id,
    p_source_type: 'session_ticket',
    p_source_id: null,
    p_metadata: {
      session_type: kind,
      session_name: meta.session_name || null,
    },
    p_hold_id: meta.capacity_hold_id || null,
  });

  if (!commit.ok) {
    await createLedgerEntryFromReceipt({
      session,
      meta: { ...meta, venue_id },
      serviceClient,
      sourceType: 'stripe_payment',
      sourceId: session.id,
      receipt,
      amountIncVatMinor: Number(session.amount_total || 0),
      metadata: {
        intended_source_type: 'activity_registration',
        delivery_status: 'capacity_conflict',
        activity_session_id: activitySessionId,
        session_date: date,
        session_type: kind,
      },
    });
    await recordPaidCapacityConflict(serviceClient, {
      venueId: venue_id,
      scopeType: 'activity_session',
      scopeId: activitySessionId,
      sessionDate: date,
      stripeSessionId: session.id,
      paymentIntentId: session.payment_intent || null,
      receiptId: receipt?.id || null,
      ledgerSourceType: 'stripe_payment',
      ledgerSourceId: session.id,
      customerId: receipt?.customer_id || null,
      userId: resolvedUserId,
      title: `Betald aktivitet kunde inte levereras: ${meta.session_name || 'Aktivitet'}`,
      metadata: { product_type: 'activity_ticket', session_type: kind },
    });
    return;
  }

  await createLedgerEntryFromReceipt({
    session,
    meta: { ...meta, venue_id },
    serviceClient,
    sourceType: 'activity_registration',
    sourceId: session.id,
    receipt,
    amountIncVatMinor: Number(session.amount_total || 0),
      metadata: {
        session_registration_id: commit.registration_id || null,
        activity_session_id: activitySessionId,
        session_date: date,
        session_type: kind,
        pricing_reason: meta.pricing_reason || null,
        scarcity_mode: meta.scarcity_mode || null,
      },
  });

  if (commit.registration_id) {
    const { error: entitlementErr } = await serviceClient
      .from('access_entitlements')
      .upsert({
        venue_id,
        user_id: resolvedUserId,
        entitlement_type: 'session_ticket',
        status: 'active',
        source_type: 'session_ticket',
        source_id: commit.registration_id,
        activity_session_id: activitySessionId,
        session_date: date,
        valid_date: null,
        includes_session_types: [kind],
        metadata: {
          session_name: meta.session_name || null,
          session_type: kind,
          stripe_session_id: session.id,
        },
      }, { onConflict: 'source_type,source_id,user_id,entitlement_type' });

    if (entitlementErr) {
      console.error('Failed to create session ticket entitlement:', entitlementErr.message);
    }
  }

  if (meta.chat_room_id) {
    await announceActivityRegistration(serviceClient, {
      roomId: meta.chat_room_id,
      userId: resolvedUserId,
      activitySessionId,
      sessionDate: date,
      stripeSessionId: session.id,
    });
  }
}

async function announceActivityRegistration(
  serviceClient: any,
  params: {
    roomId: string;
    userId: string;
    activitySessionId: string;
    sessionDate: string;
    stripeSessionId: string;
  },
) {
  const { data: profile } = await serviceClient
    .from('player_profiles')
    .select('display_name')
    .eq('auth_user_id', params.userId)
    .maybeSingle();

  const name = profile?.display_name || 'En spelare';
  await serviceClient.from('chat_messages').insert({
    room_id: params.roomId,
    user_id: params.userId,
    message_type: 'bot',
    content: `${name} kommer`,
    metadata: {
      channel: 'activity_registration',
      activity_session_id: params.activitySessionId,
      session_date: params.sessionDate,
      stripe_session_id: params.stripeSessionId,
    },
  });
}

// ── Membership ────────────────────────────────────────────────────────────────

async function handleMembership(
  session: any,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { tier_id, user_id } = meta;

  if (!tier_id) throw new Error('Missing tier_id in membership metadata');
  if (session.payment_status && session.payment_status !== 'paid') {
    console.log('Ignoring unpaid membership checkout session', session.id, session.payment_status);
    return;
  }

  // Resolve venue_id from the tier first. Do not trust empty venue_id metadata.
  const { data: tier, error: tierErr } = await serviceClient
    .from('membership_tiers')
    .select('id, venue_id')
    .eq('id', tier_id)
    .maybeSingle();
  if (tierErr || !tier) throw new Error(`Membership tier not found: ${tier_id}`);

  const resolvedUserId = await resolveUserId(session, user_id, serviceClient, meta.customer_email);
  const firstName = String(meta.first_name || '').trim();
  const lastName = String(meta.last_name || '').trim();
  const phone = String(meta.customer_phone || '').trim();
  const customerName = String(meta.customer_name || [firstName, lastName].filter(Boolean).join(' ')).trim();

  // Store the live Stripe customer on the profile. This also fixes old test customer ids.
  const profilePatch: Record<string, unknown> = {
    auth_user_id: resolvedUserId,
    stripe_customer_id: session.customer || null,
    updated_at: new Date().toISOString(),
  };
  if (customerName) profilePatch.display_name = customerName;
  if (firstName) profilePatch.first_name = firstName;
  if (lastName) profilePatch.last_name = lastName;
  if (phone) profilePatch.phone = phone;

  const { error: profileErr } = await serviceClient
    .from('player_profiles')
    .upsert(profilePatch, { onConflict: 'auth_user_id' });
  if (profileErr) throw new Error(`Failed to update player profile: ${profileErr.message}`);

  const today = DateTime.now().setZone('Europe/Stockholm').toISODate();
  const paidSek = Math.round(((session.amount_total || 0) / 100) * 100) / 100;

  // Reactivate an existing membership row when the user buys again.
  // This is critical because admin/manual cancellation leaves a cancelled row
  // for the same user + venue + tier; a new paid Stripe checkout must flip it
  // back to active instead of silently returning.
  const { data: existing, error: existingErr } = await serviceClient
    .from('memberships')
    .select('id, status')
    .eq('user_id', resolvedUserId)
    .eq('venue_id', tier.venue_id)
    .eq('tier_id', tier_id)
    .is('expires_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) throw new Error(`Failed to check existing membership: ${existingErr.message}`);

  if (existing) {
    const { error: updateErr } = await serviceClient
      .from('memberships')
      .update({
        status: 'active',
        starts_at: today,
        expires_at: null,
        assigned_by: resolvedUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateErr) throw new Error(`Failed to reactivate membership: ${updateErr.message}`);
    const receipt = await createPurchaseReceipt({
      session,
      meta: { ...meta, venue_id: tier.venue_id },
      serviceClient,
      userId: resolvedUserId,
      totalSek: paidSek,
      purchaseType: 'membership',
      productDescription: meta.tier_name ? `Medlemskap · ${meta.tier_name}` : 'Medlemskap',
    });
    await createLedgerEntryFromReceipt({
      session,
      meta: { ...meta, venue_id: tier.venue_id },
      serviceClient,
      sourceType: 'membership',
      sourceId: session.id,
      receipt,
      amountIncVatMinor: Number(session.amount_total || 0),
      metadata: {
        membership_id: existing.id,
        tier_id,
        tier_name: meta.tier_name || null,
        stripe_invoice_id: stripeId(session.invoice),
        reactivated: true,
      },
    });
    return;
  }

  const { data: membership, error } = await serviceClient.from('memberships').insert({
    venue_id:    tier.venue_id,
    user_id:     resolvedUserId,
    tier_id,
    status:      'active',
    starts_at:   today,
    expires_at:  null,
    assigned_by: resolvedUserId,
  }).select('id').single();

  if (error) throw new Error(`Failed to insert membership: ${error.message}`);

  const receipt = await createPurchaseReceipt({
    session,
    meta: { ...meta, venue_id: tier.venue_id },
    serviceClient,
    userId: resolvedUserId,
    totalSek: paidSek,
    purchaseType: 'membership',
    productDescription: meta.tier_name ? `Medlemskap · ${meta.tier_name}` : 'Medlemskap',
  });
  await createLedgerEntryFromReceipt({
    session,
    meta: { ...meta, venue_id: tier.venue_id },
    serviceClient,
    sourceType: 'membership',
    sourceId: session.id,
    receipt,
    amountIncVatMinor: Number(session.amount_total || 0),
    metadata: {
      membership_id: membership?.id || null,
      tier_id,
      tier_name: meta.tier_name || null,
      stripe_invoice_id: stripeId(session.invoice),
      reactivated: false,
    },
  });
}
