# Pickla Production Readiness

This is the launch spine for Pickla soft launch. The goal is controlled production with real payments, not a broad public launch.

## Launch Mode

- **Launch type:** soft launch with real customers and real payments.
- **Environment:** production plus a separate stage Supabase project and Vercel stage app.
- **Compliance:** lean GDPR pack before launch, formal external review later.
- **Feature rule:** no new large product surfaces until the gates below are green.

## Gate 1: Memberships

Pass criteria:

- Admin can create, edit, hide, publish, and manually assign tiers.
- `is_active` means public/sellable. `is_assignable` means staff can assign it manually.
- Founder benefits are configured through `membership_entitlements`, not hardcoded business promises:
  - `court_hours_per_week`
  - `open_play_unlimited`
  - `guest_day_vouchers_monthly`
- Court-hour usage is based on active bookings, so cancelled bookings release allowance.
- Founder overage price comes from `membership_tier_pricing` for `court_hourly`.
- `/my` shows the active membership name and benefits in the membership area.
- Guest vouchers are shown separately from membership court-hour usage.

Manual smoke:

- Founder books 1 court for 60 min with allowance left: price is `0 kr`.
- Founder books multiple courts: usage is `durationHours * courtCount`.
- Founder exceeds allowance: only overage is paid at tier pricing.
- Founder cancels: allowance is available again and courts are bookable.
- Hidden Founder tier can still be assigned if `is_assignable = true`.

## Gate 2: Products And Schedule

Pass criteria:

- `access_products` is the price/logical product source for day access, Open Play, group training, vouchers, and booking-related products.
- `activity_series` describes recurring programs.
- `activity_sessions` describes concrete schedule slots.
- Events are for planning, partner/customer production, and larger activations.
- Ordinary weekly activities are not duplicated as heavy `events`.

Manual smoke:

- Open Play session can be listed, purchased or joined through membership.
- Group training can be listed and purchased.
- A product price change affects the customer flow expected for that product.
- Open Play with Studentpris selected (59 kr) and both inclusion toggles off stays 59 kr for guest, Play, Play+, and Founder after save and reload, unless Studentpris has an explicit membership price; normal Open Play still honors its configured benefits.
- A paused/cancelled series does not appear as active customer inventory.

## Gate 3: Stripe And Payments

Pass criteria:

- Stripe Checkout works for court booking, multi-court, day/session purchase, and membership.
- Free entitlement paths bypass Stripe and still create correct booking/access records.
- Stripe webhook is idempotent and does not double-book courts.
- Receipts show `0 kr` for free/corporate/entitlement bookings.
- Receipt snapshots exist for new paid grouped bookings.
- Refund and cancellation handling has a manual staff routine.

Manual smoke:

- Paid court booking creates booking rows, shared chat/group, receipt, and `/my` detail.
- Multi-court paid booking charges the sum and creates one receipt group.
- Failed/abandoned Stripe session does not reserve courts.
- Webhook replay does not duplicate bookings or receipts.

## Gate 4: Customer Data And Compliance

Pass criteria:

- Privacy policy, terms, processor list, and data map are published or ready to publish.
- Staff know how to handle export, deletion, support correction, and incidents.
- Customer data collection is limited to data required for booking, payment, membership, support, and venue operations.
- Payment card data remains in Stripe; Pickla stores only Stripe ids and card display metadata where needed.

Reference: [data-and-compliance.md](./data-and-compliance.md)

## Gate 5: Desk And Daily Operations

Pass criteria:

- Desk can run a full venue day: opening, walk-ins, bookings, check-ins, Open Play, membership, cancellation, refunds, device issues, and closing.
- Staff have a short exception routine for common issues.
- Device/padda pages are stable enough for kiosk use.

Reference: [daily-operations-runbook.md](./daily-operations-runbook.md)

## Gate 6: Security

Pass criteria:

- Admin and staff access is least-privilege by venue.
- Sensitive edge endpoints authenticate manually because functions are deployed `--no-verify-jwt`.
- Public display/device endpoints expose only data intended for kiosks or TVs.
- Prod and stage secrets are separate.
- Temporary staff/admin access has an owner and expiry/removal routine.

Reference: [security-checklist.md](./security-checklist.md)

## Gate 7: Stage

Pass criteria:

- Stage has separate Supabase project, Vercel deployment, Stripe test mode, and Resend/test email setup.
- Stage is seeded with one realistic venue, courts, products, schedule, Founder tier, staff user, and test customers.
- Stage can run the full smoke test without touching production data.

Reference: [staging.md](./staging.md)

## Gate 8: Observability, Rollback, And Support

Pass criteria:

- `npm run prod:check` passes before release candidates.
- Full `npm run lint` is a known pre-existing debt gate; run targeted lint for touched files until the legacy lint backlog is cleaned up.
- Edge deploy list is written down for every backend change.
- Stripe webhook failures and Supabase function errors are checked after deploy using the Ops Agent 15-minute watch.
- Incident severity is classified as P0, P1, P2, or P3 before fixes are made.
- Every production incident records affected route/function, venue, user/customer, booking/payment ids, containment, fix, and verification.
- `/ops` is available to admins and stores shared signals/checks/incidents in DB, not browser-only state.
- Ops Agent automatic checks update health signals for payments, bookings, memberships, check-in, devices, score, and mail.
- Rollback path is known: revert frontend commit, redeploy previous functions, and apply DB fix-forward if a migration caused issues.
- Support corrections are done through admin tools or explicit SQL notes, never ad hoc hidden edits.
- Daily opening and closing checks exist for desk, paddor, Stripe, bookings, and memberships.

