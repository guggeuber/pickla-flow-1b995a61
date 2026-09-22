import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cancellationDecisionCopy,
  type CancellationDecision,
} from "@/lib/cancellationPolicy";

const migration = readFileSync(
  "supabase/migrations/20260922120000_cancellation_policy_v1.sql",
  "utf8",
);
const edge = readFileSync("supabase/functions/api-cancellations/index.ts", "utf8");
const client = readFileSync("src/lib/cancellationPolicy.ts", "utf8");

function decision(overrides: Partial<CancellationDecision> = {}): CancellationDecision {
  return {
    subject_type: "activity_registration",
    subject_id: "00000000-0000-4000-8000-000000000001",
    venue_id: "00000000-0000-4000-8000-000000000002",
    snapshot_id: "00000000-0000-4000-8000-000000000003",
    policy_family: "occurrence_ticket",
    policy_key: "standard_12h",
    policy_version: 1,
    provenance: "family_default",
    copy_sv: {
      title: "Avbokning Standard 12 h",
      summary: "Platsen släpps direkt.",
      late: "Ingen återbetalning.",
      boundary: "Exakt 12 timmar räknas som sent.",
    },
    copy_en: {
      title: "Standard 12-hour cancellation",
      summary: "The place is released immediately.",
      late: "No refund.",
      boundary: "Exactly 12 hours counts as late.",
    },
    evaluated_at: "2030-01-01T10:00:00.000Z",
    state_revision: "revision-1",
    allowed: true,
    reason_code: "customer_cancelled_before_refund_cutoff",
    already_cancelled: false,
    checked_in: false,
    cancel_deadline_at: "2030-01-02T12:00:00.000Z",
    refund_deadline_at: "2030-01-02T00:00:00.000Z",
    refund_mode: "automatic_full",
    refund_amount_minor: 16500,
    currency: "SEK",
    entitlement_restore_mode: "none",
    capacity_release_mode: "immediate",
    ...overrides,
  };
}

describe("Cancellation Policy V1", () => {
  it("renders Swedish and English from the same server decision", () => {
    const sv = cancellationDecisionCopy(decision(), "sv");
    const en = cancellationDecisionCopy(decision(), "en");

    expect(sv.outcome).toContain("165");
    expect(sv.outcome).toContain("automatiskt");
    expect(en.outcome).toContain("165");
    expect(en.outcome).toContain("automatically");
    expect(sv.confirmLabel).toContain("165");
    expect(en.confirmLabel).toContain("165");
  });

  it("never promises a refund when the server decision says none", () => {
    const late = decision({ refund_mode: "none", refund_amount_minor: 0 });
    expect(cancellationDecisionCopy(late, "sv").confirmLabel).toBe("Avboka utan återbetalning");
    expect(cancellationDecisionCopy(late, "en").confirmLabel).toBe("Cancel without refund");
  });

  it("shows the required checked-in contact message in both languages", () => {
    const checkedIn = decision({
      allowed: false,
      checked_in: true,
      reason_code: "checked_in_locked",
      refund_mode: "none",
      refund_amount_minor: 0,
    });
    expect(cancellationDecisionCopy(checkedIn, "sv").outcome).toBe(
      "Du är redan incheckad. Kontakta Pickla om något blivit fel.",
    );
    expect(cancellationDecisionCopy(checkedIn, "en").outcome).toBe(
      "You are already checked in. Contact Pickla if something is wrong.",
    );
  });

  it("keeps eligibility and time authority out of the frontend", () => {
    expect(client).toContain('apiPost<CancellationDecision>("api-cancellations", "preview"');
    expect(client).toContain("state_revision: decision.state_revision");
    expect(client).not.toMatch(/DateTime\.now\(.*refund/i);
    expect(edge).toContain("p_now: new Date().toISOString()");
    expect(edge).not.toContain("body.refund_amount");
    expect(edge).not.toContain("body.payer");
  });

  it("recognizes the hosted Edge Function route with or without the gateway prefix", () => {
    expect(edge).toContain("const functionPrefix = '/api-cancellations'");
    expect(edge).toContain("pathname.indexOf(functionPrefix)");
    expect(edge).toContain("pathname.slice(prefixIndex + functionPrefix.length)");
  });

  it("uses only valid venue_staff enum roles for policy administration", () => {
    expect(edge).toContain("requireVenueRole(admin, userId, venueId, ['venue_admin'])");
    expect(edge).not.toContain("['venue_admin', 'owner', 'manager']");
  });

  it("contains immutable snapshots, exact boundaries, atomic capacity release, and R2A commands", () => {
    expect(migration).toContain("CREATE TABLE public.cancellation_policy_snapshots");
    expect(migration).toContain("cancellation_policy_snapshots_immutable");
    expect(migration).toContain("p_now < COALESCE(");
    expect(migration).toContain("stale_cancellation_preview");
    expect(migration).toContain("cancel_activity_registration_participation");
    expect(migration).toContain("cancel_booking_participant_capacity");
    expect(migration).toContain("provider_idempotency_key");
    expect(migration).toContain("cancellation_decision_id");
  });
});
