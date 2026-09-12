import { DateTime } from 'https://esm.sh/luxon@3.5.0';
import { resolveCustomerIdForUser } from './customers.ts';
import { recordPaidCapacityConflict } from './paid_capacity_conflict.ts';
import type { StripeCheckoutStatus } from './commerce_checkout_expiry.ts';

const BOOKING_PARTICIPANT_MAX_PER_COURT = 4;
const BOOKING_PARTICIPANT_SOURCE_TYPE = 'booking_participant';

function stripeObjectId(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'object' && value && 'id' in value) return String((value as any).id || '') || null;
  return null;
}

function paymentMethod(session: StripeCheckoutStatus) {
  const types = Array.isArray(session.payment_method_types) ? session.payment_method_types : [];
  if (types.includes('card')) return 'Kort via Stripe';
  return types.length ? `${types.join(', ')} via Stripe` : 'Stripe';
}

function bookingSessionDate(row: any) {
  const iso = row?.start_time;
  if (!iso) return DateTime.now().setZone('Europe/Stockholm').toISODate()!;
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Stockholm').toISODate()!;
}

function bookingParticipantCapacity(rows: any[]) {
  return Math.max(rows.length, 1) * BOOKING_PARTICIPANT_MAX_PER_COURT;
}

function openBookingCapacity(rows: any[]) {
  const representative = rows.find((row: any) => row?.open_for_more_status === 'open') || rows[0] || {};
  if (representative.open_for_more_status !== 'open') return 0;
  const publicCapacity = Number(representative.open_for_more_public_capacity || 0);
  if (publicCapacity > 0) return publicCapacity;
  const openedPlaces = Number(representative.open_for_more_opened_places || 0);
  const committedAtPublication = Number(representative.open_for_more_committed_at_publication || 0);
  if (openedPlaces > 0) return committedAtPublication + openedPlaces;
  return Math.max(Number(representative.open_for_more_total_players || 0), 0);
}

function bookingParticipantCapacityLimit(rows: any[]) {
  return rows.some((row: any) => row?.open_for_more_status === 'open')
    ? openBookingCapacity(rows)
    : bookingParticipantCapacity(rows);
}

async function getBookingGroupRows(serviceClient: any, booking: any) {
  let query = serviceClient
    .from('bookings')
    .select('id, booking_ref, venue_id, venue_court_id, user_id, customer_id, start_time, end_time, total_price, status, notes, access_code, stripe_session_id, included_court_hours, membership_usage_entitlement_type, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at')
    .eq('venue_id', booking.venue_id)
    .neq('status', 'cancelled');
  if (booking.stripe_session_id) {
    query = query.eq('stripe_session_id', booking.stripe_session_id);
  } else if (booking.access_code) {
    query = query.eq('access_code', booking.access_code).eq('start_time', booking.start_time).eq('end_time', booking.end_time);
  } else {
    query = query.eq('start_time', booking.start_time).eq('end_time', booking.end_time).eq('notes', booking.notes);
  }
  const { data, error } = await query.order('start_time', { ascending: true });
  if (error) throw new Error(error.message);
  return data?.length ? data : [booking];
}

async function ensureParticipantReceipt(
  serviceClient: any,
  session: StripeCheckoutStatus,
  participant: any,
  booking: any,
) {
  const fields = 'id, customer_id, receipt_number, purchase_type, product_description, customer_name, total_inc_vat_sek, vat_amount_sek, vat_rate, issued_at, payment_method, payment_status, stripe_session_id, stripe_payment_intent_id, stripe_customer_id';
  const loadExisting = () => serviceClient.from('booking_receipts')
    .select(fields)
    .eq('stripe_session_id', session.id)
    .maybeSingle();
  const { data: existing, error: existingError } = await loadExisting();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing;

  const amountMinor = Number(session.amount_total || 0);
  const totalSek = Math.round(amountMinor) / 100;
  const vatAmountSek = Math.round(totalSek * 6 / 106 * 100) / 100;
  const userId = participant.user_id || String(session.metadata?.user_id || '').trim() || null;
  const customerId = participant.customer_id || await resolveCustomerIdForUser(serviceClient, userId);
  const { data: receipt, error } = await serviceClient.from('booking_receipts').insert({
    booking_refs: booking?.booking_ref ? [booking.booking_ref] : [],
    stripe_session_id: session.id,
    stripe_payment_intent_id: stripeObjectId(session.payment_intent),
    stripe_customer_id: stripeObjectId(session.customer),
    venue_id: participant.venue_id,
    customer_id: customerId,
    user_id: userId,
    customer_name: participant.display_name || String(session.metadata?.customer_name || '') || session.customer_details?.name || null,
    customer_email: session.customer_details?.email || participant.email || String(session.metadata?.customer_email || '') || null,
    customer_phone: participant.phone || String(session.metadata?.customer_phone || '') || session.customer_details?.phone || null,
    purchase_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
    product_description: 'Medspelarplats · Banbokning',
    payment_method: paymentMethod(session),
    total_inc_vat: Math.round(totalSek),
    total_ex_vat: Math.round(Math.max(totalSek - vatAmountSek, 0)),
    vat_amount: Math.round(vatAmountSek),
    total_inc_vat_sek: totalSek,
    total_ex_vat_sek: Math.round(Math.max(totalSek - vatAmountSek, 0) * 100) / 100,
    vat_amount_sek: vatAmountSek,
    vat_rate: 6,
    currency: String(session.currency || 'sek').toUpperCase(),
    payment_provider: 'stripe',
    payment_status: session.payment_status || 'paid',
    metadata: { product_type: BOOKING_PARTICIPANT_SOURCE_TYPE },
  }).select(fields).single();
  if (!error && receipt) return receipt;
  if (error?.code === '23505') {
    const { data: concurrent, error: concurrentError } = await loadExisting();
    if (concurrentError) throw new Error(concurrentError.message);
    if (concurrent) return concurrent;
  }
  throw new Error(error?.message || 'Booking participant receipt could not be created');
}

