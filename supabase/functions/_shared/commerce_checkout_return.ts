export type StripeCheckoutReturnFacts = {
  id?: string | null;
  status?: string | null;
  payment_status?: string | null;
};

export type StripeCheckoutCancellationDecision =
  | 'expire_and_reopen'
  | 'reopen'
  | 'verify_payment'
  | 'blocked';

export function isStripeCheckoutSessionReference(value: unknown) {
  const reference = String(value || '').trim();
  return reference.length >= 8 && reference.length <= 255 && reference.startsWith('cs_');
}

export function checkoutReturnEligible(orderSessionId: unknown, returnedSessionId: unknown) {
  const orderReference = String(orderSessionId || '').trim();
  const returnedReference = String(returnedSessionId || '').trim();
  return isStripeCheckoutSessionReference(returnedReference)
    && orderReference === returnedReference;
}

export function stripeCheckoutCancellationDecision(
  session: StripeCheckoutReturnFacts,
): StripeCheckoutCancellationDecision {
  const status = String(session.status || '').toLowerCase();
  const paymentStatus = String(session.payment_status || '').toLowerCase();
  if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required' || status === 'complete') {
    return 'verify_payment';
  }
  if (status === 'open' && paymentStatus !== 'paid') return 'expire_and_reopen';
  if (status === 'expired' && paymentStatus !== 'paid') return 'reopen';
  return 'blocked';
}
