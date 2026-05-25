# Support Runbook

## First Rule

Do not delete production records to make the UI look clean. Bookings, receipts, chats, memberships, communications, and score rows are operational history. Prefer status changes, admin tools, refunds, and explicit correction notes.

## Severity

- **P0:** payment captured but customer cannot receive product, double-booking, data leak, or broad checkout/webhook failure.
- **P1:** booking, cancellation, membership, check-in, registration, or auth is broken for a meaningful user group.
- **P2:** single-device issue or confusing UI with a safe staff workaround.
- **P3:** copy, polish, or minor layout issue.

Use [observability-and-ops-agent.md](./observability-and-ops-agent.md) for incident notes and post-deploy watch.

## Common Issues

### Customer cannot log in

1. Confirm the email address.
2. Check whether email is confirmed in Supabase Auth.
3. Send password reset if needed.
4. Do not manually change password for the customer.

### Booking paid but missing

1. Check Stripe Checkout Session and PaymentIntent.
2. Check `api-stripe-webhook` delivery.
3. Search bookings by `stripe_session_id`.
4. If payment succeeded but booking failed, verify court conflict before manual fix.
5. Record the Stripe ids and any manual correction.

### Booking cancelled but court still blocked

1. Confirm booking rows have `status = cancelled`.
2. Confirm availability queries exclude cancelled rows.
3. Check whether grouped rows all share the same status.
4. Keep the booking chat/history. The cancelled booking should remain visible as cancelled, not disappear from history.

### Wrong membership allowance

1. Check active bookings for the current Stockholm week.
2. Cancelled bookings should not count.
3. Check tier entitlements and pricing rules.
4. Check whether the user has multiple active memberships.
5. Check whether the booking used multiple courts; court-hours are `durationHours * courtCount`.

### Refund requested

1. Confirm policy and booking status.
2. Refund in Stripe.
3. Add an internal note with reason, amount, and staff member.
4. Do not delete booking or receipt records.

### Customer data request

Follow [data-and-compliance.md](./data-and-compliance.md).

## Support Correction Log

Every manual support correction should include:

- staff member
- timestamp
- venue
- customer email or user id
- affected booking/payment/membership/session ids
- before state
- after state
- reason
- whether customer was notified

