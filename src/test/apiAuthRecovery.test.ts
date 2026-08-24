import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authRuntime = vi.hoisted(() => ({
  accessToken: "valid-token" as string | null,
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: authRuntime.getSession,
      refreshSession: authRuntime.refreshSession,
      signOut: authRuntime.signOut,
    },
  },
}));

vi.mock("@/lib/clientObservability", () => ({ reportApiFailure: vi.fn() }));

import { ApiRequestError, apiDelete, apiGet, apiPatch } from "@/lib/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorization(init?: RequestInit) {
  return new Headers(init?.headers).get("Authorization");
}

describe("canonical API auth recovery", () => {
  beforeEach(async () => {
    await Promise.resolve();
    authRuntime.accessToken = "valid-token";
    authRuntime.getSession.mockReset().mockImplementation(async () => ({
      data: {
        session: authRuntime.accessToken
          ? { access_token: authRuntime.accessToken, user: { id: "user-id" } }
          : null,
      },
      error: null,
    }));
    authRuntime.refreshSession.mockReset().mockImplementation(async () => {
      authRuntime.accessToken = "fresh-token";
      return { data: { session: { access_token: "fresh-token", user: { id: "user-id" } } }, error: null };
    });
    authRuntime.signOut.mockReset().mockImplementation(async (options) => {
      authRuntime.accessToken = null;
      return { data: null, error: null, options };
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
  });

  afterEach(async () => {
    await Promise.resolve();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a valid session once and does not refresh", async () => {
    await expect(apiGet<{ ok: boolean }>("api-test", "protected")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(authorization(vi.mocked(fetch).mock.calls[0][1])).toBe("Bearer valid-token");
    expect(authRuntime.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes a rejected bearer once and retries the request once", async () => {
    authRuntime.accessToken = "rejected-token";
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => (
      authorization(init) === "Bearer rejected-token"
        ? jsonResponse({ error: "Unauthorized" }, 401)
        : jsonResponse({ ok: true })
    )));

    await expect(apiGet<{ ok: boolean }>("api-test", "protected")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(authorization(vi.mocked(fetch).mock.calls[1][1])).toBe("Bearer fresh-token");
  });

  it("recovers ten simultaneous rejected requests with one refresh and one retry each", async () => {
    authRuntime.accessToken = "rejected-token";
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => (
      authorization(init) === "Bearer rejected-token"
        ? jsonResponse({ error: "Unauthorized" }, 401)
        : jsonResponse({ ok: true })
    )));

    const requests = Array.from({ length: 10 }, (_, index) => (
      apiGet<{ ok: boolean }>("api-test", `protected-${index}`)
    ));
    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 10 }, () => ({ ok: true })),
    );
    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it("lets a slower 401 handler reuse a token already rotated by another request", async () => {
    authRuntime.accessToken = "rejected-token";
    let oldTokenCalls = 0;
    let releaseSlow401: (response: Response) => void = () => undefined;
    const slow401 = new Promise<Response>((resolve) => { releaseSlow401 = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (authorization(init) === "Bearer fresh-token") return jsonResponse({ ok: true });
      oldTokenCalls += 1;
      return oldTokenCalls === 1 ? jsonResponse({ error: "Unauthorized" }, 401) : slow401;
    }));

    const fast = apiGet<{ ok: boolean }>("api-test", "fast");
    const slow = apiGet<{ ok: boolean }>("api-test", "slow");
    await expect(fast).resolves.toEqual({ ok: true });
    releaseSlow401(jsonResponse({ error: "Unauthorized" }, 401));
    await expect(slow).resolves.toEqual({ ok: true });

    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("terminally signs out once when ten requests cannot refresh", async () => {
    authRuntime.accessToken = "rejected-token";
    authRuntime.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid refresh token"),
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Unauthorized" }, 401)));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => apiGet("api-test", `protected-${index}`)),
    );

    expect(results.every((result) => (
      result.status === "rejected"
      && result.reason instanceof ApiRequestError
      && result.reason.status === 401
    ))).toBe(true);
    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(authRuntime.signOut).toHaveBeenCalledTimes(1);
    expect(authRuntime.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it("does not restart terminal recovery when a slower original 401 arrives", async () => {
    authRuntime.accessToken = "staggered-rejected-token";
    authRuntime.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Invalid refresh token"),
    });
    let releaseSlow401: (response: Response) => void = () => undefined;
    const slow401 = new Promise<Response>((resolve) => { releaseSlow401 = resolve; });
    let initialCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      initialCalls += 1;
      return initialCalls === 1 ? jsonResponse({ error: "Unauthorized" }, 401) : slow401;
    }));

    const fast = apiGet("api-test", "terminal-fast");
    const slow = apiGet("api-test", "terminal-slow");
    await expect(fast).rejects.toMatchObject({ status: 401 });
    releaseSlow401(jsonResponse({ error: "Unauthorized" }, 401));
    await expect(slow).rejects.toMatchObject({ status: 401 });

    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(authRuntime.signOut).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops after one retry when the refreshed token is also rejected", async () => {
    authRuntime.accessToken = "retry-once-rejected-token";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Unauthorized" }, 401)));

    await expect(apiGet("api-test", "retry-once")).rejects.toMatchObject({ status: 401 });

    expect(authRuntime.refreshSession).toHaveBeenCalledTimes(1);
    expect(authRuntime.signOut).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes PATCH and DELETE failures with status-aware API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Forbidden" }, 403)));

    await expect(apiPatch("api-test", "resource", { enabled: true })).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 403,
    });
    await expect(apiDelete("api-test", "resource", { id: "resource-id" })).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 403,
    });
    expect(authRuntime.refreshSession).not.toHaveBeenCalled();
  });
});
