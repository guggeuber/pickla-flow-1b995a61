# Commerce R2A adversarial acceptance results

- Run date: 2026-09-19 (Europe/Stockholm)
- Database: disposable local Supabase PostgreSQL 17 at `127.0.0.1:54322`
- Provider credentials: no Stripe test secret was available
- Production: not used

## Evidence classes

- **DB PASS** means PostgreSQL functions ran against the migrated disposable database. Concurrency cases used two independent `dblink` connections and real row/index locks.
- **SOURCE PASS** means the Edge Runtime bundled the changed function or a source-contract/unit test passed. It is not provider evidence.
- **BLOCKED** means the required Stripe test-mode or deployed-stage evidence could not be produced. No mock is counted as equivalent.

Permanent executables:

- `supabase/tests/product_engine_release_1.sql`
- `supabase/tests/commerce_r2a_tracked_merchandise.sql`
- `supabase/tests/commerce_r2a_concurrency.sql`
- `src/test/commerceR2A.test.ts`
- `src/test/commerceR2AEdgeContracts.test.ts`

## Stage-by-stage result

| # | Scenario | Expected | Actual evidence | Result |
|---:|---|---|---|---|
| 1 | Receive five Black/M; replay receive | `5 / 0 / 0 / 5`; one movement | `5 / 0 / 0 / 5`; replay returned `replayed=true`; one receive movement | DB PASS |
| 2 | A/B reserve two each, C/D race final unit | after A/B `5 / 4 / 0 / 1`; then `5 / 5 / 0 / 0`; one final-unit loser | both A/B succeeded; exactly one of C/D succeeded and the other returned `sold_out`; no sixth unit | DB PASS, two connections |
| 3 | B provider creation ambiguous | keep two reserved; reuse one attempt/key; one worker claim | state became `provider_creation_unresolved`; attempt replay returned same attempt; overlapping workers claimed `1 + 0`; reservation stayed held | DB/fault-injection PASS; real post-creation Stripe ambiguity BLOCKED |
| 4 | Expire winning one-unit checkout | local time changes nothing; verified closure releases once; A/B state `5 / 4 / 0 / 1` | no local release; authoritative close produced one release movement and replay had no second effect | DB PASS; real Stripe expiry BLOCKED |
| 5 | Pay A quantity two | intermediate `5 / 2 / 2 / 1`; one receipt, sale ledger, allocation effect | canonical finalizer produced one receipt, one `commerce_order` ledger row, one payment-commit movement; duplicate finalization returned `already_finalized=true` | DB PASS; actual Stripe payment/webhook BLOCKED |
| 6 | Paid stock remains physical; conclusively close B | final `5 / 0 / 2 / 3` | payment retained on-hand; B remained held through ambiguity and released only through explicit conclusive-unpaid closure | DB PASS; provider recovery BLOCKED |
| 7 | Partial pickup and concurrent replay | `4 / 0 / 1 / 3`; one collected, one remaining; replay has one effect | two simultaneous uses of the same pickup key both returned safely; exactly one pickup movement; `4 / 0 / 1 / 3` | DB PASS, two connections |
| 8 | Duplicate/reordered webhooks | one financial/inventory effect; webhook-before-attach safe | duplicate finalizer and payment-before-attachment branches produced one receipt/ledger/movement; later attach retained `payment_committed` | DB PASS/SOURCE PASS; concurrent HTTP webhook delivery with Stripe signatures BLOCKED |
| 9 | Refund collected unit without return | inventory remains `4 / 0 / 1 / 3`; money once | quantity refund reconciled twice with one financial ledger effect; no inventory movement until disposition | DB PASS; real Stripe partial refund BLOCKED |
| 10 | Later sellable return | `5 / 0 / 1 / 4`; duplicate no effect | one sellable-return movement and one on-hand increment; repeated disposition key replayed | DB PASS |
| 11 | Collect second, damaged return, refund | after pickup `4 / 0 / 0 / 4`; damaged return leaves same | final balance `4 / 0 / 0 / 4`; damaged disposition recorded without on-hand change; two partial refunds total original `59,800` minor units | DB PASS; real Stripe refund BLOCKED |
| 12a | Correction wins against three-unit reservation | correction to two succeeds; reservation fails | correction committed first; reservation returned `sold_out`; state `2 / 0 / 1 / 1` | DB PASS, two connections |
| 12b | Reservation wins against correction | reservation succeeds; stale count fails; explicit shortage becomes `2 / 3 / 1 / -2` and blocks | reservation committed; correction returned `stale_inventory_version`; explicit shortage exposed `-2`, preserved claims, blocked, then released/reconciled/resolved with evidence | DB PASS, two connections |
| 13 | Stop/recover worker | no blind release; one lease; expired lease reclaimable; eventual idempotent outcome | overlapping lease claim `1 + 0`; forced lease expiry was reclaimed; ambiguous stock stayed held until explicit provider-conclusive close | DB PASS/fault injection; deployed scheduler/provider outage recovery BLOCKED |
| 14 | Disable feature with obligations | new tracked sale fails; existing pickup/recovery/refund remains operable | new prepare returned `tracked_merch_sales_disabled`; second paid pickup completed; recovery/refund commands are not flag-gated | DB PASS; actual open Stripe Session servicing after disable BLOCKED |

Balance notation is `on_hand / reserved / allocated / available_to_sell`.

## Additional permanent regression evidence

- Eight Classic Tee combinations exist in one product truth with normalized organization-scoped SKUs.
- The same Black/M variant has independent balances at two locations under one seller.
- A concurrent case-insensitive SKU creation race permits exactly one winner.
- Duplicate demand for one variant/location is aggregated before reservation.
- A two-line order with an unconfigured second variant rolls back the first reservation and all movements.
- A late verified payment after conclusive unpaid closure reacquires the complete original reservation and allocates it exactly once when stock remains; when another attempt owns the stock, no claim is stolen and one receipt/ledger effect plus paid-but-unfulfillable incident is recorded.
- Null price override falls back to 299 SEK; a non-null override is selected; zero remains distinct and every zero-priced tracked line is rejected at authoritative prepare.
- Two shirts at 299 SEK and 25% VAT freeze to total `59,800`, VAT `11,960`, ex-VAT `47,840` minor units. One shirt is 59.80 SEK VAT and 239.20 SEK ex-VAT.
- Used SKU/option identity is immutable; archive remains available; movements/dispositions reject update/delete.
- Unauthorized staff commands fail and browser roles have no direct mutation or recovery-RPC privileges.
- Reconciliation scanning opens a blocking incident and refuses resolution until balances match immutable movement totals.
- Existing Product Engine Release 1 SQL remains green.

## Missing evidence and release implication

No `STRIPE_SECRET_KEY` for test mode, webhook-signing test secret, deployed isolated stage, or scheduler secret was present. The following critical claims therefore remain **BLOCKED**: actual Session creation/expiry, a response-loss ambiguity after Stripe has created the Session, signed concurrent webhook delivery, successful and partial Stripe refunds, missed-event provider recovery, and live-Session servicing after feature disable. Per the acceptance rules, the release gate is **NO-GO** until those cases run with `livemode=false` in an isolated stage and their database effects match this report.
