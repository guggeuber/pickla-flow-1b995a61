import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BookingParticipantRetryError,
  reconcileBookingParticipantRetry,
} from "../../supabase/functions/_shared/booking_participant_retry";

const participant = {
  id: "785c1adf-fd96-438d-8ab3-40ef439257ae",
  venue_id: "venue-a",
  booking_group_key: "stripe:booking-a",
  price_minor: 19_800,
};

function queryResult(data: any, error: any = null) {
  const chain: any = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data, error });
  return chain;
}

function adminWithHold(hold: any) {
  const releases: any[] = [];
  return {
    releases,
    from(table: string) {
      if (table !== "capacity_holds") throw new Error(`Unexpected table ${table}`);
      return queryResult(hold);
    },
    async rpc(name: string, args: any) {
      if (name !== "release_capacity_hold") throw new Error(`Unexpected RPC ${name}`);
      releases.push(args);
      return { data: true, error: null };
    },
  };
}

function hold(overrides: Record<string, unknown> = {}) {
  return {
    id: "hold-old",
    status: "active",
    expires_at: "2026-09-08T18:24:00.000Z",
    stripe_session_id: "cs_old",
    source_id: participant.id,
    idempotency_key: `booking_participant_claim:${participant.booking_group_key}:${participant.id}`,
    metadata: {},
    ...overrides,
  };
}

function stripeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_old",
    status: "expired",
    payment_status: "unpaid",
    amount_total: 19_800,
    currency: "sek",
    mode: "payment",
    url: null,
    metadata: {
      product_type: "booking_participant",
      booking_participant_id: participant.id,
      capacity_hold_id: "hold-old",
    },
    ...overrides,
  };
}

function stripeFetch(...sessions: any[]) {
  const responses = [...sessions];
  return vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
}

const baseOptions = {
  stripeKey: "sk_test",
  stripeApiBase: "https://stripe.test/v1",
  expectedAmountMinor: 19_800,
  now: new Date("2026-09-12T10:00:00.000Z"),
};

