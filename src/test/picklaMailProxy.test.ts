import { afterEach, describe, expect, it, vi } from "vitest";
import mailProxy from "../../api/mail";

const credential = "proxy-current:test-only-proxy-secret-000000000000000000";
const originalCredential = process.env.PICKLA_MAIL_PROXY_CREDENTIAL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCredential === undefined) delete process.env.PICKLA_MAIL_PROXY_CREDENTIAL;
  else process.env.PICKLA_MAIL_PROXY_CREDENTIAL = originalCredential;
});

describe("Pickla Mail same-origin proxy", () => {
  it("fails closed when its server-only credential is absent", async () => {
    delete process.env.PICKLA_MAIL_PROXY_CREDENTIAL;
    const response = await mailProxy.fetch(new Request("https://playpickla.com/mail/subscribe?action=subscribe", {
      method: "POST",
      body: "{}",
    }));
    expect(response.status).toBe(503);
  });

  it("forwards a bounded signup with the trusted credential and Vercel client IP", async () => {
    process.env.PICKLA_MAIL_PROXY_CREDENTIAL = credential;
    let calledUrl: URL | RequestInfo | undefined;
    let calledInit: RequestInit | undefined;
    const upstream = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calledUrl = input;
      calledInit = init;
      return Response.json({ accepted: true, confirmation_required: true }, { status: 202 });
    });
    vi.stubGlobal("fetch", upstream);
    const body = JSON.stringify({ email: "canary@example.test", consent: true });
    const response = await mailProxy.fetch(new Request("https://playpickla.com/mail/subscribe?action=subscribe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.8",
      },
      body,
    }));

    expect(response.status).toBe(202);
    expect(upstream).toHaveBeenCalledOnce();
    expect(String(calledUrl)).toBe("https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-communications/subscribe");
    expect(calledInit?.headers).toMatchObject({
      "x-pickla-client-network": "203.0.113.8",
      "x-pickla-mail-proxy": credential,
    });
    expect(new TextDecoder().decode(calledInit?.body as ArrayBuffer)).toBe(body);
  });

  it("forwards only the opaque confirmation token and rejects unsupported actions", async () => {
    process.env.PICKLA_MAIL_PROXY_CREDENTIAL = credential;
    let calledUrl: URL | RequestInfo | undefined;
    const upstream = vi.fn(async (input: URL | RequestInfo) => {
      calledUrl = input;
      return new Response("<!doctype html><title>Pickla Mail</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const confirmed = await mailProxy.fetch(new Request("https://playpickla.com/mail/confirm?action=confirm&token=opaque-token&ignored=value", {
      headers: { "x-forwarded-for": "2001:db8::1" },
    }));
    expect(confirmed.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(String(calledUrl)).toBe("https://ptnvhbniiiapzbyofctg.supabase.co/functions/v1/api-communications/confirm?token=opaque-token");

    const rejected = await mailProxy.fetch(new Request("https://playpickla.com/mail/delete?action=delete"));
    expect(rejected.status).toBe(404);
  });

  it.each([
    {
      name: "incorrect upstream text/plain",
      upstreamHeaders: { "content-type": "text/plain; charset=utf-8" },
    },
    {
      name: "missing upstream Content-Type",
      upstreamHeaders: {},
    },
  ])("forces renderable HTML at the final public response boundary with $name", async ({ upstreamHeaders }) => {
    process.env.PICKLA_MAIL_PROXY_CREDENTIAL = credential;
    const html = "<!doctype html><html><head><title>Email confirmation · Pickla</title></head><body><main><h1>You're in 🥒</h1></main></body></html>";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode(html), {
      status: 200,
      headers: upstreamHeaders,
    })));

    const response = await mailProxy.fetch(new Request(
      "https://playpickla.com/mail/confirm?action=confirm&token=opaque-token",
      { headers: { "x-forwarded-for": "203.0.113.8" } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );

    const document = new DOMParser().parseFromString(await response.text(), "text/html");
    expect(document.title).toBe("Email confirmation · Pickla");
    expect(document.querySelector("h1")?.textContent).toBe("You're in 🥒");
    expect(document.body.textContent).not.toContain("<!doctype html>");
  });

  it("rejects oversized signup bodies before calling upstream", async () => {
    process.env.PICKLA_MAIL_PROXY_CREDENTIAL = credential;
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await mailProxy.fetch(new Request("https://playpickla.com/mail/subscribe?action=subscribe", {
      method: "POST",
      headers: { "content-length": "4097" },
      body: "{}",
    }));
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
});
