import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("active event storage capabilities", () => {
  it("restores event logos with ownership-scoped writes and no broad authenticated policy", () => {
    const migration = read("supabase/migrations/20260728170000_restore_event_logo_storage.sql");
    expect(migration).toContain("'event-logos'");
    expect(migration).toContain("public.can_manage_event_logo_object(name)");
    expect(migration).toContain("public.is_venue_admin(auth.uid(), v_venue_id)");
    expect(migration).toContain("public.is_super_admin()");
    expect(migration).not.toContain('CREATE POLICY "Staff can upload event logos"');
    expect(migration).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/);
  });

  it("keeps event offers private, PDF-only and server-only", () => {
    const migration = read("supabase/migrations/20260728180000_restore_private_event_offer_storage.sql");
    expect(migration).toContain("'event-offers'");
    expect(migration).toContain("false,\n  10485760");
    expect(migration).toContain("ARRAY['application/pdf']");
    expect(migration).not.toContain("CREATE POLICY");
  });

  it("uses one canonical object and one-hour signed URLs throughout offer APIs", () => {
    const sales = read("supabase/functions/event-sales-agent/index.ts");
    const generator = read("supabase/functions/event-pdf-generator/index.ts");
    const helper = read("supabase/functions/_shared/event_offer_storage.ts");

    expect(helper).toContain("organizationId");
    expect(helper).toContain("event_leads");
    expect(helper).toContain("EVENT_OFFER_SIGNED_URL_TTL_SECONDS = 60 * 60");
    expect(sales).toContain("canonicalEventOfferObjectPath(admin, offer)");
    expect(sales).toContain("assertCanonicalEventOfferObjectPath(admin, offer)");
    expect(sales).toContain("download(canonicalPath)");
    expect(sales).toContain("pdf_generation_failed");
    expect(generator).toContain("canonicalEventOfferObjectPath(admin, offer)");
    expect(generator).toContain("assertCanonicalEventOfferObjectPath(admin, offer)");
    expect(`${sales}\n${generator}`).not.toMatch(/60 \* 60 \* 24 \* 7/);
  });

  it("records exactly four deferred legacy-logo debt references", () => {
    const manifest = JSON.parse(read("docs/database/event-logo-reconciliation.json"));
    expect(manifest.release_disposition).toBe("known_content_debt_deferred");
    expect(manifest.records).toHaveLength(4);
    expect(manifest.records.map((record: { table: string; id: string }) => `${record.table}:${record.id}`)).toEqual([
      "events:71a4ed74-ff8d-4fac-bf2f-15606c8ce456",
      "events:9e8a09cc-70e7-4429-ae6a-addb5d06d404",
      "event_templates:82197c90-dc30-480b-9bce-b630ce4f22e0",
      "event_templates:b669a0ab-0fa7-4005-9db3-0b4b1f23b130",
    ]);

    const tool = read("scripts/reconcile-event-logos.mjs");
    expect(tool).toContain("records?.length !== 4");
    expect(tool).toContain("known_content_debt_deferred");
    expect(tool).toContain("Source URL changed");
    expect(tool).toContain("--allow-production");
    expect(tool).toContain("platform.event_logo.reconciled");
  });
});
