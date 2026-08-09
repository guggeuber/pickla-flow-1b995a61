import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Check, Loader2, Search, ShieldCheck, UserRoundPlus } from "lucide-react";
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

type ActivitySession = {
  id: string;
  name: string;
  session_date?: string | null;
  start_time?: string | null;
  recurrence_days?: number[] | null;
};

type CustomerOption = {
  id?: string;
  customer_id?: string | null;
  display_name?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

type CustomerRight = {
  id: string;
  type: string;
  status: string;
  reason: string;
  service_date: string | null;
  activity_session_id: string | null;
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
    customer_name: string;
    activity_name: string;
    program_name: string;
  }>;
};

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
const today = () => DateTime.now().setZone("Europe/Stockholm").toISODate() || "";

function customerId(customer: CustomerOption | null) {
  return customer?.customer_id || customer?.id || "";
}

function customerName(customer: CustomerOption) {
  return customer.full_name
    || [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    || customer.display_name
    || customer.email
    || "Kund";
}

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
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [assignProgramId, setAssignProgramId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [serviceDate, setServiceDate] = useState(today);
  const [externalReference, setExternalReference] = useState("");
  const [operatorNote, setOperatorNote] = useState("");

  const { data: configuration, isLoading: programsLoading } = useQuery<ProgramResponse>({
    queryKey: ["admin-partner-access-programs", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet("api-entitlements", "programs", { venueId }),
  });
  const { data: sessions = [] } = useQuery<ActivitySession[]>({
    queryKey: ["admin-activity-sessions", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet("api-admin", "activity-sessions", { venueId }),
  });
  const { data: operations } = useQuery<OperationsResponse>({
    queryKey: ["admin-partner-operations", venueId],
    enabled: Boolean(venueId),
    queryFn: () => apiGet("api-entitlements", "operations", { venueId }),
  });

  const normalizedSearch = customerSearch.trim();
  const { data: customerOptions = [], isFetching: customerSearchLoading } = useQuery<CustomerOption[]>({
    queryKey: ["admin-partner-customer-search", venueId, normalizedSearch],
    enabled: Boolean(venueId) && !selectedCustomer && normalizedSearch.length >= 2,
    queryFn: () => apiGet("api-customers", "list", { venueId, search: normalizedSearch, limit: "8" }),
  });
  const selectedCustomerId = customerId(selectedCustomer);
  const { data: selectedCustomerRights } = useQuery<{ rights: CustomerRight[] }>({
    queryKey: ["admin-partner-customer-rights", venueId, selectedCustomerId],
    enabled: Boolean(venueId && selectedCustomerId),
    queryFn: () => apiGet("api-entitlements", "customer", { venueId, customerId: selectedCustomerId }),
  });

  const programs = configuration?.programs || [];
  const activePrograms = programs.filter((program) => program.status === "active");
  const eligibleSessionIds = useMemo(() => new Set((configuration?.session_eligibility || [])
    .filter((row) => row.partner_program_id === assignProgramId && row.status === "eligible")
    .map((row) => row.activity_session_id)), [assignProgramId, configuration?.session_eligibility]);
  const eligibleSessions = sessions.filter((session) => eligibleSessionIds.has(session.id));
  const activeSelectedRights = (selectedCustomerRights?.rights || [])
    .filter((right) => right.type === "partner_access" && right.status === "active");

  useEffect(() => {
    if (!assignProgramId && activePrograms[0]) setAssignProgramId(activePrograms[0].id);
  }, [activePrograms, assignProgramId]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-partner-access-programs", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-partner-operations", venueId] });
    if (selectedCustomerId) qc.invalidateQueries({ queryKey: ["admin-partner-customer-rights", venueId, selectedCustomerId] });
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

  const assignAccess = useMutation({
    mutationFn: () => {
      if (!selectedCustomerId || !assignProgramId || !sessionId || !serviceDate || !externalReference.trim()) {
        throw new Error("Välj kund, program, pass och datum samt ange Bruce-referens");
      }
      return apiPost("api-entitlements", "partner-entitlement", {
        venueId,
        customerId: selectedCustomerId,
        programId: assignProgramId,
        sessionId,
        serviceDate,
        externalReference: externalReference.trim(),
        operatorNote: operatorNote.trim() || null,
      });
    },
    onSuccess: () => {
      invalidateAll();
      setExternalReference("");
      setOperatorNote("");
      toast.success("Bruce-access tilldelad");
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
          <p className="text-sm font-semibold">Tilldela Bruce-access</p>
          <p className="text-[11px] text-muted-foreground">Endast pass som har aktiverats under Schema går att välja.</p>
        </div>
        {selectedCustomer ? (
          <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }} className="flex w-full items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-left text-sm">
            <span>{customerName(selectedCustomer)}</span><span className="text-xs text-muted-foreground">Byt kund</span>
          </button>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Sök befintlig kund" className={`${inputClass} pl-9`} />
            {normalizedSearch.length >= 2 ? (
              <div className="mt-2 space-y-1">
                {customerSearchLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : customerOptions.map((customer) => (
                  <button key={customerId(customer)} type="button" onClick={() => setSelectedCustomer(customer)} className="flex w-full justify-between rounded-xl bg-muted/40 px-3 py-2 text-left text-xs">
                    <span className="font-semibold">{customerName(customer)}</span><span className="text-muted-foreground">{customer.email || customer.phone || "Kund"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {selectedCustomer && activeSelectedRights.length > 0 ? (
          <div className="rounded-xl bg-muted/40 p-3 text-xs">
            <p className="font-semibold">Aktiv partneraccess</p>
            {activeSelectedRights.map((right) => <p key={right.id} className="mt-1 text-muted-foreground">{right.reason} · {right.service_date || "giltig period"}</p>)}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={assignProgramId} onChange={(event) => { setAssignProgramId(event.target.value); setSessionId(""); }} className={inputClass}>
            <option value="">Välj program</option>
            {activePrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value)} className={inputClass}>
            <option value="">Välj aktiverat pass</option>
            {eligibleSessions.map((session) => <option key={session.id} value={session.id}>{session.name}{session.start_time ? ` · ${session.start_time.slice(0, 5)}` : ""}</option>)}
          </select>
          <input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} className={inputClass} aria-label="Passdatum" />
          <input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Bruce-referens" className={inputClass} />
          <input value={operatorNote} onChange={(event) => setOperatorNote(event.target.value)} placeholder="Intern anteckning (valfritt)" className={`${inputClass} sm:col-span-2`} />
        </div>
        <button type="button" onClick={() => assignAccess.mutate()} disabled={assignAccess.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {assignAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}
          Tilldela för valt pass
        </button>
      </div>

      <div className="glass-card space-y-3 rounded-2xl p-4">
        <div>
          <p className="text-sm font-semibold">Bruce-drift</p>
          <p className="text-[11px] text-muted-foreground">Access och faktisk närvaro. Finansiella avtalsfält visas inte här.</p>
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
        {(operations?.receivables || []).length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold">Väntande partnerunderlag</p>
            <div className="space-y-1.5">
              {operations!.receivables.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 text-xs">
                  <span>{event.customer_name} · {event.activity_name}</span>
                  <span className="font-semibold">{event.event_type === "reversal" ? "−" : ""}{formatSek(event.amount_minor)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
