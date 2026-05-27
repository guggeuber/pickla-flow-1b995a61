// Deploy with: supabase functions deploy api-stripe-webhook --no-verify-jwt
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Configure the webhook endpoint in the Stripe dashboard:
//   https://<project>.supabase.co/functions/v1/api-stripe-webhook
// Events to listen for: checkout.session.completed

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { findAuthUserByEmail, generateAccessCode, getOrCreatePublicBookingUserId } from '../_shared/bookings.ts';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';


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

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge but ignore other event types
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object;
  const meta = session.metadata || {};
  const { product_type } = meta;

  if (!product_type) {
    console.error('Missing product_type in session', session.id);
    return errorResponse('Missing session metadata', 400);
  }

  const serviceClient = getServiceClient();

  try {
    if (product_type === 'court_booking') {
      await handleCourtBooking(session, meta, serviceClient);
    } else if (product_type === 'day_pass') {
      await handleDayPass(session, meta, serviceClient);
    } else if (product_type === 'membership') {
      await handleMembership(session, meta, serviceClient);
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
    return errorResponse((err as Error).message, 500);
  }

  return new Response('ok', { status: 200 });
});

// ── Court booking ─────────────────────────────────────────────────────────────

function vatPartsFromIncludedTotal(totalIncVat: number, vatRate = 6) {
  const vatAmount = Math.round(totalIncVat * vatRate / (100 + vatRate));
  return {
    totalIncVat,
    vatRate,
    vatAmount,
    totalExVat: Math.max(totalIncVat - vatAmount, 0),
  };
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
  if (!bookingRefs.length || totalSek <= 0) return;

  const { data: existing } = await serviceClient
    .from('booking_receipts')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();
  if (existing) return;

  const vat = vatPartsFromIncludedTotal(totalSek, 6);
  const { error } = await serviceClient.from('booking_receipts').insert({
    booking_refs: bookingRefs,
    stripe_session_id: session.id,
    venue_id: meta.venue_id,
    user_id: bookingUserId,
    customer_name: meta.name || session.customer_details?.name || null,
    customer_email: session.customer_details?.email || null,
    customer_phone: meta.phone || session.customer_details?.phone || null,
    total_inc_vat: vat.totalIncVat,
    total_ex_vat: vat.totalExVat,
    vat_amount: vat.vatAmount,
    vat_rate: vat.vatRate,
    currency: (session.currency || 'sek').toUpperCase(),
    payment_provider: 'stripe',
    payment_status: session.payment_status || 'paid',
    metadata: {
      product_type: meta.product_type || 'court_booking',
      court_ids: meta.court_ids || '[]',
      date: meta.date || null,
      start_time: meta.start_time || null,
      end_time: meta.end_time || null,
    },
  });

  if (error) {
    // Never fail a paid booking because the v1 receipt snapshot is not migrated yet.
    console.error('Failed to create booking receipt:', error.message);
  }
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
    .select('booking_ref')
    .eq('stripe_session_id', session.id)
    .neq('status', 'cancelled');

  if (refsErr) {
    console.error('Failed to fetch booking refs for receipt:', refsErr.message);
    return;
  }

  await createCourtBookingReceipt({
    session,
    meta,
    serviceClient,
    bookingUserId,
    bookingRefs: (sessionBookings || []).map((b: any) => b.booking_ref).filter(Boolean),
    totalSek,
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

  // Idempotency: skip if already created
  const { data: existing } = await serviceClient
    .from('day_passes')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();
  if (existing) return;

  const resolvedUserId = await resolveUserId(session, user_id, serviceClient);
  const priceSek = Math.round((session.amount_total || 0) / 100);

  const { data: dayPass, error } = await serviceClient.from('day_passes').insert({
    venue_id,
    user_id:           resolvedUserId,
    valid_date:        date,
    price:             priceSek,
    status:            'active',
    stripe_session_id: session.id,
  }).select('id').single();

  if (error) throw new Error(`Failed to insert day_pass: ${error.message}`);

  const activitySessionId = activity_session_id || open_play_session_id || null;
  const kind = session_type || 'open_play';
  const includesDayAccess = includes_day_access === 'true' || kind === 'open_play';

  if (activitySessionId) {
    await serviceClient.from('session_registrations').upsert({
      venue_id,
      activity_session_id: activitySessionId,
      session_date: date,
      user_id: resolvedUserId,
      status: 'confirmed',
      price_paid_sek: priceSek,
      stripe_session_id: session.id,
      source_type: 'day_pass',
      source_id: dayPass.id,
      metadata: {
        session_type: kind,
        session_name: meta.session_name || null,
      },
    }, { onConflict: 'activity_session_id,session_date,user_id' });
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
    return;
  }

  const { error } = await serviceClient.from('memberships').insert({
    venue_id:    tier.venue_id,
    user_id:     resolvedUserId,
    tier_id,
    status:      'active',
    starts_at:   today,
    expires_at:  null,
    assigned_by: resolvedUserId,
  });

  if (error) throw new Error(`Failed to insert membership: ${error.message}`);
}
