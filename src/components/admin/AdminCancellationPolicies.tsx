import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancellationDecisionCopy,
  confirmStaffCancellation,
  fetchStaffCancellationPreview,
  type CancellationDecision,
  type CancellationSubjectType,
  type StaffCancellationChoice,
} from "@/lib/cancellationPolicy";

type AdminPolicyData = {
  policies: Array<{
    id: string;
    policy_key: string;
    policy_family: string;
    name: string;
    cancellation_policy_versions: Array<{
      id: string;
      version: number;
      lifecycle_status: string;
      preset_key: string;
      rules: Record<string, unknown>;
      copy_sv: { title: string; summary: string; late: string; boundary: string };
    }>;
  }>;
  bindings: Array<{
    id: string;
    policy_family: string;
    subject_type: string;
    subject_id: string | null;
    cancellation_policy_versions: {
      version: number;
      preset_key: string;
      rules: Record<string, unknown>;
      copy_sv: { title: string; summary: string; late: string; boundary: string };
    };
  }>;
  decisions: Array<{
    id: string;
    policy_mode: "policy_v1" | "legacy";
    snapshot_id: string | null;
    subject_type: string;
    subject_id: string;
    actor_mode: string;
    reason_code: string;
    refund_amount_minor: number;
    currency: string;
    refund_mode: string;
    entitlement_restore_mode: string;
    staff_reason?: string | null;
  }>;
  snapshots: Array<{
    id: string;
    policy_key: string;
    policy_version: number | null;
    provenance: string;
    created_at: string;
    copy_sv?: { title?: string } | null;
  }>;
  refunds: Array<{
    cancellation_decision_id: string;
    status: string;
    last_error?: string | null;
  }>;
  cutovers: Array<{
    authority_key: string;
    preset_key: string;
    schema_version: number;
    enabled_at: string;
  }>;
  rollout_preflight: {
    historical_business_rows_mutated: number;
    historical_snapshots_created: number;
    historical_fk_links_changed: number;
    ambiguous_legacy_rows: number;
    legacy_policy_details_unavailable: number;
    post_cutover_missing_snapshot: number;
    legacy_population: Record<string, number>;
  } | null;
};

const FAMILY_LABELS: Record<string, string> = {
  occurrence_ticket: "Open Play, träning & aktivitet",
  booking_participant: "Medspelarplats",
  court_booking: "Banbokning",
  managed_course: "Kurs",
  league_team: "Liga / lagserie",
  event: "Event",
};

const FAMILY_PRESETS: Record<string, string[]> = {
  occurrence_ticket: ["standard_12h"],
  booking_participant: ["standard_12h"],
  court_booking: ["court_24h"],
  managed_course: ["course_48h"],
  league_team: ["league_registration_close"],
  event: ["event_24h", "event_non_refundable"],
};

const PRESET_LABELS: Record<string, string> = {
  standard_12h: "STANDARD 12H",
  court_24h: "COURT 24H",
  course_48h: "COURSE 48H",
  league_registration_close: "LEAGUE REGISTRATION CLOSE",
  event_24h: "EVENT 24H",
  event_non_refundable: "EVENT NON-REFUNDABLE",
};

function money(minor: number, currency = "SEK") {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency, maximumFractionDigits: 2 })
    .format(Number(minor || 0) / 100);
}