References:

- [observability-and-ops-agent.md](./observability-and-ops-agent.md)
- [launch-runbook.md](./launch-runbook.md)
- [support-runbook.md](./support-runbook.md)

## Gate 9: PWA Frontend Version Convergence

Pass criteria:

- `npm run prod:check` proves that the generated deployment identity is shared by `version.json`, the main JavaScript bundle, the service worker, and the dynamic release Function input.
- `/api/release` is the only authoritative release source and must be a dynamic, correlated, no-store response. Static `version.json` is diagnostic only; content-hashed assets remain immutable.
- Verify `/api/release` has no positive `Age`, never returns `x-vercel-cache: HIT|STALE`, echoes a unique request ID, and reports the exact Vercel deployment ID before promotion.
- A modern client converges to a new build with at most one safe reload per target SHA.
- Auth, Stripe, confirmation, booking, membership, and unsaved-form flows defer reload until a safe route or lifecycle retry.
- A legacy client that cannot understand the current message contract is recovered by service-worker `WindowClient.navigate()` only on a safe same-origin URL.
- Convergence diagnostics contain build identity and reason, but no customer, auth, session, query-string, or payment data.
- The Customer, Desk, and Admin multi-PWA split remains blocked until telemetry and physical iOS Home Screen verification are green.

Manual stage smoke:

- Install build A on an iPhone Home Screen, leave it resident, deploy build B to stage, then reopen it after a long idle period.
- On a safe route, verify one convergence navigation/reload and confirm that `/my` shows build B's short SHA and UTC timestamp.
- Repeat while an auth callback, Stripe test checkout, confirmation route, and dirty form are active; verify that no reload happens until the flow is safe.
- Repeat offline and return online; verify no reload loop and eventual convergence.
- Verify a legacy/pre-contract build opened on a safe route is navigated by the new service worker without relying on old JavaScript.

Reference: [pwa-version-contract.md](./pwa-version-contract.md)

## Gate 10: Authenticated Today Pricing

Pass criteria:

- An authenticated user sees no actionable Today activity until the atomic `today-personalized` read model has returned schedule truth and a canonical personal price for every included session occurrence.
- Anonymous Today remains on the cacheable `today-primary` read; private Today responses are `no-store` and account-, generation-, and frontend-build-scoped in React Query.
- One request snapshots products, day access, membership, tier rules, host assignments, and bounded occurrence facts before the shared pricing resolver runs. The request accepts at most 24 visible occurrences.
- Opening a drawer from Today reuses its still-fresh exact occurrence decision without another personalized-pricing request. A direct link resolves its own decision once.
- Membership, day-access, and activity-registration changes invalidate both Today and drawer personalized state. Checkout still resolves the canonical price again and rejects a changed quote.
- Auth or pricing failure shows a neutral retry state; it never falls back to a public or list price for an authenticated account.

Release order and stage smoke:

- Apply `20260913130000_bounded_activity_pricing_facts.sql`, reload the PostgREST schema, then deploy `api-event-public --no-verify-jwt` before releasing the frontend.
- Verify first actionable Today prices for a non-member (`165 kr`), Play (`99 kr`), Play+ (`Ingår`), and active day access (`Ingår`) against stage fixtures.
- Confirm one `today-personalized` request and no `today-primary` or retired personalized batch request for an authenticated first render; then open the same activity drawer and confirm zero additional personalized requests.
- Activate/cancel access and confirm the next Today request uses a new generation and replaces the prior price. Complete one Stripe test checkout and one included-access registration to confirm checkout authority and fulfillment remain unchanged.
- Record `authenticated-today-personalized-timing` diagnostics, including total time, schedule time, access-snapshot query count, occurrence count, and resolver count. Do not promote until the stage latency and physical iOS PWA checks meet the release budget.

## Gate 11: Cancellation Policy V1

Pass criteria:

- Every new migrated sale freezes a deterministic, immutable cancellation-policy snapshot. Missing policy configuration fails the new sale closed.
- Customer preview and confirmation use one server-authoritative decision. A changed decision returns `409` and requires confirmation of the new consequence.
- Accepted cancellation releases participation/capacity exactly once before any provider call. Refund failure never resurrects participation.
- Automatic refunds use the existing durable Commerce R2A machinery and reconcile idempotently to the frozen payer/payment provenance.
- Checked-in customer self-cancellation is blocked; staff override is explicit, scoped, reasoned, and audited.
- Organizer hide/cancel fails closed while active participants remain and reports affected participant count and safely known paid amount.
- Existing ambiguous records retain explicit legacy behavior; new terms are never fabricated for historical purchases.
- Membership subscription cancellation, merchandise returns, and organizer batch resolution remain named separate follow-ups.

Release order and stage smoke:

- Apply `20260922120000_cancellation_policy_v1.sql`, reload the PostgREST schema, then deploy `api-cancellations`, `api-commerce`, `api-commerce-recovery`, `api-bookings`, `api-stripe-webhook`, and `api-admin` with `--no-verify-jwt` before releasing the frontend.
- On stage `anpxxnpevtxhiajxmfji` with Stripe TEST, certify both sides of the 12h, 24h, 48h, and league-close boundaries, both event presets, co-player payer separation, entitlement restoration, checked-in blocking/staff override, Policy A/B snapshots, delayed/failed refunds, duplicate confirmation, and concurrent final-place replacement.
- Record stage identity, migration/schema/function evidence, provider objects, timings, shadow mismatches, ambiguous legacy count, and zero production writes.

Reference: [cancellation-policy-v1.md](./cancellation-policy-v1.md)
