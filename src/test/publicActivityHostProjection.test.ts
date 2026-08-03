import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  projectPublicEventParticipants,
} from "../../supabase/functions/_shared/security_projections";
import { projectPublicActivitySessionHosts } from "../../supabase/functions/_shared/public_activity_hosts";

const eventApiSource = readFileSync("supabase/functions/api-event-public/index.ts", "utf8");
const programSource = readFileSync("src/pages/ProgramSessionPage.tsx", "utf8");
const todaySource = readFileSync("src/pages/TodayPage.tsx", "utf8");

const forbiddenKeys = new Set([
  "customer_id",
  "user_id",
  "auth_user_id",
  "profile_id",
  "email",
  "phone",
]);

function findForbiddenPaths(value: unknown, path = "$", result: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenPaths(item, `${path}[${index}]`, result));
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key.toLowerCase())) result.push(childPath);
    findForbiddenPaths(child, childPath, result);
  }
  return result;
}

describe("public activity host projection", () => {
  it("keeps only approved presentation fields and playing-host behavior", () => {
    const projected = projectPublicActivitySessionHosts([{
      activity_session_id: "11111111-1111-4111-8111-111111111111",
      customer_id: "22222222-2222-4222-8222-222222222222",
      user_id: "33333333-3333-4333-8333-333333333333",
      auth_user_id: "44444444-4444-4444-8444-444444444444",
      profile_id: "55555555-5555-4555-8555-555555555555",
      first_name: "  Ada  ",
      display_name: "  Ada Lovelace  ",
      avatar_url: "https://images.example.test/ada.jpg",
      sort_order: 0,
      email: "ada@example.test",
      phone: "+46000000000",
      organization_metadata: { role: "internal" },
      is_playing: true,
    }]);

    expect(projected).toEqual([{
      first_name: "Ada",
      display_name: "Ada Lovelace",
      avatar_url: "https://images.example.test/ada.jpg",
      is_playing: true,
    }]);
  });

  it("drops non-public avatar storage paths", () => {
    expect(projectPublicActivitySessionHosts([{
      display_name: "Host",
      avatar_url: "private-bucket/internal/avatar.png",
    }])).toEqual([{
      first_name: "Host",
      display_name: "Host",
      avatar_url: null,
      is_playing: true,
    }]);
  });

  it("recursively rejects forbidden linkage and contact fields across the public payload", () => {
    const privateCustomerId = "22222222-2222-4222-8222-222222222222";
    const privateAuthId = "44444444-4444-4444-8444-444444444444";
    const payload = {
      activity_session: {
        id: "public-session-reference",
        hosts: projectPublicActivitySessionHosts([{
          customer_id: privateCustomerId,
          auth_user_id: privateAuthId,
          display_name: "Ada Lovelace",
          avatar_url: "https://images.example.test/ada.jpg",
          email: "private@example.test",
          phone: "+46000000000",
        }]),
      },
      registrations: { count: 4 },
      participants: projectPublicEventParticipants([{
        id: "internal-player-row",
        auth_user_id: privateAuthId,
        name: "Public Player",
        email: "hidden@example.test",
        phone: "+46111111111",
      }], new Map([[privateAuthId, "https://images.example.test/player.jpg"]])),
    };

    expect(findForbiddenPaths(payload)).toEqual([]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(privateCustomerId);
    expect(serialized).not.toContain(privateAuthId);
    expect(serialized).not.toMatch(/private@example\.test|hidden@example\.test|\+46/);
    expect(payload.activity_session.hosts[0]).toMatchObject({
      display_name: "Ada Lovelace",
      avatar_url: "https://images.example.test/ada.jpg",
      is_playing: true,
    });
    expect(payload.registrations.count).toBe(4);
  });

  it("uses the same safe host projection for public and authenticated callers", () => {
    const row = {
      customer_id: "22222222-2222-4222-8222-222222222222",
      user_id: "33333333-3333-4333-8333-333333333333",
      display_name: "Ada Lovelace",
      avatar_url: "https://images.example.test/ada.jpg",
      email: "authenticated-only@example.test",
    };
    expect(projectPublicActivitySessionHosts([row])).toEqual(projectPublicActivitySessionHosts([{ ...row }]));
    expect(findForbiddenPaths({ hosts: projectPublicActivitySessionHosts([row]) })).toEqual([]);
  });

  it("routes every official public host consumer through the safe projection", () => {
    expect(eventApiSource).toContain("projectPublicActivitySessionHosts(rows)");
    expect(eventApiSource).toContain("hosts: hostsBySessionId.get(session.id) || []");
    expect(eventApiSource).not.toContain("hosts: hosts.filter(");
    expect(todaySource).not.toContain("get_public_activity_session_hosts");
    expect(programSource).not.toMatch(/host\.customer_id|sessionHosts\.map\([^)]*customer_id/);
    expect(programSource).toContain("isPlayingHostReason(currentRegistrationMetadata.role)");
  });
});
