import { describe, expect, it } from "vitest";

import { shouldRetryQuery } from "@/lib/queryRetry";

function statusError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("React Query retry policy", () => {
  it("never retries authorization failures", () => {
    expect(shouldRetryQuery(0, statusError(401))).toBe(false);
    expect(shouldRetryQuery(0, statusError(403))).toBe(false);
  });

  it("keeps network and 5xx retries bounded", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(2, statusError(503))).toBe(true);
    expect(shouldRetryQuery(3, statusError(503))).toBe(false);
    expect(shouldRetryQuery(0, statusError(400))).toBe(false);
  });
});
