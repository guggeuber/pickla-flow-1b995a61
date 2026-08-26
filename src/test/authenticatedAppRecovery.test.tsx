import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
  },
}));

import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AuthenticatedBootstrapGate } from "@/components/AuthenticatedAppBootstrap";
import { routeRequiresVerifiedAccount } from "@/lib/publicFirstPaintRoutes";
import { supabase } from "@/integrations/supabase/client";
import {
  loadAccountBootstrapWith,
  normalizeAccountIdentity,
  validateRestoredSessionWith,
  type AccountBootstrap,
} from "@/lib/accountBootstrap";
import { isStaleChunkError, showChunkRecovery } from "@/lib/appRecovery";
import { getFirstName } from "@/lib/displayName";

const affectedProductionShape: AccountBootstrap = {
  profile: {
    id: "profile-id",
    display_name: "Parker J Rogers",
    first_name: null,
    last_name: null,
    customer_id: "customer-id",
    phone: null,
  },
  customer: {
    id: "customer-id",
    display_name: "Parker J Rogers",
    first_name: null,
    last_name: null,
    customer_id: null,
    phone: null,
  },
  identityMissing: false,
};

function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
  vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: { session: null, user: null }, error: null });
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
});

function GateHarness({
  children = <h1>Authenticated landing</h1>,
  user = {
    id: "affected-user-id",
    email: "player@example.test",
    user_metadata: { display_name: "Parker J Rogers" },
  },
  authLoading = false,
  loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape),
  bypass = false,
  blockForAccount = true,
}: {
  children?: ReactNode;
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  authLoading?: boolean;
  loadBootstrap?: (userId: string) => Promise<AccountBootstrap>;
  bypass?: boolean;
  blockForAccount?: boolean;
}) {
  return (
    <QueryClientProvider client={testQueryClient()}>
      <AuthenticatedBootstrapGate
        user={user}
        authLoading={authLoading}
        signOut={vi.fn().mockResolvedValue(undefined)}
        loadBootstrap={loadBootstrap}
        bypass={bypass}
        blockForAccount={blockForAccount}
      >
        {children}
      </AuthenticatedBootstrapGate>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  document.getElementById("pickla-chunk-recovery")?.remove();
  vi.restoreAllMocks();
});

