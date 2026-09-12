import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingParticipantSummary } from "@/components/bookings/BookingParticipantSummary";
import { bookingParticipantSummaryLabel } from "@/lib/bookingParticipantState";
import {
  projectBookingParticipantOperationalState,
  resolveBookingGroupCapacity,
  resolveBookingParticipantGroupCapacity,
} from "../../supabase/functions/_shared/booking_participant_state";

const NOW = new Date("2026-09-13T10:00:00.000Z");

function bookingRows(capacityFields: Record<string, unknown> = {}) {
  return ["court-a", "court-b"].map((id) => ({
    id,
    open_for_more_status: "closed",
    ...capacityFields,
  }));
}

function participant(id: string, paymentStatus: "paid" | "free" | "pending") {
  return {
    id,
    customer_id: `customer-${id}`,
    user_id: `user-${id}`,
    payment_status: paymentStatus,
    price_minor: paymentStatus === "paid" ? 19_800 : 0,
    metadata: {},
  };
}

function projectedParticipants(options: { confirmed: number; pending: number; liveHoldIndex?: number }) {
  const rows = [
    ...Array.from({ length: options.confirmed }, (_, index) => participant(
      `confirmed-${index + 1}`,
      index < 7 ? "free" : "paid",
    )),
    ...Array.from({ length: options.pending }, (_, index) => participant(`pending-${index + 1}`, "pending")),
  ];
  return rows.map((row) => projectBookingParticipantOperationalState(
    row,
    row.payment_status === "pending"
      ? {
        id: `hold-${row.id}`,
        source_id: row.id,
        status: options.liveHoldIndex === Number(row.id.split("-").at(-1)) ? "active" : "expired",
        expires_at: options.liveHoldIndex === Number(row.id.split("-").at(-1))
          ? "2026-09-13T10:10:00.000Z"
          : "2026-09-13T09:59:00.000Z",
      }
      : null,
    NOW,
  ));
}

describe("canonical booking-group capacity", () => {
  it("reproduces the production-shaped 2-row group as 12 = 11 + 0 + 1", () => {
    const rows = bookingRows({
      open_for_more_public_capacity: 12,
      open_for_more_total_players: 12,
      open_for_more_opened_places: 3,
      open_for_more_committed_at_publication: 9,
    });
    const participants = projectedParticipants({ confirmed: 11, pending: 3 });

    expect(resolveBookingParticipantGroupCapacity(rows, participants)).toEqual({
      confirmed_count: 11,
      reserved_count: 0,
      available_count: 1,
      pending_unreserved_count: 3,
      capacity: 12,
      capacity_source: "open_for_more_public_capacity",
      capacity_is_authoritative: true,
      capacity_state: "ok",
      capacity_invariant_violation: false,
      over_capacity_count: 0,
    });
  });

  it("uses live holds only and transitions retry from reserved to one committed place", () => {
    const rows = bookingRows({ open_for_more_public_capacity: 12 });
    const reserved = resolveBookingParticipantGroupCapacity(
      rows,
      projectedParticipants({ confirmed: 11, pending: 3, liveHoldIndex: 1 }),
    );
    expect(reserved).toMatchObject({
      confirmed_count: 11,
      reserved_count: 1,
      available_count: 0,
      pending_unreserved_count: 2,
    });

    const committed = resolveBookingParticipantGroupCapacity(
      rows,
      projectedParticipants({ confirmed: 12, pending: 2 }),
    );
    expect(committed).toMatchObject({
      confirmed_count: 12,
      reserved_count: 0,
      available_count: 0,
      pending_unreserved_count: 2,
      capacity_state: "ok",
    });
  });

  it("does not let raw unpaid participant rows consume capacity", () => {
    const rows = bookingRows({ open_for_more_public_capacity: 12 });
    const summary = resolveBookingParticipantGroupCapacity(
      rows,
      [
        ...projectedParticipants({ confirmed: 11, pending: 0 }),
        projectBookingParticipantOperationalState(participant("raw-unpaid", "pending"), null, NOW),
      ],
    );
    expect(summary).toMatchObject({
      confirmed_count: 11,
      reserved_count: 0,
      pending_unreserved_count: 1,
      available_count: 1,
    });
  });

  it("marks twelve confirmed places as full so the claim precondition denies another", () => {
    const summary = resolveBookingParticipantGroupCapacity(
      bookingRows({ open_for_more_public_capacity: 12 }),
      projectedParticipants({ confirmed: 12, pending: 0 }),
    );
    expect(summary).toMatchObject({
      capacity: 12,
      confirmed_count: 12,
      reserved_count: 0,
      available_count: 0,
      capacity_state: "ok",
    });
  });

  it("keeps explicit capacity authoritative after publication closes", () => {
    expect(resolveBookingGroupCapacity(bookingRows({
      open_for_more_public_capacity: 12,
      open_for_more_status: "closed",
    }))).toEqual({
      capacity: 12,
      capacity_source: "open_for_more_public_capacity",
      capacity_is_authoritative: true,
    });
  });

  it("supports opened-place snapshots and the legacy total before falling back", () => {
    expect(resolveBookingGroupCapacity(bookingRows({
      open_for_more_opened_places: 3,
      open_for_more_committed_at_publication: 9,
    }))).toMatchObject({ capacity: 12, capacity_source: "open_for_more_opened_places" });
    expect(resolveBookingGroupCapacity(bookingRows({
      open_for_more_total_players: 10,
    }))).toMatchObject({ capacity: 10, capacity_source: "open_for_more_total_players" });
    expect(resolveBookingGroupCapacity(bookingRows())).toEqual({
      capacity: 8,
      capacity_source: "booking_rows_fallback",
      capacity_is_authoritative: false,
    });
  });

  it("surfaces an over-capacity invariant violation without hiding confirmed people", () => {
    const summary = resolveBookingParticipantGroupCapacity(
      bookingRows({ open_for_more_public_capacity: 12 }),
      projectedParticipants({ confirmed: 13, pending: 0 }),
    );
    expect(summary).toMatchObject({
      capacity: 12,
      confirmed_count: 13,
      reserved_count: 0,
      available_count: 0,
      capacity_state: "over_capacity_attention",
      capacity_invariant_violation: true,
      over_capacity_count: 1,
    });
    expect(bookingParticipantSummaryLabel(summary)).toBe("13/12 har plats · KRÄVER ÅTGÄRD (+1)");
  });

  it("renders exactly the same server summary in the shared customer/Desk/Admin component", () => {
    const summary = resolveBookingParticipantGroupCapacity(
      bookingRows({ open_for_more_public_capacity: 12 }),
      projectedParticipants({ confirmed: 11, pending: 3 }),
    );
    expect(bookingParticipantSummaryLabel(summary)).toBe("11/12 har plats · 1 plats kvar");
    render(<BookingParticipantSummary summary={summary} />);
    expect(screen.getByText("11/12 har plats · 1 plats kvar")).toBeInTheDocument();
  });
});

