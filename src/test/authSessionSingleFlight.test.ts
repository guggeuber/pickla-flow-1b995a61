import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

import {
  getSessionSingleFlight,
  recoverSessionAfterUnauthorized,
  refreshSessionSingleFlight,
  subscribeToTerminalAuthFailure,
  terminateInvalidSessionSingleFlight,
  type UnauthorizedRecoveryDependencies,
} from "@/lib/authSessionSingleFlight";

type SessionReader = NonNullable<Parameters<typeof getSessionSingleFlight>[0]>;
type SessionReadResult = Awaited<ReturnType<SessionReader>>;
type SessionRefresher = NonNullable<Parameters<typeof refreshSessionSingleFlight>[0]>;
type SessionRefreshResult = Awaited<ReturnType<SessionRefresher>>;
type RecoverySessionReader = NonNullable<UnauthorizedRecoveryDependencies["getSession"]>;
type RecoverySessionRefresher = NonNullable<UnauthorizedRecoveryDependencies["refreshSession"]>;

function sessionReadResult(accessToken: string | null): SessionReadResult {
  return {
    data: { session: accessToken ? { access_token: accessToken } : null },
    error: null,
  } as SessionReadResult;
}

function sessionRefreshResult(accessToken: string | null): SessionRefreshResult {
  return {
    data: { session: accessToken ? { access_token: accessToken } : null, user: null },
    error: null,
  } as SessionRefreshResult;
}

afterEach(async () => {
  await Promise.resolve();
  vi.restoreAllMocks();
});

describe("auth session single-flight", () => {
  it("shares one session read across concurrent bootstrap and request-header consumers", async () => {
    let finish: (value: SessionReadResult) => void = () => undefined;
    const pending = new Promise<SessionReadResult>((resolve) => { finish = resolve; });
    const readSession = vi.fn<SessionReader>(() => pending);

    const bootstrapRead = getSessionSingleFlight(readSession);
    const checkoutHeaderRead = getSessionSingleFlight(readSession);
    expect(readSession).toHaveBeenCalledTimes(1);

    finish(sessionReadResult(null));
    await expect(Promise.all([bootstrapRead, checkoutHeaderRead])).resolves.toHaveLength(2);
  });

  it("shares one refresh across simultaneous recovery callers", async () => {
    let finish: (value: SessionRefreshResult) => void = () => undefined;
    const pending = new Promise<SessionRefreshResult>((resolve) => { finish = resolve; });
    const refreshSession = vi.fn<SessionRefresher>(() => pending);

    const accountRecovery = refreshSessionSingleFlight(refreshSession);
    const checkoutRecovery = refreshSessionSingleFlight(refreshSession);
    expect(refreshSession).toHaveBeenCalledTimes(1);

    finish(sessionRefreshResult("fresh"));
    await expect(Promise.all([accountRecovery, checkoutRecovery])).resolves.toHaveLength(2);
  });

  it("does not overlap a bootstrap session read with checkout refresh", async () => {
    let finishRead: (value: SessionReadResult) => void = () => undefined;
    const pendingRead = new Promise<SessionReadResult>((resolve) => { finishRead = resolve; });
    const readSession = vi.fn<SessionReader>(() => pendingRead);
    const refreshSession = vi.fn<SessionRefresher>().mockResolvedValue(sessionRefreshResult("fresh"));

    const bootstrapRead = getSessionSingleFlight(readSession);
    const checkoutRefresh = refreshSessionSingleFlight(refreshSession);
    await Promise.resolve();
    expect(readSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();

    finishRead(sessionReadResult(null));
    await bootstrapRead;
    await expect(checkoutRefresh).resolves.toMatchObject({
      data: { session: { access_token: "fresh" } },
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("shares one rejected-token recovery across ten concurrent callers", async () => {
    let accessToken = "rejected-token";
    let finishRefresh: () => void = () => undefined;
    const refreshPending = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const getSession = vi.fn<RecoverySessionReader>(async () => sessionReadResult(accessToken));
    const refreshSession = vi.fn<RecoverySessionRefresher>(async () => {
      await refreshPending;
      accessToken = "fresh-token";
      return sessionRefreshResult(accessToken);
    });

    const recoveries = Array.from({ length: 10 }, () => recoverSessionAfterUnauthorized(
      "rejected-token",
      { getSession, refreshSession },
    ));

    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    finishRefresh();
    await expect(Promise.all(recoveries)).resolves.toEqual(
      Array.from({ length: 10 }, () => ({ accessToken: "fresh-token", error: null })),
    );
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("reuses a token rotated before a slower 401 handler recovers", async () => {
    const getSession = vi.fn<RecoverySessionReader>().mockResolvedValue(sessionReadResult("already-rotated-token"));
    const refreshSession = vi.fn<RecoverySessionRefresher>();

    await expect(recoverSessionAfterUnauthorized("rejected-token", {
      getSession,
      refreshSession,
    })).resolves.toEqual({ accessToken: "already-rotated-token", error: null });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("single-flights terminal local sign-out and notifies the UI once", async () => {
    let finishSignOut: () => void = () => undefined;
    const pendingSignOut = new Promise<void>((resolve) => { finishSignOut = resolve; });
    const signOut = vi.fn(() => pendingSignOut);
    const listener = vi.fn();
    const unsubscribe = subscribeToTerminalAuthFailure(listener);

    const first = terminateInvalidSessionSingleFlight(signOut);
    const second = terminateInvalidSessionSingleFlight(signOut);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);

    finishSignOut();
    await Promise.all([first, second]);
    unsubscribe();
  });
});
