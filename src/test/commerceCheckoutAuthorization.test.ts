import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  reportApiFailure: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock("@/lib/clientObservability", () => ({
  reportApiFailure: mocks.reportApiFailure,
}));

import { apiPost } from "@/lib/api";

const CART_TOKEN = "opaque-cart-token-that-is-long-enough-for-tests";

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.reportApiFailure.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("commerce checkout Authorization", () => {
  it("omits Authorization for an explicit guest checkout and keeps the cart token in the body", async () => {
    await apiPost("api-commerce", "checkout", { token: CART_TOKEN }, { auth: "omit" });

    expect(mocks.getSession).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({ token: CART_TOKEN });
  });

  it("omits Authorization when the current Supabase session is absent", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await apiPost("api-commerce", "checkout", { token: CART_TOKEN });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses only the Supabase session access token as bearer and never the cart token", async () => {
    const accessToken = "header.payload.signature";
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: accessToken } } });

    await apiPost("api-commerce", "checkout", { token: CART_TOKEN });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${accessToken}`);
    expect(headers.Authorization).not.toContain(CART_TOKEN);
  });
});
