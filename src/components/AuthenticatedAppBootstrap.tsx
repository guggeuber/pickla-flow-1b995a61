import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useLocation } from "react-router-dom";

import { AppRecoveryScreen } from "@/components/AppRecoveryScreen";
import { useAuth } from "@/hooks/useAuth";
import { loadAccountBootstrap, type AccountBootstrap } from "@/lib/accountBootstrap";
import { reportClientEvent } from "@/lib/clientObservability";

type BootstrapUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type AuthenticatedBootstrapGateProps = {
  children: ReactNode;
  user: BootstrapUser | null;
  authLoading: boolean;
  signOut: () => Promise<void>;
  loadBootstrap?: (userId: string) => Promise<AccountBootstrap>;
  bypass?: boolean;
};

export function AuthenticatedBootstrapGate({
  children,
  user,
  authLoading,
  signOut,
  loadBootstrap = loadAccountBootstrap,
  bypass = false,
}: AuthenticatedBootstrapGateProps) {
  const [signingOut, setSigningOut] = useState(false);
  const bootstrap = useQuery({
    queryKey: ["authenticated-account-bootstrap", user?.id],
    enabled: !!user?.id && !authLoading && !bypass,
    queryFn: () => loadBootstrap(user!.id),
    retry: 2,
    retryDelay: (attempt) => Math.min(300 * 2 ** attempt, 1200),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!bootstrap.error) return;
    void reportClientEvent({
      event_type: "client_account_bootstrap_error",
      severity: "error",
      message: bootstrap.error instanceof Error ? bootstrap.error.message : "Account bootstrap failed",
      fingerprint: "account-bootstrap-failed",
    });
  }, [bootstrap.error]);

  if (bypass) return children;

  if (authLoading || (user && bootstrap.isPending)) {
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

  if (user && bootstrap.isError) {
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
}

export function AuthenticatedAppBootstrap({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const bypass = location.pathname === "/auth" || location.pathname.startsWith("/auth/");
  return (
    <AuthenticatedBootstrapGate user={user} authLoading={loading} signOut={signOut} bypass={bypass}>
      {children}
    </AuthenticatedBootstrapGate>
  );
}
