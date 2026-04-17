// api-stripe — Stripe customer & payment method management
// Deploy: supabase functions deploy api-stripe --no-verify-jwt --project-ref cqnjpudmsreubgviqptg
// Required secrets: STRIPE_SECRET_KEY

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('Stripe not configured', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

  const { client, userId, error } = await getAuthenticatedClient(req);
  if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

  const admin = getServiceClient();

  // ── Shared: get or create Stripe customer for this user ──────────────────────
  async function getOrCreateStripeCustomer(): Promise<string> {
    const { data: profile } = await admin.from('player_profiles')
      .select('stripe_customer_id, display_name')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (profile?.stripe_customer_id) return profile.stripe_customer_id;

    // Get user email from auth
    const { data: { user: authUser } } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.email;

    const customer = await stripe.customers.create({
      email: email || undefined,
      name: profile?.display_name || undefined,
      metadata: { supabase_user_id: userId },
    });

    // Store customer ID
    await admin.from('player_profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('auth_user_id', userId);

    return customer.id;
  }

  try {
    // ── POST /setup-session — create Stripe Checkout in setup mode ──────────────
    if (req.method === 'POST' && path === 'setup-session') {
      const customerId = await getOrCreateStripeCustomer();
      const origin = req.headers.get('origin') || 'https://playpickla.com';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'setup',
        payment_method_types: ['card'],
        success_url: `${origin}/my?card_saved=1`,
        cancel_url:  `${origin}/my`,
      });

      return jsonResponse({ url: session.url });
    }

    // ── GET /payment-methods — list saved cards ───────────────────────────────
    if (req.method === 'GET' && path === 'payment-methods') {
      const { data: profile } = await admin.from('player_profiles')
        .select('stripe_customer_id')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (!profile?.stripe_customer_id) return jsonResponse({ methods: [] });

      const pms = await stripe.paymentMethods.list({
        customer: profile.stripe_customer_id,
        type: 'card',
      });

      const methods = pms.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '••••',
        exp_month: pm.card?.exp_month,
        exp_year: pm.card?.exp_year,
      }));

      return jsonResponse({ methods }, 200, 30);
    }

    // ── DELETE /payment-method?pmId=X — detach a saved card ──────────────────
    if (req.method === 'DELETE' && path === 'payment-method') {
      const pmId = url.searchParams.get('pmId');
      if (!pmId) return errorResponse('Missing pmId');

      // Verify the card belongs to this user's customer
      const { data: profile } = await admin.from('player_profiles')
        .select('stripe_customer_id')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (!profile?.stripe_customer_id) return errorResponse('No customer found', 404);

      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm.customer !== profile.stripe_customer_id) return errorResponse('Forbidden', 403);

      await stripe.paymentMethods.detach(pmId);
      return jsonResponse({ ok: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
