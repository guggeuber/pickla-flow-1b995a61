import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const eventApiSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function loadMyRegistrationsRuntime(authResult: { userId: string | null; error: string | null }) {
  const source = sourceBetween(
    eventApiSource,
    "function normalizedIdentity",
    "async function verifyResendWebhook",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const getAuthenticatedClient = vi.fn().mockResolvedValue(authResult);
  const errorResponse = (message: string, status = 400) => ({ status, body: { error: message } });
  const jsonResponse = (body: unknown, status = 200) => ({ status, body });
  const factory = new Function(
    "getAuthenticatedClient",
    "errorResponse",
    "jsonResponse",
    `${javascript}; return {
      normalizedIdentity,
      verifiedAuthIdentifiers,
      handleMyRegistrations,
    };`,
  );
  return {
    ...factory(getAuthenticatedClient, errorResponse, jsonResponse),
    getAuthenticatedClient,
  };
}

function createClient(options: {
  user?: Record<string, unknown> | null;
  rowsFor?: (column: string, value: string) => any[];
  queryError?: { code?: string; message: string } | null;
} = {}) {
  const queries: Array<{ fields: string; column: string; value: string }> = [];
  const getUserById = vi.fn().mockResolvedValue({
    data: { user: options.user ?? null },
    error: null,
  });
  return {
    queries,
    auth: { admin: { getUserById } },
    from: vi.fn((table: string) => {
      expect(table).toBe("players");
      return {
        select: (fields: string) => ({
          eq: (column: string, value: string) => ({
            limit: async (limit: number) => {
              expect(limit).toBe(500);
              queries.push({ fields, column, value });
              return {
                data: options.rowsFor?.(column, value) ?? [],
                error: options.queryError ?? null,
              };
            },
          }),
        }),
      };
    }),
  };
}

describe("my-registrations security", () => {
  it("uses the correct GET route and accepts no caller-controlled identity parameter", () => {
    const route = sourceBetween(
      eventApiSource,
      "if (req.method === 'GET' && path === 'my-registrations')",
      "path === 'email-webhook'",
    );
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain("handleMyRegistrations(req, client)");
    expect(route).not.toContain("url.searchParams.get('userId')");
    expect(route).not.toContain("req.json()");
  });

  it("rejects an unauthenticated request before any data lookup", async () => {
    const runtime = loadMyRegistrationsRuntime({ userId: null, error: "invalid token details" });
    const client = createClient();
    const response = await runtime.handleMyRegistrations(new Request("https://example.test/my-registrations"), client);

    expect(response).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it("ignores injected identities and queries only the authenticated user and verified identities", async () => {
    const runtime = loadMyRegistrationsRuntime({ userId: "own-user", error: null });
    const client = createClient({
      user: {
        email: "  OWN@EXAMPLE.TEST ",
        email_confirmed_at: "2026-07-18T10:00:00Z",
        phone: " +46700000000 ",
        phone_confirmed_at: "2026-07-18T10:00:00Z",
      },
    });
    await runtime.handleMyRegistrations(
      new Request("https://example.test/my-registrations?userId=victim&email=victim@example.test"),
      client,
    );

    expect(client.queries.map(({ column, value }) => [column, value])).toEqual([
      ["auth_user_id", "own-user"],
      ["email", "own@example.test"],
      ["email", "+46700000000"],
    ]);
    expect(JSON.stringify(client.queries)).not.toContain("victim");
  });

  it("returns a safe projection and deduplicates only identical registration IDs", async () => {
    const runtime = loadMyRegistrationsRuntime({ userId: "own-user", error: null });
    const duplicate = {
      id: "registration-1",
      event_id: "event-1",
      name: "Player",
      created_at: "2026-07-18T10:00:00Z",
      email: "private@example.test",
      phone: "+46700000000",
      auth_user_id: "own-user",
      internal_note: "private",
      events: {
        id: "event-1",
        name: "Open Play",
        display_name: "Open Play",
        slug: "open-play",
        start_date: "2026-07-18",
        end_date: "2026-07-18",
        start_time: "10:00",
        end_time: "11:00",
        status: "published",
        private_contact: "hidden",
        venues: { name: "Pickla", private_contact: "hidden" },
      },
    };
    const distinct = { ...duplicate, id: "registration-2" };
    const client = createClient({
      user: { email: "own@example.test", email_confirmed_at: "confirmed" },
      rowsFor: (column) => column === "auth_user_id" ? [duplicate, distinct] : [duplicate],
    });
    const response = await runtime.handleMyRegistrations(
      new Request("https://example.test/my-registrations"),
      client,
    );

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((row: any) => row.id)).toEqual(["registration-1", "registration-2"]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /email|phone|auth_user_id|internal_note|private_contact|private@example/,
    );
  });

  it("returns an empty array for an authenticated user with no registrations or usable identities", async () => {
    const runtime = loadMyRegistrationsRuntime({ userId: "own-user", error: null });
    const client = createClient({
      user: {
        email: "unverified@example.test",
        email_confirmed_at: null,
        phone: "",
        phone_confirmed_at: "confirmed",
      },
    });
    const response = await runtime.handleMyRegistrations(
      new Request("https://example.test/my-registrations"),
      client,
    );

    expect(response).toEqual({ status: 200, body: [] });
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toMatchObject({ column: "auth_user_id", value: "own-user" });
  });

  it("normalizes and deduplicates only verified auth identities", () => {
    const runtime = loadMyRegistrationsRuntime({ userId: "own-user", error: null });

    expect(runtime.normalizedIdentity("  Mixed@Example.TEST ")).toBe("mixed@example.test");
    expect(runtime.normalizedIdentity(null)).toBe("");
    expect(runtime.verifiedAuthIdentifiers({
      email: " SAME@example.test ",
      email_confirmed_at: "confirmed",
      phone: "same@example.test",
      phone_confirmed_at: "confirmed",
    })).toEqual(["same@example.test"]);
    expect(runtime.verifiedAuthIdentifiers({
      email: "unverified@example.test",
      email_confirmed_at: null,
      phone: 123,
      phone_confirmed_at: "confirmed",
    })).toEqual([]);
  });

  it("returns a generic server error without leaking database details", async () => {
    const runtime = loadMyRegistrationsRuntime({ userId: "own-user", error: null });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createClient({
      queryError: {
        code: "42P01",
        message: "relation players_internal does not exist",
      },
    });
    const response = await runtime.handleMyRegistrations(
      new Request("https://example.test/my-registrations"),
      client,
    );

    expect(response).toEqual({
      status: 500,
      body: { error: "Could not load registrations" },
    });
    expect(JSON.stringify(response)).not.toContain("players_internal");
    expect(consoleError).toHaveBeenCalledWith("my-registrations query failed", "42P01");
    consoleError.mockRestore();
  });
});
