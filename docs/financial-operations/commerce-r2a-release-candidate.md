# Pickla Commerce R2A implementation candidate report

- Status: local implementation candidate; **NO-GO pending Stripe/stage evidence**
- Prepared: 2026-09-19
- Branch: `codex/commerce-r2a`
- Production mutation authority: none

## 1. Fresh starting SHA

`a8b7ce92c969970c680f22705f601bf82e61abe2`, fetched from `origin/main` before the isolated worktree was created. This equalled the historical audit SHA, so there was no intervening Commerce commit to reconcile at start.

## 2. Final observed origin/main SHA and replay status

Final read-only fetch on 2026-09-19 observed `a8b7ce92c969970c680f22705f601bf82e61abe2`, unchanged from the fresh starting SHA. The candidate is therefore a direct child of that SHA and no upstream replay was required. No remote push is authorized or performed.

## 3. Reconciliation findings

The canonical owners were already `access_products`, `product_relationships`, `commerce_orders`, `commerce_order_lines`, `booking_receipts`, `commerce_receipt_lines`, `ledger_entries`, one `api-commerce` Checkout path, one `api-stripe-webhook`, and `finalize_commerce_payment`. R2A extends those owners. It does not add a merch cart/order/receipt/ledger, Stripe integration, or pricing service. The detailed pre-code map is in `commerce-r2a-contract-reconciliation.md`.

The existing standalone Desk query assumed `session_date`; R2A retains dated activity filtering while including undated standalone pickup obligations. Existing stockless participation, rental, merchandise, add-on, guest/account-later, receipt, VAT, and capacity-hold contracts remain on their existing branches.

## 4. Schema, constraints, indexes, functions, RLS, and grants

Migration: `20260919120000_commerce_r2a_tracked_merchandise.sql`.

Additive product/inventory tables: `product_options`, `product_option_values`, `product_variants`, `product_variant_option_values`, `inventory_locations`, `product_venue_listings`, `inventory_levels`, `inventory_commands`, `inventory_movements`, `inventory_incidents`.

Additive lifecycle tables: `commerce_checkout_attempts`, `commerce_checkout_attempt_lines`, `inventory_reservations`, `inventory_allocations`, `commerce_pickup_commands`, `commerce_refunds`, `commerce_refund_lines`, `commerce_physical_dispositions`.

Extensions: default-off `venues.tracked_merch_sales_enabled`; `access_products.catalog_owner_organization_id` and explicit `inventory_policy`; seller/pickup/attempt/snapshot fields on orders; variant/SKU/tracking/location/quantity-outcome snapshots on order lines. No historical tracked variant, SKU, seller, or stock is invented.

Key uniqueness/guards: normalized organization SKU including archived rows; product option combination; one default active retail location; product/venue listing; one inventory level per variant/location; command and movement effect identities; one unresolved attempt per order; provider environment/account/payment identity; reservation/allocation/pickup/refund/disposition effects; used variant identity immutability; tracking-policy transition guard.

Views: `commerce_inventory_positions` and `commerce_r2a_drain_status`. All new tables have RLS enabled, browser roles are revoked, service role is granted, and security-definer functions use fixed `public, pg_temp` search paths. Browser roles do not receive recovery/system RPC execution.

## 5. Canonical invariants

`available_to_sell = on_hand - reserved - allocated`. Payment converts reserved to allocated but does not remove physical stock. Pickup removes on-hand and allocated. Refund and physical disposition are independent. Unknown provider state never releases stock. Every inventory effect has one immutable movement identity. Existing Commerce remains the sole product/order/price/payment/receipt/ledger truth.

## 6. Transactional commands and lock ordering

Commands cover variant upsert, receiving, correction, incident resolution, tracked prepare/attach/close, recovery claims, payment finalization, pickup, refund preparation/reconciliation, external refund capture, disposition, and reconciliation scanning. The stable order is order, attempt/command, lines/reservations/allocations, then inventory levels ordered by location and variant. Multi-line demand is aggregated and reserved all-or-nothing. Expected versions prevent stale physical counts.

## 7. Checkout-attempt state machine

`prepared -> provider_creation_unresolved|open|payment_processing|payment_committed|closed_unpaid|attention`; `provider_creation_unresolved -> open|payment_processing|payment_committed|closed_unpaid|attention`; `open -> payment_processing|payment_committed|closed_unpaid|attention`; `payment_processing -> payment_committed|attention`. `payment_committed` is terminal for payment. `closed_unpaid` is terminal for ordinary provider processing but a later cryptographically verified paid event is reconciled against the preserved immutable order: all stock is atomically reacquired or financial truth is recorded with paid-but-unfulfillable attention. The attempt freezes order version, line snapshots, seller/location/currency/totals, Stripe request, account/environment/key, expiration, provider IDs, errors, and recovery lease.