describe("booking-group capacity integration contract", () => {
  const state = readFileSync("supabase/functions/_shared/booking_participant_state.ts", "utf8");
  const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
  const admin = readFileSync("supabase/functions/api-admin/index.ts", "utf8");
  const payment = readFileSync("supabase/functions/_shared/booking_participant_payment.ts", "utf8");
  const entitlement = readFileSync("supabase/functions/_shared/booking_participant_entitlement.ts", "utf8");
  const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
  const frontend = readFileSync("src/lib/bookingParticipantState.ts", "utf8");

  it("routes customer, Desk, Admin, retry, entitlement and webhook through one resolver", () => {
    expect(bookings).toContain("resolveBookingParticipantGroupCapacity(bookingRows, participants");
    expect(bookings).toContain("participant_summary: bookingGroupParticipantSummary(");
    expect(bookings).toContain("if (!placeholder && committedCount >= capacity)");
    expect(admin).toContain("resolveBookingParticipantGroupCapacity(");
    expect(payment).toContain("resolveBookingGroupCapacity(groupedRows).capacity");
    expect(entitlement).toContain("resolveBookingGroupCapacity(rows).capacity");
    expect(webhook).toContain("p_capacity: resolveBookingGroupCapacity(bookingRows).capacity");
  });

  it("keeps row cardinality only inside the named legacy fallback", () => {
    for (const source of [bookings, admin, payment, entitlement, webhook]) {
      expect(source).not.toMatch(/Math\.max\([^\n]*\.length[^\n]*\*\s*4/);
      expect(source).not.toContain("BOOKING_PARTICIPANT_MAX_PER_COURT");
    }
    expect(state).toContain("capacity_source: 'booking_rows_fallback'");
    expect(state).toContain("Math.max(rows.length, 1) * BOOKING_PARTICIPANT_FALLBACK_CAPACITY_PER_ROW");
  });

  it("does not let the frontend recalculate server-authoritative availability", () => {
    expect(frontend).toContain("summary?.available_count ?? 0");
    expect(frontend).not.toContain("capacity - confirmed - reserved");
  });
});