async function ensureParticipantLedger(
  serviceClient: any,
  session: StripeCheckoutStatus,
  participant: any,
  booking: any,
  receipt: any,
  sourceType: string,
  sourceId: string,
  metadata: Record<string, unknown>,
) {
  const amountMinor = Number(session.amount_total || 0);
  const occurredAt = receipt?.issued_at || new Date().toISOString();
  const accountingDate = DateTime.fromISO(occurredAt, { zone: 'utc' }).setZone('Europe/Stockholm').toISODate();
  if (!accountingDate) throw new Error('Could not resolve ledger accounting date');
  const { error } = await serviceClient.from('ledger_entries').insert({
    venue_id: participant.venue_id,
    source_type: sourceType,
    source_id: sourceId,
    accounting_date: accountingDate,
    occurred_at: occurredAt,
    customer_id: receipt?.customer_id || participant.customer_id || null,
    customer_name: receipt?.customer_name || participant.display_name || null,
    amount_inc_vat_minor: amountMinor,
    vat_amount_minor: Math.round(amountMinor * 6 / 106),
    payment_status: 'paid',
    payment_method: receipt?.payment_method || paymentMethod(session),
    stripe_session_id: session.id,
    receipt_number: receipt?.receipt_number || null,
    booking_receipt_id: receipt?.id || null,
    metadata: {
      product_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
      purchase_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
      product_description: 'Medspelarplats · Banbokning',
      stripe_payment_intent_id: stripeObjectId(session.payment_intent),
      stripe_customer_id: stripeObjectId(session.customer),
      booking_participant_id: participant.id,
      booking_id: participant.booking_id,
      booking_group_key: participant.booking_group_key,
      booking_ref: booking?.booking_ref || null,
      ...metadata,
    },
  });
  if (error && error.code !== '23505') throw new Error(`Failed to create ledger entry: ${error.message}`);
}

