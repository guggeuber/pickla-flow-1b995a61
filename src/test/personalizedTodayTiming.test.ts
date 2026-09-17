import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  reportClientEvent: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/lib/clientObservability", () => ({ reportClientEvent: mocks.reportClientEvent }));

import { fetchPersonalizedToday } from "@/lib/personalizedPricing";

describe("authenticated Today client timing", () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.reportClientEvent.mockReset();
  });

  it("includes auth, fetch, parse, retry, request-id, and resource phases in success telemetry", async () => {
    mocks.apiGet.mockImplementation(async (_fn, _endpoint, _params, options) => {
      options.onTiming({
        client_request_id: "client-request-1",
        response_request_id: "client-request-1",
        total_ms: 520,
        auth_ms: 17,
        fetch_ms: 498,
        parse_ms: 5,
        retry_count: 0,
        fetch_attempt_count: 1,
        status: 200,
        auth_state_before: {
          auth_operation_in_flight: false,
          session_read_in_flight: false,
          session_refresh_in_flight: false,
          unauthorized_recovery_in_flight: false,
        },
        resource_timing: { available: false },
      });
      return {
        personalized_pricing: { pricing: [] },
        diagnostics: { timings: { total_ms: 400 } },
      };
    });

    await fetchPersonalizedToday({
      venueSlug: "pickla-arena-sthlm",
      startDate: "2026-09-16",
      endDate: "2026-09-22",
    });

    expect(mocks.reportClientEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "authenticated_today_resolved",
      metadata: expect.objectContaining({
        client_phases: expect.objectContaining({
          client_request_id: "client-request-1",
          auth_ms: 17,
          fetch_ms: 498,
          parse_ms: 5,
          fetch_attempt_count: 1,
        }),
      }),
    }));
  });
});
