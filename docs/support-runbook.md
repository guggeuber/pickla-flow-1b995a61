# Support Runbook

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

### Booking cancelled but court still blocked

1. Confirm booking rows have `status = cancelled`.
2. Confirm availability queries exclude cancelled rows.
3. Check whether grouped rows all share the same status.

### Wrong membership allowance

1. Check active bookings for the current Stockholm week.
2. Cancelled bookings should not count.
3. Check tier entitlements and pricing rules.
4. Check whether the user has multiple active memberships.

### Refund requested

1. Confirm policy and booking status.
2. Refund in Stripe.
3. Add an internal note with reason, amount, and staff member.
4. Do not delete booking or receipt records.

### Customer data request

Follow [data-and-compliance.md](./data-and-compliance.md).

