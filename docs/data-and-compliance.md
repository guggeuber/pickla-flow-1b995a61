# Data And Compliance Baseline

This is not legal advice. It is the lean operating baseline before soft launch.

## Company / Controller Model

- Pickla Orbit AB, org.nr 559203-1610, is the platform company for Pickla. It can provide shared platform, product, support, operations tooling, and processor/vendor management across several operating companies and future franchises.
- Pickla Solna AB, org.nr 556977-4481, is an operating company for the Solna venue. It handles local venue operations, bookings, memberships, desk, customer contact, and daily support for that venue.
- The relevant operating company can vary by venue/franchise. Public policy copy should explain that Pickla Orbit provides the platform while the local operating company may be the local contracting/operating party.
- Customer data should only be shared between Pickla Orbit, the relevant operating company/franchise, and processors where needed to deliver the service, support the customer, handle payments/receipts, or operate the venue.

## Public Policy Pages

The public v1 policy pages are:

- `/privacy` for privacy policy.
- `/terms` for booking, payment, membership, voucher, cancellation, and operational terms.
- `/cookies` for necessary cookies/local storage and third-party service information.

There is no cookie banner in v1 because Pickla does not use marketing or analytics cookies. If non-essential tracking is introduced later, add consent handling before launch.

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

Technical data:

- auth/session identifiers
- push notification subscription metadata if the customer activates notifications
- service worker/PWA state and required local storage for app functionality
- client/API error metadata needed for debugging production issues

Do not store full card numbers, CVC, personal identity numbers, address, birth date, gender, emergency contacts, unnecessary identity documents, or sensitive health data in v1.

## Data Minimization Defaults

- Email remains the canonical auth identity in Supabase Auth.
- `display_name` is used for public/social display and backwards compatibility.
- `first_name` and `last_name` are used for membership, receipts, desk, support, and staff-created customers.
- Phone is required only where operationally justified: memberships, staff-assisted workflows, group/event leads, and support cases where contact by phone is needed.
- Casual booking should stay low-friction unless a specific product or operational flow requires more data.
- Payment method handling stays in Stripe; Pickla only stores Stripe ids, payment status, receipt snapshots, and safe card display metadata.

## Processor List

- Supabase: database, auth, storage, edge functions, realtime.
- Stripe: payments, subscriptions, saved payment methods.
- Vercel: frontend hosting/build/deploy.
- Resend: transactional and customer email.
- Giphy: optional GIF search in chat if enabled.

## Customer Rights Routine

Export request:

1. Verify the requester controls the email/account.
2. Export account profile, auth email, bookings, receipts, memberships, membership usage, vouchers/claims, session registrations, event inquiries, customer communications, and relevant chat/support messages.
3. Include Stripe ids and receipt snapshots, but do not attempt to export full card data from Stripe.
4. Record completion date, staff member, requester email, and export scope.

Deletion request:

1. Verify the requester controls the email/account.
2. Keep legally required financial records.
3. Anonymize or delete non-required profile, phone, display/avatar, support, and communication fields where possible.
4. Preserve operational records where needed with minimized personal fields, especially bookings, receipts, payments, refunds, and dispute evidence.
5. Disable access or remove roles/subscriptions where the account should no longer be usable.

Correction request:

1. Update profile/customer fields through admin or customer profile.
2. Do not edit payment records directly; correct with receipts/refund notes.
3. Record manual correction reason, staff member, and affected records in the support correction log.

Incident:

1. Record what happened and affected users.
2. Contain access or revoke credentials/tokens.
3. Assess notification requirement.
4. Write follow-up action.
5. Review whether temporary access, secrets, RLS, edge function auth, or third-party processor settings contributed.

## Staff Access Routine

- Staff should use named accounts where possible.
- Venue access is scoped through `venue_staff`.
- Super admin access is restricted to trusted operators.
- Shared devices should use purpose-specific staff/device accounts, not personal super admin accounts.
- Staff should only open customer records when needed for booking, membership, check-in, support, payment correction, or incident handling.
- Manual customer corrections should be logged with before/after state.

## Temporary Admin Access

1. Define owner, reason, venue/customer scope, and expiry before granting access.
2. Grant the least privilege role that can solve the issue.
3. Record who approved and who received access.
4. Remove access at expiry or immediately after the task is complete.
5. Review affected records if temporary access was used during an incident.

## Policies Needed Before Soft Launch

- Privacy policy: published at `/privacy`.
- Terms of booking/membership/cancellation/refund: published at `/terms`.
- Cookie/local storage information: published at `/cookies`.
- Staff access routine: maintained in this document and security checklist.
- Temporary admin access routine: maintained in this document and security checklist.
- Processor list / data processing overview: maintained here and summarized publicly.