/** Canonical paid-booking-participant fulfillment used by webhook and retry recovery. */
export async function finalizePaidBookingParticipantCheckout(
  session: StripeCheckoutStatus,
  serviceClient: any,
) {
  if (session.payment_status !== 'paid') throw new Error('booking_participant_payment_not_paid');
  const participantId = String(session.metadata?.booking_participant_id || '').trim();
  if (!participantId) throw new Error('Missing booking_participant_id');

  const { data: participant, error: participantError } = await serviceClient
    .from('booking_participants')
    .select('id, venue_id, booking_id, booking_group_key, customer_id, user_id, display_name, email, phone, price_minor, payment_status, payment_stripe_session_id, booking_receipt_id, metadata, bookings(booking_ref, venue_id, start_time, end_time, access_code, stripe_session_id, notes, open_for_more_status, open_for_more_total_players, open_for_more_opened_places, open_for_more_public_capacity, open_for_more_committed_at_publication, open_for_more_pace, open_for_more_note, open_for_more_published_at, open_for_more_closed_at)')
    .eq('id', participantId)
    .maybeSingle();
  if (participantError) throw new Error(participantError.message);
  if (!participant) throw new Error('Booking participant not found');
  if (participant.payment_status === 'free') throw new Error('booking_participant_already_free');
  if (participant.payment_status === 'paid' && participant.payment_stripe_session_id !== session.id) {
    throw new Error('booking_participant_payment_already_settled');
  }

  const amountMinor = Number(session.amount_total || 0);
  if (amountMinor <= 0 || amountMinor !== Number(participant.price_minor || 0)) {
    throw new Error('booking_participant_payment_amount_mismatch');
  }
  if (String(session.currency || '').toLowerCase() !== 'sek') {
    throw new Error('booking_participant_payment_currency_mismatch');
  }

  const booking = Array.isArray(participant.bookings) ? participant.bookings[0] : participant.bookings;
  if (!booking || booking.venue_id !== participant.venue_id) throw new Error('Booking participant booking not found');
  const receipt = await ensureParticipantReceipt(serviceClient, session, participant, booking);
  const participantMetadata = participant.metadata && typeof participant.metadata === 'object' ? participant.metadata : {};
  const stableOpenBookingCapacity = Number(
    session.metadata?.open_booking_public_capacity ||
    session.metadata?.open_booking_total_players ||
    participantMetadata.open_booking_public_capacity ||
    participantMetadata.open_booking_total_players ||
    0
  );
  const openBookingMetadata = {
    booking_ref: booking.booking_ref || null,
    open_booking_context: session.metadata?.open_booking_context || participantMetadata.source || null,
    open_booking_opened_places: Number(session.metadata?.open_booking_opened_places || participantMetadata.open_booking_opened_places || 0) || null,
    open_booking_public_capacity: stableOpenBookingCapacity || null,
    open_booking_committed_at_publication: Number(session.metadata?.open_booking_committed_at_publication || participantMetadata.open_booking_committed_at_publication || 0) || null,
    open_booking_total_players: stableOpenBookingCapacity || null,
  };

  if (participant.payment_status === 'paid') {
    if (!participant.booking_receipt_id && receipt?.id) {
      const { error } = await serviceClient.from('booking_participants')
        .update({ booking_receipt_id: receipt.id })
        .eq('id', participant.id)
        .eq('payment_status', 'paid')
        .eq('payment_stripe_session_id', session.id);
      if (error) throw new Error(error.message);
    }
    await ensureParticipantLedger(
      serviceClient,
      session,
      participant,
      booking,
      receipt,
      BOOKING_PARTICIPANT_SOURCE_TYPE,
      participant.id,
      openBookingMetadata,
    );
    return { ok: true, participantId: participant.id, reason: 'already_reconciled', receiptId: receipt?.id || null };
  }

  const groupedRows = await getBookingGroupRows(serviceClient, booking);
  const capacity = stableOpenBookingCapacity > 0 ? stableOpenBookingCapacity : bookingParticipantCapacityLimit(groupedRows);
  const { data: commit, error: commitError } = await serviceClient.rpc('commit_booking_participant_capacity', {
    p_venue_id: participant.venue_id,
    p_booking_id: participant.booking_id,
    p_booking_group_key: participant.booking_group_key,
    p_session_date: bookingSessionDate(booking),
    p_capacity: capacity,
    p_customer_id: participant.customer_id || receipt?.customer_id || null,
    p_user_id: participant.user_id || String(session.metadata?.user_id || '').trim() || null,
    p_display_name: participant.display_name || String(session.metadata?.customer_name || '') || 'Spelare',
    p_email: session.customer_details?.email || participant.email || null,
    p_phone: participant.phone || null,
    p_role: 'player',
    p_price_minor: amountMinor,
    p_payment_status: 'paid',
    p_payment_method: paymentMethod(session),
    p_payment_stripe_session_id: session.id,
    p_booking_receipt_id: receipt?.id || null,
    p_metadata: {
      ...(participant.metadata || {}),
      stripe_session_id: session.id,
      stripe_payment_intent_id: stripeObjectId(session.payment_intent),
    },
    p_hold_id: String(session.metadata?.capacity_hold_id || '').trim() || null,
    p_participant_id: participant.id,
  }).maybeSingle();
  if (commitError) throw new Error(commitError.message);

  if (!commit?.ok) {
    await ensureParticipantLedger(serviceClient, session, participant, booking, receipt, 'stripe_payment', String(session.id), {
      intended_source_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
      delivery_status: 'capacity_conflict',
      ...openBookingMetadata,
    });
    await recordPaidCapacityConflict(serviceClient, {
      venueId: participant.venue_id,
      scopeType: 'booking_group',
      scopeId: participant.booking_group_key,
      sessionDate: bookingSessionDate(booking),
      stripeSessionId: String(session.id),
      paymentIntentId: stripeObjectId(session.payment_intent),
      receiptId: receipt?.id || null,
      ledgerSourceType: 'stripe_payment',
      ledgerSourceId: String(session.id),
      customerId: participant.customer_id || receipt?.customer_id || null,
      userId: participant.user_id || null,
      title: `Betald medspelarplats kunde inte levereras: ${participant.display_name || 'Spelare'}`,
      metadata: {
        product_type: BOOKING_PARTICIPANT_SOURCE_TYPE,
        booking_participant_id: participant.id,
        booking_group_key: participant.booking_group_key,
        booking_id: participant.booking_id,
        ...openBookingMetadata,
      },
    });
    return { ok: false, participantId: participant.id, reason: commit?.reason || 'capacity_full', receiptId: receipt?.id || null };
  }

  await ensureParticipantLedger(
    serviceClient,
    session,
    participant,
    booking,
    receipt,
    BOOKING_PARTICIPANT_SOURCE_TYPE,
    participant.id,
    openBookingMetadata,
  );
  return { ok: true, participantId: participant.id, reason: commit.reason || 'committed', receiptId: receipt?.id || null };
}
