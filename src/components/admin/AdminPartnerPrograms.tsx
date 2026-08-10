import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

type PartnerProgram = {
  id: string;
  program_key: string;
  name: string;
  activity_label: string;
  access_reason: string;
  desk_label: string;
  funding_counterparty_ref: string;
  reimbursement_amount_minor: number;
  currency: "SEK";
  agreement_version: string;
  agreement_effective_date: string;
  consumption_trigger: "on_checkin" | "on_commitment" | "on_session_end";
  no_show_policy: "do_not_consume" | "consume" | "manual_review";
  status: "active" | "inactive" | "archived";
  valid_from: string | null;
  valid_until: string | null;
};

type SessionEligibility = {
  partner_program_id: string;
  activity_session_id: string;
  status: "eligible" | "ineligible";
};

type ProgramResponse = {
  programs: PartnerProgram[];
  session_eligibility: SessionEligibility[];
};

type OperationsResponse = {
  assignments: Array<{
    id: string;
    status: string;
    access_reason: string;
    service_date: string;
    customer: { id: string; name: string };
    activity: { id: string; name: string; start_time?: string | null } | null;
    program: { name: string; desk_label: string } | null;
    registration: { id: string; status: string } | null;
    attendance: { consumption_id: string; occurred_at: string; reconciled: boolean } | null;
  }>;
  receivables: Array<{
    id: string;
    event_type: "accrued" | "reversal";
    amount_minor: number;
    currency: string;
    occurred_at: string;
    settlement_state: string;
    settlement_reference?: string | null;
    customer_name: string;
    activity_name: string;
    program_name: string;
  }>;
};

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
const today = () => DateTime.now().setZone("Europe/Stockholm").toISODate() || "";

