import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { AxCard, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";

type BruceSession = {
  program_id: string;
  program_name: string;
  desk_label: string;
  activity_session_id: string;
  activity_name: string;
  start_time: string;
  end_time: string;
  total_capacity: number | null;
  allocated_capacity: number;
  registered_count: number;
  publication_status: "needs_publication" | "published" | "changed" | "removed" | "error";
};

type CustomerOption = {
  id?: string;
  customer_id?: string;
  display_name?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

const inputClass = "h-10 w-full rounded-xl border border-white bg-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400";

function optionId(customer: CustomerOption | null) {
  return customer?.customer_id || customer?.id || "";
}

function optionName(customer: CustomerOption) {
  return customer.full_name
    || [customer.first_name, customer.last_name].filter(Boolean).join(" ")
    || customer.display_name
    || customer.email
    || "Kund";
}

function time(value: string) {
  return String(value || "").slice(0, 5);
}

export default function DeskBrucePanel({
  venueId,
  serviceDate,
  onParticipantAdded,
}: {
  venueId: string;
  serviceDate: string;
  onParticipantAdded: () => void;
}) {
  const qc = useQueryClient();
  const [selectedKey, setSelectedKey] = useState("");
  const [verified, setVerified] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [externalReference, setExternalReference] = useState("");

  const sessionsQuery = useQuery<{ sessions: BruceSession[] }>({
    queryKey: ["desk-bruce-sessions", venueId, serviceDate],
    queryFn: () => apiGet("api-entitlements", "desk-sessions", { venueId, date: serviceDate }),
    enabled: Boolean(venueId && serviceDate),
    refetchInterval: 30_000,
  });
  const sessions = sessionsQuery.data?.sessions || [];
  const selectedSession = useMemo(() => sessions.find((session) => `${session.program_id}:${session.activity_session_id}` === selectedKey) || sessions[0] || null, [selectedKey, sessions]);
  const normalizedSearch = customerSearch.trim();
  const customersQuery = useQuery<CustomerOption[]>({
    queryKey: ["desk-bruce-customer-search", venueId, normalizedSearch],
    queryFn: () => apiGet("api-customers", "list", { venueId, search: normalizedSearch, limit: "8" }),
    enabled: !selectedCustomer && normalizedSearch.length >= 2,
    staleTime: 15_000,
  });

  const createCustomer = useMutation({
    mutationFn: () => apiPost<CustomerOption>("api-entitlements", "partner-customer", {
      venueId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
    }),
    onSuccess: (customer) => {
      setSelectedCustomer(customer);
      setCustomerSearch(optionName(customer));
      setCreateOpen(false);
      toast.success("Kunden är skapad i Pickla");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addParticipant = useMutation({
    mutationFn: () => {
      if (!verified) throw new Error("Bekräfta att kunden är verifierad i Bruce Studio");
      if (!selectedSession || !optionId(selectedCustomer)) throw new Error("Välj pass och kund");
      return apiPost("api-entitlements", "partner-visit", {
        venueId,
        programId: selectedSession.program_id,
        sessionId: selectedSession.activity_session_id,
        serviceDate,
        customerId: optionId(selectedCustomer),
        externalReference: externalReference.trim() || null,
        operatorNote: "Verifierad manuellt i Bruce Studio",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["desk-bruce-sessions", venueId, serviceDate] });
      qc.invalidateQueries({ queryKey: ["admin-partner-operations", venueId] });
      setSelectedCustomer(null);
      setCustomerSearch("");
      setExternalReference("");
      setVerified(false);
      onParticipantAdded();
      toast.success("Bruce-deltagaren är tillagd");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="space-y-2">
      <AxSectionLabel icon={UserRoundPlus} accent={ax("electric")}>Bruce</AxSectionLabel>
      {sessionsQuery.isLoading ? (
        <AxCard pad="row"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("electric") }} /></AxCard>
      ) : sessions.length === 0 ? (
        <AxEmpty icon={UserRoundPlus} title="Inga Bruce-pass denna dag" hint="Aktivera Bruce på passet under Admin · Schema." tint={ax("electric")} />
      ) : (
        <AxCard pad="row">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black tracking-[0.18em] text-white">BRUCE</span>
                  <span className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider" style={{ background: ax("electric", 0.16), color: ax("electricSoft") }}>Manuell verifiering</span>
                </div>
                <p className="mt-1 text-sm font-black text-white">Lägg till Bruce-deltagare</p>
                <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>Verifiera kunden i Bruce Studio innan du skapar platsen i Pickla.</p>
              </div>
              {selectedSession ? (
                <div className="text-right">
                  <p className="text-xs font-black text-white">Bruce {selectedSession.registered_count}/{selectedSession.allocated_capacity || "–"}</p>
                  <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>Totalt {selectedSession.total_capacity ?? "–"}</p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <select
                value={selectedSession ? `${selectedSession.program_id}:${selectedSession.activity_session_id}` : ""}
                onChange={(event) => setSelectedKey(event.target.value)}
                className={inputClass}
                aria-label="Bruce-pass"
              >
                {sessions.map((session) => (
                  <option key={`${session.program_id}:${session.activity_session_id}`} value={`${session.program_id}:${session.activity_session_id}`}>
                    {time(session.start_time)} · {session.activity_name}
                  </option>
                ))}
              </select>
              <label className="flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black" style={{ borderColor: verified ? ax("lime", 0.45) : ax("borderSoft"), background: verified ? ax("lime", 0.12) : ax("surfaceHi"), color: verified ? ax("lime") : ax("muted") }}>
                <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
                Verifierad i Bruce Studio
              </label>
            </div>

            {selectedCustomer ? (
              <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }} className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-black text-white" style={{ borderColor: ax("lime", 0.35), background: ax("lime", 0.12) }}>
                <span>{optionName(selectedCustomer)}</span><span className="text-xs" style={{ color: ax("lime") }}>Byt kund</span>
              </button>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                  <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Sök kund med namn, telefon eller e-post" className={`${inputClass} pl-9`} />
                </div>
                {normalizedSearch.length >= 2 ? (
                  <div className="mt-2 space-y-1 rounded-xl border p-2" style={{ borderColor: ax("borderSoft"), background: ax("panel") }}>
                    {customersQuery.isFetching ? <Loader2 className="mx-auto h-4 w-4 animate-spin" style={{ color: ax("electric") }} /> : (customersQuery.data || []).map((customer) => (
                      <button key={optionId(customer)} type="button" onClick={() => setSelectedCustomer(customer)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/5">
                        <span className="text-sm font-black text-white">{optionName(customer)}</span>
                        <span className="truncate text-xs font-bold" style={{ color: ax("muted") }}>{customer.phone || customer.email || "Kund"}</span>
                      </button>
                    ))}
                    {!customersQuery.isFetching && (customersQuery.data || []).length === 0 ? <p className="px-2 py-1 text-xs font-bold" style={{ color: ax("muted") }}>Ingen kund hittades.</p> : null}
                  </div>
                ) : null}
              </div>
            )}

            {!selectedCustomer ? (
              <div>
                <button type="button" onClick={() => setCreateOpen((current) => !current)} className="text-xs font-black underline" style={{ color: ax("electricSoft") }}>
                  {createOpen ? "Stäng kundformulär" : "Skapa ny kund i Pickla"}
                </button>
                {createOpen ? (
                  <div className="mt-2 grid gap-2 rounded-xl border p-3 md:grid-cols-2" style={{ borderColor: ax("borderSoft"), background: ax("surfaceHi") }}>
                    <input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Förnamn" className={inputClass} />
                    <input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Efternamn" className={inputClass} />
                    <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefon" className={inputClass} />
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-post (valfritt)" className={inputClass} />
                    <button type="button" onClick={() => createCustomer.mutate()} disabled={createCustomer.isPending || !firstName.trim() || !lastName.trim() || !phone.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50 md:col-span-2" style={{ background: ax("electric"), color: ax("ink") }}>
                      {createCustomer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}
                      Skapa kund
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Bruce-referens (valfri — ange bara riktig referens)" className={inputClass} />
              <button type="button" onClick={() => addParticipant.mutate()} disabled={addParticipant.isPending || !verified || !selectedCustomer || !selectedSession} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-black disabled:opacity-40" style={{ background: ax("lime"), color: ax("ink") }}>
                {addParticipant.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Lägg till Bruce-deltagare
              </button>
            </div>
          </div>
        </AxCard>
      )}
    </section>
  );
}
