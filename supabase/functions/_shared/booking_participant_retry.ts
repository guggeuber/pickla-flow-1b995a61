import {
  expireStripeCheckoutSession,
  finalizeExpiredCommerceCheckout,
  retrieveStripeCheckoutSession,
  stripeCheckoutLifecycleState,
  StripeCheckoutLifecycleError,
  type StripeCheckoutStatus,
} from './commerce_checkout_expiry.ts';

type FetchLike = typeof fetch;

export type BookingParticipantRetryResult =
  | { action: 'acquire'; releasedHoldId?: string }
  | { action: 'reuse_checkout'; holdId: string; checkoutUrl: string; stripeSessionId: string }
  | { action: 'paid_reconciled'; holdId: string; stripeSessionId: string };

export class BookingParticipantRetryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BookingParticipantRetryError';
    this.code = code;
  }
}

function metadataString(session: StripeCheckoutStatus, key: string) {
  return String(session.metadata?.[key] || '').trim();
}

function assertParticipantCheckoutIdentity(
  session: StripeCheckoutStatus,
  hold: any,
  participant: any,
) {
  if (!session.id || session.id !== hold.stripe_session_id) {
    throw new BookingParticipantRetryError('stripe_checkout_identity_mismatch', 'Stripe Checkout identity mismatch');
  }
  const metadataHoldId = metadataString(session, 'capacity_hold_id');
  const metadataParticipantId = metadataString(session, 'booking_participant_id');
  const productType = metadataString(session, 'product_type');
  if (
    (metadataHoldId && metadataHoldId !== hold.id) ||
    (metadataParticipantId && metadataParticipantId !== participant.id) ||
    (productType && productType !== 'booking_participant')
  ) {
    throw new BookingParticipantRetryError('stripe_checkout_identity_mismatch', 'Stripe Checkout metadata mismatch');
  }
}

function checkoutMatchesCurrentAttempt(session: StripeCheckoutStatus, expectedAmountMinor: number) {
  return session.mode === 'payment' &&
    String(session.currency || '').toLowerCase() === 'sek' &&
    Number(session.amount_total || 0) === expectedAmountMinor;
}

async function releaseExpiredParticipantHold(admin: any, session: StripeCheckoutStatus, hold: any) {
  const result = await finalizeExpiredCommerceCheckout({
    ...session,
    metadata: {
      ...(session.metadata || {}),
      capacity_hold_id: hold.id,
    },
  }, admin, 'booking_participant_retry');
  if (!result.released) {
    throw new BookingParticipantRetryError('capacity_hold_release_failed', 'Expired capacity hold was not released');
  }
}

/**
 * Reconciles the single active payment attempt for a canonical participant.
 * The deterministic participant/booking identity remains stable; a released
 * hold id is the boundary between the old and next payment attempt.
 */
export async function reconcileBookingParticipantRetry(
  admin: any,
  participant: any,
  options: {
    stripeKey?: string | null;
    stripeApiBase?: string | null;
    expectedAmountMinor: number;
    finalizePaid: (session: StripeCheckoutStatus, admin: any) => Promise<unknown>;
    now?: Date;
    fetchImpl?: FetchLike;
  },
): Promise<BookingParticipantRetryResult> {
  const finalizePaid = async (session: StripeCheckoutStatus) => {
    let result: any;
    try {
      result = await options.finalizePaid(session, admin);
    } catch (error) {
      if (error instanceof BookingParticipantRetryError) throw error;
      throw new BookingParticipantRetryError(
        'paid_reconciliation_failed',
        (error as Error).message || 'Paid booking participant reconciliation failed',
      );
    }
    if (result?.ok === false) {
      throw new BookingParticipantRetryError(
        'paid_capacity_conflict',
        'Payment succeeded but participant capacity could not be committed',
      );
    }
  };
  const { data: hold, error: holdError } = await admin
    .from('capacity_holds')
    .select('id, status, expires_at, stripe_session_id, source_id, idempotency_key, metadata')
    .eq('venue_id', participant.venue_id)
    .eq('scope_type', 'booking_group')
    .eq('scope_id', participant.booking_group_key)
    .eq('source_type', 'booking_participant')
    .eq('source_id', participant.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (holdError) {
    throw new BookingParticipantRetryError('capacity_hold_lookup_failed', holdError.message);
  }
  if (!hold?.stripe_session_id) return { action: 'acquire' };
  if (!options.stripeKey) {
    throw new BookingParticipantRetryError('stripe_not_configured', 'Stripe status cannot be verified');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const stripeApiBase = options.stripeApiBase || 'https://api.stripe.com/v1';
  let session: StripeCheckoutStatus;
  try {
    session = await retrieveStripeCheckoutSession(
      options.stripeKey,
      stripeApiBase,
      String(hold.stripe_session_id),
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof StripeCheckoutLifecycleError) {
      throw new BookingParticipantRetryError(error.code, error.message);
    }
    throw error;
  }
  assertParticipantCheckoutIdentity(session, hold, participant);

  let state = stripeCheckoutLifecycleState(session);
  if (state === 'paid') {
    await finalizePaid(session);
    return { action: 'paid_reconciled', holdId: hold.id, stripeSessionId: String(session.id) };
  }

  if (state === 'open') {
    const now = options.now || new Date();
    const holdIsLive = new Date(String(hold.expires_at || '')).getTime() > now.getTime();
    if (
      holdIsLive &&
      session.url &&
      checkoutMatchesCurrentAttempt(session, Math.max(0, Math.round(options.expectedAmountMinor)))
    ) {
      return {
        action: 'reuse_checkout',
        holdId: hold.id,
        checkoutUrl: session.url,
        stripeSessionId: String(session.id),
      };
    }

    try {
      session = await expireStripeCheckoutSession(
        options.stripeKey,
        stripeApiBase,
        String(hold.stripe_session_id),
        fetchImpl,
      );
    } catch (error) {
      if (error instanceof StripeCheckoutLifecycleError) {
        throw new BookingParticipantRetryError(error.code, error.message);
      }
      throw error;
    }
    assertParticipantCheckoutIdentity(session, hold, participant);
    state = stripeCheckoutLifecycleState(session);
    if (state === 'paid') {
      await finalizePaid(session);
      return { action: 'paid_reconciled', holdId: hold.id, stripeSessionId: String(session.id) };
    }
  }

  if (state === 'expired_unpaid') {
    await releaseExpiredParticipantHold(admin, session, hold);
    return { action: 'acquire', releasedHoldId: hold.id };
  }

  throw new BookingParticipantRetryError(
    'stripe_checkout_state_unknown',
    `Stripe Checkout state is not safely retryable (${session.status || 'unknown'}/${session.payment_status || 'unknown'})`,
  );
}
