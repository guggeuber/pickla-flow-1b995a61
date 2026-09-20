# Pickla Commerce R2A contract reconciliation

- Status: implementation baseline contract
- Branch: `codex/commerce-r2a`
- Fresh baseline: `origin/main` at `a8b7ce92c969970c680f22705f601bf82e61abe2`
- Reconciled: 2026-09-19

## Purpose

This document fixes the R2A implementation boundary before implementation code is changed. R2A is an additive extension of the existing canonical Pickla Commerce engine. It does not introduce another catalog, order, price, payment, checkout, receipt, VAT, seller, or audit truth.

The pre-implementation comparison found no commit delta between the historical commerce audit baseline and the fresh `origin/main` used by this worktree. Existing contracts below therefore remain the compatibility baseline.

## Ownership map

| Responsibility | Existing canonical owner | Existing callers | R2A additive owner/change | Compatibility obligation | Required verification |
|---|---|---|---|---|---|
| Product identity and base presentation | `access_products` | `api-commerce`, `api-admin`, customer shop, activity flows | Keep `access_products`; add explicit inventory policy and catalog-owner seam | Every existing stockless product behaves unchanged | Existing Commerce SQL/contract tests; stockless purchase regression |
| Brand/catalog ownership | `organizations` plus `venues.organization_id` | Admin/venue setup | Optional `access_products.catalog_owner_organization_id`; mandatory only for new tracked products | Do not infer or rewrite historical legal facts | Migration/backfill assertions; tracked-product validation |
| Legal seller | `franchisees`, selected through `venues.franchisee_id` | Financial foundation and venue operations | Listing and order seller references point to `franchisees`; no new seller table | Historical orders remain valid without a seller snapshot | Seller/listing SQL constraints; seller snapshot tests |
| Venue sale publication | `access_products.venue_id` and product flags | Catalog/admin/customer shop | Add `product_venue_listings` for tracked products so one product/variant truth may be offered by multiple venues | Legacy venue-scoped reads remain valid; listing path is feature gated | Multi-venue listing SQL test; catalog response contract |
| Price | `access_products.base_price_sek`, `activity_sessions.price_sek`, server-side Commerce resolution | `api-commerce`, activity purchase APIs | Optional variant price override in minor units; resolved only on server and frozen on order lines | Activity-session precedence and all stockless pricing stay unchanged; no UI price authority | Price resolution tests; order-line snapshot test |
| Product options and variants | Not present | None | Normalized option, option-value, variant, and variant-option tables | No fake unrelated products; archived variants retain identity and SKU uniqueness | Combination uniqueness, required-option coverage, archived-SKU reuse rejection |
| SKU | Not present | None | Organization-scoped, normalized, immutable-after-use SKU on `product_variants` | No SKU is required for historical stockless lines | Case/whitespace uniqueness and immutability tests |
| Inventory location | Venue is the physical operational scope; no stock location model | None | `inventory_locations`, owned by venue and canonical franchisee seller | Does not reuse court/time availability tables | Ownership/default-location constraints |
| Inventory quantity | No merchandise stock model | None | `inventory_levels` with `on_hand`, `reserved`, `allocated`; availability is derived | Never convert legacy capacity/booking holds into stock | Conservation and negative-availability incident tests |
| Inventory event history | `audit_log` and `ops_incidents` are platform-wide evidence/incident owners | Admin/operations | Immutable `inventory_movements`, structured `inventory_incidents`, and audit/ops links | No mutable balance-only path | Movement immutability, command idempotency, audit tests |
| Cart and order identity | `commerce_orders` in `draft` state | `api-commerce`, customer cart | Keep the same order; add seller, pickup, attempt, and tracked state references | Existing anonymous/authenticated cart merge/version rules remain | Existing R1B concurrency tests plus tracked-cart tests |
| Order lines | `commerce_order_lines` | Catalog/cart/checkout/webhook/receipts | Add variant/SKU/inventory/pickup snapshots and quantity outcomes | Existing lines remain readable and financial truth is immutable | Snapshot and quantity conservation tests |
| Checkout preparation | `api-commerce` plus `freeze_commerce_order` | Customer checkout | Durable `commerce_checkout_attempts` and attempt lines; atomic stock reservation before Stripe creation | Stockless checkout remains on its established path | Retry/timeout/duplicate-attempt tests |
| Stripe session creation | `api-commerce` calls Stripe Checkout | Customer checkout | Persist a frozen request and idempotency key before the call; persist provider result; never blindly recreate ambiguous attempts | Same Stripe account/environment rules and no duplicate Checkout engine | Function contract tests; real Stripe test-mode gate when credentials exist |
| Payment finalization | `finalize_commerce_payment` is the canonical DB finalizer | `api-stripe-webhook` | Extend that function to convert tracked reservations to allocations in the same transaction | One finalizer and existing receipt/ledger semantics | Duplicate/out-of-order webhook tests; DB concurrency gate |
| Expiry/recovery | Existing checkout expiry is not a durable inventory workflow | Webhook only | Bounded recovery worker and authoritative provider reconciliation | Never release stock on timeout alone; release only after provider proves unpaid/expired | Worker lease, stale-event, retry, and ambiguous-state tests |
| VAT | VAT snapshot fields on products/order lines/receipts; SEK VAT-inclusive | Commerce finalizer/receipts | Reuse existing VAT resolver and frozen line VAT; refunds allocate from original line truth | No separate merchandise VAT calculator | Rounding and partial-refund tests |
| Receipt and financial ledger | `booking_receipts`, `commerce_receipt_lines`, `ledger_entries` | Finalizer/admin financial reads | Reuse originals; refund rows and ledger entries reference original truth | Original receipt remains immutable | Payment/refund idempotency and allocation tests |
| Pickup fulfillment | `transition_commerce_fulfillment` and Commerce admin fulfillment route | Admin/Desk | Quantity-aware tracked pickup command; stockless transition remains intact | Standalone stockless pickup bug may be fixed without changing activity semantics | Partial/full pickup, retry, cross-location tests |
| Refund | Existing Stripe refund/reconciliation paths and ledger semantics | Admin/Stripe webhook | Durable refund command/line allocation against original order lines | A refund does not imply a physical return | Partial/full/external refund and duplicate-event tests |
| Return/disposition | Not present | None | Separate physical disposition command: sellable return, damaged write-off, or no return | Must never be inferred from refund status | Post-refund disposition tests and inventory movement proof |
| Operational incident | `ops_incidents` | Admin operations | Structured inventory incident links to an `ops_incidents` record and blocks unsafe availability | Existing incident model remains the operator-visible root | Negative availability and resolution tests |
| Audit | `audit_log` | Admin/platform operations | Every inventory, pickup, refund, disposition, and recovery command emits canonical audit evidence | Existing audit records and readers remain valid | Actor/idempotency/audit coverage tests |

