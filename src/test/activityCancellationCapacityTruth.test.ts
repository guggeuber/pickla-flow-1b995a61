import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityRegistrationCheckinEligibility } from "@/lib/deskOps";

const commerce = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260921140000_activity_cancellation_capacity_truth.sql",
  "utf8",
);
const concurrency = readFileSync(
  "supabase/tests/activity_cancellation_capacity_truth.sql",
  "utf8",
);
const desk = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
const myPage = readFileSync("src/pages/MyPage.tsx", "utf8");

afterEach(() => vi.useRealTimers());

describe("activity cancellation capacity truth", () => {
  it("serializes cancellation with checkout and changes the canonical registration before reporting capacity", () => {
    const lock = migration.indexOf("PERFORM public.capacity_lock_scope(");
    const cancel = migration.indexOf("UPDATE public.session_registrations", lock);
    const available = migration.indexOf("available_count :=", cancel);
    expect(lock).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(lock);
    expect(available).toBeGreaterThan(cancel);
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("status IN ('active', 'committed')");
    expect(migration).toContain("activity_registration.participation_cancelled");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.cancel_activity_registration_participation");
    expect(migration).toContain("TO service_role");
  });

  it("keeps financial state separate from participation state", () => {
    const paidBranch = migration.indexOf("IF v_order_paid THEN");
    const freeBranch = migration.indexOf("ELSE", paidBranch);
    const paidSql = migration.slice(paidBranch, freeBranch);
    expect(paidSql).toContain("UPDATE public.commerce_orders");
    expect(paidSql).not.toContain("SET status = 'cancelled'");
    expect(migration).toContain("WHEN v_refund_id IS NOT NULL THEN 'refund_requested'");
    expect(migration).toContain("ELSE 'paid_not_refunded'");
    expect(migration).not.toContain("UPDATE public.booking_receipts");
    expect(migration).not.toContain("INSERT INTO public.ledger_entries");
  });

  it("routes legacy paid self-cancellation through the canonical policy/R2A command", () => {
    const cancelRoute = commerce.indexOf("path === 'cancel'");
    const resolveRoute = commerce.indexOf("path === 'resolve'", cancelRoute);
    const route = commerce.slice(cancelRoute, resolveRoute);
    expect(route).toContain("cancellation_subject_state");
    expect(route).toContain("confirmCancellationAndDispatchRefund");
    expect(route).toContain("EXPECTED_POLICY_CHANGE");
    expect(route).not.toContain("createStripeRefund");
    expect(route).not.toContain("cancelActivityRegistrationParticipation");
    expect(route).toContain("participation_cancelled: true");
    expect(route).toContain("preview.state_revision");
  });

  it("uses the same canonical command for staff cancellation", () => {
    expect(webhook).toContain("cancel_activity_registration_participation");
    expect(webhook).toContain("p_source: 'stripe_refund'");
    expect(bookings).toContain("path === 'activity-participant-cancel'");
    expect(bookings).toContain("confirmCancellationAndDispatchRefund");
    expect(bookings).toContain("staffRefundChoice: 'none'");
    expect(bookings).toContain("staffRestoreChoice: 'none'");
    expect(bookings).toContain("if (!await canOperateVenue(admin, userId, venueId))");
  });

  it("moves the co-player path to policy preview and confirmation without client-supplied refund facts", () => {
    const participantCancel = bookings.indexOf("path === 'booking-participant-cancel'");
    const receiptRoute = bookings.indexOf("path === 'receipt'", participantCancel);
    const route = bookings.slice(participantCancel, receiptRoute);
    expect(route).toContain("cancellation_subject_state");
    expect(route).toContain("confirmCancellationAndDispatchRefund");
    expect(route).toContain("EXPECTED_POLICY_CHANGE");
    expect(route).not.toContain("body.refund");
    expect(route).not.toContain("body.payer");
  });

  it("shows cancelled participation and payment truth without polluting capacity or check-in totals", () => {
    expect(bookings).not.toContain(".neq('status', 'cancelled')\n          .order('registered_at')");
    expect(bookings).toContain("headline: cancelled ? 'AVBOKAD' : 'HAR PLATS'");
    expect(bookings).toContain("AVBOKAD · BETALD · EJ ÅTERBETALD");
    expect(bookings).toContain("AVBOKAD · ÅTERBETALNING PÅGÅR");
    expect(desk).toContain("participant.has_place !== false");
    expect(desk).toContain("capacityParticipants.filter");
    expect(myPage).toContain("Platsen är släppt. Återbetalningen behandlas.");
  });

  it("contains the exact Henry shape, missed-webhook proof, and real competing transactions", () => {
    expect(concurrency).toContain("'Singel Träning Hög nivå - Högt tempo'");
    expect(concurrency).toContain("165, 8, 'cancellation_truth', 'published'");
    expect(concurrency).toContain("'re_test_henry_165'");
    expect(concurrency).toContain("'2031-01-14', 16500, 'confirmed'");
    expect(concurrency).toContain("CREATE TEMP TABLE henry_cancellation_result");
    expect(concurrency).toContain("v_fill.committed_count <> 7");
    expect(concurrency).toContain("v_fill.available_count <> 1");
    expect(concurrency).toContain("fixture.role = 'host'");
    expect(concurrency).toContain("hidden or cancelled occurrence prevented participation release");
    expect(concurrency).toContain("dblink_send_query('cancel_checkout_1'");
    expect(concurrency).toContain("dblink_send_query('cancel_checkout_2'");
    expect(concurrency).toContain("activity_cancellation_test_replacement");
    expect(concurrency).toContain("dblink_send_query('cancel_retry_1'");
    expect(concurrency).toContain("dblink_send_query('cancel_retry_2'");
    expect(concurrency).toContain("v_fill.fill_count <> 8");
  });

  it("blocks check-in before its window, permits it during the event, and rejects cancelled or ended participation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-07T16:00:00.000Z"));
    const base = {
      venue_id: "venue",
      registration_id: "registration",
      start_time: "2031-01-07T17:00:00.000Z",
      end_time: "2031-01-07T19:00:00.000Z",
      payment_status: "paid",
      amount_sek: 165,
      status: "confirmed",
    };
    expect(activityRegistrationCheckinEligibility(base)).toMatchObject({ ok: false, reason: "Öppnar 17:30" });

    vi.setSystemTime(new Date("2031-01-07T17:15:00.000Z"));
    expect(activityRegistrationCheckinEligibility(base)).toMatchObject({ ok: true });
    expect(activityRegistrationCheckinEligibility({ ...base, status: "cancelled" })).toMatchObject({ ok: false, reason: "Inte bekräftad" });

    vi.setSystemTime(new Date("2031-01-07T19:00:01.000Z"));
    expect(activityRegistrationCheckinEligibility(base)).toMatchObject({ ok: false, reason: "Passerad" });
  });
});
