import { ApiRequestError } from "@/lib/api";

export type AuthorizationUiState = "loading" | "unavailable" | "denied" | "authorized";

export function isCanonicalAuthorizationDenial(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

export function resolveAuthorizationUiState(input: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isAuthorized: boolean;
}): AuthorizationUiState {
  if (input.isLoading) return "loading";
  if (input.isError) {
    return isCanonicalAuthorizationDenial(input.error) ? "denied" : "unavailable";
  }
  return input.isAuthorized ? "authorized" : "denied";
}