describe("authenticated application resilience", () => {
  it.each(["sv-SE", "en-US"])("renders the authenticated landing page with %s", async (locale) => {
    Object.defineProperty(navigator, "language", { configurable: true, value: locale });
    render(<GateHarness />);
    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
  });

  it("accepts the exact affected null-name/phone shape without crashing", async () => {
    const loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape);
    render(<GateHarness loadBootstrap={loadBootstrap} />);

    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
    expect(loadBootstrap).toHaveBeenCalledWith("affected-user-id");
    expect(getFirstName({ playerProfile: affectedProductionShape.profile })).toBe("Parker");
  });

  it("normalizes malformed optional metadata instead of calling string methods on it", () => {
    expect(normalizeAccountIdentity({
      id: "profile-id",
      display_name: { unexpected: true },
      first_name: 17,
      last_name: ["Rogers"],
      phone: null,
    })).toEqual({
      id: "profile-id",
      display_name: null,
      first_name: null,
      last_name: null,
      customer_id: null,
      phone: null,
    });
    expect(getFirstName({
      authUser: {
        email: "safe-fallback@example.test",
        user_metadata: { display_name: { malformed: true } },
      },
    })).toBe("safe-fallback");
  });

  it("allows a temporarily or permanently missing optional identity row to load safely", async () => {
    const missingIdentity: AccountBootstrap = { profile: null, customer: null, identityMissing: true };
    render(<GateHarness loadBootstrap={vi.fn().mockResolvedValue(missingIdentity)} />);
    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
  });

  it("shows guarded recovery actions when the bootstrap request fails", async () => {
    render(<GateHarness loadBootstrap={vi.fn().mockRejectedValue(new Error("profile request failed"))} />);

    expect(await screen.findByRole("heading", {
      name: "Something went wrong while loading your account.",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("keeps the landing page hidden until the auth session and account bootstrap are ready", async () => {
    const loadBootstrap = vi.fn().mockResolvedValue(affectedProductionShape);
    const queryClient = testQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedBootstrapGate
          user={null}
          authLoading
          signOut={vi.fn().mockResolvedValue(undefined)}
          loadBootstrap={loadBootstrap}
        >
          <h1>Authenticated landing</h1>
        </AuthenticatedBootstrapGate>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Loading account")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authenticated landing" })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedBootstrapGate
          user={{ id: "new-user-id", email: "new@example.test" }}
          authLoading={false}
          signOut={vi.fn().mockResolvedValue(undefined)}
          loadBootstrap={loadBootstrap}
        >
          <h1>Authenticated landing</h1>
        </AuthenticatedBootstrapGate>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Authenticated landing" })).toBeInTheDocument();
    expect(loadBootstrap).toHaveBeenCalledWith("new-user-id");
  });

  it("renders public customer content while remote account validation is still pending", () => {
    const loadBootstrap = vi.fn(() => new Promise<AccountBootstrap>(() => undefined));
    render(
      <GateHarness loadBootstrap={loadBootstrap} blockForAccount={false}>
        <h1>Public Today content</h1>
      </GateHarness>,
    );

    expect(screen.getByRole("heading", { name: "Public Today content" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading account")).not.toBeInTheDocument();
    expect(loadBootstrap).toHaveBeenCalledWith("affected-user-id");
  });

  it("keeps public content visible when account enrichment fails", async () => {
    render(
      <GateHarness loadBootstrap={vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))} blockForAccount={false}>
        <h1>Public Course content</h1>
      </GateHarness>,
    );

    expect(await screen.findByRole("heading", { name: "Public Course content" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Something went wrong while loading your account." })).not.toBeInTheDocument();
  });

  it("clears private query data when public-route account validation fails", async () => {
    const queryClient = testQueryClient();
    queryClient.setQueryData(["my-bookings", "affected-user-id"], [{ id: "private-booking" }]);
    render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedBootstrapGate
          user={{ id: "affected-user-id", email: "player@example.test" }}
          authLoading={false}
          signOut={vi.fn().mockResolvedValue(undefined)}
          loadBootstrap={vi.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }))}
          blockForAccount={false}
        >
          <h1>Public content remains</h1>
        </AuthenticatedBootstrapGate>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Public content remains" })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData(["my-bookings", "affected-user-id"])).toBeUndefined());
  });

  it("limits public-first account behavior to the audited customer routes", () => {
    expect(routeRequiresVerifiedAccount("/")).toBe(false);
    expect(routeRequiresVerifiedAccount("/today")).toBe(false);
    expect(routeRequiresVerifiedAccount("/courses")).toBe(false);
    expect(routeRequiresVerifiedAccount("/course/series-1")).toBe(false);
    expect(routeRequiresVerifiedAccount("/seriespel")).toBe(false);
    expect(routeRequiresVerifiedAccount("/seriespel/season-1")).toBe(false);
    expect(routeRequiresVerifiedAccount("/my")).toBe(true);
    expect(routeRequiresVerifiedAccount("/hub")).toBe(true);
    expect(routeRequiresVerifiedAccount("/desk")).toBe(true);
  });

  it("does not interrupt auth callback/reset routes with account bootstrap", async () => {
    const loadBootstrap = vi.fn().mockRejectedValue(new Error("must not run"));
    render(
      <GateHarness loadBootstrap={loadBootstrap} bypass>
        <h1>Auth callback continues</h1>
      </GateHarness>,
    );
    expect(await screen.findByRole("heading", { name: "Auth callback continues" })).toBeInTheDocument();
  });

  it("loads through a missing-profile customer fallback", async () => {
    const client = {
      fetchProfile: vi.fn().mockResolvedValue({ data: null, error: null }),
      fetchCustomerById: vi.fn(),
      fetchCustomerByUserId: vi.fn().mockResolvedValue({
        data: {
          id: "customer-id",
          display_name: "Fallback Customer",
          first_name: null,
          last_name: null,
          primary_phone: null,
        },
        error: null,
      }),
    };

    await expect(loadAccountBootstrapWith(client, "user-id")).resolves.toMatchObject({
      profile: null,
      customer: { id: "customer-id", display_name: "Fallback Customer" },
      identityMissing: false,
    });
    expect(client.fetchCustomerByUserId).toHaveBeenCalledWith("user-id");
  });

  it("remotely validates a restored session before account bootstrap continues", async () => {
    const terminate = vi.fn();
    const user = await validateRestoredSessionWith(
      "affected-user-id",
      vi.fn().mockResolvedValue({
        data: { user: { id: "affected-user-id" } },
        error: null,
      }),
      terminate,
    );

    expect(user).toEqual({ id: "affected-user-id" });
    expect(terminate).not.toHaveBeenCalled();
  });

  it("terminates a remotely revoked restored session but preserves transient recovery", async () => {
    const terminateRevoked = vi.fn().mockResolvedValue(undefined);
    const revoked = Object.assign(new Error("Auth session missing"), {
      name: "AuthSessionMissingError",
      status: 400,
      code: "session_not_found",
    });
    await expect(validateRestoredSessionWith(
      "affected-user-id",
      vi.fn().mockResolvedValue({ data: { user: null }, error: revoked }),
      terminateRevoked,
    )).rejects.toThrow("Auth session missing");
    expect(terminateRevoked).toHaveBeenCalledTimes(1);

    const terminateNetwork = vi.fn();
    await expect(validateRestoredSessionWith(
      "affected-user-id",
      vi.fn().mockResolvedValue({ data: { user: null }, error: new TypeError("Failed to fetch") }),
      terminateNetwork,
    )).rejects.toThrow("Failed to fetch");
    expect(terminateNetwork).not.toHaveBeenCalled();
  });

  it("renders recovery UI instead of a black screen for a top-level React exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function CrashingRoute(): never {
      throw new Error("render failed");
    }

    render(
      <AppErrorBoundary>
        <CrashingRoute />
      </AppErrorBoundary>,
    );

    expect(await screen.findByRole("heading", {
      name: "Something went wrong while loading your account.",
    })).toBeInTheDocument();
  });

  it("recognizes stale chunk failures and offers visible reload recovery", () => {
    const error = new TypeError("Failed to fetch dynamically imported module: /assets/App-old.js");
    expect(isStaleChunkError(error)).toBe(true);
    showChunkRecovery(error);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