describe("booking participant Stripe retry lifecycle", () => {
  it("leaves a first payment attempt on the normal fresh-hold path", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const finalizePaid = vi.fn();
    const result = await reconcileBookingParticipantRetry(adminWithHold(null), participant, {
      ...baseOptions,
      fetchImpl,
      finalizePaid,
    });

    expect(result).toEqual({ action: "acquire" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizePaid).not.toHaveBeenCalled();
  });

  it("releases an expired unpaid Stripe-linked stale hold before a fresh attempt", async () => {
    const admin = adminWithHold(hold());
    const finalizePaid = vi.fn();
    const result = await reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(stripeSession()),
      finalizePaid,
    });

    expect(result).toEqual({ action: "acquire", releasedHoldId: "hold-old" });
    expect(admin.releases).toEqual([{ p_hold_id: "hold-old", p_reason: "stripe_checkout_expired" }]);
    expect(finalizePaid).not.toHaveBeenCalled();
  });

  it("reconciles an already-paid session without releasing capacity or creating a new attempt", async () => {
    const admin = adminWithHold(hold());
    const finalizePaid = vi.fn(async () => ({ ok: true }));
    const paid = stripeSession({ status: "complete", payment_status: "paid", url: null });
    const result = await reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(paid),
      finalizePaid,
    });

    expect(result).toEqual({ action: "paid_reconciled", holdId: "hold-old", stripeSessionId: "cs_old" });
    expect(finalizePaid).toHaveBeenCalledOnce();
    expect(admin.releases).toHaveLength(0);
  });

  it("fails closed when a paid attempt cannot be committed because capacity is genuinely full", async () => {
    const admin = adminWithHold(hold());
    await expect(reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(stripeSession({ status: "complete", payment_status: "paid" })),
      finalizePaid: vi.fn(async () => ({ ok: false, reason: "capacity_full" })),
    })).rejects.toMatchObject({ code: "paid_capacity_conflict" });
    expect(admin.releases).toHaveLength(0);
  });

  it("reuses the same live open Checkout for concurrent retries", async () => {
    const liveHold = hold({ expires_at: "2026-09-12T10:10:00.000Z" });
    const open = stripeSession({ status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/cs_old" });
    const finalizePaid = vi.fn();

    const first = await reconcileBookingParticipantRetry(adminWithHold(liveHold), participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(open),
      finalizePaid,
    });
    const second = await reconcileBookingParticipantRetry(adminWithHold(liveHold), participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(open),
      finalizePaid,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ action: "reuse_checkout", holdId: "hold-old", stripeSessionId: "cs_old" });
    expect(finalizePaid).not.toHaveBeenCalled();
  });

  it("expires an open but locally stale Checkout, then releases its hold", async () => {
    const admin = adminWithHold(hold());
    const fetchImpl = stripeFetch(
      stripeSession({ status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/cs_old" }),
      stripeSession(),
    );
    const result = await reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl,
      finalizePaid: vi.fn(),
    });

    expect(result).toEqual({ action: "acquire", releasedHoldId: "hold-old" });
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/checkout/sessions/cs_old/expire");
    expect(admin.releases).toHaveLength(1);
  });

  it("reconciles payment won during an expiry race and never releases its hold", async () => {
    const admin = adminWithHold(hold());
    const open = stripeSession({ status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/cs_old" });
    const paid = stripeSession({ status: "complete", payment_status: "paid", url: null });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(open), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "already completed" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(paid), { status: 200 })) as typeof fetch;
    const finalizePaid = vi.fn(async () => ({ ok: true }));

    const result = await reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl,
      finalizePaid,
    });

    expect(result).toMatchObject({ action: "paid_reconciled", holdId: "hold-old" });
    expect(finalizePaid).toHaveBeenCalledOnce();
    expect(admin.releases).toHaveLength(0);
  });

  it("expires an open Checkout when the current canonical 198 SEK price does not match", async () => {
    const admin = adminWithHold(hold({ expires_at: "2026-09-12T10:10:00.000Z" }));
    const fetchImpl = stripeFetch(
      stripeSession({ status: "open", payment_status: "unpaid", amount_total: 9_900, url: "https://checkout.stripe.test/cs_old" }),
      stripeSession(),
    );
    const result = await reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl,
      finalizePaid: vi.fn(),
    });

    expect(result.action).toBe("acquire");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed on Stripe lookup failure and does not release the hold", async () => {
    const admin = adminWithHold(hold());
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    await expect(reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl,
      finalizePaid: vi.fn(),
    })).rejects.toMatchObject<Partial<BookingParticipantRetryError>>({ code: "stripe_checkout_lookup_failed" });
    expect(admin.releases).toHaveLength(0);
  });

  it("fails closed on participant/hold metadata mismatch", async () => {
    const admin = adminWithHold(hold());
    await expect(reconcileBookingParticipantRetry(admin, participant, {
      ...baseOptions,
      fetchImpl: stripeFetch(stripeSession({
        metadata: { product_type: "booking_participant", booking_participant_id: "someone-else", capacity_hold_id: "hold-old" },
      })),
      finalizePaid: vi.fn(),
    })).rejects.toMatchObject({ code: "stripe_checkout_identity_mismatch" });
    expect(admin.releases).toHaveLength(0);
  });
});

describe("booking participant retry integration contracts", () => {
  const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
  const webhook = readFileSync("supabase/functions/api-stripe-webhook/index.ts", "utf8");
  const claimPage = readFileSync("src/pages/ClaimBookingParticipantPage.tsx", "utf8");
  const payment = readFileSync("supabase/functions/_shared/booking_participant_payment.ts", "utf8");

  it("separates stable participant intent from the fresh hold payment-attempt identity", () => {
    expect(bookings).toContain("booking_participant_claim:${participant.booking_group_key}");
    expect(bookings).toContain("product_type === BOOKING_PARTICIPANT_SOURCE_TYPE ? capacityHoldId : requestIdempotencyKey");
    expect(claimPage).toContain("claim.checkout_url");
  });

  it("keeps webhook and retry recovery on one paid-participant finalizer", () => {
    expect(webhook).toContain("finalizePaidBookingParticipantCheckout(session, serviceClient)");
    expect(bookings).toContain("finalizePaid: finalizePaidBookingParticipantCheckout");
    expect(payment).toContain("amountMinor !== Number(participant.price_minor || 0)");
    expect(payment).toContain("error.code !== '23505'");
  });

  it("does not turn Stripe uncertainty into a false capacity error", () => {
    expect(bookings).toContain("Det tidigare betalningsförsöket kunde inte verifieras");
    expect(bookings).toContain("Bokningen har inga öppna platser kvar");
  });
});
