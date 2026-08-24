import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { canonicalAppOrigin } from "@/lib/canonicalOrigin";
import {
  getSessionSingleFlight,
  subscribeToTerminalAuthFailure,
} from "@/lib/authSessionSingleFlight";
import { clearCustomerQueryCache } from "@/lib/authQueryCache";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>;
  resendConfirmation: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PENDING_CLAIM_KEY = "pickla_pending_claim_token";

export function authRedirectOrigin() {
  return canonicalAppOrigin();
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const claimAttempted = useRef(false);
  const authenticatedUserId = useRef<string | null>(null);

  // Auto-claim pending day pass when user becomes authenticated
  useEffect(() => {
    if (!user || claimAttempted.current) return;
    const token = window.localStorage?.getItem(PENDING_CLAIM_KEY);
    if (!token) return;
    claimAttempted.current = true;
    apiPost("api-day-passes", "claim", { token })
      .then(() => {
        window.localStorage?.removeItem(PENDING_CLAIM_KEY);
        toast.success("Dagspass hämtat! Du hittar det under Mitt konto.");
      })
      .catch((error) => {
        toast.error(error?.message || "Kunde inte hämta dagspasset. Öppna länken igen och försök på nytt.");
      });
  }, [user]);

  useEffect(() => {
    let receivedAuthEvent = false;
    let disposed = false;

    const applySession = (nextSession: Session | null) => {
      if (disposed) return;
      const previousUserId = authenticatedUserId.current;
      const nextUserId = nextSession?.user.id ?? null;
      if (previousUserId && previousUserId !== nextUserId) {
        void clearCustomerQueryCache(queryClient, previousUserId);
      }
      authenticatedUserId.current = nextUserId;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    };

    const unsubscribeTerminalFailure = subscribeToTerminalAuthFailure(() => {
      receivedAuthEvent = true;
      applySession(null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        receivedAuthEvent = true;
        applySession(session);
      }
    );

    getSessionSingleFlight()
      .then(({ data: { session } }) => {
        if (!receivedAuthEvent) applySession(session);
      })
      .catch(() => {
        if (!receivedAuthEvent) applySession(null);
      });

    return () => {
      disposed = true;
      unsubscribeTerminalFailure();
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${authRedirectOrigin()}/auth/callback`,
      },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const resendConfirmation = async (email: string) => {
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${authRedirectOrigin()}/auth/callback`,
        },
      });
      return { error: error ? new Error(error.message) : null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error("Kunde inte skicka bekräftelselänk.") };
    }
  };

  const signOut = async () => {
    const signingOutUserId = user?.id ?? authenticatedUserId.current;
    setSession(null);
    setUser(null);
    if (signingOutUserId) void clearCustomerQueryCache(queryClient, signingOutUserId);
    authenticatedUserId.current = null;
    await supabase.auth.signOut({ scope: "local" });
    claimAttempted.current = false;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, resendConfirmation, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
