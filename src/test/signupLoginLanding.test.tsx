import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const authRuntime = vi.hoisted(() => {
  let listener: ((event: string, session: unknown) => void) | null = null;
  let currentSession: unknown = null;
  return {
    get listener() { return listener; },
    set listener(value) { listener = value; },
    get currentSession() { return currentSession; },
    set currentSession(value) { currentSession = value; },
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    from: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        authRuntime.listener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: vi.fn(async () => ({ data: { session: authRuntime.currentSession } })),
      signUp: authRuntime.signUp,
      signInWithPassword: authRuntime.signIn,
      signOut: authRuntime.signOut,
    },
    from: authRuntime.from,
  },
}));

vi.mock("@/lib/api", () => ({ apiPost: vi.fn() }));

import { AuthenticatedAppBootstrap } from "@/components/AuthenticatedAppBootstrap";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

const testSession = {
  access_token: "local-test-token",
  refresh_token: "local-test-refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "new-auth-user-id",
    email: "new-player@example.test",
    phone: null,
    user_metadata: { display_name: "Anne-Marie O'Connor" },
  },
};

function AuthFlow() {
  const { signUp, signIn, user } = useAuth();
  const [registered, setRegistered] = useState(false);

  if (user) return <h1>Authenticated landing page</h1>;
  if (!registered) {
    return (
      <button
        type="button"
        onClick={async () => {
          const result = await signUp("new-player@example.test", "Strong-password-123!", "Anne-Marie O'Connor");
          if (!result.error) setRegistered(true);
        }}
      >
        Create account
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void signIn("new-player@example.test", "Strong-password-123!")}
    >
      Log in
    </button>
  );
}

describe("signup to authenticated landing", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    authRuntime.currentSession = null;
    authRuntime.listener = null;
    authRuntime.signUp.mockReset().mockResolvedValue({ data: { user: testSession.user }, error: null });
    authRuntime.signOut.mockReset().mockResolvedValue({ error: null });
    authRuntime.signIn.mockReset().mockImplementation(async () => {
      authRuntime.currentSession = testSession;
      authRuntime.listener?.("SIGNED_IN", testSession);
      return { data: { session: testSession }, error: null };
    });
    authRuntime.from.mockReset().mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "player_profiles"
              ? {
                  id: "profile-id",
                  display_name: "Anne-Marie O'Connor",
                  first_name: null,
                  last_name: null,
                  customer_id: "customer-id",
                  phone: null,
                }
              : {
                  id: "customer-id",
                  display_name: "Anne-Marie O'Connor",
                  first_name: null,
                  last_name: null,
                  primary_phone: null,
                },
            error: null,
          }),
        }),
      }),
    }));
  });

  it("creates an account, logs in, bootstraps the null-safe profile and reaches the landing page", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/today"]}>
          <AuthProvider>
            <AuthenticatedAppBootstrap>
              <AuthFlow />
            </AuthenticatedAppBootstrap>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Authenticated landing page" })).toBeInTheDocument();
    expect(authRuntime.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "new-player@example.test",
      options: expect.objectContaining({ data: { display_name: "Anne-Marie O'Connor" } }),
    }));
    expect(authRuntime.signIn).toHaveBeenCalledWith({
      email: "new-player@example.test",
      password: "Strong-password-123!",
    });
    await waitFor(() => expect(authRuntime.from).toHaveBeenCalledWith("player_profiles"));
    expect(authRuntime.from).toHaveBeenCalledWith("customers");
  });
});
