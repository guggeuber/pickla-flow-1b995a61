import test from "node:test";
import assert from "node:assert/strict";
import { safeFailure, withPaymentBrowser } from "./release-stripe-payment-window.mjs";

test("payment browser remains open until the provider result settles", async () => {
  let closed = false;
  let finish;
  const provider = new Promise((resolve) => { finish = resolve; });
  const pending = withPaymentBrowser({ close: async () => { closed = true; } }, async () => {
    assert.equal(closed, false);
    const result = await provider;
    assert.equal(closed, false);
    return result;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  finish("paid");
  assert.equal(await pending, "paid");
  assert.equal(closed, true);
});

test("failure report never includes an underlying secret-bearing error message", () => {
  const report = safeFailure(new Error("sk_test_sensitive-never-log"), { phase: "provider_payment" });
  assert.equal(report.classification, "unexpected_harness_failure");
  assert.equal(JSON.stringify(report).includes("sk_test_"), false);
});
