import type { FrontendBuildIdentity } from "@/lib/frontendBuild";

export const AUTHORITATIVE_RELEASE_URL = "/api/release";
export const AUTHORITATIVE_RELEASE_TIMEOUT_MS = 8_000;

export type AuthoritativeFrontendRelease = FrontendBuildIdentity & {
  deployment_id: string;
  deployment_url: string;
  environment: string;
  request_id: string;
  served_at: string;
};

export type FrontendReleaseRelation = "same" | "newer" | "older" | "unknown";

export type FrontendReleaseFailureKind =
  | "timeout"
  | "transport"
  | "http_5xx"
  | "http_error"
  | "malformed_json"
  | "missing_sha"
  | "invalid_identity"
  | "request_mismatch"
  | "stale_response"
  | "cache_contract"
  | "unknown_release";

export class FrontendReleaseLookupError extends Error {
  readonly failureKind: FrontendReleaseFailureKind;
  readonly status?: number;
  readonly requestId?: string;

  constructor(
    failureKind: FrontendReleaseFailureKind,
    message: string,
    status?: number,
    requestId?: string,
  ) {
    super(message);
    this.name = "FrontendReleaseLookupError";
    this.failureKind = failureKind;
    this.status = status;
    this.requestId = requestId;
  }
}

/** Git SHAs are identities. Ordering comes only from the deployment build time. */
export function classifyFrontendRelease(
  running: FrontendBuildIdentity,
  authoritative: FrontendBuildIdentity,
): FrontendReleaseRelation {
  if (authoritative.sha === running.sha) return "same";
  const runningTime = Date.parse(running.built_at);
  const authoritativeTime = Date.parse(authoritative.built_at);
  if (!Number.isFinite(runningTime) || !Number.isFinite(authoritativeTime)) return "unknown";
  if (authoritativeTime > runningTime) return "newer";
  if (authoritativeTime < runningTime) return "older";
  return "unknown";
}

function parseAuthoritativeRelease(
  value: unknown,
  expectedRequestId: string,
): AuthoritativeFrontendRelease {
  if (!value || typeof value !== "object") {
    throw new FrontendReleaseLookupError(
      "malformed_json",
      "release endpoint returned a non-object payload",
      undefined,
      expectedRequestId,
    );
  }
  const candidate = value as Record<string, unknown>;
  const sha = typeof candidate.sha === "string" ? candidate.sha.trim() : "";
  if (!sha) {
    throw new FrontendReleaseLookupError(
      "missing_sha",
      "release endpoint returned no SHA",
      undefined,
      expectedRequestId,
    );
  }
  const builtAt = typeof candidate.built_at === "string" ? candidate.built_at.trim() : "";
  const deploymentId = typeof candidate.deployment_id === "string" ? candidate.deployment_id.trim() : "";
  const deploymentUrl = typeof candidate.deployment_url === "string" ? candidate.deployment_url.trim() : "";
  const environment = typeof candidate.environment === "string" ? candidate.environment.trim() : "";
  const requestId = typeof candidate.request_id === "string" ? candidate.request_id.trim() : "";
  const servedAt = typeof candidate.served_at === "string" ? candidate.served_at.trim() : "";
  if (
    !/^[0-9a-f]{40,64}$/i.test(sha)
    || !builtAt
    || Number.isNaN(Date.parse(builtAt))
    || !deploymentId
    || !deploymentUrl
    || !environment
    || !servedAt
    || Number.isNaN(Date.parse(servedAt))
  ) {
    throw new FrontendReleaseLookupError(
      "invalid_identity",
      "release endpoint returned an invalid identity",
      undefined,
      expectedRequestId,
    );
  }
  if (requestId !== expectedRequestId) {
    throw new FrontendReleaseLookupError(
      "request_mismatch",
      "release endpoint did not echo this request",
      undefined,
      expectedRequestId,
    );
  }
  return {
    sha,
    built_at: builtAt,
    deployment_id: deploymentId,
    deployment_url: deploymentUrl,
    environment,
    request_id: requestId,
    served_at: servedAt,
  };
}

function releaseRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export async function fetchAuthoritativeFrontendRelease(input: {
  origin?: string;
  fetchImpl?: typeof fetch;
  requestId?: string;
  timeoutMs?: number;
} = {}): Promise<AuthoritativeFrontendRelease> {
  const origin = input.origin ?? window.location.origin;
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestId = input.requestId ?? releaseRequestId();
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? AUTHORITATIVE_RELEASE_TIMEOUT_MS,
  );

  try {
    const url = new URL(AUTHORITATIVE_RELEASE_URL, origin);
    url.searchParams.set("request_id", requestId);
    url.searchParams.set("_", String(Date.now()));
    let response: Response;
    try {
      response = await fetchImpl(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache, no-store",
          Pragma: "no-cache",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FrontendReleaseLookupError(
          "timeout",
          "release endpoint timed out",
          undefined,
          requestId,
        );
      }
      throw new FrontendReleaseLookupError(
        "transport",
        error instanceof Error ? error.message : "release endpoint transport failed",
        undefined,
        requestId,
      );
    }

    if (!response.ok) {
      throw new FrontendReleaseLookupError(
        response.status >= 500 ? "http_5xx" : "http_error",
        `release endpoint returned ${response.status}`,
        response.status,
        requestId,
      );
    }
    const cacheControl = response.headers.get("cache-control")?.toLowerCase() || "";
    if (!cacheControl.includes("no-store")) {
      throw new FrontendReleaseLookupError(
        "cache_contract",
        "release endpoint is missing no-store",
        undefined,
        requestId,
      );
    }
    const age = Number(response.headers.get("age") || "0");
    const vercelCache = response.headers.get("x-vercel-cache")?.toUpperCase() || "";
    if ((Number.isFinite(age) && age > 0) || vercelCache === "HIT" || vercelCache === "STALE") {
      throw new FrontendReleaseLookupError(
        "stale_response",
        "release endpoint was served from stale shared cache",
        undefined,
        requestId,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new FrontendReleaseLookupError(
        "malformed_json",
        "release endpoint returned malformed JSON",
        undefined,
        requestId,
      );
    }
    return parseAuthoritativeRelease(payload, requestId);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
