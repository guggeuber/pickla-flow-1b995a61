// Bounded Commerce R2A recovery worker.
// Deploy with --no-verify-jwt and invoke only with x-cron-secret.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { resolveOrCreateCustomerIdForUser, resolveOrCreateGuestCustomerByEmail } from '../_shared/customers.ts';
import { requireStripeRuntimeEnvironment } from '../_shared/stripe_environment.ts';

const STRIPE_API_BASE = (Deno.env.get('STRIPE_API_BASE') || 'https://api.stripe.com/v1').replace(/\/$/, '');
const MAX_ATTEMPTS_PER_RUN = 25;
const PROVIDER_IDEMPOTENCY_SAFE_RETRY_MS = 23 * 60 * 60 * 1000;

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

async function stripeRequest(stripeKey: string, path: string, init: RequestInit = {}) {
  requireStripeRuntimeEnvironment(stripeKey);
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${stripeKey}`, ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe API error ${response.status}`);
  return payload;
}

async function createOrRecoverSession(stripeKey: string, attempt: any) {
  const body = new URLSearchParams();
  Object.entries(attempt.provider_request || {}).forEach(([key, value]) => appendStripeFormValue(body, key, value));
  return stripeRequest(stripeKey, '/checkout/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': attempt.provider_idempotency_key,
    },
    body,
  });
}

async function retrieveSession(stripeKey: string, sessionId: string) {
  return stripeRequest(stripeKey, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function createOrRecoverRefund(stripeKey: string, refund: any) {
  const body = new URLSearchParams();
  Object.entries(refund.provider_request || {}).forEach(([key, value]) => appendStripeFormValue(body, key, value));
  return stripeRequest(stripeKey, '/refunds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': refund.provider_idempotency_key,
    },
    body,
  });
}

async function retrieveRefund(stripeKey: string, refundId: string) {
  return stripeRequest(stripeKey, `/refunds/${encodeURIComponent(refundId)}`);
}

function assertRecoveredSessionContract(attempt: any, session: any) {
  const expectedLiveMode = attempt.provider_environment === 'live';
  if (Boolean(session?.livemode) !== expectedLiveMode) throw new Error('Recovered Stripe Session environment mismatch');
  if (String(session?.metadata?.commerce_checkout_attempt_id || '') !== String(attempt.id)
    || String(session?.metadata?.commerce_order_id || '') !== String(attempt.commerce_order_id)
    || String(session?.client_reference_id || '') !== String(attempt.commerce_order_id)) {
    throw new Error('Recovered Stripe Session identity does not match durable attempt');
  }
  if (Number(session?.amount_total || 0) !== Number(attempt.total_inc_vat_minor || 0)
    || String(session?.currency || '').toUpperCase() !== String(attempt.currency || '').toUpperCase()) {
    throw new Error('Recovered Stripe Session amount or currency does not match durable attempt');
  }
}

async function finalizePaidAttempt(admin: ReturnType<typeof getServiceClient>, attempt: any, session: any) {
  const { data: order, error: orderError } = await admin.from('commerce_orders')
    .select('*').eq('id', attempt.commerce_order_id).maybeSingle();
  if (orderError || !order) throw new Error(orderError?.message || 'Commerce order not found');
  if (Number(session.amount_total || 0) !== Number(order.total_inc_vat_minor || 0)
    || String(session.currency || '').toUpperCase() !== String(order.currency || '').toUpperCase()) {
    throw new Error('Recovered Stripe Session does not match canonical order total');
  }
  const email = String(session.customer_details?.email || order.guest_email || '').trim().toLowerCase();
  const name = session.customer_details?.name || order.guest_name || null;
  const phone = session.customer_details?.phone || order.guest_phone || null;
  const customerId = order.user_id
    ? await resolveOrCreateCustomerIdForUser(admin, order.user_id, order.venue_id, 'commerce_r2a_recovery')
    : email
      ? await resolveOrCreateGuestCustomerByEmail(admin, {
        venueId: order.venue_id,
        email,
        displayName: name,
        phone,
        source: 'commerce_r2a_recovery',
      })
      : null;
  if (!customerId) throw new Error('Recovered paid checkout has no resolvable customer');
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : String(session.payment_intent?.id || '');
  if (!paymentIntentId) throw new Error('Recovered paid checkout has no PaymentIntent');
  const { error } = await admin.rpc('finalize_commerce_payment', {
    p_order_id: order.id,
    p_order_version: Number(attempt.frozen_order_version),
    p_stripe_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_customer_id: customerId,
    p_user_id: order.user_id || null,
    p_customer_name: name,
    p_customer_email: email,
    p_customer_phone: phone,
    p_payment_method: 'Kort via Stripe',
  });
  if (error) throw new Error(error.message);
}

