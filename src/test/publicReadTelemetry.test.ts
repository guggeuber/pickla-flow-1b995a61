import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const telemetryRuntime = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: telemetryRuntime.getSession,
      refreshSession: telemetryRuntime.refreshSession,
      signOut: telemetryRuntime.signOut,
    },
  },
}));

import { reportApiFailure } from "@/lib/clientObservability";

describe("public read client telemetry payload", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/today?v=pickla-arena-sthlm");
    telemetryRuntime.getSession.mockReset().mockResolvedValue({
      data: {
        session: {
          access_token: "raw-browser-jwt-must-not-enter-body",
          user: { id: "raw-auth-user-id", email: "private@example.test" },
        },
      },
      error: null,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("includes final retry/correlation state and excludes private identity or credentials from the event body", async () => {
    reportApiFailure({
      method: "GET",
      fn: "api-event-public",
      endpoint: "today-primary-telemetry-test",
      status: 503,
      message: "JWT issued at future",
      duration_ms: 740,
      request_id: "edge-request-1",
      final_request_id: "edge-request-2",
      error_class: "auth_jwt_validation",
      retry_count: 1,
      retry_outcome: "recovered",
      stale_retained: true,
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request[1]?.body));
    const serializedBody = JSON.stringify(body);

    expect(body).toMatchObject({
      event_type: "client_public_read_incident",
      severity: "warning",
      metadata: {
        endpoint: "today-primary-telemetry-test",
        status: 503,
        request_id: "edge-request-1",
        final_request_id: "edge-request-2",
        error_class: "auth_jwt_validation",
        retry_count: 1,
        retry_outcome: "recovered",
        stale_retained: true,
        duration_ms: 740,
      },
    });
    expect(body.metadata.release).toEqual(expect.any(String));
    expect(serializedBody).not.toContain("raw-browser-jwt-must-not-enter-body");
    expect(serializedBody).not.toContain("raw-auth-user-id");
    expect(serializedBody).not.toContain("private@example.test");
    expect(serializedBody).not.toContain("customer_id");
    expect(serializedBody).not.toContain("Authorization");
  });
});
