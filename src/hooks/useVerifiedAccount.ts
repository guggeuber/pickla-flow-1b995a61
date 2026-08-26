import { createContext, useContext } from "react";

import { useAuth } from "@/hooks/useAuth";
import type { AccountBootstrap } from "@/lib/accountBootstrap";

export type VerifiedAccountState =
  | "session_hydrating"
  | "anonymous"
  | "remote_validating"
  | "verified"
  | "validation_error"
  | "terminal_failure";

export type VerifiedAccountContextValue = {
  state: VerifiedAccountState;
  account: AccountBootstrap | null;
  verifiedUserId: string | null;
  isVerified: boolean;
  retry: () => Promise<unknown>;
};

export const VerifiedAccountContext = createContext<VerifiedAccountContextValue | null>(null);

export function useVerifiedAccount() {
  const value = useContext(VerifiedAccountContext);
  const auth = useAuth();
  if (value) return value;
  // Component tests and isolated stories may intentionally omit the app
  // boundary. Production is always wrapped by AuthenticatedAppBootstrap.
  const state: VerifiedAccountState = auth.authStatus === "terminal_failure"
    ? "terminal_failure"
    : auth.loading
      ? "session_hydrating"
      : auth.authStatus === "local_session"
        ? "remote_validating"
        : auth.user
          ? "verified"
          : "anonymous";
  return {
    state,
    account: null,
    verifiedUserId: state === "verified" ? auth.user?.id || null : null,
    isVerified: state === "verified",
    retry: async () => undefined,
  };
}
