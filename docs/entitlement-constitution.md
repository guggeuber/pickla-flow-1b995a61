# Entitlement Constitution

This document defines the participation-right boundary. It is a domain model,
not a customer feature and not a payment implementation.

## Invariants

1. An entitlement is a person/customer-owned right to participate. Its scope,
   meter, validity, funder and consumption policy are independent properties.
2. `funder` is canonical and explicit. `funding_type` records issuance
   provenance and must never be used to infer the funder.
3. Buying an entitlement creates deferred revenue. Consuming an entitlement
   recognises revenue for the consumed service. Consumption history is
   append-only; corrections append reversals.
4. Stored Value never grants participation. It is a monetary balance only.
5. Payment Sources never create rights. Cards, invoices, wallets and partner
   settlement rails can fund a transaction, but only entitlement issuance
   creates a participation right.

## Canonical properties

- Funders: `self_prepaid`, `subscription`, `house_comped`, `partner`,
  `employer`, `sponsor`.
- Consumption triggers: `on_checkin` (default), `on_commitment`,
  `on_session_end`.
- No-show policy is explicit: `do_not_consume` (current production behavior),
  `consume`, or `manual_review`.
- Occurrence origins: `paid`, `promotional`, `house_comped`, `legacy_import`.
- Structured scope axes: brand, venue(s), activity formats, series, channels
  and validity. Existing simple scopes remain valid inputs to the normalized
  scope model.

v1.1 stores non-check-in trigger and no-show policy choices but does not execute
them. Production behavior remains `on_checkin` plus `do_not_consume`.

## Resolver policy

Resolver order is stored on the entitlement instead of being derived from its
type at decision time. The v1 production ranks are frozen during migration:

1. Exact session / booking access — 10
2. Membership access — 20
3. Day access — 30
4. Punch card — 40
5. Partner access — 50
6. Other — 60

The model also carries scarcity class, origin priority and an optional expiry
sort timestamp. Their defaults preserve the v1 order. They prepare a future,
separately approved policy for non-scarce before scarce, promotional before
paid and earliest expiry first; v1.1 does not turn that policy on globally.

## Partner reimbursement history

At partner-funded consumption, the immutable consumption row freezes:

- partner program and external partner reference;
- reimbursement rate and currency;
- agreement version;
- agreement effective date.

Receivable events read the frozen consumption snapshot. Editing a partner
agreement later cannot alter historical reimbursement.

## Deliberate exclusions

This foundation adds no Bruce UI, Epassi flow, punch-card UI, Stored Value or
Payment Source. Those require separate product decisions and cannot bypass the
entitlement boundary above.
