# Product Engine Release 1

Status: implemented locally, disabled by default, not deployed.

## Scope

Release 1 introduces one canonical commerce transaction for activity participation, rentals, and pickup-only merchandise:

`commerce_order (draft cart) -> commerce_order_lines -> Stripe Checkout -> booking_receipt + commerce_receipt_lines -> one ledger_entry`

The naming is deliberate:

- `access_products.commerce_kind` is the canonical commerce classification.
- `access_products.product_kind` remains a compatibility access subtype while legacy flows exist.
- `commerce_order_lines.commerce_kind` is the immutable purchase-time snapshot.
- `commerce_receipt_lines` is general because a receipt can mix participation, rentals, and merchandise.

There is no separate cart table. A cart is a `commerce_orders` row with `status = 'draft'`.

## Activation

All seeded products have both `is_active = false` and `commerce_enabled = false`. Existing products are backfilled with a commerce classification where it is unambiguous, but remain commerce-disabled.

An activity uses Commerce only when its resolved `access_products` row is active and has `commerce_enabled = true`. Otherwise the existing activity checkout remains unchanged.

Pilot activation order:

1. Configure and activate the rental/merchandise products.
2. Configure VAT on every product.
3. Add an active `offered_with` relationship from the pilot activity product to the rental.
4. Enable Commerce on the pilot activity product last.

## Financial Truth

- The client submits product IDs, quantities, and session references only.
- `api-commerce` reloads products and resolves every price server-side.
- VAT is frozen per line from product configuration.
- The payment RPC creates one receipt, one set of immutable receipt lines, and exactly one ledger row.
- Pickup transitions never write ledger rows.
- A paid capacity conflict keeps the receipt and ledger payment truth, marks delivery `attention`, and creates the existing R2 operations incident. It does not create a delivered Play Right.

For the verification order:

| Line | Inc VAT | VAT |
| --- | ---: | ---: |
| Open Play | 165 SEK | 6% |
| Rental racket | 50 SEK | 6% |
| Pink Pickla Bag | 200 SEK | 25% |
| Total | 415 SEK | line-derived |

## Guest Identity

Guest merchandise checkout uses a 256-bit random token stored only as SHA-256. Payment email resolves or creates a canonical Customer Master record and an unverified email identity. It never creates `auth.users`, never creates `player_profiles`, and never marks email verified.

The emailed receipt token is separately hashed and read-only. It exposes only the scoped order, receipt lines, and pickup state. It cannot edit the cart or invoke checkout.

## Fulfillment

Pickup lines use:

- `pending_pickup`
- `collected`
- `not_collected`
- `attention`

Desk transitions use `transition_commerce_fulfillment`, which updates the line and writes `audit_log` in the same transaction.

## Compatibility Paths

These paths intentionally remain outside Commerce in Release 1:

| Flow | Current path | Decommission milestone |
| --- | --- | --- |
| Court booking | `api-bookings/create-checkout` | Commerce Release 2 after booking-group and participant payment mapping is approved |
| Membership | `api-bookings/create-checkout` subscription mode | Commerce Release 3 after recurring-order semantics are approved |
| Legacy day pass | `api-bookings/create-checkout` / day-pass functions | Commerce Release 2 after share/claim compatibility is verified |
| Activity without flag | existing activity ticket path | Remove after one controlled Open Play pilot reconciles receipt, ledger, R2, ticket, and pickup |

No new purchase should be added to a compatibility path. New one-time products belong in Commerce.

Release 1 permits one participation line plus any supported rental and merchandise lines in an order. Multiple participation lines in one Stripe Checkout are deferred until R2 can attach one checkout to several independent capacity holds without weakening atomic capacity truth.

## Verification

After `supabase db reset`:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/product_engine_release_1.sql
```

The test transaction proves mixed VAT, stale-version rejection, frozen order/lines, duplicate finalization idempotency, guest checkout without an Auth user, one receipt, one ledger entry, three receipt lines, and audited pickup.

## Production Order

1. Apply `20260712140000_product_engine_release_1.sql` manually in Supabase SQL Editor.
2. Run `NOTIFY pgrst, 'reload schema';`.
3. Deploy `api-commerce --no-verify-jwt`.
4. Deploy `api-stripe-webhook --no-verify-jwt`.
5. Deploy `api-bookings --no-verify-jwt`.
6. Deploy `api-admin --no-verify-jwt`.
7. Deploy frontend.
8. Verify all Commerce flags remain off.
9. Configure one pilot and enable its activity product only after smoke checks.

## Rollback

Before pilot activation, rollback is configuration-only: keep `commerce_enabled = false` and restore the previous Edge Function/frontend revisions.

After paid Commerce orders exist, do not drop tables or columns. Disable all Commerce products, restore application revisions, and retain order/receipt/ledger history. A later additive migration may remove unused runtime objects only after retention requirements are reviewed.
