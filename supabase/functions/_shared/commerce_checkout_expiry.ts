type ServiceClient = any;

type StripeCheckoutStatus = {
  id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function stripeCheckoutCanBeReleased(session: StripeCheckoutStatus) {
  return session.status === 'expired' && session.payment_status !== 'paid';
}

export async function finalizeExpiredCommerceCheckout(
  session: StripeCheckoutStatus,
  serviceClient: ServiceClient,
  source = 'stripe_webhook',
) {
  const directHoldId = String(session?.metadata?.capacity_hold_id || '').trim();
  if (directHoldId) {
    const { error: directReleaseError } = await serviceClient.rpc('release_capacity_hold', {
      p_hold_id: directHoldId,
      p_reason: 'stripe_checkout_expired',
    });
    if (directReleaseError) throw new Error(directReleaseError.message);
  }

  const orderId = String(session?.metadata?.commerce_order_id || '').trim();
  if (!orderId || !session.id) return { released: Boolean(directHoldId), orderId: orderId || null };
  const { data: order, error: orderError } = await serviceClient.from('commerce_orders')
    .select('id, venue_id, status, stripe_session_id, metadata')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order || order.stripe_session_id !== session.id || !['checkout_pending', 'expired'].includes(order.status)) {
    return { released: false, orderId };
  }

  const { data: lines, error: linesError } = await serviceClient.from('commerce_order_lines')
    .select('capacity_hold_id, activity_session_id, commerce_kind')
    .eq('commerce_order_id', order.id);
  if (linesError) throw new Error(linesError.message);
  for (const line of lines || []) {
    if (!line.capacity_hold_id) continue;
    const { error: releaseError } = await serviceClient.rpc('release_capacity_hold', {
      p_hold_id: line.capacity_hold_id,
      p_reason: 'stripe_checkout_expired',
    });
    if (releaseError) throw new Error(releaseError.message);
  }

  if (order.status === 'checkout_pending') {
    const reconciledAt = new Date().toISOString();
    const { error: expireError } = await serviceClient.from('commerce_orders')
      .update({
        status: 'expired',
        expires_at: reconciledAt,
        metadata: {
          ...(order.metadata || {}),
          expiry_source: source,
          expiry_reconciled_at: reconciledAt,
        },
      })
      .eq('id', order.id)
      .eq('status', 'checkout_pending');
    if (expireError) throw new Error(expireError.message);
  }

  const participation = (lines || []).find((line: any) => line.commerce_kind === 'participation');
  const { error: eventError } = await serviceClient.from('commerce_events').upsert({
    venue_id: order.venue_id,
    commerce_order_id: order.id,
    activity_session_id: participation?.activity_session_id || null,
    event_name: 'checkout_abandoned',
    journey_id_hash: order.metadata?.journey_id_hash || null,
    metadata: { source },
  }, { onConflict: 'commerce_order_id,event_name' });
  if (eventError) console.error('checkout abandoned event failed', eventError.message);
  return { released: true, orderId };
}

async function retrieveStripeCheckoutSession(stripeKey: string, stripeApiBase: string, sessionId: string) {
  const response = await fetch(`${stripeApiBase.replace(/\/$/, '')}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe session lookup failed ${response.status}`);
  return payload as StripeCheckoutStatus;
}

export async function reconcileExpiredFirstVisitCheckouts(
  serviceClient: ServiceClient,
  options: {
    customerId?: string | null;
    orderId?: string | null;
    stripeKey?: string | null;
    stripeApiBase?: string | null;
    now?: Date;
  },
) {
  if (!options.stripeKey || (!options.customerId && !options.orderId)) return { checked: 0, released: 0, errors: 0 };
  let query = serviceClient.from('capacity_holds')
    .select('id, customer_id, expires_at, stripe_session_id, metadata')
    .eq('status', 'active')
    .eq('metadata->>applied_price_type', 'first_visit_offer')
    .lte('expires_at', (options.now || new Date()).toISOString())
    .not('stripe_session_id', 'is', null)
    .limit(5);
  if (options.customerId) query = query.eq('customer_id', options.customerId);
  if (options.orderId) query = query.eq('metadata->>commerce_order_id', options.orderId);
  const { data: holds, error } = await query;
  if (error) {
    console.error('first-visit expiry lookup failed', error.message);
    return { checked: 0, released: 0, errors: 1 };
  }

  let released = 0;
  let errors = 0;
  for (const hold of holds || []) {
    try {
      const session = await retrieveStripeCheckoutSession(
        options.stripeKey,
        options.stripeApiBase || 'https://api.stripe.com/v1',
        String(hold.stripe_session_id),
      );
      if (!stripeCheckoutCanBeReleased(session)) continue;
      session.metadata = {
        ...(session.metadata || {}),
        commerce_order_id: session.metadata?.commerce_order_id || hold.metadata?.commerce_order_id,
      };
      const result = await finalizeExpiredCommerceCheckout(session, serviceClient, 'stripe_status_recovery');
      if (result.released) released += 1;
    } catch (recoveryError) {
      errors += 1;
      console.error('first-visit expiry reconciliation failed', recoveryError instanceof Error ? recoveryError.message : recoveryError);
    }
  }
  return { checked: (holds || []).length, released, errors };
}
