export type FrontendBuildIdentity = {
  sha: string;
  built_at: string;
};

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

const fallbackBuild: FrontendBuildIdentity = {
  sha: "local",
  built_at: "local",
};

export const RUNNING_FRONTEND_BUILD: FrontendBuildIdentity = {
  sha: typeof __BUILD_SHA__ === "undefined" ? fallbackBuild.sha : __BUILD_SHA__,
  built_at: typeof __BUILD_TIME__ === "undefined" ? fallbackBuild.built_at : __BUILD_TIME__,
};

export function parseFrontendBuildIdentity(value: unknown): FrontendBuildIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const sha = typeof candidate.sha === "string" ? candidate.sha.trim() : "";
  const builtAt = typeof candidate.built_at === "string" ? candidate.built_at.trim() : "";
  if (!sha || !builtAt) return null;
  return { sha, built_at: builtAt };
}

export function shortFrontendSha(sha: string) {
  return sha === "local" ? sha : sha.slice(0, 8);
}