## Canonical invariants for R2A

1. `available = on_hand - reserved - allocated` at one variant and one inventory location.
2. Reservation is created atomically with a durable checkout attempt, before Stripe session creation.
3. A successful payment moves the reserved quantity to allocated quantity in the same transaction as the existing canonical Commerce payment finalizer.
4. Pickup reduces both `on_hand` and `allocated`; a retry cannot reduce either twice.
5. A refund changes financial truth only. Physical quantity changes only through a separate disposition command.
6. No timeout, network exception, or unknown provider state releases inventory. Only authoritative Stripe state or an explicitly reconciled terminal result may close an unpaid attempt and release its reservation.
7. Negative availability is never silently clamped. It creates/block-surfaces an inventory incident.
8. A tracked product is merchandise, standalone-only, desk-pickup-only in R2A. Tracked activity add-ons are rejected by database and API authority.
9. SKU uniqueness is organization-wide after normalization and includes archived variants. An identity used by an order line is not editable or reusable.
10. Product, seller, variant, price, VAT, and pickup facts needed for historical interpretation are snapshotted onto the existing canonical order/order-line truth.

## Deliberate model choices

### Seller

`franchisees` already represents the venue operator/legal entity and carries legal name, organization number, payout currency, and future Stripe account identity. R2A references it from listings, inventory ownership, checkout attempts, and orders. A second seller/legal-entity table would split truth and is prohibited.

### Catalog ownership and multi-venue listings

`access_products` remains the canonical product row. Its required legacy `venue_id` remains the home/admin venue so old reads do not break. New tracked products additionally identify a catalog-owning organization. `product_venue_listings` publishes the same product and variants at one or more venues and selects the legal seller and default pickup/stock location. It contains no duplicate title, description, image, VAT, or base price.

### Variant pricing

The canonical base price remains on `access_products`. A variant may carry a nullable price override in integer minor units. The server resolves session-specific price first where relevant, then variant override for standalone tracked merchandise, then product base price. The resolved price and VAT are frozen on the existing order line. UI values are display-only.

### Inventory and reservations

Court/time availability, activity capacity, and `capacity_holds` are participation inventory and are not merchandise stock. R2A adds dedicated merchandise stock tables. Balance mutations occur only through database commands that lock rows in stable order and write immutable movement records.

### Checkout attempts and Stripe idempotency

Each attempt has a persisted idempotency key, frozen request, provider environment/account, lease/recovery state, and provider identifiers. At most one nonterminal attempt exists for an order version. Stripe documents that idempotency records may be removed after at least 24 hours; therefore an old ambiguous attempt is recovered by provider identifiers/state and is never recreated merely by reusing its key. Checkout expiration is explicitly persisted and kept within Stripe's supported 30-minute-to-24-hour interval.

### Refund and return separation

R2A records refund commands and deterministic per-line amount/VAT allocation. External refunds that cannot be fully attributed remain visible as unallocated financial exceptions. Restocking is a later explicit disposition against refunded quantity; damaged/no-return outcomes are equally explicit.

## Known baseline discrepancy fixed within scope

The current standalone fulfillment query requires a session date even though standalone order lines have no session date. R2A will remove that assumption for standalone orders while preserving date-scoped activity fulfillment. This is a query/command correction over the existing order truth, not a second fulfillment model.

## Feature and rollout boundary

Tracked merchandise sales require all of the following: product `inventory_policy = tracked`, a valid active venue listing, a valid seller and pickup location, listing sales enabled, and `venues.tracked_merch_sales_enabled = true`. The venue flag defaults to `false`. Stockless Commerce remains enabled by its current controls and cannot be disabled by the R2A flag.

## Environment gate status at reconciliation time

- Fresh source baseline: available and reconciled.
- Production mutation/deployment: expressly prohibited and not performed.
- Usable staging project: absent according to `docs/staging.md`.
- Local Supabase: unavailable because the Docker daemon is not running at reconciliation time.
- Stripe test secret: absent.
- Recovery worker secret: absent.

Implementation, static verification, unit/source-contract tests, and documentation may proceed. Claims requiring real PostgreSQL competing connections, real Stripe test mode, or a deployed recovery schedule remain release blockers until those environments are provided and the gates are run. Mocked or source-only tests do not satisfy those gates.

## Sources used for provider constraints

- Stripe idempotent requests: <https://docs.stripe.com/api/idempotent_requests>
- Stripe Checkout limited-inventory expiration guidance: <https://docs.stripe.com/payments/checkout/managing-limited-inventory>
- Stripe Checkout Session expiration API: <https://docs.stripe.com/api/checkout/sessions/expire>
