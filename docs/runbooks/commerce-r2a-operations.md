# Commerce R2A tracked-merchandise operations

Status: release-candidate runbook; do not use for production until the release gate is approved.

## Safety boundary

Tracked merchandise is additive to canonical Commerce. access_products, commerce_orders, commerce_order_lines, booking_receipts, commerce_receipt_lines, ledger_entries, the existing Stripe Checkout endpoint, and finalize_commerce_payment remain authoritative.

New tracked purchases require both venues.tracked_merch_sales_enabled and product_venue_listings.tracked_sales_enabled. Both are off until explicitly configured. Turning them off blocks only new tracked attempts. It must not stop the webhook, recovery worker, pickup, refund, or disposition routes.

Never:

- release a reservation because a browser returned, a request timed out, or a local timestamp passed;
- edit inventory_levels or inventory_movements directly;
- infer a physical return from a refund;
- redeploy an older payment finalizer while tracked attempts or obligations exist;
- retry an old ambiguous Stripe creation with a new idempotency key.

## Stripe environment contract

Every Commerce provider call and signed webhook is fail-closed across three server-side identities:

- `PICKLA_ENVIRONMENT=stage` requires Supabase project `anpxxnpevtxhiajxmfji` and an `sk_test_` or least-privilege `rk_test_` Stripe key.
- `PICKLA_ENVIRONMENT=production` requires Supabase project `ptnvhbniiiapzbyofctg` and an `sk_live_` or deliberately provisioned `rk_live_` Stripe key.
- local development requires a localhost Supabase URL and a test-mode key.

The signed webhook event `livemode` value must also match the configured key mode before an event is recorded or any Commerce effect is applied. Missing, crossed, or unknown environment identity is an operational configuration failure; do not bypass the guard or infer an environment from frontend variables.

## State and balance model

available_to_sell = on_hand - reserved - allocated.

| Operation | on_hand | reserved | allocated |
|---|---:|---:|---:|
| Receive sellable stock | +q | 0 | 0 |
| Prepare Checkout | 0 | +q | 0 |
| Confirm unpaid provider closure | 0 | -q | 0 |
| Commit paid Checkout | 0 | -q | +q |
| Hand over at Desk | -q | 0 | -q |
| Cancel paid, uncollected, physically present item | 0 | 0 | -q |
| Accept sellable return | +q | 0 | 0 |
| Accept damaged return | 0 | 0 | 0 |

Negative computed availability is valid incident evidence. It is not clamped. The affected level is blocked until physical and movement truth reconcile and an administrator supplies resolution evidence.

## Checkout attempt state machine

| State | Owner | Permitted next state |
|---|---|---|
| prepared | database prepare transaction | provider_creation_unresolved, open, payment_processing, payment_committed, closed_unpaid, attention |
| provider_creation_unresolved | API/recovery worker | open, payment_processing, payment_committed, closed_unpaid, attention |
| open | Stripe/recovery/webhook | payment_processing, payment_committed, closed_unpaid, attention |
| payment_processing | webhook/recovery | payment_committed, attention |
| payment_committed | canonical finalizer | terminal for payment; pickup/refund continue separately |
| closed_unpaid | recovery/expiry webhook with authoritative provider evidence | ordinary terminal; original order remains preserved/cancelled; a later verified paid event atomically reacquires all stock or becomes paid-but-unfulfillable attention |
| attention | recovery/operator | provider reconciliation, refund, or incident resolution; never blind release |

Lock order is order, attempt/command, ordered lines/reservations/allocations, then inventory levels ordered by location and variant. Commands are idempotent and inventory effect identities are unique.

## Recovery worker

Function: api-commerce-recovery. Authentication: x-cron-secret must equal the non-public CRON_SECRET Supabase secret. It has a bounded claim size of 25 and a two-minute lease.

Each run:

1. scans the balance/movement/reservation/allocation reconciliation view;
2. claims due Checkout attempts with FOR UPDATE SKIP LOCKED;
3. retrieves known Sessions or safely reuses the original persisted request/key while younger than 23 hours;
4. finalizes paid Sessions, releases only confirmed expired/unpaid Sessions, or retains open/uncertain stock;
5. claims and reconciles pending/ambiguous refunds in the same bounded manner;
6. opens an operations incident after repeated failures rather than discarding the obligation.

