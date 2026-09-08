import { describe, expect, it } from "vitest";

import { isUpstreamTransportError } from "../../supabase/functions/_shared/upstream_transport";

describe("upstream transport classification", () => {
  it("recognizes Edge Runtime and browser fetch transport failures", () => {
    expect(isUpstreamTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUpstreamTransportError(new Error(
      "TypeError: error sending request: client error (SendRequest): http2 error: stream error detected",
    ))).toBe(true);
    expect(isUpstreamTransportError({ message: "Network request failed" })).toBe(true);
  });

  it("does not reclassify validation, PostgREST or programming errors", () => {
    expect(isUpstreamTransportError(new Error("Missing venueId"))).toBe(false);
    expect(isUpstreamTransportError(new Error("column commerce_orders.status does not exist"))).toBe(false);
    expect(isUpstreamTransportError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});
