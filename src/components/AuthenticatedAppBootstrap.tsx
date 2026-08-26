import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useLocation } from "react-router-dom";

import { AppRecoveryScreen } from "@/components/AppRecoveryScreen";
import { useAuth, type LocalAuthStatus } from "@/hooks/useAuth";
import { loadAccountBootstrap, type AccountBootstrap } from "@/lib/accountBootstrap";
import { clearCustomerQueryCache } from "@/lib/authQueryCache";
import { reportClientEvent } from "@/lib/clientObservability";
import { shouldRetryQuery } from "@/lib/queryRetry";
import {
  VerifiedAccountContext,
  type VerifiedAccountContextValue,
  type VerifiedAccountState,
} from "@/hooks/useVerifiedAccount";
import { routeRequiresVerifiedAccount } from "@/lib/publicFirstPaintRoutes";

type BootstrapUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type AuthenticatedBootstrapGateProps = {
  children: ReactNode;
  user: BootstrapUser | null;
  authLoading: boolean;
  authStatus?: LocalAuthStatus;
  signOut: () => Promise<void>;
  loadBootstrap?: (userId: string) => Promise<AccountBootstrap>;
  bypass?: boolean;
  blockForAccount?: boolean;
};

function accountState(
  user: BootstrapUser | null,
  authLoading: boolean,
  authStatus: LocalAuthStatus | undefined,
  bootstrap: { isPending: boolean; isError: boolean; data?: AccountBootstrap },
  bypass: boolean,
): VerifiedAccountState {
  if (authStatus === "terminal_failure") return "terminal_failure";
  if (authLoading || authStatus === "session_hydrating") return "session_hydrating";
  if (!user) return "anonymous";
  if (bypass) return "remote_validating";
  if (bootstrap.isError) return "validation_error";
  if (bootstrap.isPending || !bootstrap.data) return "remote_validating";
  return "verified";
}

export function AuthenticatedBootstrapGate({
  children,
  user,
  authLoading,
  authStatus,
  signOut,
  loadBootstrap = loadAccountBootstrap,
  bypass = false,
  blockForAccount = true,
}: AuthenticatedBootstrapGateProps) {
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const bootstrap = useQuery({
    queryKey: ["authenticated-account-bootstrap", user?.id],
    enabled: !!user?.id && !authLoading && !bypass,
    queryFn: () => loadBootstrap(user!.id),
    retry: (failureCount, error) => failureCount < 2 && shouldRetryQuery(failureCount, error),
    retryDelay: (attempt) => Math.min(300 * 2 ** attempt, 1200),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!bootstrap.error) return;
    void clearCustomerQueryCache(queryClient, user?.id, { preserveAccountBootstrap: true });
    void reportClientEvent({
      event_type: "client_account_bootstrap_error",
      severity: "error",
      message: bootstrap.error instanceof Error ? bootstrap.error.message : "Account bootstrap failed",
      fingerprint: "account-bootstrap-failed",
    });
  }, [bootstrap.error, queryClient, user?.id]);

  const state = accountState(user, authLoading, authStatus, bootstrap, bypass);
  const value = useMemo<VerifiedAccountContextValue>(() => ({
    state,
    account: state === "verified" ? bootstrap.data || null : null,
    verifiedUserId: state === "verified" ? user?.id || null : null,
    isVerified: state === "verified",
    retry: () => bootstrap.refetch(),
  }), [bootstrap, state, user?.id]);

  const content = (() => {
    if (bypass || !blockForAccount) return children;

    if (state === "session_hydrating" || state === "remote_validating") {
      return (
        <main
          aria-label="Loading account"
          className="grid min-h-[100dvh] place-items-center bg-[#fffaf7] text-[#111111]"
        >
          <div className="grid place-items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-[#ed3f8f]" />
            <p className="text-sm font-semibold text-black/55">Loading your account…</p>
          </div>
        </main>
      );
    }

    if (user && state === "validation_error") {
      return (
        <AppRecoveryScreen
          busy={bootstrap.isFetching || signingOut}
          onRetry={() => bootstrap.refetch()}
          onSignOut={async () => {
            setSigningOut(true);
            try {
              await signOut();
            } finally {
              window.location.assign("/auth");
            }
          }}
        />
      );
    }

    return children;
  })();

  return <VerifiedAccountContext.Provider value={value}>{content}</VerifiedAccountContext.Provider>;
}

export function AuthenticatedAppBootstrap({ children }: { children: ReactNode }) {
  const { user, loading, authStatus, signOut } = useAuth();
  const location = useLocation();
  const bypass = location.pathname === "/auth" || location.pathname.startsWith("/auth/");
  return (
    <AuthenticatedBootstrapGate
      user={user}
      authLoading={loading}
      authStatus={authStatus}
      signOut={signOut}
      bypass={bypass}
      blockForAccount={routeRequiresVerifiedAccount(location.pathname)}
    >
      {children}
    </AuthenticatedBootstrapGate>
  );
}
