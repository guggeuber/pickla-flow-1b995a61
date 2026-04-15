// Deploy with: supabase functions deploy api-stripe-webhook --no-verify-jwt
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Configure the webhook endpoint in the Stripe dashboard:
//   https://<project>.supabase.co/functions/v1/api-stripe-webhook
// Events to listen for: checkout.session.completed

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { generateAccessCode, getOrCreatePublicBookingUserId } from '../_shared/bookings.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';

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
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return errorResponse(`Webhook signature error: ${(err as Error).message}`, 400);
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge but ignore other event types
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
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

async function handleCourtBooking(
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { venue_id, court_ids, date, start_time, end_time, name, phone, user_id } = meta;

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

  // Resolve user — use authenticated user or fall back to shared guest user
  const bookingUserId = user_id || await getOrCreatePublicBookingUserId(serviceClient);

  // Distribute total evenly across courts (Stripe amount is in ören)
  const totalSek = Math.round((session.amount_total || 0) / 100);
  const pricePerCourt = Math.round(totalSek / courtIds.length);
  const notes = [name, phone].filter(Boolean).join(' | ');

  for (const courtId of courtIds) {
    // Idempotency: skip if already created for this session + court
    const { data: existing } = await serviceClient
      .from('bookings')
      .select('id')
      .eq('stripe_session_id', session.id)
      .eq('venue_court_id', courtId)
      .maybeSingle();
    if (existing) continue;

    const accessCode = await generateAccessCode(serviceClient, venue_id, date);

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
      access_code:            accessCode,
      access_code_expires_at: endISO,
      stripe_session_id:      session.id,
    });

    if (error) throw new Error(`Failed to insert booking for court ${courtId}: ${error.message}`);
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
  session: Stripe.Checkout.Session,
  metaUserId: string,
  serviceClient: any,
): Promise<string> {
  // 1. Explicit user_id from metadata — most reliable path
  if (metaUserId) return metaUserId;

  // 2 & 3. Use Stripe's verified customer email
  const email = session.customer_details?.email;
  if (email) {
    // Try to find existing user
    const { data: existing } = await serviceClient.auth.admin.getUserByEmail(email);
    if (existing?.user?.id) return existing.user.id;

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
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { venue_id, date, user_id } = meta;

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

  const { error } = await serviceClient.from('day_passes').insert({
    venue_id,
    user_id:           resolvedUserId,
    valid_date:        date,
    price:             priceSek,
    status:            'active',
    stripe_session_id: session.id,
  });

  if (error) throw new Error(`Failed to insert day_pass: ${error.message}`);
}

// ── Membership ────────────────────────────────────────────────────────────────

async function handleMembership(
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
  serviceClient: any,
): Promise<void> {
  const { tier_id, user_id } = meta;

  if (!tier_id) throw new Error('Missing tier_id in membership metadata');

  // Idempotency: skip if already created for this session
  const { data: existing } = await serviceClient
    .from('memberships')
    .select('id')
    .eq('notes', `stripe_session:${session.id}`)
    .maybeSingle();
  if (existing) return;

  // Resolve venue_id from the tier
  const { data: tier, error: tierErr } = await serviceClient
    .from('membership_tiers')
    .select('id, venue_id')
    .eq('id', tier_id)
    .maybeSingle();
  if (tierErr || !tier) throw new Error(`Membership tier not found: ${tier_id}`);

  const resolvedUserId = await resolveUserId(session, user_id, serviceClient);
  const today = DateTime.now().setZone('Europe/Stockholm').toISODate();

  const { error } = await serviceClient.from('memberships').insert({
    venue_id:    tier.venue_id,
    user_id:     resolvedUserId,
    tier_id,
    status:      'active',
    starts_at:   today,
    notes:       `stripe_session:${session.id}`,
  });

  if (error) throw new Error(`Failed to insert membership: ${error.message}`);
}
