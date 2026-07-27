import { describe, expect, it, vi } from "vitest";

import {
  getSessionSingleFlight,
  refreshSessionSingleFlight,
} from "@/lib/authSessionSingleFlight";

describe("auth session single-flight", () => {
  it("shares one session read across concurrent bootstrap and request-header consumers", async () => {
    let finish: (value: any) => void = () => undefined;
    const pending = new Promise<any>((resolve) => { finish = resolve; });
    const readSession = vi.fn(() => pending);

    const bootstrapRead = getSessionSingleFlight(readSession);
    const checkoutHeaderRead = getSessionSingleFlight(readSession);
    expect(readSession).toHaveBeenCalledTimes(1);

    finish({ data: { session: null }, error: null });
    await expect(Promise.all([bootstrapRead, checkoutHeaderRead])).resolves.toHaveLength(2);
  });

  it("shares one refresh across simultaneous recovery callers", async () => {
    let finish: (value: any) => void = () => undefined;
    const pending = new Promise<any>((resolve) => { finish = resolve; });
    const refreshSession = vi.fn(() => pending);

    const accountRecovery = refreshSessionSingleFlight(refreshSession);
    const checkoutRecovery = refreshSessionSingleFlight(refreshSession);
    expect(refreshSession).toHaveBeenCalledTimes(1);

    finish({ data: { session: { access_token: "fresh" } }, error: null });
    await expect(Promise.all([accountRecovery, checkoutRecovery])).resolves.toHaveLength(2);
  });

  it("does not overlap a bootstrap session read with checkout refresh", async () => {
    let finishRead: (value: any) => void = () => undefined;
    const pendingRead = new Promise<any>((resolve) => { finishRead = resolve; });
    const readSession = vi.fn(() => pendingRead);
    const refreshSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "fresh" } },
      error: null,
    });

    const bootstrapRead = getSessionSingleFlight(readSession);
    const checkoutRefresh = refreshSessionSingleFlight(refreshSession);
    await Promise.resolve();
    expect(readSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();

    finishRead({ data: { session: null }, error: null });
    await bootstrapRead;
    await expect(checkoutRefresh).resolves.toMatchObject({
      data: { session: { access_token: "fresh" } },
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
