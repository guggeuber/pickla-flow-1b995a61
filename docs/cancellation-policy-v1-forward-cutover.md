# Cancellation Policy V1 forward-only cutover

Policy V1 is authoritative only for the seven rows in
`cancellation_policy_cutovers`: occurrence tickets, booking participants, court
bookings, managed courses, league teams, refundable events and non-refundable
events. Memberships and merchandise are excluded.

Every V1 purchase freezes a published version into an immutable snapshot that
references its cutover row. A terms-bearing purchase created on or after
`enabled_at` fails closed when that snapshot is missing.

Purchases before `enabled_at` remain explicit `legacy` at runtime. They keep a
null snapshot FK and never receive manufactured contractual terms. Customer and
admin projections say that the purchase predates Policy V1 and that policy
details are unavailable. Existing future/active purchases remain legacy; their
future occurrence date does not make Policy V1 retroactive.

The release migration contains schema and policy configuration only. It does
not update historical commerce lines, registrations, bookings or booking
participants, and it creates no historical snapshots. Any later legacy-data
reconciliation must be a separate reviewed task with exact predicates, counts,
rollback and customer-contract evidence.

Before release, run `scripts/cancellation-policy-rollout-preflight.sql` against
the target. Expected release values are:

- `historical_business_rows_mutated = 0`
- `historical_snapshots_created = 0`
- `historical_fk_links_changed = 0`
- `post_cutover_missing_snapshot = 0`

`legacy_population` is informational. Those rows are deliberately not a
backfill queue. `ambiguous_legacy_rows` is separately zero: the 18 observed on
stage were every row selected by the rejected broad bootstrap there, not a
proven ambiguity class. `legacy_policy_details_unavailable` reports the larger
historical population without inventing contractual terms.
