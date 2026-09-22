import { requireStripeRuntimeEnvironment } from './stripe_environment.ts';

const STRIPE_API_BASE = (Deno.env.get('STRIPE_API_BASE') || 'https://api.stripe.com/v1').replace(/\/$/, '');

export type TrackedRefundCommand = {
  id: string;
  amount_inc_vat_minor: number;
  cancellation_decision_id?: string | null;
  provider_environment: string;
  provider_account_key: string;
  provider_idempotency_key: string;
  provider_request: Record<string, unknown>;
};

export type StripeRefundPayload = {
  id: string;
  status?: string | null;
  failure_reason?: string | null;
  livemode?: boolean;
  payment_intent?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

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

export async function createOrRecoverTrackedRefund(
  stripeKey: string,
  refund: TrackedRefundCommand,
): Promise<StripeRefundPayload> {
  const runtime = requireStripeRuntimeEnvironment(stripeKey);
  if (refund.provider_account_key !== 'platform') throw new Error('Unsupported refund provider account');
  if (refund.provider_environment !== runtime.stripeMode) throw new Error('Refund Stripe environment mismatch');
  const body = new URLSearchParams();
  Object.entries(refund.provider_request || {}).forEach(([key, value]) => appendStripeFormValue(body, key, value));
  const response = await fetch(`${STRIPE_API_BASE}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': refund.provider_idempotency_key,
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const stripeError = payload.error && typeof payload.error === 'object'
    ? String((payload.error as Record<string, unknown>).message || '')
    : '';
  if (!response.ok) throw new Error(stripeError || `Stripe refund error ${response.status}`);
  return payload as StripeRefundPayload;
}

export function trackedRefundProviderStatus(refund: StripeRefundPayload): 'pending' | 'succeeded' | 'failed' {
  if (refund?.status === 'succeeded') return 'succeeded';
  if (['failed', 'canceled'].includes(String(refund?.status || ''))) return 'failed';
  return 'pending';
}

export function assertTrackedRefundContract(
  command: TrackedRefundCommand,
  providerRefund: StripeRefundPayload,
) {
  if (Boolean(providerRefund?.livemode) !== (command.provider_environment === 'live')) {
    throw new Error('Stripe refund environment mismatch');
  }
  if (String(providerRefund?.payment_intent || '') !== String(command.provider_request?.payment_intent || '')
    || Number(providerRefund?.amount || 0) !== Number(command.amount_inc_vat_minor || 0)
    || String(providerRefund?.metadata?.commerce_refund_id || '') !== String(command.id)) {
    throw new Error('Stripe refund does not match durable refund command');
  }
  const expectedDecision = String(command.cancellation_decision_id || '');
  if (expectedDecision && String(providerRefund?.metadata?.cancellation_decision_id || '') !== expectedDecision) {
    throw new Error('Stripe refund cancellation decision mismatch');
  }
}
