import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getSession: vi.fn(),
  reportApiFailure: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: runtime.getSession,
      refreshSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@/lib/clientObservability", () => ({ reportApiFailure: runtime.reportApiFailure }));

import { ApiRequestError, ApiTransportError, apiGet, classifyClientFailure } from "@/lib/api";

function response(body: unknown, status: number, requestId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-pickla-request-id": requestId,
    },
  });
}

function publicOptions(staleRetained = false) {
  return {
    auth: "omit" as const,
    publicRead: { maxRetries: 1 as const, retryDelayMs: 0, staleRetained },
  };
}

describe("bounded public read retry and incident telemetry", () => {
  beforeEach(() => {
    runtime.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "browser-jwt" } }, error: null });
    runtime.reportApiFailure.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries one classified 503 once, recovers, and emits one final structured event", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({
        error: "Kunde inte hämta data just nu",
        code: "public_read_unavailable",
        error_class: "auth_jwt_validation",
        request_id: "edge-failed",
      }, 503, "edge-failed"))
      .mockResolvedValueOnce(response({ venue: { id: "venue-1" } }, 200, "edge-recovered")));

    await expect(apiGet("api-event-public", "today-primary", {}, publicOptions(true)))
      .resolves.toEqual({ venue: { id: "venue-1" } });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtime.getSession).not.toHaveBeenCalled();
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(new Headers(call[1]?.headers).has("Authorization")).toBe(false);
    }
    expect(runtime.reportApiFailure).toHaveBeenCalledTimes(1);
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "today-primary",
      status: 503,
      request_id: "edge-failed",
      final_request_id: "edge-recovered",
      error_class: "auth_jwt_validation",
      retry_count: 1,
      retry_outcome: "recovered",
      stale_retained: true,
    }));
  });

  it("stops after one retry and reports only the final failed outcome", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ error: "Unavailable", error_class: "transport" }, 503, "edge-1"))
      .mockResolvedValueOnce(response({ error: "Unavailable", error_class: "transport" }, 503, "edge-2")));

    await expect(apiGet("api-bookings", "public-venue", {}, publicOptions(true)))
      .rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtime.reportApiFailure).toHaveBeenCalledTimes(1);
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      request_id: "edge-2",
      initial_request_id: "edge-1",
      retry_count: 1,
      retry_outcome: "failed",
      stale_retained: true,
    }));
  });

  it("does not turn a browser transport failure into a fake HTTP 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")));

    const result = apiGet("api-bookings", "public-venue", {}, {
      auth: "omit",
      publicRead: { maxRetries: 0, retryDelayMs: 0 },
    });

    await expect(result).rejects.toMatchObject({
      name: "ApiTransportError",
      failureKind: "network_error",
    });
    await expect(result).rejects.not.toHaveProperty("status");
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      failure_kind: "network_error",
      error_class: "network_error",
    }));
    expect(runtime.reportApiFailure.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("keeps a real HTTP 503 as an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Unavailable" }, 503, "edge-real-503")));

    const error = await apiGet("api-bookings", "public-venue", {}, {
      auth: "omit",
      publicRead: { maxRetries: 0, retryDelayMs: 0 },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).not.toBeInstanceOf(ApiTransportError);
    expect(error).toMatchObject({ status: 503 });
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      status: 503,
      failure_kind: "real_http_5xx",
    }));
  });

  it("classifies timeout, abort, offline, service worker, and unknown transport separately", () => {
    expect(classifyClientFailure(Object.assign(new Error("deadline"), { name: "TimeoutError" }))).toBe("timeout");
    const timeoutSignal = {
      aborted: true,
      reason: Object.assign(new Error("deadline"), { name: "TimeoutError" }),
    } as AbortSignal;
    expect(classifyClientFailure(Object.assign(new Error("cancelled"), { name: "AbortError" }), timeoutSignal)).toBe("timeout");
    expect(classifyClientFailure(Object.assign(new Error("cancelled"), { name: "AbortError" }))).toBe("aborted");
    expect(classifyClientFailure(Object.assign(new Error("worker"), { name: "ServiceWorkerError" }))).toBe("service_worker_failure");
    expect(classifyClientFailure(new Error("opaque failure"))).toBe("unknown_transport_failure");

    const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    expect(classifyClientFailure(new TypeError("Load failed"))).toBe("offline");
    if (online) Object.defineProperty(navigator, "onLine", online);
    else Reflect.deleteProperty(navigator, "onLine");
  });

  it("retries the deterministic simulation of the legacy JWT-future 500", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ error: "JWT issued at future" }, 500, "edge-old"))
      .mockResolvedValueOnce(response({ ok: true }, 200, "edge-new")));

    await expect(apiGet("api-event-public", "today-primary", {}, publicOptions()))
      .resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      retry_count: 1,
      retry_outcome: "recovered",
    }));
  });

  it.each([
    [404, { error: "Venue not found", code: "venue_not_found", error_class: "not_found" }],
    [400, { error: "Venue and valid date range are required" }],
    [500, { error: "Deterministic application invariant failed" }],
  ])("does not retry deterministic status %s", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status, `edge-${status}`)));
    await expect(apiGet("api-event-public", "today-primary", {}, publicOptions()))
      .rejects.toBeInstanceOf(ApiRequestError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runtime.reportApiFailure).toHaveBeenCalledWith(expect.objectContaining({
      retry_count: 0,
      retry_outcome: "failed",
    }));
  });

  it("retries one network failure without leaking the browser session into the public request", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ ok: true }, 200, "edge-network-recovered")));

    await expect(apiGet("api-event-public", "today-primary", {}, publicOptions()))
      .resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtime.getSession).not.toHaveBeenCalled();
    expect(runtime.reportApiFailure).toHaveBeenCalledTimes(1);
  });

  it("puts a privacy-safe request id on public GETs without adding a preflight header", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const requestId = new URL(url).searchParams.get("pickla_request_id");
      return Promise.resolve(response({ ok: true }, 200, requestId || "missing"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("api-event-public", "today-primary", {}, publicOptions())).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    const requestId = new URL(url).searchParams.get("pickla_request_id");
    expect(requestId).toMatch(/^[a-zA-Z0-9-]{8,80}$/);
    expect(new Headers(init.headers).has("x-pickla-request-id")).toBe(false);
  });

  it("sends and receives the same correlation id on authenticated requests", async () => {
    let observedRequestId = "";
    let timingRequestId = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      observedRequestId = new Headers(init.headers).get("x-pickla-request-id") || "";
      return Promise.resolve(response({ ok: true }, 200, observedRequestId));
    }));

    await apiGet("api-event-public", "today-personalized", {}, {
      onTiming: (timing) => { timingRequestId = timing.response_request_id || ""; },
    });

    expect(observedRequestId).toMatch(/^[a-zA-Z0-9-]{8,80}$/);
    expect(timingRequestId).toBe(observedRequestId);
  });
});
