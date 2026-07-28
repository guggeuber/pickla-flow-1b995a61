import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, "locks");

function testJwt(expiresAt: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: expiresAt })}.test-signature`;
}

function storedSession(expiresAt: number) {
  return {
    access_token: testJwt(expiresAt),
    refresh_token: "test-refresh-token",
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "auth-resilience-user",
      aud: "authenticated",
      role: "authenticated",
      email: "auth-resilience@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-07-28T00:00:00.000Z",
    },
  };
}

function createStoredClient(
  session: ReturnType<typeof storedSession> | null,
  fetcher: typeof fetch = fetch,
  id = "default",
) {
  const projectRef = `auth-resilience-${id}`;
  const storageKey = `sb-${projectRef}-auth-token`;
  const values = new Map<string, string>();
  if (session) values.set(storageKey, JSON.stringify(session));

  const client = createClient(`https://${projectRef}.supabase.co`, "test-anon-key", {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
      },
    },
    global: { fetch: fetcher },
  });

  return { client, storageKey, values };
}

function restoreNavigatorLocks() {
  if (originalLocksDescriptor) {
    Object.defineProperty(navigator, "locks", originalLocksDescriptor);
    return;
  }
  Reflect.deleteProperty(navigator, "locks");
}

describe("Supabase auth SDK coordination", () => {
  afterEach(() => {
    restoreNavigatorLocks();
    vi.restoreAllMocks();
  });

  it("does not use navigator.locks for default session coordination", async () => {
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: () => Promise<unknown>,
    ) => callback());
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    const { client } = createStoredClient(null, fetch, "no-lock");

    const [first, second] = await Promise.all([
      client.auth.getSession(),
      client.auth.getSession(),
    ]);

    expect(first).toMatchObject({ data: { session: null }, error: null });
    expect(second).toMatchObject({ data: { session: null }, error: null });
    expect(request).not.toHaveBeenCalled();
  });

  it("single-flights concurrent session reads while refreshing an expired session", async () => {
    const refreshed = storedSession(Math.floor(Date.now() / 1000) + 3600);
    const refreshFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(refreshed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const { client, storageKey, values } = createStoredClient(
      storedSession(Math.floor(Date.now() / 1000) - 60),
      refreshFetch,
      "expired",
    );

    const [first, second] = await Promise.all([
      client.auth.getSession(),
      client.auth.getSession(),
    ]);

    expect(refreshFetch).toHaveBeenCalledTimes(1);
    expect(first.data.session?.access_token).toBe(refreshed.access_token);
    expect(second.data.session?.access_token).toBe(refreshed.access_token);
    expect(JSON.parse(values.get(storageKey) ?? "null")).toMatchObject({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    });
  });

  it("clears an expired persisted session when its refresh token is invalid", async () => {
    const expectedErrorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refreshFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: "refresh_token_not_found",
      msg: "Invalid Refresh Token: Refresh Token Not Found",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));
    const { client, storageKey, values } = createStoredClient(
      storedSession(Math.floor(Date.now() / 1000) - 60),
      refreshFetch,
      "invalid-refresh",
    );

    const result = await client.auth.getSession();

    expect(refreshFetch).toHaveBeenCalledTimes(1);
    expect(result.data.session).toBeNull();
    expect(values.has(storageKey)).toBe(false);
    expect(expectedErrorLog).toHaveBeenCalledOnce();
  });
});
