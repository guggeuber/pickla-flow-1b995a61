import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  CHECKOUT_EMAIL_REQUIRED_MESSAGE,
  PURCHASE_SESSION_ERROR_MESSAGE,
  PurchaseSessionError,
  isAuthSessionFailure,
  isCartVersionConflict,
  isCheckoutEmailRequired,
  purchaseErrorMessage,
  withPurchaseSessionRecovery,
} from "@/lib/purchaseSessionRecovery";

function apiError(message: string, status: number) {
  return Object.assign(new Error(message), { name: "ApiRequestError", status });
}

const refreshedSession = {
  data: { session: { access_token: "fresh-access-token" } },
  error: null,
};

const commerceApiSource = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");

describe("program purchase session recovery", () => {
  it("uses a valid session without refreshing", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const refresh = vi.fn();

    await expect(withPurchaseSessionRecovery(request, refresh)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes an expired access token once and retries once", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(apiError("JWT expired", 401))
      .mockResolvedValueOnce({ orderId: "order-1" });
    const refresh = vi.fn().mockResolvedValue(refreshedSession);

    await expect(withPurchaseSessionRecovery(request, refresh)).resolves.toEqual({ orderId: "order-1" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("recovers the exact unverifiable checkout JWT response without creating two Stripe sessions", async () => {
    let stripeSessionsCreated = 0;
    const request = vi.fn()
      .mockRejectedValueOnce(apiError(
        "invalid JWT: unable to parse or verify signature, token is unverifiable: unrecognized JWT kid <nil> for algorithm ES256",
        400,
      ))
      .mockImplementationOnce(async () => ({ stripeSessionId: `cs_test_${++stripeSessionsCreated}` }));
    const refresh = vi.fn().mockResolvedValue(refreshedSession);

    await expect(withPurchaseSessionRecovery(request, refresh)).resolves.toEqual({ stripeSessionId: "cs_test_1" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stripeSessionsCreated).toBe(1);
  });

  it("shows customer-safe copy when both access and refresh tokens are expired", async () => {
    const request = vi.fn().mockRejectedValue(apiError("Invalid JWT", 401));
    const refresh = vi.fn().mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid Refresh Token: Refresh Token Not Found"),
    });

    await expect(withPurchaseSessionRecovery(request, refresh)).rejects.toEqual(new PurchaseSessionError());
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("uses one explicitly permitted guest checkout after refresh fails", async () => {
    const request = vi.fn().mockRejectedValue(apiError("invalid JWT: token is unverifiable", 400));
    const refresh = vi.fn().mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid Refresh Token"),
    });
    const guestCheckout = vi.fn().mockResolvedValue({ url: "https://checkout.example/guest" });

    await expect(withPurchaseSessionRecovery(request, refresh, guestCheckout)).resolves.toEqual({
      url: "https://checkout.example/guest",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(guestCheckout).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale page left open overnight without starting a retry loop", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(apiError("token expired", 401))
      .mockRejectedValueOnce(apiError("token expired", 401));
    const refresh = vi.fn().mockResolvedValue(refreshedSession);

    await expect(withPurchaseSessionRecovery(request, refresh)).rejects.toMatchObject({
      message: PURCHASE_SESSION_ERROR_MESSAGE,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("leaves an anonymous successful request alone", async () => {
    const request = vi.fn().mockResolvedValue({ guest: true });
    const refresh = vi.fn();

    await expect(withPurchaseSessionRecovery(request, refresh)).resolves.toEqual({ guest: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waits for a slow request without issuing another request", async () => {
    let resolveRequest: (value: { ok: boolean }) => void = () => undefined;
    const pending = new Promise<{ ok: boolean }>((resolve) => { resolveRequest = resolve; });
    const request = vi.fn(() => pending);
    const refresh = vi.fn();
    const result = withPurchaseSessionRecovery(request, refresh);

    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    resolveRequest({ ok: true });
    await expect(result).resolves.toEqual({ ok: true });
  });

  it("does not hide unrelated client or server failures", async () => {
    for (const error of [
      apiError("Capacity is full", 409),
      apiError("JWT parser crashed", 500),
    ]) {
      const request = vi.fn().mockRejectedValue(error);
      const refresh = vi.fn();
      await expect(withPurchaseSessionRecovery(request, refresh)).rejects.toBe(error);
      expect(refresh).not.toHaveBeenCalled();
      expect(purchaseErrorMessage(error, "fallback")).toBe(error.message);
    }
  });

  it("does not retry an ambiguous network timeout after checkout may have mutated", async () => {
    const timeout = new TypeError("Failed to fetch");
    const request = vi.fn().mockRejectedValue(timeout);
    const refresh = vi.fn();
    const guestCheckout = vi.fn();

    await expect(withPurchaseSessionRecovery(request, refresh, guestCheckout)).rejects.toBe(timeout);
    expect(request).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(guestCheckout).not.toHaveBeenCalled();
  });

  it("never returns raw auth terminology to the customer", () => {
    for (const rawMessage of [
      "JWT expired",
      "token expired",
      "invalid token",
      "authorization header missing",
      "Unauthorized",
    ]) {
      const error = apiError(rawMessage, 401);
      expect(isAuthSessionFailure(error)).toBe(true);
      expect(purchaseErrorMessage(error, "fallback")).toBe(PURCHASE_SESSION_ERROR_MESSAGE);
    }

    const productionError = apiError(
      "invalid JWT: unable to parse or verify signature, token is unverifiable: unrecognized JWT kid <nil> for algorithm ES256",
      400,
    );
    expect(isAuthSessionFailure(productionError)).toBe(true);
    expect(purchaseErrorMessage(productionError, "fallback")).toBe(PURCHASE_SESSION_ERROR_MESSAGE);

    const wrongProjectKey = apiError(
      "invalid JWT: token is unverifiable: unrecognized JWT kid foreign-project-key for algorithm ES256",
      400,
    );
    expect(isAuthSessionFailure(wrongProjectKey)).toBe(true);
    expect(purchaseErrorMessage(wrongProjectKey, "fallback")).toBe(PURCHASE_SESSION_ERROR_MESSAGE);

    const stolenLock = new Error('Lock "sb-project-auth-token" was released because another request stole it');
    expect(isAuthSessionFailure(stolenLock)).toBe(true);
    expect(purchaseErrorMessage(stolenLock, "fallback")).toBe(PURCHASE_SESSION_ERROR_MESSAGE);
  });

  it("keeps missing-email and cart-version failures separate from auth recovery", () => {
    const missingEmail = apiError(CHECKOUT_EMAIL_REQUIRED_MESSAGE, 400);
    const changedCart = apiError("Cart changed — review it again.", 409);

    expect(isCheckoutEmailRequired(missingEmail)).toBe(true);
    expect(isAuthSessionFailure(missingEmail)).toBe(false);
    expect(isCartVersionConflict(changedCart)).toBe(true);
    expect(isAuthSessionFailure(changedCart)).toBe(false);
    expect(purchaseErrorMessage(changedCart, "fallback")).toBe(changedCart.message);
  });

  it("can only retry auth rejection before commerce mutation begins", () => {
    const requestAuth = commerceApiSource.indexOf("const { userId } = await optionalUser(req)");
    const cartInsert = commerceApiSource.indexOf(".from('commerce_orders').insert({");
    const stripeCreate = commerceApiSource.indexOf("stripeSession = await createStripeCheckoutSession");

    expect(requestAuth).toBeGreaterThan(-1);
    expect(cartInsert).toBeGreaterThan(requestAuth);
    expect(stripeCreate).toBeGreaterThan(cartInsert);
    expect(stripeCreate).toBeGreaterThan(requestAuth);
    expect(commerceApiSource).toContain("if (order.status !== 'draft')");
    expect(commerceApiSource).toContain("if (order.version !== Number(body.expected_version))");
    expect(commerceApiSource).toContain("attach_commerce_order_stripe_session");
  });
});
