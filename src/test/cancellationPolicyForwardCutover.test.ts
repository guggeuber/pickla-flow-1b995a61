import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cancellationDecisionCopy, type CancellationDecision } from "@/lib/cancellationPolicy";

const migration = readFileSync("supabase/migrations/20260922120000_cancellation_policy_v1.sql", "utf8");
const commerce = readFileSync("supabase/functions/api-commerce/index.ts", "utf8");
const bookings = readFileSync("supabase/functions/api-bookings/index.ts", "utf8");
const preflight = readFileSync("scripts/cancellation-policy-rollout-preflight.sql", "utf8");

describe("Cancellation Policy V1 forward-only cutover", () => {
  it("contains seven explicit authorities and excludes membership and merchandise", () => {
    for (const authority of [
      "occurrence_ticket", "booking_participant", "court_booking", "managed_course",
      "league_team", "refundable_event", "non_refundable_event",
    ]) expect(migration).toContain(`'${authority}'`);
    const cutoverTable = migration.slice(
      migration.indexOf("CREATE TABLE public.cancellation_policy_cutovers"),
      migration.indexOf("CREATE TABLE public.cancellation_policy_snapshots"),
    );
    expect(cutoverTable).not.toContain("membership");
    expect(cutoverTable).not.toContain("merchandise");
  });

  it("never manufactures a legacy contractual snapshot or runs a historical FK backfill", () => {
    expect(migration).not.toContain("create_legacy_cancellation_snapshot");
    expect(migration).not.toContain("legacy_ambiguous");
    expect(migration).not.toMatch(/UPDATE public\.commerce_order_lines SET cancellation_policy_snapshot_id\s*=\s*v_snapshot_id/i);
    expect(migration).not.toMatch(/UPDATE public\.session_registrations SET cancellation_policy_snapshot_id\s*=\s*v_snapshot_id/i);
    expect(migration).not.toMatch(/UPDATE public\.bookings SET cancellation_policy_snapshot_id\s*=\s*v_snapshot_id/i);
    expect(migration).not.toMatch(/UPDATE public\.booking_participants SET cancellation_policy_snapshot_id\s*=\s*v_snapshot_id/i);
  });

  it("reports zero release-time historical mutations and fails closed for missing new truth", () => {
    expect(migration).toContain("historical_links AS");
    expect(migration).toContain("'historical_business_rows_mutated',(SELECT linked_rows FROM historical_link_totals)");
    expect(migration).toContain("'historical_snapshots_created',(SELECT linked_snapshots FROM historical_link_totals)");
    expect(migration).toContain("'historical_fk_links_changed',(SELECT linked_rows FROM historical_link_totals)");
    expect(migration).toContain("'ambiguous_legacy_rows',0");
    expect(migration).toContain("cancellation_policy_snapshot_required_after_cutover");
    expect(preflight).toContain("BEGIN TRANSACTION READ ONLY");
  });

  it("keeps the production-shape 1,883 records on legacy dispatch without mutation", () => {
    const population = {
      commerce_participation: 814,
      standalone_registration: 273,
      court_booking: 453,
      booking_participant: 343,
    };
    expect(Object.values(population).reduce((sum, count) => sum + count, 0)).toBe(1883);
    const synthetic = Object.entries(population).flatMap(([kind, count]) =>
      Array.from({ length: count }, (_, id) => ({ kind, id, snapshotId: null, purchaseSide: "before" })),
    );
    const dispatched = synthetic.map((row) => ({ ...row, mode: row.purchaseSide === "before" ? "legacy" : "fail_closed" }));
    expect(dispatched.filter((row) => row.mode === "legacy")).toHaveLength(1883);
    expect(dispatched.filter((row) => row.snapshotId !== null)).toHaveLength(0);
  });

  it("shows truthful legacy copy and preserves the co-player manual-refund consequence", () => {
    const legacy: CancellationDecision = {
      subject_type: "booking_participant", subject_id: "subject", venue_id: "venue",
      policy_mode: "legacy", snapshot_id: null, policy_family: "booking_participant",
      policy_key: "legacy-preserved", policy_version: null, provenance: "pre_cutover_runtime",
      copy_sv: { title: "Legacy policy", summary: "Köpt före Policy V1. Policyuppgifter saknas.", late: "", boundary: "" },
      copy_en: { title: "Legacy policy", summary: "Purchased before Policy V1. Policy details are unavailable.", late: "", boundary: "" },
      evaluated_at: "2026-09-22T00:00:00Z", state_revision: "legacy-revision",
      allowed: true, reason_code: "legacy_cancellation_allowed", already_cancelled: false,
      checked_in: false, cancel_deadline_at: null, refund_deadline_at: null,
      refund_mode: "manual_legacy", refund_amount_minor: 0, currency: "SEK",
      entitlement_restore_mode: "none", capacity_release_mode: "immediate",
    };
    expect(cancellationDecisionCopy(legacy, "sv").title).toBe("Legacy policy");
    expect(cancellationDecisionCopy(legacy, "sv").confirmLabel).toBe("Avboka · återbetalning granskas");
    expect(commerce).toContain("legacyCancellationProjection");
    expect(bookings).toContain("preview?.policy_mode === 'legacy'");
  });

  it("keeps the required legacy and Policy V1 purchase families side by side", () => {
    const matrix = [
      { subject: "open_play", legacy: "legacy-preserved", current: "standard_12h" },
      { subject: "co_player", legacy: "manual_legacy", current: "standard_12h" },
      { subject: "court", legacy: "legacy-preserved", current: "court_24h" },
      { subject: "course", legacy: "legacy-preserved", current: "course_48h" },
    ];
    expect(matrix).toEqual([
      { subject: "open_play", legacy: "legacy-preserved", current: "standard_12h" },
      { subject: "co_player", legacy: "manual_legacy", current: "standard_12h" },
      { subject: "court", legacy: "legacy-preserved", current: "court_24h" },
      { subject: "course", legacy: "legacy-preserved", current: "course_48h" },
    ]);
    expect(migration).toContain("v_policy_mode := 'legacy'");
    expect(migration).toContain("v_policy_key := 'legacy-preserved'");
    expect(migration).toContain("v_policy_family IN ('occurrence_ticket','managed_course','league_team')");
    expect(migration).toContain("('managed_course', 'managed_course', 'course_48h')");
  });
});
