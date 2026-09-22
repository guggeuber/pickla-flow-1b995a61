# Cancellation Policy V1

Cancellation Policy V1 separates participation, money, entitlements, and check-in. An accepted cancellation releases participation or capacity in the same database transaction. A provider refund is a durable, idempotent follow-up and never gates capacity release.

## Scope and presets

The customer outcomes in V1 are deliberately limited to a full refund or no refund. The approved immutable presets are:

| Preset | Applies to | Customer withdrawal | Automatic refund | Measurable entitlement |
| --- | --- | --- | --- | --- |
| `STANDARD_12H` | Open Play, training, ordinary occurrence tickets, co-player seats | Until start | More than 12 hours before start | Restore before the same cutoff |
| `COURT_24H` | Court bookings | Until start | More than 24 hours before start | Restore included court hours before the same cutoff |
| `COURSE_48H` | Managed courses | Until first occurrence | More than 48 hours before first occurrence | Restore before the same cutoff when provenance exists |
| `LEAGUE_REGISTRATION_CLOSE` | League/team registration | Before `registration_close` | Full before close | Policy provenance only |
| `EVENT_24H` | Explicit refundable events | Until start | More than 24 hours before start | Restore before the same cutoff when provenance exists |
| `EVENT_NON_REFUNDABLE` | Explicit non-refundable events | Until start | Never | No restoration |

At the exact deadline the deadline has passed. Membership subscription cancellation and merchandise returns are outside this policy domain.

## Canonical model

- `cancellation_policies` is the stable venue-owned identity.
- `cancellation_policy_versions` is immutable after publication and contains the preset rules plus Swedish and English copy.
- `cancellation_policy_bindings` resolves a product-family default or one explicit product, series, or event override. There is no deeper override chain.
- `cancellation_policy_snapshots` freezes the effective version, source, deadlines, payer, payment, funding, entitlement, and customer-message facts at purchase time.
- `cancellation_decisions` is the immutable audit trail for preview-confirmed cancellation effects. Only constrained provider reconciliation fields may advance.

The purchase snapshot is referenced from bookings, booking participants, session registrations, and Commerce order lines. Changing a binding only affects new purchases. New migrated sales fail closed when no deterministic policy can be resolved.

## Evaluation and confirmation

`cancellation_subject_state` is the single server-authoritative evaluator. The caller supplies only the subject identity and intent. The server resolves ownership, venue, frozen snapshot, server time, schedule or registration close, check-in, payer/payment, and entitlement provenance. Its result includes:

- `can_cancel`, `cancel_deadline`, `reason_code`, and `decision_revision`
- `capacity_effect`
- `refund_eligible`, `refund_mode`, `refund_amount_minor`, and `refund_deadline`
- `entitlement_effect`
- `customer_message_key` and parameters
- policy identity, version, source, and provenance

The frontend never computes eligibility. `POST api-cancellations/preview` returns the exact consequence and revision. Confirmation sends that revision to `POST api-cancellations/confirm`. The database locks the relevant subject or court group and re-evaluates. A materially changed consequence returns `409` with a new preview and requires another confirmation.

Checked-in customers are blocked from self-service cancellation. Authorized staff use the separate staff preview/confirm endpoints, must provide a reason, and may explicitly select permitted refund and restoration consequences. Check-in history remains intact.

## Effect execution

Confirmation atomically:

1. records the immutable decision;
2. cancels the participation and releases capacity exactly once;
3. appends an entitlement reversal when policy and frozen provenance permit it;
4. creates a receipt-targeted R2A refund command for automatic refunds;
5. commits local truth.

The Edge Function then dispatches the existing Commerce R2A command to Stripe outside the transaction. Provider failure leaves participation cancelled and capacity released while the refund moves to an actionable failure state. Replay and Commerce recovery reconcile by receipt and cancellation-decision idempotency keys.

For co-player seats, the snapshot freezes the actual payer and provider reference independently of the participant. Multi-court bookings lock and revise the whole booking group so one customer action cannot partially release a grouped booking.