## 8. Stripe ambiguity, expiry, retry, and recovery

The API persists and reserves before Stripe, creates the existing Checkout Session outside the transaction with the stored idempotency key/request, then attaches. Ambiguous creation retains stock. Browser return, client timeout, failed card attempt, and local deadline do not release. Authoritative unpaid closure cancels and preserves the original order rather than reopening it; the customer receives a fresh cart, so a late payment cannot overwrite newer lines. Known Sessions are retrieved; an original request/key is retried only inside a conservative 23-hour window; older ambiguity requires manual provider reconciliation. Explicit Checkout expiry is 31 minutes, within Stripe's documented 30-minute-to-24-hour range.

The recovery function claims at most 25 attempts/refunds with two-minute leases, validates environment/account/order/attempt/amount/currency, finalizes paid truth, closes only authoritative unpaid truth, scans reconciliation, and escalates repeated failures. It requires `x-cron-secret`.

## 9. Reservation, allocation, and movement semantics

Receive `(+q,0,0)`, reserve `(0,+q,0)`, release `(0,-q,0)`, payment `(0,-q,+q)`, pickup `(-q,0,-q)`, uncollected-present cancellation `(0,0,-q)`, sellable return `(+q,0,0)`, damaged return `(0,0,0)`. Physical shortage may expose negative computed availability only through the explicit correction path; it preserves claims and blocks work. Movement and balance reconciliation is queryable and incident-producing.

## 10. Quantity-aware fulfillment

Desk reads paid/attention pickup obligations at the authorized venue, including standalone lines with null `session_date`. Tracked lines expose SKU, variant, collected, and remaining quantity; tracked attention orders are visible but pickup-disabled until the allocation incident is resolved. Each pickup command authorizes staff, locks order/line/allocation/level, checks incident/refund conflict, reduces on-hand plus allocated, records one movement/audit effect, and derives partial/full fulfillment. Stockless fulfillment keeps its existing transition function.

## 11. Refund and physical disposition semantics

Refund intent is quantity-based and allocated from immutable original line totals/discount/VAT, not current prices. Pending quantities reserve the refund cap. Provider reconciliation creates canonical refund ledger effects exactly once; external unallocated money is recorded without guessing quantity. Pickup conflicts with transient refund states. Separate append-only dispositions handle sellable return, damaged return, uncollected-present cancellation, and missing stock. Refund never automatically restocks.

## 12. Seller, location, and security boundaries

Catalog owner is the organization; legal seller and inventory owner are existing `franchisees`. A listing publishes one canonical product at a venue without duplicating catalog/price truth. One R2A order must use one active seller, currency, and pickup location whose owner and venue match the listing. Stripe Connect sellers are explicitly rejected in R2A; the supported account key is platform. Staff operations require active venue admin/desk role. Customer catalog projections omit commands, movements, recovery payloads, actors, and internal balances.

## 13. Observability, incidents, and worker operation

Correlation exists across order, attempt, Session/payment/refund, variant/location, reservation/allocation, command/movement, and incident. P0 covers paid-without-reservation/allocation; P1 covers physical shortage and ledger mismatch; repeated recovery failures escalate P2 then P1. Resolution needs structured evidence and is rejected while availability is negative or movement totals disagree. Run/alert/drain instructions are in `docs/runbooks/commerce-r2a-operations.md`.

## 14. Migration/backfill results and unresolved mappings

Fresh replay from all repository migrations through R2A succeeds on local Supabase PostgreSQL 17. The representative legacy Product Engine Release 1 fixture passes unchanged. R2A columns are nullable/defaulted for historical rows, and no historical SKU/seller/stock is fabricated. Actual future production mapping of legal seller, retail location, listings, variants, and opening counts remains a deliberate rollout operation; activation stays blocked until verified configuration exists.

## 15. Legacy Commerce regression results

The final full Vitest run passes **143/143 files and 1,015/1,015 tests**. During reconciliation, one full run found focused source contracts needing additive updates for the new variant-aware cart key in a mock, null-session standalone pickup inclusion, extended Admin product projection, variant-price fallback, and the tracked expiry branch retaining the old participant expiry call. No legacy assertion was deleted or relaxed away from its business guarantee.

Repository-wide ESLint is a pre-existing failing baseline (**1,803 findings: 1,769 errors and 34 warnings**, principally `no-explicit-any`) and is not a clean release gate on `origin/main`. The modified Desk file has the same 55 `no-explicit-any` findings as its `origin/main` version; all other candidate-owned frontend files pass scoped ESLint.