Stripe documents that an idempotency key may be removed after at least 24 hours. The worker refuses blind recreation after 23 hours and requires manual Stripe reconciliation.

Future scheduler setup must occur only after the function, CRON_SECRET, and stage Stripe test credentials are installed and verified. Configure the platform scheduler to POST once per minute to:

    https://<project-ref>.supabase.co/functions/v1/api-commerce-recovery
    x-cron-secret: <secret stored outside source>

Overlap is safe because claims are leased. Monitor non-200 responses and the drain query below.

## Routine Admin operations

### Product setup

1. Create/edit the existing access_products row and choose explicit commerce_kind=merchandise, inventory_policy=tracked, VAT, base price, standalone sale, and desk pickup.
2. Configure the verified legal seller, venue retail location, color/size definitions, and variants/SKUs.
3. Receive an opening physical count with a reason, reference, and unique idempotency key.
4. Confirm balances and variants before enabling the listing. Never invent opening stock in a migration.

### Receiving and physical count

Receiving requires a positive quantity, reason, reference, and idempotency key. A replay returns the original result and appends no second movement.

A physical count sends on_hand and the displayed balance version. A stale version fails. If the count is below reservations plus allocations, the explicit shortage option is required; the correction records physical truth, opens a blocking incident, and preserves all claims.

### Pickup

Desk lists paid standalone obligations even when session_date is null. Each scan hands over one unit through the quantity command. A repeated scan key returns the original outcome. Pending or ambiguous refunds block handover. A succeeded refund reduces collectible entitlement only when its quantity is not already represented by collected units.

### Refund and physical disposition

Refund initiation allocates amount, discount, and VAT from the frozen original line—not the current catalog. Pending/attention is not success. Stripe webhook and worker reconcile money into canonical ledger_entries.

Physical handling is separate:

- no return: no disposition and no stock;
- sellable collected return: return_sellable increases on_hand once;
- damaged collected return: return_damaged records the item but adds no sellable stock;
- paid/uncollected and present: after succeeded quantity refund, uncollected_present reduces allocation only;
- paid/uncollected and missing: uncollected_missing reduces physical count and allocation and opens a shortage incident.

Goodwill refunds never imply quantity or stock.

## Incidents

| Condition | Severity | Blocking scope | Required action/evidence |
|---|---|---|---|
| Paid line lacks valid reservation/allocation | P0 | variant/location sale and pickup | verify Stripe payment, attempt snapshot, physical unit, and allocation/refund resolution |
| Physical shortage | P1 | affected inventory level | physical recount, receiving/correction, and customer-obligation resolution |
| Balance/ledger mismatch | P1 | affected inventory level | compare movements, active reservations, open allocations, and level; repair forward, never edit history |
| Repeated recovery failure | P2 at 5, P1 at 10 | attempt/refund remains held | inspect Stripe account/environment, identifiers, request evidence, and last error |
| External refund without attribution | attention | money recorded; no inferred stock | deliberately allocate to an original line or document goodwill |

Incident resolution requires structured evidence. The database rejects resolution while availability is negative or movement totals differ from balances.

## Disable, drain, and rollback

1. Disable listing tracked sales and, if appropriate, the venue flag.
2. Keep the current webhook, finalizer, recovery worker, pickup, refund, and disposition code running.
3. Honor open Sessions, or explicitly expire each in Stripe and let verified unpaid state release its reservation.
4. Resolve paid allocations by pickup, refund plus uncollected disposition, or documented incident action.
5. Continue refund reconciliation and external-refund allocation.
6. Use compensating commands; do not delete tables or movements.

Drain query:

    select * from public.commerce_r2a_drain_status;

All six values must be zero: unresolved attempts, reserved units, allocated units, unresolved refunds, open inventory incidents, and pickup obligations. Zero open Stripe Sessions alone is not a drain proof.

Reconciliation query:

    select *
    from public.commerce_inventory_positions
    where not reconciled or incident_blocked;

## Future release sequence

Schema and compatible backend first with flags off; transactional/security verification; recovery worker and alerting; Checkout/webhook; standalone pickup; customer/Admin UI; complete stage database and Stripe test-mode gates; staff rehearsal; one seller/venue/location/product pilot; multi-location only after pilot gates pass.
