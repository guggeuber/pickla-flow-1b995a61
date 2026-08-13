# Course V1 — Series Commitment doctrine

## Canonical hierarchy

`Activity Format → Activity Series → Activity Session`

`Activity Series → Series Commitment`

- **Format** is reusable identity and content across terms, venues and future franchises.
- **Series** is a concrete term/run and owns sellable Course capacity.
- **Session** is one physical occurrence used by Schedule, Operations, Staffing and Check-in.
- **Series Commitment** is the durable answer to who owns one Series place. It never copies Session IDs and never owns price/payment truth.
- **Series entitlement** is the participant's non-consuming right to attend the Series.
- **Session registration** is an idempotent operational projection for expected participation and attendance.

Commerce remains the source of truth for Order, order line, payment, receipt and ledger provenance. A Course uses one upfront `series_access` order line. The paid webhook atomically turns the existing Series hold into one active commitment and one Series entitlement. There are never six purchases or six entitlements.

## Capacity and attendance

Available Course seats are:

`Series.capacity − active Series Commitments − active Series holds`

The existing canonical `capacity_holds` engine protects checkout concurrency. Failed or expired Checkout releases the hold and creates no durable commitment.

Absence/no-show is occurrence attendance state only. It never restores Series capacity, creates credit, changes the entitlement, or changes the commitment.

## Identity and privacy

Adult payer and participant are separate canonical Customers where required. The Order belongs to the payer; the commitment and entitlement belong to the participant.

A subordinate participant is a minimal operational identity with first name, birth year, guardian Customer and an optional operational note. It is not an auth user, public player profile or social Customer identity.

### P-18 — Minor participants never appear in public/social identity surfaces

A subordinate/minor participant must never appear in PeopleRow, social participant previews, co-player graphs, sharing previews or another public identity surface. Identifying data is visible only to the guardian and authorized operational staff. Public Course projections expose aggregate capacity only.

## Session changes

Moving, cancelling, replacing or adding a Course Session reconciles the operational `session_registrations` projection. It does not rewrite commitments or entitlements. Course Sessions are `closed_to_public` and cannot be purchased independently as Open Play.

## V1 boundaries

Course V1 deliberately excludes instalments, Pay at Desk, invoice flow, prorating, make-up sessions, credits, place transfers, group moves and post-start financial automation. Before Course start, the existing Commerce refund lifecycle may cancel the commitment after Stripe confirms a full refund. After Course start, exceptions are manual.

The schema leaves `commitment_type=resource` reserved for a future recurring resource Contract. Participant commitments are compatible with a future Team/Organization carrier, but Course V1 implements only Customer or subordinate participant carriers. League competition remains outside Series Commitment.

## Source-of-truth audit

| Object | Responsibility | Course action |
| --- | --- | --- |
| `activity_formats` | Reusable activity identity/content | New minimal canonical object |
| `activity_series` | Concrete term/run and sellable capacity | Extended |
| `activity_sessions` | Physical occurrences | Extended with public closure/index |
| `series_commitments` | Durable Series place | New canonical object |
| `access_products` | Sellable product | Reused with `series_access` |
| `commerce_orders` / lines | Payment and payer provenance | Reused; line references Series/participant |
| `capacity_holds` | Temporary scarce-capacity protection | Reused with `activity_series` scope |
| `access_entitlements` | Participant access right | Reused with Series scope and subordinate owner |
| `session_registrations` | Expected occurrence participation | Reused as materialized projection |
| `venue_checkins` | Concrete attendance | Reused; no Course-specific check-in |
| Operations Week / staffing | Operational projection and assignments | Reused unchanged except instructor wording |
