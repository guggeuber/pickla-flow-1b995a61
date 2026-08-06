import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const authRuntime = vi.hoisted(() => ({
  listener: null as ((event: string, session: unknown) => void) | null,
  getSession: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        authRuntime.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: authRuntime.getSession,
      signUp: authRuntime.signUp,
      signInWithPassword: vi.fn(),
      resend: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api", () => ({ apiPost: vi.fn() }));
vi.mock("@/components/PicklaTopBar", () => ({ PicklaTopBar: () => null }));

import Auth from "@/pages/Auth";
import { AuthProvider } from "@/hooks/useAuth";

const session = {
  access_token: "test-token",
  user: { id: "new-user", email: "new@example.test", user_metadata: { display_name: "New User" } },
};

function renderAuth() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/auth?v=pickla-arena-sthlm&redirect=%2Fmy"]}>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/today" element={<h1>Today destination</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillSignup() {
  fireEvent.click(await screen.findByRole("button", { name: "REGISTRERA" }));
  fireEvent.change(await screen.findByPlaceholderText("ditt namn"), { target: { value: "New User" } });
  fireEvent.change(screen.getByPlaceholderText("e-post"), { target: { value: "new@example.test" } });
  fireEvent.change(screen.getByPlaceholderText("lösenord"), { target: { value: "secret123" } });
}

describe("auth form lifecycle", () => {
  beforeEach(() => {
    authRuntime.listener = null;
    authRuntime.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    authRuntime.signUp.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("survives an authenticated session arriving before signUp resolves", async () => {
    authRuntime.signUp.mockImplementation(async () => {
      act(() => authRuntime.listener?.("SIGNED_IN", session));
      await Promise.resolve();
      return { data: { user: session.user, session }, error: null };
    });
    renderAuth();
    await fillSignup();

    fireEvent.submit(screen.getByRole("button", { name: "SKAPA KONTO" }).closest("form")!);

    expect(await screen.findByRole("heading", { name: "Today destination" })).toBeInTheDocument();
    expect(authRuntime.signUp).toHaveBeenCalledTimes(1);
  });

  it("submits only once when the form receives two submit events in the same task", async () => {
    let resolveSignup: ((value: unknown) => void) | undefined;
    authRuntime.signUp.mockImplementation(() => new Promise((resolve) => { resolveSignup = resolve; }));
    renderAuth();
    await fillSignup();
    const form = screen.getByRole("button", { name: "SKAPA KONTO" }).closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(authRuntime.signUp).toHaveBeenCalledTimes(1);
    resolveSignup?.({ data: { user: session.user, session: null }, error: null });
    await waitFor(() => expect(screen.getByText("Kontot behöver bekräftas innan du kan logga in.")).toBeInTheDocument());
  });

  it("keeps one form DOM node when successful signup returns to login", async () => {
    authRuntime.signUp.mockResolvedValue({ data: { user: session.user, session: null }, error: null });
    renderAuth();
    await fillSignup();
    const signupForm = screen.getByRole("button", { name: "SKAPA KONTO" }).closest("form");

    fireEvent.submit(signupForm!);

    await screen.findByRole("heading", { name: "Logga in" });
    await waitFor(() => expect(within(document.querySelector("form")!).getByRole("button", { name: "LOGGA IN" })).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector("form")).toBe(signupForm));
  });
});