async function processAttempt(admin: ReturnType<typeof getServiceClient>, stripeKey: string, attempt: any) {
  if (attempt.provider_account_key !== 'platform') throw new Error('Unsupported recovery provider account');
  const environment = requireStripeRuntimeEnvironment(stripeKey).stripeMode;
  if (attempt.provider_environment !== environment) throw new Error('Recovery Stripe environment mismatch');

  let session = attempt.provider_session_id
    ? await retrieveSession(stripeKey, attempt.provider_session_id)
    : null;
  if (!session) {
    const ageMs = Date.now() - new Date(attempt.created_at).getTime();
    if (ageMs >= PROVIDER_IDEMPOTENCY_SAFE_RETRY_MS) {
      throw new Error('Ambiguous provider creation is older than safe idempotency retry window; manual Stripe reconciliation required');
    }
    session = await createOrRecoverSession(stripeKey, attempt);
    assertRecoveredSessionContract(attempt, session);
    const { error: attachError } = await admin.rpc('commerce_r2a_attach_checkout_session', {
      p_attempt_id: attempt.id,
      p_provider_session_id: session.id,
      p_provider_response: { id: session.id, url: session.url, status: session.status, expires_at: session.expires_at },
    });
    if (attachError) throw new Error(attachError.message);
  }
  assertRecoveredSessionContract(attempt, session);

  if (session.payment_status === 'paid') {
    await finalizePaidAttempt(admin, attempt, session);
    return { outcome: 'payment_committed', session_id: session.id };
  }
  if (session.status === 'expired') {
    const { error } = await admin.rpc('commerce_r2a_close_unpaid_attempt', {
      p_attempt_id: attempt.id,
      p_provider_session_id: session.id,
      p_provider_status: 'expired',
      p_reason: 'commerce_recovery_confirmed_expired',
    });
    if (error) throw new Error(error.message);
    return { outcome: 'closed_unpaid', session_id: session.id };
  }
  return { outcome: session.status === 'complete' ? 'payment_processing' : 'open', session_id: session.id };
}

async function processRefund(admin: ReturnType<typeof getServiceClient>, stripeKey: string, refund: any) {
  if (refund.provider_account_key !== 'platform') throw new Error('Unsupported refund recovery provider account');
  const environment = requireStripeRuntimeEnvironment(stripeKey).stripeMode;
  if (refund.provider_environment !== environment) throw new Error('Refund recovery Stripe environment mismatch');
  let providerRefund = refund.provider_refund_id
    ? await retrieveRefund(stripeKey, refund.provider_refund_id)
    : null;
  if (!providerRefund) {
    const ageMs = Date.now() - new Date(refund.created_at).getTime();
    if (ageMs >= PROVIDER_IDEMPOTENCY_SAFE_RETRY_MS) {
      throw new Error('Ambiguous refund creation is older than safe idempotency retry window; manual Stripe reconciliation required');
    }
    providerRefund = await createOrRecoverRefund(stripeKey, refund);
  }
  if (Boolean(providerRefund?.livemode) !== (refund.provider_environment === 'live')
    || String(providerRefund?.metadata?.commerce_refund_id || '') !== String(refund.id)
    || (refund.commerce_order_id
      && String(providerRefund?.metadata?.commerce_order_id || '') !== String(refund.commerce_order_id))
    || (refund.cancellation_decision_id
      && String(providerRefund?.metadata?.cancellation_decision_id || '') !== String(refund.cancellation_decision_id))
    || String(providerRefund?.payment_intent || '') !== String(refund.provider_request?.payment_intent || '')
    || Number(providerRefund?.amount || 0) !== Number(refund.amount_inc_vat_minor || 0)) {
    throw new Error('Recovered Stripe refund does not match durable refund command');
  }
  const providerStatus = providerRefund.status === 'succeeded'
    ? 'succeeded'
    : ['failed', 'canceled'].includes(String(providerRefund.status)) ? 'failed' : 'pending';
  const { error } = await admin.rpc('commerce_r2a_reconcile_refund', {
    p_refund_id: refund.id,
    p_provider_refund_id: providerRefund.id,
    p_provider_status: providerStatus,
    p_provider_response: providerRefund,
    p_error: providerStatus === 'failed'
      ? `Stripe refund ${providerRefund.status}${providerRefund.failure_reason ? `: ${providerRefund.failure_reason}` : ''}`
      : null,
  });
  if (error) throw new Error(error.message);
  return { outcome: providerStatus, provider_refund_id: providerRefund.id };
}

