# Daily Operations Runbook

This is the staff-facing baseline for running one day at Pickla.

## Opening

- Confirm Desk loads.
- Confirm venue status/opening hours look correct.
- Confirm paddor/device home screens are online.
- Confirm at least one staff account can access Hub/Admin and Desk.
- Confirm today's schedule: bookings, Open Play, events/group inquiries.

## Bookings

Normal flow:

- Customer books in app.
- Booking appears on `/my`, Desk, and relevant padda/resource status.
- Customer can use 4-digit code for resource check-in.

Exceptions:

- Missing code: search customer in Desk and inspect booking.
- Wrong resource: resource padda should show expected resource and not check in.
- Cancelled booking: status remains visible as cancelled, but courts are released.
- Payment confusion: check Stripe dashboard and booking receipt before manual correction.

## Memberships

- Founder can use included court-hours.
- Founder can access Open Play without paying.
- Founder guest vouchers are for new recipients only.
- If a member says allowance is wrong, check active bookings first. Cancelled bookings should not consume allowance.

## Open Play And Sessions

- Confirm session exists in Schema/Activity Sessions.
- Registrations should appear for paid users and included Founder access.
- Check-in should show the access source clearly.

## Desk Check-in

- Scan/search should resolve in this order:
  1. active booking in check-in window
  2. active membership
  3. active day/session access
- Repeated scans should be idempotent and show already checked in.

## Paddor

- Each padda should have a display device record and a resource assignment where relevant.
- If a padda is moved, update the display device assignment in admin.
- If a padda loses status, refresh first; then verify device token/assignment.

## Closing

- Check active check-ins and occupied resources.
- Confirm no stuck booking/payment issue from the day.
- Note any manual correction in Hub/Admin notes.

