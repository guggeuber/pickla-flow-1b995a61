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
- Rollback path is known: revert frontend commit, redeploy previous functions, and apply DB fix-forward if a migration caused issues.
- Support corrections are done through admin tools or explicit SQL notes, never ad hoc hidden edits.
- Daily opening and closing checks exist for desk, paddor, Stripe, bookings, and memberships.

References:

- [observability-and-ops-agent.md](./observability-and-ops-agent.md)
- [launch-runbook.md](./launch-runbook.md)
- [support-runbook.md](./support-runbook.md)
