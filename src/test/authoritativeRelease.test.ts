import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AUTHORITATIVE_RELEASE_URL,
  classifyFrontendRelease,
  fetchAuthoritativeFrontendRelease,
  FrontendReleaseLookupError,
} from "@/lib/frontendRelease";

const requestId = "request0123456789abcdef";
const release = {
  sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  built_at: "2026-09-20T10:00:00.000Z",
  deployment_id: "dpl_release_b",
  deployment_url: "pickla-release-b.vercel.app",
  environment: "production",
  request_id: requestId,
  served_at: "2026-09-20T10:00:01.000Z",
};

function response(payload: unknown, init?: ResponseInit) {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status: 200,
    ...init,
    headers: {
      "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      "Content-Type": "application/json",
      "x-vercel-cache": "MISS",
      ...init?.headers,
    },
  });
}

async function expectFailure(fetchImpl: typeof fetch, failureKind: string) {
  await expect(fetchAuthoritativeFrontendRelease({
    origin: "https://playpickla.com",
    fetchImpl,
    requestId,
    timeoutMs: 50,
  })).rejects.toMatchObject({ failureKind, requestId });
}

describe("authoritative release lookup", () => {
  it("accepts a fresh dynamic deployment identity with an echoed correlation id", async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => response(release));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    await expect(fetchAuthoritativeFrontendRelease({
      origin: "https://playpickla.com",
      fetchImpl,
      requestId,
    })).resolves.toEqual(release);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe(AUTHORITATIVE_RELEASE_URL);
    expect(requestedUrl.searchParams.get("request_id")).toBe(requestId);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ cache: "no-store" }));
  });

  it("rejects HTTP 500", async () => {
    const fetchImpl = vi.fn(async () => response({}, { status: 500 })) as unknown as typeof fetch;
    await expectFailure(fetchImpl, "http_5xx");
  });

  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => response("{")) as unknown as typeof fetch;
    await expectFailure(fetchImpl, "malformed_json");
  });

  it("rejects a payload with no SHA", async () => {
    const fetchImpl = vi.fn(async () => response({ ...release, sha: undefined })) as unknown as typeof fetch;
    await expectFailure(fetchImpl, "missing_sha");
  });

  it("rejects a stale intermediary response whose request id does not match", async () => {
    const fetchImpl = vi.fn(async () => response({ ...release, request_id: "different0123456789" })) as unknown as typeof fetch;
    await expectFailure(fetchImpl, "request_mismatch");
  });

  it("rejects shared-cache HIT and positive Age evidence", async () => {
    for (const headers of [{ "x-vercel-cache": "HIT" }, { Age: "160876" }]) {
      const fetchImpl = vi.fn(async () => response(release, { headers })) as unknown as typeof fetch;
      await expectFailure(fetchImpl, "stale_response");
    }
  });

  it("rejects an endpoint that loses its no-store contract", async () => {
    const fetchImpl = vi.fn(async () => response(release, { headers: { "Cache-Control": "public, max-age=60" } })) as unknown as typeof fetch;
    await expectFailure(fetchImpl, "cache_contract");
  });

  it("times out without manufacturing a release", async () => {
    const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    await expect(fetchAuthoritativeFrontendRelease({
      origin: "https://playpickla.com",
      fetchImpl,
      requestId,
      timeoutMs: 1,
    })).rejects.toMatchObject({ failureKind: "timeout" });
  });
});

describe("monotonic release semantics", () => {
  it("orders by deployment build time, never lexically by Git SHA", () => {
    const olderHighSha = { sha: "ffffffffffffffffffffffffffffffffffffffff", built_at: "2026-09-18T10:00:00.000Z" };
    const newerLowSha = { sha: "0000000000000000000000000000000000000000", built_at: "2026-09-20T10:00:00.000Z" };
    expect(classifyFrontendRelease(olderHighSha, newerLowSha)).toBe("newer");
    expect(classifyFrontendRelease(newerLowSha, olderHighSha)).toBe("older");
    expect(classifyFrontendRelease(newerLowSha, { ...newerLowSha })).toBe("same");
    expect(classifyFrontendRelease(newerLowSha, {
      sha: olderHighSha.sha,
      built_at: newerLowSha.built_at,
    })).toBe("unknown");
  });

  it("keeps the endpoint dynamic, public, privacy-safe and explicitly non-cacheable", () => {
    const endpoint = readFileSync("api/release.ts", "utf8");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(endpoint).toContain("VERCEL_DEPLOYMENT_ID");
    expect(endpoint).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(endpoint).toContain('"Vercel-CDN-Cache-Control"');
    expect(endpoint).toContain('"CDN-Cache-Control"');
    expect(endpoint).toContain('"Cache-Control"');
    expect(endpoint).toContain('"Access-Control-Allow-Origin": "*"');
    expect(endpoint).not.toContain("SUPABASE");
    expect(endpoint).not.toContain("Authorization");
    expect(vercel.functions["api/release.ts"].includeFiles).toBe("api/_release-identity.generated.json");
    const releaseHeaders = vercel.headers.find((entry: { source: string }) => entry.source === "/api/release").headers;
    for (const name of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"]) {
      expect(releaseHeaders.find((header: { key: string }) => header.key === name).value).toContain("no-store");
    }
  });
});