## Customer and admin surfaces

The same policy projection renders concise Swedish and English pre-purchase, confirmation, My Bookings, preview, and result copy. The confirmation button names the actual consequence, such as `Avboka och få 165 kr tillbaka` or `Avanmäl mig utan återbetalning`.

Admin > Settings > Avbokning & återbetalning provides preset selection, customer preview, immutable-version language, decision history, frozen snapshots, refund status, reason codes, and staff override. Existing purchases show the version they were purchased under.

Organizer hide/cancel is fail-closed when an occurrence has active participants. Admin shows the affected participant count and safely known paid amount. A future organizer batch cancellation workflow must decide participant outcomes explicitly; it is not inferred from customer self-cancellation policy.

## Legacy and cutover

The migration backfills historical terms-bearing records with `legacy/ambiguous` snapshots when exact contractual terms cannot be proven. Those snapshots preserve the former behavior rather than imposing a new stricter preset. Staff can see the provenance. New purchases always require a deterministic snapshot.

Legacy cancellation endpoints are compatibility adapters. They execute Policy V1 only where its material consequence matches the old endpoint. Deliberate policy changes, including co-player automatic refunds and the court-hour cutoff, return `EXPECTED_POLICY_CHANGE` so the preview/confirm UI must be used. Accidental shadow mismatches block cutover.

Useful stage audit queries:

```sql
select provenance, count(*)
from public.cancellation_policy_snapshots
group by provenance
order by provenance;

select subject_type, reason_code, count(*)
from public.cancellation_decisions
group by subject_type, reason_code
order by subject_type, reason_code;

select r.status, count(*)
from public.commerce_refunds r
where r.cancellation_decision_id is not null
group by r.status
order by r.status;
```

## Operations and observability

Trace one cancellation by `cancellation_decisions.id`: snapshot and policy version, subject state, capacity effect, refund command and provider reconciliation, entitlement reversal, actor, and optional staff reason are linked without customer PII in logs.

Staff should investigate:

- old `pending`/`processing` automatic refunds through Commerce recovery;
- `failed` refunds using the stored provider error and incident workflow;
- `manual` outcomes rather than inventing a provider command;
- `policy_snapshot_missing` as a cutover/configuration incident for new sales;
- `legacy_policy_ambiguous` using the former behavior and frozen source facts;
- stale decisions by returning the new preview to the customer, never forcing the old promise.

## Stage release gate

Stage is Supabase `anpxxnpevtxhiajxmfji`, `stage.playpickla.com`, and Stripe TEST only. Before release review:

1. replay all migrations from zero locally, run DB lint, permanent SQL tests, real PostgreSQL concurrency, full Vitest, targeted Edge/Deno checks, candidate-scoped ESLint, build, PWA/Public Web checks, CORS contract, and `git diff --check`;
2. deploy the migration and changed Edge Functions to stage with `--no-verify-jwt`;
3. record stage project identity, migration count, schema fingerprint, and deployed function versions;
4. run the required real stage matrix for both sides of every cutoff, co-player payer separation, money and member-hour court bookings, course, league, both event presets, checked-in/staff override, Policy A/B, delayed webhook, provider failure, duplicate cancellation, and the concurrent final place;
5. record policy resolution, snapshot creation, preview, and confirmation timings;
6. verify production writes, deployments, refunds, and main pushes remain zero.

## Required follow-ups

### Membership cancellation / Stripe subscription correctness

This must separately reconcile local membership status, Stripe subscription status, immediate versus period-end termination, future billing, failure recovery, copy, Admin state, and idempotency. Cancellation Policy V1 does not claim membership coverage.

### Merchandise return policy

Physical return eligibility, return window, item condition, disposition/restock, and consumer-rights handling remain separate from the R2A financial refund state.

### Organizer batch cancellation

Build an explicit audited workflow that previews affected participants and money, selects resolution policy, releases each place exactly once, creates durable refund work where chosen, and reports partial provider failure. Until then organizer cancellation remains fail-closed for populated occurrences.
