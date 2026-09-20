import { readFileSync } from "node:fs";

type GeneratedReleaseIdentity = {
  sha: string;
  built_at: string;
  deployment_id: string;
  deployment_url: string;
  environment: string;
};

const generatedIdentity = JSON.parse(
  readFileSync(new URL("./_release-identity.generated.json", import.meta.url), "utf8"),
) as GeneratedReleaseIdentity;

const NO_STORE_HEADERS = {
  "Access-Control-Allow-Headers": "Accept, Cache-Control, Pragma",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "Expires": "0",
  "Pragma": "no-cache",
  "Vercel-CDN-Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS });
}

function runtimeMatchesGeneratedIdentity() {
  const runtimeSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const runtimeDeploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (process.env.VERCEL && (!runtimeSha || !runtimeDeploymentId)) return false;
  if (runtimeSha && runtimeSha !== generatedIdentity.sha) return false;
  if (runtimeDeploymentId && runtimeDeploymentId !== generatedIdentity.deployment_id) return false;
  return true;
}

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "method_not_allowed");
    }
    if (!runtimeMatchesGeneratedIdentity()) {
      return errorResponse(503, "release_identity_unavailable");
    }

    const requestId = new URL(request.url).searchParams.get("request_id")?.trim() || "";
    if (!/^[A-Za-z0-9_-]{16,96}$/.test(requestId)) {
      return errorResponse(400, "invalid_request_id");
    }

    const body = {
      ...generatedIdentity,
      request_id: requestId,
      served_at: new Date().toISOString(),
    };
    return new Response(request.method === "HEAD" ? null : `${JSON.stringify(body)}\n`, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  },
};