export const commerceRecoveryHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return errorResponse('Unauthorized', 401);
  let stripeKey = '';
  try {
    stripeKey = requireStripeRuntimeEnvironment().stripeKey;
  } catch (error) {
    console.error('Stripe environment guard rejected recovery request:', error instanceof Error ? error.message : 'unknown error');
    return errorResponse('Stripe environment configuration rejected', 503);
  }

  const admin = getServiceClient();
  const { data: reconciliationIncidents, error: reconciliationError } = await admin.rpc('commerce_r2a_scan_inventory_reconciliation');
  if (reconciliationError) return errorResponse(reconciliationError.message, 500);
  const leaseToken = crypto.randomUUID();
  const { data: attempts, error: claimError } = await admin.rpc('commerce_r2a_claim_recovery_attempts', {
    p_limit: MAX_ATTEMPTS_PER_RUN,
    p_lease_seconds: 120,
    p_lease_token: leaseToken,
  });
  if (claimError) return errorResponse(claimError.message, 500);
  const refundLeaseToken = crypto.randomUUID();
  const { data: refunds, error: refundClaimError } = await admin.rpc('commerce_r2a_claim_recovery_refunds', {
    p_limit: MAX_ATTEMPTS_PER_RUN,
    p_lease_seconds: 120,
    p_lease_token: refundLeaseToken,
  });
  if (refundClaimError) return errorResponse(refundClaimError.message, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const attempt of attempts || []) {
    try {
      const result = await processAttempt(admin, stripeKey, attempt);
      await admin.rpc('commerce_r2a_finish_recovery_lease', {
        p_attempt_id: attempt.id,
        p_lease_token: leaseToken,
        p_error: null,
        p_retry_after_seconds: result.outcome === 'open' || result.outcome === 'payment_processing' ? 300 : 86400,
      });
      results.push({ attempt_id: attempt.id, ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery failed';
      const retryAfter = Math.min(3600, 60 * (2 ** Math.min(Number(attempt.recovery_attempts || 1), 6)));
      await admin.rpc('commerce_r2a_finish_recovery_lease', {
        p_attempt_id: attempt.id,
        p_lease_token: leaseToken,
        p_error: message,
        p_retry_after_seconds: retryAfter,
      });
      if (Number(attempt.recovery_attempts || 0) === 5 || Number(attempt.recovery_attempts || 0) === 10) {
        const { data: order } = await admin.from('commerce_orders').select('venue_id').eq('id', attempt.commerce_order_id).maybeSingle();
        if (order?.venue_id) {
          await admin.from('ops_incidents').insert({
            venue_id: order.venue_id,
            severity: Number(attempt.recovery_attempts || 0) >= 10 ? 'P1' : 'P2',
            title: 'Commerce checkout recovery requires attention',
            status: 'open',
            affected_route: '/admin',
            affected_ids: attempt.id,
            impact: message.slice(0, 500),
            containment: 'Reservation remains held. Reconcile the Stripe Session before any release.',
            metadata: { commerce_order_id: attempt.commerce_order_id, checkout_attempt_id: attempt.id, recovery_attempts: attempt.recovery_attempts },
          });
        }
      }
      results.push({ attempt_id: attempt.id, ok: false, error: message });
    }
  }
  const refundResults: Array<Record<string, unknown>> = [];
  for (const refund of refunds || []) {
    try {
      const result = await processRefund(admin, stripeKey, refund);
      await admin.rpc('commerce_r2a_finish_refund_recovery_lease', {
        p_refund_id: refund.id,
        p_lease_token: refundLeaseToken,
        p_error: null,
        // A Stripe refund can initially be observed as succeeded and later fail.
        // The SQL claim function bounds this monitoring window; while it is open,
        // keep polling at the same conservative cadence as a pending refund.
        p_retry_after_seconds: result.outcome === 'pending' || result.outcome === 'succeeded' ? 300 : 86400,
      });
      refundResults.push({ refund_id: refund.id, ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refund recovery failed';
      await admin.rpc('commerce_r2a_finish_refund_recovery_lease', {
        p_refund_id: refund.id,
        p_lease_token: refundLeaseToken,
        p_error: message,
        p_retry_after_seconds: Math.min(3600, 60 * (2 ** Math.min(Number(refund.recovery_attempts || 1), 6))),
      });
      refundResults.push({ refund_id: refund.id, ok: false, error: message });
    }
  }
  return jsonResponse({
    reconciliation_incidents_created: Number(reconciliationIncidents || 0),
    checkout_claimed: (attempts || []).length,
    refund_claimed: (refunds || []).length,
    checkout_results: results,
    refund_results: refundResults,
  }, 200, 0);
};

Deno.serve(commerceRecoveryHandler);
