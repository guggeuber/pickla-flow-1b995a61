import { describe, expect, it } from "vitest";
import { ApiRequestError, ApiTransportError } from "@/lib/api";
import { resolveAuthorizationUiState } from "@/lib/authorizationUiState";

describe("authorization UI truth", () => {
  it("does not project transport failure as an authorization denial", () => {
    expect(resolveAuthorizationUiState({
      isLoading: false,
      isError: true,
      error: new ApiTransportError("Load failed", "network_error", "request-id"),
      isAuthorized: false,
    })).toBe("unavailable");
  });

  it.each([401, 403])("keeps canonical HTTP %s fail-closed as denied", (status) => {
    expect(resolveAuthorizationUiState({
      isLoading: false,
      isError: true,
      error: new ApiRequestError("Denied", status),
      isAuthorized: false,
    })).toBe("denied");
  });

  it("treats an explicit negative authorization projection as denied", () => {
    expect(resolveAuthorizationUiState({
      isLoading: false,
      isError: false,
      error: null,
      isAuthorized: false,
    })).toBe("denied");
  });

  it("authorizes only an explicit positive projection", () => {
    expect(resolveAuthorizationUiState({
      isLoading: false,
      isError: false,
      error: null,
      isAuthorized: true,
    })).toBe("authorized");
  });
});
