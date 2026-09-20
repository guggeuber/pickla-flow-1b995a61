export type FrontendBuildIdentity = {
  sha: string;
  built_at: string;
  deployment_id?: string;
  deployment_url?: string;
  environment?: string;
};

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_DEPLOYMENT_ID__: string;
declare const __BUILD_DEPLOYMENT_URL__: string;
declare const __BUILD_ENVIRONMENT__: string;

const fallbackBuild: FrontendBuildIdentity = {
  sha: "local",
  built_at: "local",
  deployment_id: "local",
  deployment_url: "localhost",
  environment: "development",
};

export const RUNNING_FRONTEND_BUILD: FrontendBuildIdentity = {
  sha: typeof __BUILD_SHA__ === "undefined" ? fallbackBuild.sha : __BUILD_SHA__,
  built_at: typeof __BUILD_TIME__ === "undefined" ? fallbackBuild.built_at : __BUILD_TIME__,
  deployment_id: typeof __BUILD_DEPLOYMENT_ID__ === "undefined"
    ? fallbackBuild.deployment_id
    : __BUILD_DEPLOYMENT_ID__,
  deployment_url: typeof __BUILD_DEPLOYMENT_URL__ === "undefined"
    ? fallbackBuild.deployment_url
    : __BUILD_DEPLOYMENT_URL__,
  environment: typeof __BUILD_ENVIRONMENT__ === "undefined"
    ? fallbackBuild.environment
    : __BUILD_ENVIRONMENT__,
};

export function parseFrontendBuildIdentity(value: unknown): FrontendBuildIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const sha = typeof candidate.sha === "string" ? candidate.sha.trim() : "";
  const builtAt = typeof candidate.built_at === "string" ? candidate.built_at.trim() : "";
  if (!sha || !builtAt) return null;
  const deploymentId = typeof candidate.deployment_id === "string" ? candidate.deployment_id.trim() : "";
  const deploymentUrl = typeof candidate.deployment_url === "string" ? candidate.deployment_url.trim() : "";
  const environment = typeof candidate.environment === "string" ? candidate.environment.trim() : "";
  return {
    sha,
    built_at: builtAt,
    ...(deploymentId ? { deployment_id: deploymentId } : {}),
    ...(deploymentUrl ? { deployment_url: deploymentUrl } : {}),
    ...(environment ? { environment } : {}),
  };
}

export function shortFrontendSha(sha: string) {
  return sha === "local" ? sha : sha.slice(0, 8);
}
