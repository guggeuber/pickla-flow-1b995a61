import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authRuntime = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: authRuntime },
}));

import AuthCallback from "@/pages/AuthCallback";
import AuthReset from "@/pages/AuthReset";

describe("Supabase auth callback compatibility", () => {
  beforeEach(() => {
    localStorage.clear();
    authRuntime.exchangeCodeForSession.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
    authRuntime.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    authRuntime.updateUser.mockReset().mockResolvedValue({ data: { user: {} }, error: null });
    authRuntime.verifyOtp.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
    authRuntime.onAuthStateChange.mockReset().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("exchanges a PKCE callback code and keeps the existing success flow", async () => {
    window.history.replaceState(null, "", "/auth/callback?code=pkce-code&type=signup");

    render(
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Välkommen till Pickla!" })).toBeInTheDocument();
    expect(screen.getByText("Din e-post är bekräftad")).toBeInTheDocument();
    expect(authRuntime.exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(authRuntime.exchangeCodeForSession.mock.calls[0][0]).toContain("code=pkce-code");
  });

  it("exchanges a password-recovery code and opens the existing reset form", async () => {
    window.history.replaceState(null, "", "/auth/reset?code=recovery-code");

    render(
      <MemoryRouter>
        <AuthReset />
      </MemoryRouter>,
    );

    expect(await screen.findByPlaceholderText("nytt lösenord")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bekräfta lösenord")).toBeInTheDocument();
    expect(authRuntime.exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(authRuntime.exchangeCodeForSession.mock.calls[0][0]).toContain("code=recovery-code");
    expect(authRuntime.onAuthStateChange).toHaveBeenCalledOnce();
  });
});
