const OPERATIONS_PATH_PREFIXES = ["/desk", "/hub/admin", "/admin", "/ops", "/event-ops"];

export function shouldShowStageEnvironmentMarker(environment: string | undefined, pathname: string) {
  return environment?.trim().toLowerCase() === "stage"
    && OPERATIONS_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
