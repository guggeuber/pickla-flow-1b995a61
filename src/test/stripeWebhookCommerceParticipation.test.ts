import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  fulfillCommerceParticipation,
  legacyWholeSekFromMinor,
  paidFulfillmentIncidentIdentity,
  type CommerceParticipationDependencies,
} from "../../supabase/functions/api-stripe-webhook/commerce_participation";

const webhookSource = readFileSync(
  "supabase/functions/api-stripe-webhook/index.ts",
  "utf8",
);

const participationInput = {
  lineTotalIncVatMinor: 5_940,
  commitArgs: {
    p_activity_session_id: "activity-1",
    p_session_date: "2026-07-17",
    p_user_id: "user-1",
    p_stripe_session_id: "cs_live_test",
    p_source_id: "line-1",
  },
};

function successfulHarness() {
  const registrations = new Map<string, string>();
  const entitlements = new Set<string>();
  const linkedLines = new Map<string, string>();
  const committedPrices: number[] = [];

  const dependencies: CommerceParticipationDependencies = {
    commitRegistration: async (args) => {
      committedPrices.push(Number(args.p_price_paid_sek));
      const key = [
        args.p_activity_session_id,
        args.p_session_date,
        args.p_user_id,
      ].join(":");
      const registrationId = registrations.get(key) || "registration-1";
      registrations.set(key, registrationId);
      return { ok: true, registration_id: registrationId };
    },
    markOrderAttention: async () => undefined,
    markLineAttention: async () => undefined,
    recordIncident: async () => undefined,
    linkRegistration: async (registrationId) => {
      linkedLines.set("line-1", registrationId);
    },
    upsertEntitlement: async (registrationId) => {
      entitlements.add(`session_ticket:${registrationId}:user-1`);
    },
  };

  return {
    dependencies,
    registrations,
    entitlements,
    linkedLines,
    committedPrices,
  };
}

describe("commerce participation webhook fulfillment", () => {
  it("converts 5,940 minor units to the legacy whole-SEK integer 59", () => {
    const result = legacyWholeSekFromMinor(5_940);
    expect(result).toBe(59);
    expect(Number.isInteger(result)).toBe(true);
  });

  it.each([
    [0, 0],
    [100, 1],
    [9_900, 99],
    [16_500, 165],
  ])("preserves existing whole-krona amount %i as %i SEK", (minorUnits, expectedSek) => {
    expect(legacyWholeSekFromMinor(minorUnits)).toBe(expectedSek);
  });

  it("creates one registration and one entitlement on successful fulfillment", async () => {
    const harness = successfulHarness();

    await expect(
      fulfillCommerceParticipation(participationInput, harness.dependencies),
    ).resolves.toEqual({ ok: true, registrationId: "registration-1" });

    expect(harness.committedPrices).toEqual([59]);
    expect(harness.registrations.size).toBe(1);
    expect(harness.entitlements.size).toBe(1);
    expect(harness.linkedLines.get("line-1")).toBe("registration-1");
    expect(participationInput.lineTotalIncVatMinor).toBe(5_940);
  });

  it("replay reuses the registration and entitlement instead of creating duplicates", async () => {
    const harness = successfulHarness();

    await fulfillCommerceParticipation(participationInput, harness.dependencies);
    await fulfillCommerceParticipation(participationInput, harness.dependencies);

    expect(harness.committedPrices).toEqual([59, 59]);
    expect(harness.registrations.size).toBe(1);
    expect(harness.entitlements.size).toBe(1);
    expect(harness.linkedLines.size).toBe(1);
  });

  it("marks attention, records one sanitized incident, and rethrows an RPC failure for retry", async () => {
    const rpcError = new Error(
      'invalid input syntax for type integer: "59.4"; buyer@example.test; +46701234567; sk_live_secret',
    );
    let orderStatus = "paid";
    let lineStatus = "not_required";
    const incidents = new Map<string, Record<string, string>>();
    const { incidentId } = await paidFulfillmentIncidentIdentity("order-1", "line-1");

    const dependencies: CommerceParticipationDependencies = {
      commitRegistration: async () => {
        throw rpcError;
      },
      markOrderAttention: async () => {
        orderStatus = "attention";
      },
      markLineAttention: async () => {
        lineStatus = "attention";
      },
      recordIncident: async (failure) => {
        incidents.set(incidentId, {
          order_id: "order-1",
          stripe_session_id: "cs_live_test",
          error_category: failure.category,
          error_message: failure.message,
        });
      },
      linkRegistration: async () => {
        throw new Error("must not link after RPC failure");
      },
      upsertEntitlement: async () => {
        throw new Error("must not create entitlement after RPC failure");
      },
    };

    await expect(
      fulfillCommerceParticipation(participationInput, dependencies),
    ).rejects.toBe(rpcError);
    await expect(
      fulfillCommerceParticipation(participationInput, dependencies),
    ).rejects.toBe(rpcError);

    expect(orderStatus).toBe("attention");
    expect(lineStatus).toBe("attention");
    expect(incidents.size).toBe(1);
    expect(incidents.get(incidentId)).toMatchObject({
      order_id: "order-1",
      stripe_session_id: "cs_live_test",
      error_category: "registration_rpc_invalid_integer",
    });
    expect(incidents.get(incidentId)?.error_message).toBe(
      'Registration RPC rejected non-integer value "59.4"',
    );
    expect(incidents.get(incidentId)?.error_message).not.toMatch(
      /buyer@example\.test|\+46701234567|sk_live_secret/,
    );
  });

  it("wires the generic incident to deterministic upsert without personal data", () => {
    const start = webhookSource.indexOf(
      "async function recordPaidCommerceFulfillmentFailure",
    );
    const end = webhookSource.indexOf(
      "async function recordPaidCapacityConflict",
      start,
    );
    const genericIncidentSource = webhookSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(genericIncidentSource).toContain(
      "commerce_order_id: params.orderId",
    );
    expect(genericIncidentSource).toContain(
      "stripe_session_id: params.stripeSessionId",
    );
    expect(genericIncidentSource).toContain("error_category:");
    expect(genericIncidentSource).toContain("error_message:");
    expect(genericIncidentSource).toContain("{ onConflict: 'id' }");
    expect(genericIncidentSource).not.toMatch(
      /customerId|userId|customer_email|customer_phone/,
    );
  });
});
