import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingParticipantSummary } from "@/components/bookings/BookingParticipantSummary";
import {
  bookingParticipantCustomerCopy,
  bookingParticipantStateView,
  bookingParticipantSummaryLabel,
} from "@/lib/bookingParticipantState";
import { bookingParticipantCheckinEligibility } from "@/lib/deskOps";
import {
  bookingParticipantCountSummary,
  bookingParticipantReservedCount,
  deriveBookingParticipantOperationalState,
  loadBookingParticipantHoldTruth,
  projectBookingParticipantOperationalState,
} from "../../supabase/functions/_shared/booking_participant_state";

const NOW = new Date("2026-09-13T10:00:00.000Z");

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: "participant-1",
    venue_id: "venue-a",
    booking_group_key: "stripe:booking-a",
    user_id: "user-1",
    customer_id: "customer-1",
    display_name: "Testspelare",
    price_minor: 19_800,
    amount_sek: 198,
    payment_status: "pending",
    metadata: {},
    ...overrides,
  };
}

function hold(overrides: Record<string, unknown> = {}) {
  return {
    id: "hold-1",
    scope_id: "stripe:booking-a",
    source_id: "participant-1",
    status: "active",
    expires_at: "2026-09-13T10:10:00.000Z",
    stripe_session_id: "cs_open",
    created_at: "2026-09-13T09:59:00.000Z",
    metadata: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("canonical booking participant operational state", () => {
  it("A: paid is a confirmed place exactly once", () => {
    expect(deriveBookingParticipantOperationalState(participant({ payment_status: "paid" }), null, NOW)).toMatchObject({
      operational_state: "confirmed_paid",
      has_place: true,
      confirmed: true,
      reserved: false,
      check_in_allowed: true,
    });
  });

  it("B: included Founder is a confirmed place exactly once", () => {
    const state = deriveBookingParticipantOperationalState(participant({
      payment_status: "free",
      metadata: { access_reason: "Founder" },
    }), null, NOW);
    expect(state).toMatchObject({ operational_state: "confirmed_included", has_place: true, confirmed: true });
  });

  it("C/E: only a live active Checkout hold temporarily reserves capacity", () => {
    expect(deriveBookingParticipantOperationalState(participant(), hold(), NOW)).toMatchObject({
      operational_state: "payment_pending",
      has_place: false,
      reserved: true,
      reservation_expires_at: "2026-09-13T10:10:00.000Z",
      can_resume_payment: true,
    });
  });

  it("D/F/G: expired or absent hold leaves unpaid intent without a place", () => {
    const expired = deriveBookingParticipantOperationalState(participant(), hold({
      expires_at: "2026-09-13T09:59:59.000Z",
    }), NOW);
    const rawIntent = deriveBookingParticipantOperationalState(participant(), null, NOW);
    expect(expired).toMatchObject({ operational_state: "payment_expired", has_place: false, reserved: false, can_retry_payment: true });
    expect(rawIntent).toMatchObject({ operational_state: "payment_expired", has_place: false, reserved: false });
  });

  it("H: cancelled/released participant has no place and no action", () => {
    expect(deriveBookingParticipantOperationalState(participant({ payment_status: "cancelled" }), hold({ status: "released" }), NOW)).toMatchObject({
      operational_state: "cancelled_released",
      has_place: false,
      reserved: false,
      can_retry_payment: false,
    });
  });

  it("I: paid-capacity conflict and unexplained financial evidence require attention", () => {
    expect(deriveBookingParticipantOperationalState(participant(), hold({ status: "conflict" }), NOW)).toMatchObject({
      operational_state: "payment_attention",
      has_place: false,
      requires_attention: true,
    });
    expect(deriveBookingParticipantOperationalState(participant({ booking_receipt_id: "receipt-without-commit" }), null, NOW)).toMatchObject({
      operational_state: "payment_attention",
      confirmed: false,
    });
  });

  it("keeps a projected current entitlement unconfirmed until the atomic commit", () => {
    expect(deriveBookingParticipantOperationalState(participant({
      payment_status: "free",
      entitlement_reresolution_pending: true,
      access_reason: "Founder",
    }), null, NOW)).toMatchObject({
      operational_state: "confirmation_pending",
      has_place: false,
      can_retry_payment: true,
    });
  });

  it("J/K/L/T: derives confirmed, reserved, available and pending-unreserved once", () => {
    const states = [
      projectBookingParticipantOperationalState(participant({ id: "paid", payment_status: "paid" }), null, NOW),
      projectBookingParticipantOperationalState(participant({ id: "included", payment_status: "free" }), null, NOW),
      projectBookingParticipantOperationalState(participant({ id: "held" }), hold({ source_id: "held" }), NOW),
      projectBookingParticipantOperationalState(participant({ id: "expired" }), hold({ source_id: "expired", status: "expired" }), NOW),
    ];
    expect(bookingParticipantCountSummary(states, 4)).toMatchObject({
      confirmed_count: 2,
      reserved_count: 1,
      available_count: 1,
      pending_unreserved_count: 1,
      capacity: 4,
    });
    expect(bookingParticipantCountSummary(states, 3)).toMatchObject({ available_count: 0 });
  });

  it("uses the database-equivalent live hold count even for an orphan hold", () => {
    const states = [projectBookingParticipantOperationalState(participant({ payment_status: "paid" }), null, NOW)];
    const liveHoldSources = new Set(["participant-1", "orphan-participant"]);
    const reservedCount = bookingParticipantReservedCount(states, liveHoldSources);
    expect(reservedCount).toBe(1);
    expect(bookingParticipantCountSummary(states, 3, reservedCount)).toMatchObject({
      confirmed_count: 1,
      reserved_count: 1,
      available_count: 1,
      pending_unreserved_count: 0,
      capacity: 3,
    });
  });

  it("loads latest per-participant truth and counts only unexpired active holds", async () => {
    const rows = [
      hold(),
      hold({ id: "hold-old", status: "expired", created_at: "2026-09-13T09:00:00.000Z" }),
      hold({ id: "hold-other", source_id: "participant-2", expires_at: "2026-09-13T09:59:00.000Z" }),
    ];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order"]) chain[method] = () => chain;
    chain.then = (resolve: (result: unknown) => unknown) => resolve({ data: rows, error: null });
    const admin = { from: vi.fn(() => chain) };
    const truth = await loadBookingParticipantHoldTruth(admin, "venue-a", ["stripe:booking-a"], NOW);
    expect(truth.latestByParticipantId.get("participant-1")?.id).toBe("hold-1");
    expect(truth.liveCountByGroupKey.get("stripe:booking-a")).toBe(1);
  });
});

describe("participant state UX contract", () => {
  it("M/O/P: staff labels and payment-link actions match operational truth", () => {
    expect(bookingParticipantStateView({ ...participant({ payment_status: "paid" }), operational_state: "confirmed_paid", has_place: true }).headline).toBe("HAR PLATS");
    expect(bookingParticipantStateView({ ...participant(), operational_state: "payment_pending", reserved: true, reservation_expires_at: hold().expires_at }).paymentLinkAction).toBe("resume");
    expect(bookingParticipantStateView({ ...participant(), operational_state: "payment_expired", can_retry_payment: true }).paymentLinkLabel).toBe("Kopiera ny betalningslänk");
    expect(bookingParticipantStateView({ ...participant(), operational_state: "payment_attention" }).paymentLinkAction).toBeNull();
    expect(bookingParticipantStateView({ ...participant({ payment_status: "free" }), operational_state: "confirmed_included", has_place: true }).paymentLinkAction).toBeNull();
  });

  it("N: one canonical group header distinguishes confirmed and reserved", () => {
    expect(bookingParticipantSummaryLabel({ confirmed_count: 11, reserved_count: 0, available_count: 1, capacity: 12 }))
      .toBe("11/12 har plats · 1 plats kvar");
    expect(bookingParticipantSummaryLabel({ confirmed_count: 11, reserved_count: 1, available_count: 0, capacity: 12 }))
      .toBe("11 har plats · 1 reserverad · 0 lediga");
    render(<BookingParticipantSummary summary={{ confirmed_count: 11, reserved_count: 1, available_count: 0, capacity: 12 }} />);
    expect(screen.getByText("11 har plats · 1 reserverad · 0 lediga")).toBeInTheDocument();
  });

  it("Q: unpaid copy renders the server-projected amount and never calculates a price", () => {
    const view = bookingParticipantStateView({ ...participant(), operational_state: "payment_expired", amount_sek: 198, can_retry_payment: true });
    expect(view.detail).toBe("Betalning utgången · betala 198 kr");
    expect(bookingParticipantCustomerCopy({ ...participant(), operational_state: "payment_expired", amount_sek: 198 }).detail).toBe("Ditt pris är 198 kr.");
  });

  it("R: payer Founder metadata never turns a pending companion into included", () => {
    const companion = participant({ metadata: { payer_membership_tier: "Founder" } });
    expect(deriveBookingParticipantOperationalState(companion, null, NOW).operational_state).toBe("payment_expired");
  });

  it("S: retry lifecycle transitions expired → reserved → paid", () => {
    const expired = deriveBookingParticipantOperationalState(participant(), hold({ status: "expired" }), NOW);
    const reserved = deriveBookingParticipantOperationalState(participant(), hold(), NOW);
    const paid = deriveBookingParticipantOperationalState(participant({ payment_status: "paid" }), hold({ status: "committed" }), NOW);
    expect([expired.operational_state, reserved.operational_state, paid.operational_state]).toEqual([
      "payment_expired",
      "payment_pending",
      "confirmed_paid",
    ]);
  });

  it("U: check-in is allowed only for a canonically confirmed place", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T10:00:00.000Z"));
    const booking = {
      id: "booking-1",
      venue_id: "venue-a",
      start_time: "2026-09-13T09:45:00.000Z",
      end_time: "2026-09-13T11:00:00.000Z",
      status: "confirmed",
    };
    expect(bookingParticipantCheckinEligibility({ ...participant({ payment_status: "paid" }), operational_state: "confirmed_paid", has_place: true, check_in_allowed: true }, booking).ok).toBe(true);
    expect(bookingParticipantCheckinEligibility({ ...participant(), operational_state: "payment_pending", has_place: false, check_in_allowed: false }, booking)).toEqual({ ok: false, reason: "Plats reserverad" });
  });
});

describe("participant state projection security contracts", () => {
  const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
  const admin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
  const claimPage = readFileSync("src/pages/ClaimBookingParticipantPage.tsx", "utf8");
  const desk = readFileSync("src/components/desk/shell/DeskToday.tsx", "utf8");
  const drawer = readFileSync("src/components/operations/OperationsBookingDrawer.tsx", "utf8");

  it("V: keeps public participant output minimal and admin detail venue-anchored", () => {
    expect(bookings).toContain("participants: publicParticipants");
    expect(bookings).toContain("viewer_participant: viewerParticipant ? {");
    const publicProjection = bookings.slice(bookings.indexOf("const publicParticipants"), bookings.indexOf("return jsonResponse({", bookings.indexOf("const publicParticipants")));
    expect(publicProjection).not.toContain("email:");
    expect(publicProjection).not.toContain("phone:");
    expect(publicProjection).not.toContain("stripe_session_id:");
    expect(admin).toContain("authorizeVenueScopedAdminRead");
    expect(admin).toContain(".eq('venue_id', venueId)\n    .eq('booking_group_key', participantGroupKey)");
  });

  it("uses the server price and removes CLAIMAD as the main staff state", () => {
    expect(bookings).toContain("amount_sek: minorToSek(pricing?.price_minor ?? viewerParticipant.price_minor)");
    expect(claimPage).toContain("data.pricing.price_sek");
    expect(claimPage).toContain("amount_sek: Number(claim.amount_sek || 0)");
    expect(desk).not.toContain('"Claimad"');
    expect(drawer).not.toContain('"Claimad"');
  });
});
