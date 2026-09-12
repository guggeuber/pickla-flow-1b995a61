export async function recordPaidCapacityConflict(serviceClient: any, params: {
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
