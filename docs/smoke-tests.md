# Production Smoke Tests

Run these on stage before production, and a smaller subset directly after production deploy.

## Membership

- Assign hidden Founder tier to a customer.
- Confirm the customer sees Founder on `/my`.
- Confirm court-hours, Open Play included, and guest vouchers display in the membership area.
- Book within included hours.
- Book over included hours and confirm only the overage is charged.
- Cancel a booking and confirm allowance and availability are restored.

## Products And Schedule

- Create or verify an Open Play activity session.
- Create or verify a group training session.
- Confirm the public schedule shows expected upcoming sessions.
- Confirm paused/cancelled sessions do not behave like sellable inventory.

## Booking And Stripe

- Book one pickleball court through Stripe.
- Book multiple dart boards with `0 kr`.
- Book multiple courts through Stripe.
- Confirm booking detail opens on `/my`.
- Confirm receipt totals and VAT.
- Confirm booking chat exists and remains available after cancellation.

## Desk

- Search customer.
- Check in by booking.
- Check in by membership.
- Check in by Open Play/session access.
- Repeat check-in and confirm idempotent already-checked-in behavior.

## Paddor And Score

- Open padda home for a dart board.
- Check in a multi-board booking from one booked board.
- Confirm every booked board shows the same checked-in group state.
- Start a walk-in score match.
- Register score, bust, undo, checkout, and winner view.
- Open broadcast route for the score session.

## Security

- Logged-out user cannot open admin.
- Non-staff user cannot call admin APIs.
- Venue staff cannot manage another venue.
- Public display routes do not expose customer email/phone.

