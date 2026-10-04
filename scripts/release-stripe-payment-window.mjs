// Keep Checkout open while Stripe processes the submitted TEST payment.
export async function withPaymentBrowser(browser, action) {
  try { return await action(); } finally { await browser.close(); }
}

// Error messages from HTTP, browser, and SQL clients may contain URLs or secrets.
export function safeFailure(error, state) {
  return { status: "FAIL", phase: state.phase, classification: error.code || (error.name === "TimeoutError" ? "browser_timeout" : error.name === "AbortError" ? "network_timeout" : "unexpected_harness_failure"), diagnosis: state };
}