function krToMinor(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function formatSek(minor: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(minor / 100);
}

const defaultProgramDraft = () => ({
  name: "Bruce",
  programKey: "bruce",
  activityLabel: "Bruce gäller",
  accessReason: "Ingår via Bruce",
  deskLabel: "Bruce",
  fundingCounterpartyRef: "",
  reimbursementSek: "",
  agreementVersion: "",
  agreementEffectiveDate: today(),
  consumptionTrigger: "on_checkin" as const,
  noShowPolicy: "do_not_consume" as const,
  status: "active" as const,
  validFrom: "",
  validUntil: "",
});

export default function AdminPartnerPrograms({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const [programId, setProgramId] = useState("");
  const [programDraft, setProgramDraft] = useState(defaultProgramDraft);

  const { data: configuration, isLoading: programsLoading } = useQuery<ProgramResponse>({
    queryKey: ["admin-partner-access-programs", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet("api-entitlements", "programs", { venueId }),
  });
  const { data: operations } = useQuery<OperationsResponse>({
    queryKey: ["admin-partner-operations", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet("api-entitlements", "operations", { venueId }),
  });

  const programs = configuration?.programs || [];

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-partner-access-programs", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-partner-operations", venueId] });
  };

  const saveProgram = useMutation({
    mutationFn: async () => {
      const reimbursementAmountMinor = krToMinor(programDraft.reimbursementSek);
      if (reimbursementAmountMinor == null || !programDraft.fundingCounterpartyRef.trim()
        || !programDraft.agreementVersion.trim() || !programDraft.agreementEffectiveDate) {
        throw new Error("Ange motpart, ersättning, avtalsversion och giltighetsdatum");
      }
      const body = {
        venueId,
        programKey: programDraft.programKey.trim(),
        name: programDraft.name.trim(),
        activityLabel: programDraft.activityLabel.trim(),
        accessReason: programDraft.accessReason.trim(),
        deskLabel: programDraft.deskLabel.trim(),
        fundingCounterpartyRef: programDraft.fundingCounterpartyRef.trim(),
        reimbursementAmountMinor,
        currency: "SEK",
        agreementVersion: programDraft.agreementVersion.trim(),
        agreementEffectiveDate: programDraft.agreementEffectiveDate,
        consumptionTrigger: programDraft.consumptionTrigger,
        noShowPolicy: programDraft.noShowPolicy,
        status: programDraft.status,
        validFrom: programDraft.validFrom || null,
        validUntil: programDraft.validUntil || null,
      };
      return programId
        ? apiPatch("api-entitlements", "programs", { ...body, programId })
        : apiPost("api-entitlements", "programs", body);
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(programId ? "Partnerprogram uppdaterat" : "Partnerprogram skapat");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeAccess = useMutation({
    mutationFn: ({ entitlementId, reason }: { entitlementId: string; reason: string }) => apiPost(
      "api-entitlements",
      "revoke-partner-entitlement",
      { venueId, entitlementId, reason },
    ),
    onSuccess: () => {
      invalidateAll();
      toast.success("Bruce-access borttagen");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reconcileAttendance = useMutation({
    mutationFn: ({ entitlementId, registrationId, reason }: { entitlementId: string; registrationId: string; reason: string }) => apiPost(
      "api-entitlements",
      "reconcile-attendance",
      {
        venueId,
        entitlementId,
        registrationId,
        reason,
        idempotencyKey: `manual-reconciliation:${registrationId}`,
      },
    ),
    onSuccess: () => {
      invalidateAll();
      toast.success("Närvaro registrerad och spårbar");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const settleReceivable = useMutation({
    mutationFn: ({ receivableId, settlementReference }: { receivableId: string; settlementReference: string }) => apiPost(
      "api-entitlements",
      "settle-receivable",
      { venueId, receivableId, settlementReference },
    ),
    onSuccess: () => {
      invalidateAll();
      toast.success("Partnerfordran markerad som reglerad");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const visits = (operations?.assignments || []).filter((assignment) => Boolean(assignment.attendance));
  const pendingReceivables = (operations?.receivables || []).filter((event) => event.event_type === "accrued" && event.settlement_state === "pending");
  const settledReceivables = (operations?.receivables || []).filter((event) => event.event_type === "accrued" && event.settlement_state === "settled");

  const selectProgram = (selectedId: string) => {
    setProgramId(selectedId);
    const selected = programs.find((program) => program.id === selectedId);
    if (!selected) {
      setProgramDraft(defaultProgramDraft());
      return;
    }
    setProgramDraft({
      name: selected.name,
      programKey: selected.program_key,
      activityLabel: selected.activity_label,
      accessReason: selected.access_reason,
      deskLabel: selected.desk_label,
      fundingCounterpartyRef: selected.funding_counterparty_ref,
      reimbursementSek: String(selected.reimbursement_amount_minor / 100),
      agreementVersion: selected.agreement_version,
      agreementEffectiveDate: selected.agreement_effective_date,
      consumptionTrigger: selected.consumption_trigger,
      noShowPolicy: selected.no_show_policy,
      status: selected.status === "archived" ? "inactive" : selected.status,
      validFrom: selected.valid_from?.slice(0, 10) || "",
      validUntil: selected.valid_until?.slice(0, 10) || "",
    });
  };

  const askForReason = (message: string) => {
    const reason = window.prompt(message)?.trim();
    if (!reason) toast.error("Orsak krävs för spårbarhet");
    return reason || null;
  };

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Partnerfinansierad access</p>
        <p className="mt-1 text-sm text-muted-foreground">Konfigurera Bruce utan köp, saldo eller parallella accessregler.</p>
      </div>

      <div className="glass-card space-y-3 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Programvillkor</p>
            <p className="text-[11px] text-muted-foreground">Ersättning skapas först vid faktisk incheckning.</p>
          </div>
          {programsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-primary" />}
        </div>
        <select value={programId} onChange={(event) => selectProgram(event.target.value)} className={inputClass}>
          <option value="">Nytt partnerprogram</option>
          {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
        </select>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={programDraft.name} onChange={(event) => setProgramDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="Namn" className={inputClass} />
          <input value={programDraft.programKey} disabled={Boolean(programId)} onChange={(event) => setProgramDraft((draft) => ({ ...draft, programKey: event.target.value }))} placeholder="Programnyckel" className={inputClass} />
          <input value={programDraft.activityLabel} onChange={(event) => setProgramDraft((draft) => ({ ...draft, activityLabel: event.target.value }))} placeholder="Publik etikett" className={inputClass} />
          <input value={programDraft.accessReason} onChange={(event) => setProgramDraft((draft) => ({ ...draft, accessReason: event.target.value }))} placeholder="Accessorsak" className={inputClass} />
          <input value={programDraft.deskLabel} onChange={(event) => setProgramDraft((draft) => ({ ...draft, deskLabel: event.target.value }))} placeholder="Desk-etikett" className={inputClass} />
          <input value={programDraft.fundingCounterpartyRef} onChange={(event) => setProgramDraft((draft) => ({ ...draft, fundingCounterpartyRef: event.target.value }))} placeholder="Motpartsreferens" className={inputClass} />
          <input inputMode="decimal" value={programDraft.reimbursementSek} onChange={(event) => setProgramDraft((draft) => ({ ...draft, reimbursementSek: event.target.value }))} placeholder="Ersättning i kr" className={inputClass} />
          <input value="SEK" disabled className={inputClass} aria-label="Valuta" />
          <input value={programDraft.agreementVersion} onChange={(event) => setProgramDraft((draft) => ({ ...draft, agreementVersion: event.target.value }))} placeholder="Avtalsversion" className={inputClass} />
          <input type="date" value={programDraft.agreementEffectiveDate} onChange={(event) => setProgramDraft((draft) => ({ ...draft, agreementEffectiveDate: event.target.value }))} className={inputClass} aria-label="Avtalets giltighetsdatum" />
          <select value={programDraft.consumptionTrigger} onChange={(event) => setProgramDraft((draft) => ({ ...draft, consumptionTrigger: event.target.value as typeof draft.consumptionTrigger }))} className={inputClass} aria-label="Förbrukningstidpunkt">
            <option value="on_checkin">Vid incheckning</option>
            <option value="on_commitment">Vid bindande bokning</option>
            <option value="on_session_end">Efter avslutat pass</option>
          </select>
          <select value={programDraft.noShowPolicy} onChange={(event) => setProgramDraft((draft) => ({ ...draft, noShowPolicy: event.target.value as typeof draft.noShowPolicy }))} className={inputClass} aria-label="No-show-policy">
            <option value="do_not_consume">No-show förbrukar inte</option>
            <option value="consume">No-show förbrukar</option>
            <option value="manual_review">No-show granskas manuellt</option>
          </select>
          <input type="date" value={programDraft.validFrom} onChange={(event) => setProgramDraft((draft) => ({ ...draft, validFrom: event.target.value }))} className={inputClass} aria-label="Giltig från" />
          <input type="date" value={programDraft.validUntil} onChange={(event) => setProgramDraft((draft) => ({ ...draft, validUntil: event.target.value }))} className={inputClass} aria-label="Giltig till" />
          <select value={programDraft.status} onChange={(event) => setProgramDraft((draft) => ({ ...draft, status: event.target.value as "active" | "inactive" }))} className={inputClass}>
            <option value="active">Aktiv</option>
            <option value="inactive">Inaktiv</option>
          </select>
        </div>
        <button type="button" onClick={() => saveProgram.mutate()} disabled={saveProgram.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {saveProgram.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Spara programvillkor
        </button>
      </div>

      <div className="glass-card space-y-3 rounded-2xl p-4">
        <div>
          <p className="text-sm font-semibold">Bruce-drift</p>
          <p className="text-[11px] text-muted-foreground">Besök och manuellt reglerade partnerfordringar. Ingen automatisk avstämning.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bruce-besök</p><p className="mt-1 text-xl font-bold">{visits.length}</p></div>
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Väntande</p><p className="mt-1 text-xl font-bold">{pendingReceivables.length}</p></div>
          <div className="rounded-xl bg-muted/40 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reglerade</p><p className="mt-1 text-xl font-bold">{settledReceivables.length}</p></div>
        </div>
        <div className="space-y-2">
          {(operations?.assignments || []).map((assignment) => (
            <div key={assignment.id} className="rounded-xl bg-muted/40 p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{assignment.customer.name}</p>
                  <p className="text-muted-foreground">{assignment.activity?.name || "Aktivitet"} · {assignment.service_date}</p>
                  <p className="mt-1">{assignment.access_reason} · {assignment.attendance ? "Incheckad" : "Ej incheckad"}</p>
                </div>
                {assignment.status === "active" ? (
                  <button type="button" onClick={() => {
                    const reason = askForReason("Ange orsak till att Bruce-access tas bort");
                    if (reason) revokeAccess.mutate({ entitlementId: assignment.id, reason });
                  }} className="text-muted-foreground underline">Ta bort</button>
                ) : <span className="text-muted-foreground">{assignment.status}</span>}
              </div>
              {!assignment.attendance && assignment.registration && assignment.status === "active" ? (
                <button type="button" onClick={() => {
                  const reason = askForReason("Ange varför missad närvaro registreras manuellt");
                  if (reason) reconcileAttendance.mutate({ entitlementId: assignment.id, registrationId: assignment.registration!.id, reason });
                }} className="mt-2 font-semibold text-primary underline">Registrera missad närvaro</button>
              ) : null}
            </div>
          ))}
          {(operations?.assignments || []).length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">Inga Bruce-tilldelningar ännu</p> : null}
        </div>
        {pendingReceivables.length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold">Väntande fordringar</p>
            <div className="space-y-1.5">
              {pendingReceivables.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2 text-xs">
                  <span><span className="block font-semibold">{event.customer_name} · {event.activity_name}</span><span className="text-muted-foreground">{event.program_name}</span></span>
                  <span className="flex items-center gap-3"><span className="font-semibold">{formatSek(event.amount_minor)}</span><button type="button" disabled={settleReceivable.isPending} onClick={() => {
                    const reference = window.prompt("Ange riktig regleringsreferens från Bruce-underlaget")?.trim();
                    if (reference) settleReceivable.mutate({ receivableId: event.id, settlementReference: reference });
                  }} className="font-semibold text-primary underline disabled:opacity-50">Markera reglerad</button></span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {settledReceivables.length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold">Reglerade fordringar</p>
            <div className="space-y-1.5">
              {settledReceivables.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 text-xs">
                  <span>{event.customer_name} · {event.activity_name}<span className="ml-2 text-muted-foreground">{event.settlement_reference}</span></span>
                  <span className="font-semibold">{formatSek(event.amount_minor)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
