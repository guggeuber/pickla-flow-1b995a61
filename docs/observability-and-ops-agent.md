# Observability And Ops Agent

This is Pickla's lightweight operations layer for soft launch. It is not a full monitoring stack yet. It is a clear human and agent routine for catching issues early, especially around payments, bookings, memberships, devices, and staff operations.

## Ops Center

The first operational UI lives at:

```text
/ops
```

V1 is protected by normal auth plus admin access and shows:

- overall green/yellow/red production status
- live admin metrics from existing admin endpoints
- manual health signals for payments, bookings, memberships, check-in, paddor, score, mail/auth, and deploy
- deploy/opening/closing/weekly checklists
- local incident log with P0-P3 severity

V1 stores status, checks, and incidents centrally in the database through `api-ops`:

- `ops_signals`
- `ops_check_state`
- `ops_incidents`

The live health board is currently hybrid:

- numeric venue metrics come from existing admin endpoints such as `api-admin/stats` and `api-admin/history`
- green/yellow/red operational signals are staff-controlled and stored in `ops_signals`
- incident state is shared across staff through `ops_incidents`

The next version should add automatic signal writers from Stripe webhook failures, Supabase Edge Function errors, padda heartbeat, and payment/booking reconciliation jobs.

## Goals

- Detect broken customer journeys before customers report them twice.
- Keep payments, bookings, access, and receipts reconciled.
- Give staff a simple way to classify and escalate incidents.
- Create enough operational memory that fixes are repeatable.
- Avoid hidden manual fixes without a note, owner, and follow-up.

## Signals To Watch

Critical signals:

- Vercel production build and deploy status.
- Supabase Edge Function errors for `api-bookings`, `api-stripe-webhook`, `api-checkins`, `api-memberships`, `api-day-passes`, `api-score`, and `api-event-public`.
- Stripe webhook delivery failures and retries.
- Stripe payments without confirmed Pickla booking, receipt, membership, or registration.
- Confirmed bookings that still block courts after cancellation.
- Membership allowance mismatches, especially Founder court-hours and vouchers.
- Device/padda display failures, stale device state, and check-in failures.
- Score sessions that cannot start, save turns, or broadcast.
- Resend delivery errors for auth, booking, membership, and group inquiry email.
- Frontend runtime errors reported by users, screenshots, or browser console.

Secondary signals:

- Slow profile or booking page loads.
- Staff role/login problems.
- Duplicate chats, missing activity action cards, or blank chat rooms.
- Public schedule showing stale or closed-day content.
- Manual SQL changes made during support.

## Critical Journeys

The Ops Agent should know these journeys and verify the weakest one first when something feels wrong:

1. Sign up, confirm email, log in.
2. Book one court with Stripe.
3. Book multiple resources with Stripe.
4. Book or join through a free entitlement.
5. Buy or activate membership.
6. Use Founder allowance, overage, Open Play, and guest voucher.
7. Cancel a booking and release courts and allowance.
8. Register for an activity from an activity chat.
9. Desk searches customer and checks them in.
10. Padda checks in a resource booking and starts score.

## Ops Agent Cadence

Run the local checklist script whenever you want the operating rhythm in front of you:

```bash
npm run ops:agent -- --mode=deploy
npm run ops:agent -- --mode=opening
npm run ops:agent -- --mode=closing
npm run ops:agent -- --mode=weekly
npm run ops:agent -- --mode=incident
```

After every production deploy, run a 15-minute watch:

- Confirm Vercel build is green.
- Open production home, `/book`, `/my`, and a known padda route.
- Check Supabase function logs for new errors.
- Check Stripe webhook deliveries for failures.
- Run one low-risk smoke path that matches the change.
- Record whether the deploy is green, yellow, or red.

Daily opening check:

- Today page shows the correct venue state and upcoming sessions.
- Desk loads and can search one known customer.
- Paddor are online and show the expected resource state.
- Booking availability loads for pickleball and darts.
- Stripe dashboard has no unresolved webhook failures.

Daily closing check:

- No stuck paid Stripe sessions without Pickla records.
- No unexpected active check-ins after closing.
- Cancellations from the day released inventory.
- Staff notes any support corrections made during the day.

Weekly check:

- Founder allowances and vouchers look correct for a sample user.
- Activity sessions for the next week look sane.
- Receipts and VAT look correct for a sample paid, free, and multi-resource booking.
- Temporary staff/admin access is removed or renewed intentionally.

## Incident Levels

P0, stop or contain immediately:

- Real payment is captured but customer cannot receive the booked product.
- Double-booking or inventory corruption.
- Admin/staff data exposed to the wrong user.
- Checkout or webhook path broadly broken in production.

P1, same-day fix:

- Booking, cancellation, membership, check-in, or registration broken for a meaningful user group.
- Paddor broadly unusable.
- Auth confirmation broken for new users.
- Receipts materially wrong.

P2, next release candidate:

- Single-device padda issue with workaround.
- UI regression that confuses but does not block purchase/access.
- Slow load on non-critical page.
- Staff workflow annoyance with safe manual workaround.

P3, backlog:

- Copy polish.
- Minor layout issue.
- Nice-to-have admin affordance.

## Incident Workflow

1. Detect: identify the first failing user journey.
2. Scope: decide venue, route, user group, and time window.
3. Contain: pause the risky action if needed, for example stop selling a broken product or tell staff the temporary workaround.
4. Diagnose: collect ids and logs before editing data.
5. Fix: prefer code/admin fix. Use SQL only with explicit notes.
6. Verify: rerun the affected journey and one adjacent journey.
7. Record: write incident notes and follow-up.

## Incident Note Template

Use this shape in support notes, Slack, GitHub issue, or whatever operational log is active:

```text
Time detected:
Reported by:
Venue:
Severity:
Affected route/function:
Affected user/customer:
Booking/payment/session ids:
Impact:
Current status:
Containment:
Fix commit/deploy:
Manual data changes:
Verification:
Follow-up:
Owner:
```

## Ops Agent Prompt

Use this prompt when asking an agent to inspect production readiness or a live issue:

```text
Act as Pickla Ops Agent.

Goal:
Find production risk in this area: <area>.

Check:
- customer journey impact
- payment or booking reconciliation risk
- membership/access risk
- staff/desk workaround
- logs or ids needed
- safest containment
- verification steps

Output:
1. severity P0-P3
2. likely cause
3. exact checks to run
4. safest fix path
5. rollback/containment plan
```

## Future Instrumentation

Do not block soft launch on all of this, but build toward it:

- Frontend error reporting with route, user id hash, venue id, app version, and browser.
- Structured Edge Function logs with request id, venue id, user id, action, and object ids.
- Stripe webhook failure alerting.
- Payment-to-booking reconciliation job.
- Device heartbeat dashboard for paddor and displays.
- Daily operational digest: bookings, revenue, cancellations, check-ins, failed webhooks, device status.
- Admin-visible audit log for staff actions and manual support corrections.
