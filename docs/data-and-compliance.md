# Data And Compliance Baseline

This is not legal advice. It is the lean operating baseline before soft launch.

## Personal Data We Intend To Store

Customer account:

- user id
- display name
- first name and last name when needed for membership, staff support, receipts, and desk operations
- email
- phone when needed for membership, staff support, group/event leads, and desk operations
- profile/avatar fields if supplied
- QR/account token identifiers

Venue operations:

- bookings
- booking resources/courts
- booking access codes
- check-ins and presence rows
- membership tier and benefit usage
- Open Play/session registrations
- vouchers and claims
- support/admin notes where needed

Payments:

- Stripe customer id
- Stripe checkout/session/payment ids
- payment status
- receipt snapshot
- card display metadata only, such as brand/last4/expiry

Communications:

- booking chat messages
- event/inquiry internal notes
- outbound/inbound customer email logs for group inquiries

Do not store full card numbers, CVC, personal identity numbers, address, birth date, gender, emergency contacts, unnecessary identity documents, or sensitive health data in v1.

## Processor List

- Supabase: database, auth, storage, edge functions, realtime.
- Stripe: payments, subscriptions, saved payment methods.
- Vercel: frontend hosting/build/deploy.
- Resend: transactional and customer email.
- Giphy: optional GIF search in chat if enabled.

## Customer Rights Routine

Export request:

1. Verify the requester controls the email/account.
2. Export account, bookings, receipts, memberships, vouchers, and relevant messages.
3. Record completion date and staff member.

Deletion request:

1. Verify the requester controls the email/account.
2. Keep legally required financial records.
3. Anonymize or delete non-required profile/support data.
4. Preserve operational records where needed with minimized personal fields.

Correction request:

1. Update profile/customer fields through admin or customer profile.
2. Do not edit payment records directly; correct with receipts/refund notes.

Incident:

1. Record what happened and affected users.
2. Contain access or revoke credentials/tokens.
3. Assess notification requirement.
4. Write follow-up action.

## Policies Needed Before Soft Launch

- Privacy policy.
- Terms of booking/membership.
- Cancellation/refund terms.
- Staff access routine.
- Temporary admin access routine.
- Processor list / data processing overview.
