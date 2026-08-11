import {
  bookingParticipantCanReResolve,
  persistCurrentBookingParticipantCoverage,
  resolveCurrentBookingParticipantCoverage,
} from '../functions/_shared/booking_participant_entitlement.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function queryResult(data: any, error: any = null) {
  const result = { data, error };
  const chain: any = {};
  for (const method of ['select', 'eq', 'neq', 'lte', 'gte', 'gt', 'or', 'order', 'limit', 'in', 'is']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fixtureParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    venue_id: '20000000-0000-4000-8000-000000000001',
    booking_id: '30000000-0000-4000-8000-000000000001',
    booking_group_key: 'group:test',
    customer_id: '40000000-0000-4000-8000-000000000001',
    user_id: '50000000-0000-4000-8000-000000000001',
    price_minor: 9900,
    payment_status: 'pending',
    booking_receipt_id: null,
    payment_stripe_session_id: null,
    metadata: {},
    ...overrides,
  };
}

function fixtureBookings(founder = false) {
  return [{
    id: '30000000-0000-4000-8000-000000000001',
    venue_id: '20000000-0000-4000-8000-000000000001',
    start_time: '2026-08-11T15:00:00.000Z',
    end_time: '2026-08-11T16:00:00.000Z',
    included_court_hours: founder ? 1 : 0,
    membership_usage_entitlement_type: founder ? 'court_hours_per_week' : null,
  }];
}

function resolverClient(input: { founder?: boolean; canonical?: any } = {}) {
  return {
    from(table: string) {
      if (table !== 'memberships') throw new Error(`Unexpected table ${table}`);
      return queryResult(input.founder ? [{
        id: '60000000-0000-4000-8000-000000000001',
        starts_at: '2026-08-01',
        expires_at: null,
        membership_tiers: { name: 'Founder' },
      }] : []);
    },
    async rpc(name: string) {
      if (name !== 'resolve_access_entitlement') throw new Error(`Unexpected RPC ${name}`);
      return { data: input.canonical || { status: 'not_covered', covered: false }, error: null };
    },
  };
}

Deno.test('Founder granted after an unpaid claim now covers a Founder booking', async () => {
  const result = await resolveCurrentBookingParticipantCoverage(
    resolverClient({ founder: true }),
    fixtureParticipant(),
    { bookingRows: fixtureBookings(true), channel: 'checkin' },
  );
  assert(result.covered, 'Founder coverage was not found');
  assert(result.accessReason === 'Founder', `Unexpected Founder reason: ${result.accessReason}`);
  assert(result.entitlementType === 'membership_access', `Unexpected type: ${result.entitlementType}`);
});

Deno.test('current canonical Membership coverage is property-driven', async () => {
  const result = await resolveCurrentBookingParticipantCoverage(
    resolverClient({ canonical: {
      status: 'covered', covered: true,
      entitlement_id: '70000000-0000-4000-8000-000000000001',
      entitlement_type: 'membership_access',
      access_reason: 'Ingår i ditt medlemskap',
      funding_type: 'subscription', funder: 'subscription',
    } }),
    fixtureParticipant(),
    { bookingRows: fixtureBookings(false) },
  );
  assert(result.covered && result.entitlementType === 'membership_access', 'Membership was not selected');
});

Deno.test('current canonical Day Pass coverage is property-driven', async () => {
  const result = await resolveCurrentBookingParticipantCoverage(
    resolverClient({ canonical: {
      status: 'covered', covered: true,
      entitlement_id: '80000000-0000-4000-8000-000000000001',
      entitlement_type: 'day_access', access_reason: 'Heldagspass',
      funding_type: 'commerce_purchase', funder: 'self_prepaid',
    } }),
    fixtureParticipant(),
    { bookingRows: fixtureBookings(false) },
  );
  assert(result.covered && result.entitlementType === 'day_access', 'Day Pass was not selected');
});

Deno.test('no matching entitlement leaves the unpaid amount collectible', async () => {
  const result = await resolveCurrentBookingParticipantCoverage(
    resolverClient(),
    fixtureParticipant(),
    { bookingRows: fixtureBookings(false) },
  );
  assert(!result.covered && result.status === 'not_covered', `Unexpected result: ${JSON.stringify(result)}`);
});

Deno.test('settled and already included participation is immutable', () => {
  assert(!bookingParticipantCanReResolve(fixtureParticipant({ payment_status: 'paid' })), 'Paid participation was mutable');
  assert(!bookingParticipantCanReResolve(fixtureParticipant({ payment_status: 'free', price_minor: 0 })), 'Free participation was mutable');
  assert(!bookingParticipantCanReResolve(fixtureParticipant({ booking_receipt_id: 'receipt-id' })), 'Receipted participation was mutable');
  assert(!bookingParticipantCanReResolve(fixtureParticipant({ payment_stripe_session_id: 'cs_paid' })), 'Stripe-settled participation was mutable');
});

Deno.test('pending to free persistence is atomic, audited in metadata and idempotent', async () => {
  const original = fixtureParticipant({
    display_name: 'Peter',
    metadata: { pricing_label: 'Din del av banan', pricing_reason: 'booking_participant_share' },
  });
  const fresh = fixtureParticipant({
    display_name: 'Peter', price_minor: 0, payment_status: 'free',
    metadata: { pricing_reason: 'current_entitlement_reresolution' },
  });
  let commitArgs: any = null;
  let commitReason = 'committed';
  const admin = {
    from(table: string) {
      if (table === 'capacity_holds') return queryResult(null);
      if (table === 'booking_participants') return queryResult(fresh);
      throw new Error(`Unexpected table ${table}`);
    },
    rpc(name: string, args: any) {
      if (name !== 'commit_booking_participant_capacity') throw new Error(`Unexpected RPC ${name}`);
      commitArgs = args;
      return queryResult({ ok: true, participant_id: original.id, reason: commitReason });
    },
  };
  const coverage = {
    covered: true, status: 'covered', entitlementId: null,
    entitlementType: 'membership_access', accessReason: 'Founder',
    fundingType: null, funder: null, sourceType: 'membership',
    sourceId: '60000000-0000-4000-8000-000000000001',
    membershipId: '60000000-0000-4000-8000-000000000001',
    consumptionRequired: false, consumptionTrigger: null, noShowPolicy: null,
    resolutionPriority: 20,
  };

  const first = await persistCurrentBookingParticipantCoverage(admin, original, coverage, {
    bookingRows: fixtureBookings(true), channel: 'desk',
  });
  assert(first.reresolved, 'Pending participant did not become free');
  assert(commitArgs.p_price_minor === 0 && commitArgs.p_payment_status === 'free', 'Commit was not free');
  assert(commitArgs.p_metadata.entitlement_reresolution.original_price_minor === 9900, 'Original price was not retained');
  assert(commitArgs.p_metadata.entitlement_reresolution.original_payment_status === 'pending', 'Original status was not retained');
  assert(commitArgs.p_booking_receipt_id == null, 'A receipt was incorrectly attached');

  commitReason = 'already_committed';
  const concurrentRetry = await persistCurrentBookingParticipantCoverage(admin, original, coverage, {
    bookingRows: fixtureBookings(true), channel: 'desk',
  });
  assert(!concurrentRetry.reresolved, 'Concurrent retry claimed another request\'s transition');

  commitArgs = null;
  const second = await persistCurrentBookingParticipantCoverage(admin, fresh, coverage, {
    bookingRows: fixtureBookings(true), channel: 'desk',
  });
  assert(!second.reresolved, 'Already-free participant was changed again');
  assert(commitArgs == null, 'Idempotent retry called the commit RPC');
});