export default function AdminCancellationPolicies({ venueId }: { venueId?: string }) {
  const queryClient = useQueryClient();
  const [eventSubjectType, setEventSubjectType] = useState<"activity_series" | "event">("activity_series");
  const [eventSubjectId, setEventSubjectId] = useState("");
  const [eventPreset, setEventPreset] = useState("event_24h");
  const [staffSubjectType, setStaffSubjectType] = useState<CancellationSubjectType>("activity_registration");
  const [staffSubjectId, setStaffSubjectId] = useState("");
  const [staffReason, setStaffReason] = useState("");
  const [staffChoice, setStaffChoice] = useState<StaffCancellationChoice>({ refundChoice: "policy", restoreChoice: "policy" });
  const [staffPreview, setStaffPreview] = useState<CancellationDecision | null>(null);
  const query = useQuery({
    queryKey: ["admin-cancellation-policies", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet<AdminPolicyData>("api-cancellations", "admin", { venueId: venueId! }),
  });
  const bind = useMutation({
    mutationFn: (input: { family: string; presetKey: string; subjectType: string; subjectId?: string | null }) =>
      apiPost("api-cancellations", "admin/binding", {
        venue_id: venueId,
        policy_family: input.family,
        preset_key: input.presetKey,
        subject_type: input.subjectType,
        subject_id: input.subjectId || null,
        reason: "Vald i Admin · Avbokning & återbetalning",
      }),
    onSuccess: async () => {
      toast.success("Policyn är sparad för nya köp");
      await queryClient.invalidateQueries({ queryKey: ["admin-cancellation-policies", venueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const previewOverride = useMutation({
    mutationFn: () => fetchStaffCancellationPreview(staffSubjectType, staffSubjectId.trim(), staffChoice),
    onSuccess: setStaffPreview,
    onError: (error: Error) => { setStaffPreview(null); toast.error(error.message); },
  });
  const confirmOverride = useMutation({
    mutationFn: async () => {
      if (!staffPreview) throw new Error("Förhandsbeslut saknas");
      return confirmStaffCancellation(staffPreview, staffReason.trim(), staffChoice);
    },
    onSuccess: async (result) => {
      toast.success(result.refund_processing ? "Platsen är släppt och återbetalningen behandlas" : "Staff override genomförd");
      setStaffPreview(null);
      setStaffSubjectId("");
      setStaffReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-cancellation-policies", venueId] });
    },
    onError: async (error: Error) => {
      toast.error(error.message);
      setStaffPreview(null);
      if (staffSubjectId.trim()) previewOverride.mutate();
    },
  });

  const snapshotsById = useMemo(
    () => new Map((query.data?.snapshots || []).map((snapshot) => [snapshot.id, snapshot])),
    [query.data?.snapshots],
  );
  const refundsByDecision = useMemo(
    () => new Map((query.data?.refunds || []).map((refund) => [refund.cancellation_decision_id, refund])),
    [query.data?.refunds],
  );

  if (query.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (query.isError) return <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(query.error as Error).message}</p>;
  const data = query.data!;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-base font-bold">Avbokning & återbetalning</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Välj ett godkänt preset. Publicerade versioner ändras aldrig; ett nytt val gäller endast nya köp.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 text-xs">
        <h3 className="text-sm font-bold">Forward-only cutover</h3>
        <p className="mt-1 text-muted-foreground">
          {data.cutovers.length} auktoriteter aktiverade · historiska köp ändrade: <b className="text-foreground">{data.rollout_preflight?.historical_business_rows_mutated ?? "—"}</b>
          {" · "}historiska snapshots: <b className="text-foreground">{data.rollout_preflight?.historical_snapshots_created ?? "—"}</b>
        </p>
        <p className="mt-1 text-muted-foreground">
          Legacy · policyuppgifter saknas: <b className="text-foreground">{data.rollout_preflight?.legacy_policy_details_unavailable ?? "—"}</b>
          {" · "}bevisat tvetydig specialklass: <b className="text-foreground">{data.rollout_preflight?.ambiguous_legacy_rows ?? "—"}</b>
          {" · "}nya köp utan snapshot: <b className={data.rollout_preflight?.post_cutover_missing_snapshot ? "text-destructive" : "text-foreground"}>{data.rollout_preflight?.post_cutover_missing_snapshot ?? "—"}</b>
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold">Staff override</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Explicit och auditerad. En avbokad plats släpps alltid; incheckningshistorik raderas aldrig.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Objekttyp
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={staffSubjectType} onChange={(event) => { setStaffSubjectType(event.target.value as CancellationSubjectType); setStaffPreview(null); }}>
              <option value="activity_registration">Aktivitetsplats</option>
              <option value="booking_participant">Medspelarplats</option>
              <option value="court_booking">Banbokning</option>
              <option value="series_commitment">Kursplats</option>
              <option value="league_team_entry">Lagplats</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Objekt-ID
            <Input className="mt-1" value={staffSubjectId} onChange={(event) => { setStaffSubjectId(event.target.value); setStaffPreview(null); }} placeholder="UUID" />
          </label>
          <label className="text-xs font-semibold">Återbetalning
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={staffChoice.refundChoice} onChange={(event) => { setStaffChoice((current) => ({ ...current, refundChoice: event.target.value as StaffCancellationChoice["refundChoice"] })); setStaffPreview(null); }}>
              <option value="policy">Enligt köpt policy</option>
              <option value="full">Full återbetalning</option>
              <option value="none">Ingen återbetalning</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Rättighet
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={staffChoice.restoreChoice} onChange={(event) => { setStaffChoice((current) => ({ ...current, restoreChoice: event.target.value as StaffCancellationChoice["restoreChoice"] })); setStaffPreview(null); }}>
              <option value="policy">Enligt köpt policy</option>
              <option value="restore">Återställ mätbar rättighet</option>
              <option value="none">Återställ inte</option>
            </select>
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Anledning
            <Input className="mt-1" value={staffReason} onChange={(event) => { setStaffReason(event.target.value); setStaffPreview(null); }} placeholder="Sjukdom, Pickla/systemfel, ändrat event, goodwill eller annat" />
          </label>
        </div>
        {!staffPreview ? (
          <Button className="mt-3 w-full" variant="outline" disabled={previewOverride.isPending || !staffSubjectId.trim() || staffReason.trim().length < 3} onClick={() => previewOverride.mutate()}>
            {previewOverride.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Förhandsgranska override"}
          </Button>
        ) : (() => {
          const copy = cancellationDecisionCopy(staffPreview);
          return <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            <p className="font-bold">{copy.title}</p>
            <p className="mt-1 leading-relaxed">{copy.outcome}</p>
            <p className="mt-2">Kapacitet: <b>släpps direkt</b> · check-in bevaras: <b>{staffPreview.checked_in ? "ja" : "ej tillämpligt"}</b></p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setStaffPreview(null)} disabled={confirmOverride.isPending}>Ändra</Button>
              <Button onClick={() => confirmOverride.mutate()} disabled={confirmOverride.isPending}>{confirmOverride.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.confirmLabel}</Button>
            </div>
          </div>;
        })()}
      </section>

      <section className="space-y-3">
        {Object.entries(FAMILY_LABELS).filter(([family]) => family !== "event").map(([family, label]) => {
          const active = data.bindings.find((binding) => binding.policy_family === family && binding.subject_type === "family_default");
          const preset = FAMILY_PRESETS[family][0];
          const policy = data.policies.find((candidate) => candidate.policy_key === preset);
          const version = policy?.cancellation_policy_versions.find((candidate) => candidate.lifecycle_status === "published");
          return (
            <div key={family} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{label}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-primary">{PRESET_LABELS[preset]}</p>
                </div>
                {active ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{version?.copy_sv?.summary}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {active ? `${PRESET_LABELS[active.cancellation_policy_versions.preset_key]} · v${active.cancellation_policy_versions.version}` : "Saknar aktiv standard"}
                </span>
                {!active && <Button size="sm" disabled={bind.isPending} onClick={() => bind.mutate({ family, presetKey: preset, subjectType: "family_default" })}>Aktivera</Button>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold">Event · explicit policy</h3>
        <p className="mt-1 text-xs text-muted-foreground">Event får ingen dold standard. Bind 24 h eller ej återbetalningsbart till rätt serie/event före försäljning.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Objekttyp
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={eventSubjectType} onChange={(event) => setEventSubjectType(event.target.value as typeof eventSubjectType)}>
              <option value="activity_series">Aktivitetsserie</option>
              <option value="event">Event</option>
            </select>
          </label>
          <label className="text-xs font-semibold">ID
            <Input className="mt-1" value={eventSubjectId} onChange={(event) => setEventSubjectId(event.target.value)} placeholder="UUID" />
          </label>
          <label className="text-xs font-semibold sm:col-span-2">Policy
            <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={eventPreset} onChange={(event) => setEventPreset(event.target.value)}>
              {FAMILY_PRESETS.event.map((preset) => <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-3 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
          {data.policies.find((policy) => policy.policy_key === eventPreset)?.cancellation_policy_versions.find((version) => version.lifecycle_status === "published")?.copy_sv?.summary}
        </p>
        <Button className="mt-3 w-full" disabled={bind.isPending || !eventSubjectId.trim()} onClick={() => bind.mutate({ family: "event", presetKey: eventPreset, subjectType: eventSubjectType, subjectId: eventSubjectId.trim() })}>
          {bind.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara för nya köp"}
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-bold">Senaste policybeslut</h3>
          <p className="mt-1 text-xs text-muted-foreground">Förklaring, deadline, kapacitet, återbetalning och override utan SQL.</p>
        </div>
        {(data.decisions || []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Inga policybeslut ännu.</div>
        ) : data.decisions.slice(0, 20).map((decision) => {
          const snapshot = decision.snapshot_id ? snapshotsById.get(decision.snapshot_id) : undefined;
          const refund = refundsByDecision.get(decision.id);
          return (
            <div key={decision.id} className="rounded-xl border border-border bg-card p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{decision.policy_mode === "legacy" ? "Legacy policy · Köpt före Policy V1" : `${snapshot?.copy_sv?.title || snapshot?.policy_key || "Policy V1"} · v${snapshot?.policy_version ?? "—"}`}</p>
                  <p className="mt-1 text-muted-foreground">{decision.subject_type} · {decision.subject_id}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 font-semibold">{decision.actor_mode === "staff_override" ? "Staff override" : "Kund"}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground">
                <span>Orsak: <b className="text-foreground">{decision.reason_code}</b></span>
                <span>Kapacitet: <b className="text-foreground">Released</b></span>
                <span>Refund: <b className="text-foreground">{money(decision.refund_amount_minor, decision.currency)} · {refund?.status || decision.refund_mode}</b></span>
                <span>Entitlement: <b className="text-foreground">{decision.entitlement_restore_mode}</b></span>
                <span className="col-span-2">{decision.policy_mode === "legacy" ? <><b className="text-foreground">Legacy · policyuppgifter saknas</b> · ingen kontraktssnapshot skapad</> : <>Snapshot: <b className="text-foreground">{snapshot?.provenance || "—"}</b> · köpt {snapshot?.created_at ? new Date(snapshot.created_at).toLocaleString("sv-SE") : "—"}</>}</span>
                {decision.staff_reason ? <span className="col-span-2">Motivering: <b className="text-foreground">{decision.staff_reason}</b></span> : null}
                {refund?.last_error ? <span className="col-span-2 text-destructive">Refundfel: {refund.last_error}</span> : null}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
