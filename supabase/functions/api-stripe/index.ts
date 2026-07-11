// api-stripe — Stripe customer & payment method management
// Deploy: supabase functions deploy api-stripe --no-verify-jwt --project-ref ptnvhbniiiapzbyofctg
// Required secrets: STRIPE_SECRET_KEY

import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';
import { canonicalPublicOrigin } from '../_shared/canonical_origin.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

type StripeCustomer = {
  id: string;
  deleted?: boolean;
};

type StripeCheckoutSession = {
  id: string;
  url: string | null;
};

type StripePaymentMethod = {
  id: string;
  customer?: string | null;
  card?: {
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
  };
};

function appendFormValue(body: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormValue(body, `${key}[]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendFormValue(body, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  body.append(key, String(value));
}

function stripeForm(data: Record<string, unknown>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) appendFormValue(body, key, value);
  return body;
}

async function stripeRequest<T>(
  stripeKey: string,
  path: string,
  options: { method?: 'GET' | 'POST'; data?: Record<string, unknown>; allowNotFound?: boolean } = {},
): Promise<T | null> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeKey}`,
  };
  const init: RequestInit = { method, headers };

  if (options.data) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = stripeForm(options.data);
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, init);
  if (response.status === 404 && options.allowNotFound) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe API error ${response.status}`;
    const error = new Error(message) as Error & { status?: number; type?: string };
    error.status = response.status;
    error.type = payload?.error?.type;
    throw error;
  }

  return payload as T;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('Stripe not configured', 500);

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

    const customer = await stripeRequest<StripeCustomer>(stripeKey, '/customers', {
      method: 'POST',
      data: {
        email: email || undefined,
        name: profile?.display_name || undefined,
        metadata: { supabase_user_id: userId },
      },
    });
    if (!customer?.id) throw new Error('Could not create Stripe customer');

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
      const origin = canonicalPublicOrigin(req);

      const session = await stripeRequest<StripeCheckoutSession>(stripeKey, '/checkout/sessions', {
        method: 'POST',
        data: {
          customer: customerId,
          mode: 'setup',
          payment_method_types: ['card'],
          success_url: `${origin}/my?card_saved=1`,
          cancel_url: `${origin}/my`,
        },
      });
      if (!session?.url) return errorResponse('Could not create setup session', 500);

      return jsonResponse({ url: session.url });
    }

    // ── GET /payment-methods — list saved cards ───────────────────────────────
    if (req.method === 'GET' && path === 'payment-methods') {
      const { data: profile } = await admin.from('player_profiles')
        .select('stripe_customer_id')
        .eq('auth_user_id', userId)
        .maybeSingle();

      if (!profile?.stripe_customer_id) return jsonResponse({ methods: [], paymentMethods: [] });

      const params = new URLSearchParams({ customer: profile.stripe_customer_id, type: 'card' });
      let pms: { data?: StripePaymentMethod[] } | null = null;
      try {
        pms = await stripeRequest<{ data?: StripePaymentMethod[] }>(stripeKey, `/payment_methods?${params.toString()}`, {
          allowNotFound: true,
        });
      } catch (stripeError) {
        const message = (stripeError as Error).message || '';
        if (/No such customer/i.test(message)) {
          return jsonResponse({ methods: [], paymentMethods: [] }, 200, 30);
        }
        throw stripeError;
      }

      const methods = (pms?.data || []).map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '••••',
        exp_month: pm.card?.exp_month,
        exp_year: pm.card?.exp_year,
      }));

      return jsonResponse({ methods, paymentMethods: methods }, 200, 30);
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

      const pm = await stripeRequest<StripePaymentMethod>(stripeKey, `/payment_methods/${encodeURIComponent(pmId)}`, {
        allowNotFound: true,
      });
      if (!pm) return errorResponse('Payment method not found', 404);
      if (pm.customer !== profile.stripe_customer_id) return errorResponse('Forbidden', 403);

      await stripeRequest<StripePaymentMethod>(stripeKey, `/payment_methods/${encodeURIComponent(pmId)}/detach`, {
        method: 'POST',
      });
      return jsonResponse({ ok: true });
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