## 16. Real transactional concurrency results

Real PostgreSQL two-connection tests cover normalized-SKU creation, two-plus-two reservations, last-unit oversubscription, correction/reservation in both serializations, overlapping recovery claims and lease recovery, concurrent pickup replay, feature disable, and concurrent refund caps. Winners are intentionally nondeterministic; exact winner count and final balances are asserted. The completed run ends reconciled with no fixture residue.

## 17. Adversarial scenario evidence

See `commerce-r2a-adversarial-results.md`. Database portions pass with exact balances and effect counts. Provider portions are explicitly blocked, not simulated as equivalent.

## 18. Stripe test-mode results

**BLOCKED.** No Stripe test secret or isolated deployed stage was available. No test or live Session/refund was created. Source contracts and Supabase Edge Runtime bundling pass, but they do not substitute for real test-mode lifecycle evidence. This is a critical NO-GO gate.

## 19. Test, lint, typecheck, and build results

- `npm test`: **143 test files / 1,015 tests passed**.
- `npm run test:commerce-r2a`: **2 files / 10 tests passed**.
- `npm run test:commerce-r2a:db`: existing Product Engine, functional R2A, and real two-connection concurrency suites passed; the concurrency matrix recorded all 16 expected contender outcomes and worker claims `1 + 0`.
- `supabase db lint --local --level warning --fail-on error`: no schema errors.
- `npx tsc --noEmit`: passed.
- Candidate-scoped ESLint: passed outside the unchanged Desk baseline; Desk is 55/55 findings on both candidate and `origin/main`.
- `npm run build`: passed, including PWA service worker and public-web budget verification.
- Supabase Edge Runtime v1.74.3: `api-commerce-recovery`, `api-commerce`, `api-stripe-webhook`, and `api-admin` each bundled successfully.
- `npm run lint`: known repository baseline failed with 1,803 findings; this is recorded, not mislabeled as an R2A regression.

## 20. Files changed

- One additive migration, two permanent SQL suites, two focused Vitest suites, and one database test runner.
- `api-commerce`, `api-stripe-webhook`, new `api-commerce-recovery`, availability helper, function config, and stage deploy manifest.
- Variant-aware Commerce types/cart/shop/order UI, minimal Admin tracked-merch operations, and Desk remaining-quantity display.
- Contract reconciliation, operations runbook, adversarial evidence, and this release report.
- Focused legacy source-contract updates that preserve the expanded canonical behavior.

The exact committed list is available with `git show --stat <candidate-sha>`.

## 21. Immutable candidate SHA

Reported in the final handoff after commit creation. A Git commit cannot truthfully contain its own SHA inside its tree; the containing commit object is the immutable identifier.

## 22. Production-unchanged evidence

Actions performed: read-only Git fetch/revision checks, read-only production frontend revision inspection, local dependency install, disposable local Supabase migration/tests, local Edge Runtime bundles, and local source/test/build operations. Actions not performed: production deployment, production migration, production database write, production configuration/secret change, live-mode Stripe mutation, real product creation, real inventory mutation, push, merge, or remote branch publication. Read-only revision checks establish only what was observed; they do not prove absence of unrelated third-party production activity.

## 23. Remaining R2B work

Desk/POS sale creation, Terminal/cash, exchanges, transfers, purchase orders/suppliers, shipping, bins/warehouse, COGS/valuation, franchise settlement, consignment, multi-currency, promotions, merch member pricing, broad reporting, and general RMA remain intentionally out of scope.

## 24. Known limitations and blocked gates

- Real Stripe test-mode success, expiry, post-provider ambiguity, signed duplicate/concurrent webhook, refund, missed-event recovery, and feature-disable/live-Session cases are blocked.
- No isolated deployed stage or scheduled worker was available; worker auth, cadence, alerting, and outage recovery need stage proof.
- Repository-wide `supabase functions serve` has an existing main-worker entrypoint autodetection failure; all four changed/new functions bundle individually in Edge Runtime.
- The local PostgreSQL process crashed once when a test used `SET ROLE authenticated` inside an exception block; after recovery, security evidence uses actual grants/RLS catalogs plus unauthorized staff-RPC execution. A stable isolated stage must run the end-to-end browser-role checks.
- Actual seller/location/catalog/opening-stock configuration is rollout work and deliberately absent.

## 25. Verdict

**NO-GO for release review completion.** The code is a coherent local implementation candidate and the real-database concurrency/financial/inventory gates pass, but mandatory real Stripe test-mode, deployed recovery, and stable end-to-end security evidence are missing. Production must remain unchanged. Once those stage gates pass against this immutable candidate with `livemode=false`, a separate release decision can be made.
