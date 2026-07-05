import { useMemo, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  CreditCard,
  Gauge,
  Loader2,
  MonitorSmartphone,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Siren,
  Sparkles,
  Ticket,
  Wrench,
  X,
} from "lucide-react";
import { useAdminCheck, useAdminHistory, useAdminStats, useAdminVenues } from "@/hooks/useAdmin";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || "ptnvhbniiiapzbyofctg";

type OpsMode = "deploy" | "opening" | "closing" | "weekly";
type OpsColor = "green" | "yellow" | "red";
type Severity = "P0" | "P1" | "P2" | "P3";
type SignalKey = "payments" | "bookings" | "memberships" | "checkin" | "devices" | "score" | "mail" | "deploy";

type Incident = {
  id: string;
  severity: Severity;
  title: string;
  status: "open" | "contained" | "resolved";
  created_at: string;
  owner_name?: string | null;
};

type ClientEvent = {
  id: string;
  event_type: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  route?: string | null;
  fingerprint?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type OpsSignalRow = {
  signal_key: SignalKey;
  status: OpsColor;
  note?: string | null;
  source?: "manual" | "auto" | string | null;
  details?: Record<string, unknown> | null;
  last_auto_checked_at?: string | null;
};

type OpsCheckRow = {
  mode: OpsMode;
  item_index: number;
  label: string;
  is_done: boolean;
};

type OpsState = {
  venueId: string;
  signals: OpsSignalRow[];
  checks: OpsCheckRow[];
  incidents: Incident[];
  clientEvents?: ClientEvent[];
  agentRuns?: Array<{
    id: string;
    status: "ok" | "warning" | "critical" | "error";
    summary: Record<string, unknown>;
    finished_at: string;
  }>;
};

const modeLabels: Record<OpsMode, string> = {
  deploy: "Deploy watch",
  opening: "Opening check",
  closing: "Closing check",
  weekly: "Weekly check",
};

const checklists: Record<OpsMode, string[]> = {
  deploy: [
    "Vercel production build is green",
    "Open production home, /book, /my, and one known padda route",
    "Check Supabase Edge Function logs for changed functions",
    "Check Stripe webhook deliveries and retries",
    "Run one low-risk smoke path matching the change",
    "Classify deploy as Green, Yellow, or Red",
  ],
  opening: [
    "Today page shows correct venue state and upcoming sessions",
    "Desk loads and can search one known customer",
    "Paddor are online and show expected resource state",
    "Booking availability loads for pickleball and darts",
    "Stripe dashboard has no unresolved webhook failures",
  ],
  closing: [
    "No stuck paid Stripe sessions without Pickla records",
    "No unexpected active check-ins after closing",
    "Cancellations from the day released inventory",
    "Staff noted any support corrections made during the day",
  ],
  weekly: [
    "Founder allowance and vouchers look correct for a sample user",
    "Activity sessions for the next week look sane",
    "Receipts and VAT look correct for paid, free, and multi-resource bookings",
    "Temporary staff/admin access is removed or intentionally renewed",
  ],
};

const signalLabels: Record<SignalKey, { label: string; sub: string; icon: ElementType }> = {
  payments: { label: "Betalningar", sub: "Stripe / webhook", icon: CreditCard },
  bookings: { label: "Bokningar", sub: "Inventory / cancellation", icon: CalendarCheck },
  memberships: { label: "Medlemskap", sub: "Founder / vouchers", icon: Ticket },
  checkin: { label: "Check-in", sub: "Desk / kod / QR", icon: ClipboardCheck },
  devices: { label: "Paddor", sub: "Device routes", icon: MonitorSmartphone },
  score: { label: "Score", sub: "Dart / broadcast", icon: Activity },
  mail: { label: "Mail/Auth", sub: "Resend / Supabase Auth", icon: RadioTower },
  deploy: { label: "Deploy", sub: "Vercel / edge", icon: Gauge },
};

const signalTone: Record<OpsColor, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  yellow: "border-amber-200 bg-amber-50 text-amber-950",
  red: "border-rose-200 bg-rose-50 text-rose-950",
};

const severityTone: Record<Severity, string> = {
  P0: "bg-rose-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-amber-400 text-black",
  P3: "bg-slate-200 text-slate-900",
};

function nowStockholm() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function defaultSignals(): Record<SignalKey, OpsColor> {
  return {
    payments: "green",
    bookings: "green",
    memberships: "green",
    checkin: "green",
    devices: "green",
    score: "green",
    mail: "green",
    deploy: "green",
  };
}

function deriveOverall(signals: Record<SignalKey, OpsColor>, incidents: Incident[]): OpsColor {
  if (signals && Object.values(signals).includes("red")) return "red";
  if (incidents.some((incident) => incident.status !== "resolved" && incident.severity === "P0")) return "red";
  if (signals && Object.values(signals).includes("yellow")) return "yellow";
  if (incidents.some((incident) => incident.status !== "resolved" && incident.severity !== "P3")) return "yellow";
  return "green";
}

function overallCopy(color: OpsColor) {
  if (color === "red") return { title: "RÖD", body: "Stoppa, containa eller rulla tillbaka. Kundpåverkan utan trygg workaround." };
  if (color === "yellow") return { title: "GUL", body: "Det finns risk eller workaround. Följ upp innan nästa push eller öppning." };
  return { title: "GRÖN", body: "Pickla rullar. Fortsätt bevaka kritiska flöden." };
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[1.5rem] border border-black/10 bg-white p-4 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function formatDetails(details?: Record<string, unknown> | null) {
  if (!details || Object.keys(details).length === 0) return "Inga extra detaljer.";
  return JSON.stringify(details, null, 2);
}

function OpsCenterPage() {
  const queryClient = useQueryClient();
  const { data: adminData, isLoading, isError, refetch: refetchAdmin } = useAdminCheck();
  const { data: venues } = useAdminVenues();
  const venueId = adminData?.venueId;
  const { data: stats, refetch: refetchStats, isFetching: statsFetching } = useAdminStats(venueId);
  const { data: history, refetch: refetchHistory } = useAdminHistory(venueId);
  const [mode, setMode] = useState<OpsMode>("deploy");
  const [newIncident, setNewIncident] = useState("");
  const [newSeverity, setNewSeverity] = useState<Severity>("P2");

  const { data: opsState, refetch: refetchOps, isFetching: opsFetching } = useQuery({
    queryKey: ["ops-state", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<OpsState>("api-ops", "state", { venueId: venueId! }),
    refetchInterval: 15000,
  });

  const invalidateOps = () => {
    queryClient.invalidateQueries({ queryKey: ["ops-state", venueId] });
  };

  const signalMutation = useMutation({
    mutationFn: (body: { signal_key: SignalKey; status: OpsColor }) =>
      apiPatch("api-ops", "signal", { ...body, venueId }),
    onSuccess: invalidateOps,
  });

  const checkMutation = useMutation({
    mutationFn: (body: { mode: OpsMode; item_index: number; is_done: boolean }) =>
      apiPatch("api-ops", "check", { ...body, venueId }),
    onSuccess: invalidateOps,
  });

  const addIncidentMutation = useMutation({
    mutationFn: (body: { severity: Severity; title: string }) =>
      apiPost("api-ops", "incident", { ...body, venueId }),
    onSuccess: invalidateOps,
  });

  const updateIncidentMutation = useMutation({
    mutationFn: (body: { incident_id: string; status: Incident["status"] }) =>
      apiPatch("api-ops", "incident", { ...body, venueId }),
    onSuccess: invalidateOps,
  });

  const deleteIncidentMutation = useMutation({
    mutationFn: (incidentId: string) =>
      apiDelete("api-ops", "incident", { venueId: venueId!, incidentId }),
    onSuccess: invalidateOps,
  });

  const runAutoMutation = useMutation({
    mutationFn: () => apiPost("api-ops", "run-checks", { venueId }),
    onSuccess: invalidateOps,
  });

  const currentVenue = useMemo(() => (venues || []).find((venue: { id: string }) => venue.id === venueId), [venues, venueId]);
  const signals = useMemo(() => {
    const next = defaultSignals();
    (opsState?.signals || []).forEach((signal) => {
      next[signal.signal_key] = signal.status;
    });
    return next;
  }, [opsState?.signals]);
  const signalRows = useMemo(() => {
    const rows = new Map<SignalKey, OpsSignalRow>();
    (opsState?.signals || []).forEach((signal) => rows.set(signal.signal_key, signal));
    return rows;
  }, [opsState?.signals]);
  const checks = useMemo(() => {
    const grouped: Partial<Record<OpsMode, boolean[]>> = {};
    (opsState?.checks || []).forEach((check) => {
      const arr = grouped[check.mode] || checklists[check.mode].map(() => false);
      arr[check.item_index] = check.is_done;
      grouped[check.mode] = arr;
    });
    return grouped;
  }, [opsState?.checks]);
  const incidents = opsState?.incidents || [];
  const clientEvents = opsState?.clientEvents || [];
  const lastAgentRun = opsState?.agentRuns?.[0];
  const issueSignals = (opsState?.signals || []).filter((signal) => signal.status !== "green" || signal.note);
  const overall = deriveOverall(signals, incidents);
  const status = overallCopy(overall);
  const modeChecks = checks[mode] || checklists[mode].map(() => false);
  const completed = modeChecks.filter(Boolean).length;
  const revenueSevenDays = (history || []).reduce((sum: number, day: { revenue: number }) => sum + (day.revenue || 0), 0);

  const refreshAll = () => {
    refetchAdmin();
    refetchStats();
    refetchHistory();
    refetchOps();
  };

  const toggleCheck = (index: number) => {
    checkMutation.mutate({ mode, item_index: index, is_done: !modeChecks[index] });
  };

  const addIncident = () => {
    if (!newIncident.trim()) return;
    addIncidentMutation.mutate({ severity: newSeverity, title: newIncident.trim() });
    setNewIncident("");
    if (newSeverity === "P0") signalMutation.mutate({ signal_key: "deploy", status: "red" });
  };

  const updateIncidentStatus = (id: string, status: Incident["status"]) => {
    updateIncidentMutation.mutate({ incident_id: id, status });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f4ef]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-900" />
      </div>
    );
  }

  if (isError || !adminData?.isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f4ef] px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <ShieldCheck className="h-8 w-8 text-rose-700" />
        </div>
        <h1 className="text-3xl font-black text-slate-950">Ingen ops-access</h1>
        <p className="max-w-sm text-sm text-slate-500">Du behöver vara admin för att se driftstatus.</p>
        <Link to="/" className="rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white">Till Pickla</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-[#f7f4ef]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-3">
            <img src={picklaLogo} alt="Pickla" className="h-9 w-auto" />
            <span className="hidden rounded-full border border-black/10 bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500 sm:inline-flex">
              Ops Center
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden truncate rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm sm:block">
              {currentVenue?.name || "Venue"}
            </span>
            <button
              onClick={() => runAutoMutation.mutate()}
              disabled={runAutoMutation.isPending}
              className="hidden h-11 items-center justify-center gap-2 rounded-full border border-black/10 bg-slate-950 px-4 text-xs font-black text-white shadow-sm sm:flex"
            >
              {runAutoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Auto-scan
            </button>
            <button
              onClick={refreshAll}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white shadow-sm"
              aria-label="Uppdatera"
            >
              <RefreshCw className={`h-4 w-4 ${statsFetching || opsFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <section className={`overflow-hidden rounded-[2rem] border p-5 shadow-sm ${signalTone[overall]}`}>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] opacity-70">Production status</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="text-7xl font-black leading-none tracking-tight md:text-8xl">{status.title}</div>
                <div className="max-w-xl text-lg font-semibold leading-snug md:text-xl">{status.body}</div>
              </div>
              <p className="mt-4 font-mono text-xs opacity-60">
                DB-backed · uppdateras var 15:e sekund · lokal tid {nowStockholm()}
              </p>
              {lastAgentRun && (
                <p className="mt-1 font-mono text-xs opacity-60">
                  Ops Agent: {lastAgentRun.status} · senast {new Date(lastAgentRun.finished_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                </p>
              )}
            </div>
            <div className="grid min-w-[260px] grid-cols-2 gap-2">
              <a href="https://playpickla.com" className="rounded-2xl bg-white/70 p-3 text-sm font-bold">
                Production <ArrowUpRight className="ml-1 inline h-4 w-4" />
              </a>
              <a href="https://vercel.com" className="rounded-2xl bg-white/70 p-3 text-sm font-bold">
                Vercel <ArrowUpRight className="ml-1 inline h-4 w-4" />
              </a>
              <a href="https://dashboard.stripe.com/webhooks" className="rounded-2xl bg-white/70 p-3 text-sm font-bold">
                Stripe <ArrowUpRight className="ml-1 inline h-4 w-4" />
              </a>
              <a href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT_ID}/functions`} className="rounded-2xl bg-white/70 p-3 text-sm font-bold">
                Supabase <ArrowUpRight className="ml-1 inline h-4 w-4" />
              </a>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Bokningar idag" value={String(stats?.bookingsToday ?? "-")} sub="från api-admin/stats" />
          <Metric label="Intäkt idag" value={`${Math.round(stats?.todayRevenue ?? 0)} kr`} sub="exkl. cancelled" />
          <Metric label="Aktiva pass" value={String(stats?.activePasses ?? "-")} sub="idag" />
          <Metric label="7 dagar" value={`${Math.round(revenueSevenDays)} kr`} sub="historik" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Signals</p>
                <h2 className="text-2xl font-black">Live health board</h2>
              </div>
              <p className="max-w-sm text-xs text-slate-500">
                Status sparas i DB per venue. Admin-metrics hämtas live, signaler sätts av staff eller ops-agenten.
              </p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(signalLabels) as SignalKey[]).map((key) => {
                const cfg = signalLabels[key];
                const Icon = cfg.icon;
                const signalRow = signalRows.get(key);
                return (
                  <div key={key} className={`rounded-[1.4rem] border p-3 ${signalTone[signals[key]]}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5" />
                        <div>
                          <p className="text-sm font-black">{cfg.label}</p>
                          <p className="text-[11px] opacity-60">{cfg.sub}</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-1">
                      {(["green", "yellow", "red"] as OpsColor[]).map((color) => (
                        <button
                          key={color}
                          onClick={() => signalMutation.mutate({ signal_key: key, status: color })}
                          className={`h-8 rounded-full border text-[10px] font-black uppercase ${
                            signals[key] === color ? "border-black bg-black text-white" : "border-black/10 bg-white/60"
                          }`}
                        >
                          {color === "green" ? "OK" : color === "yellow" ? "Risk" : "Stop"}
                        </button>
                      ))}
                    </div>
                    {signalRow?.note && (
                      <div className="mt-3 rounded-2xl border border-black/5 bg-white/60 p-2">
                        <div className="mb-1 flex items-center gap-1">
                          <span className="rounded-full bg-black px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
                            {signalRow.source === "auto" ? "Auto" : "Manual"}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold leading-snug opacity-70">
                          {signalRow.note}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => runAutoMutation.mutate()}
              disabled={runAutoMutation.isPending}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-4 text-sm font-black text-white sm:hidden"
            >
              {runAutoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Kör auto-scan
            </button>
            <div className="mt-4 rounded-[1.5rem] border border-black/10 bg-[#f7f4ef] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Evidence</p>
                  <h3 className="text-lg font-black">Auto-logg</h3>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black">{issueSignals.length} signaler</span>
              </div>
              <div className="mt-3 space-y-2">
                {issueSignals.length === 0 && (
                  <p className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-500">Inga auto-notes ännu. Kör Auto-scan.</p>
                )}
                {issueSignals.map((signal) => {
                  const cfg = signalLabels[signal.signal_key];
                  return (
                    <details key={signal.signal_key} className="rounded-2xl border border-black/10 bg-white p-3">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black">{cfg.label}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">{signal.note || "Ingen note."}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${signalTone[signal.status]}`}>
                            {signal.status}
                          </span>
                        </div>
                      </summary>
                      <pre className="mt-3 max-h-60 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-relaxed text-white">
                        {formatDetails(signal.details)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Ops agent</p>
                <h2 className="text-2xl font-black">Run check</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-black">{completed}/{checklists[mode].length}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(Object.keys(modeLabels) as OpsMode[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setMode(item)}
                  className={`rounded-2xl px-3 py-3 text-left text-sm font-black ${
                    mode === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {modeLabels[item]}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {checklists[mode].map((item, index) => (
                <button
                  key={item}
                  onClick={() => toggleCheck(index)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-black/10 bg-[#f7f4ef] p-3 text-left"
                >
                  {modeChecks[index] ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
                  <span className={`text-sm font-semibold ${modeChecks[index] ? "text-slate-400 line-through" : "text-slate-900"}`}>{item}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Client</p>
                <h2 className="text-2xl font-black">Browser/API-logg</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-black">
                {clientEvents.length} senaste
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {clientEvents.length === 0 && (
                <div className="rounded-3xl border border-dashed border-black/10 p-6 text-center">
                  <ShieldCheck className="mx-auto h-7 w-7 text-emerald-400" />
                  <p className="mt-2 text-sm font-bold text-slate-500">Inga client-fel rapporterade ännu.</p>
                </div>
              )}
              {clientEvents.slice(0, 8).map((event) => (
                <details key={event.id} className="rounded-3xl border border-black/10 bg-[#f7f4ef] p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${
                        event.severity === "critical" || event.severity === "error"
                          ? "bg-rose-100 text-rose-800"
                          : event.severity === "warning"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}>
                        {event.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-950">{event.message}</p>
                        <p className="mt-1 truncate font-mono text-[11px] text-slate-400">
                          {new Date(event.created_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })} · {event.route || event.event_type}
                        </p>
                      </div>
                    </div>
                  </summary>
                  <pre className="mt-3 max-h-56 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-relaxed text-white">
                    {formatDetails({
                      event_type: event.event_type,
                      fingerprint: event.fingerprint,
                      metadata: event.metadata || {},
                    })}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[2rem] border border-black/10 bg-slate-950 p-4 text-white shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">Incident</p>
                <h2 className="text-2xl font-black">Logga signal</h2>
              </div>
              <Siren className="h-6 w-6 text-rose-300" />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {(["P0", "P1", "P2", "P3"] as Severity[]).map((severity) => (
                <button
                  key={severity}
                  onClick={() => setNewSeverity(severity)}
                  className={`rounded-2xl px-3 py-3 text-sm font-black ${newSeverity === severity ? severityTone[severity] : "bg-white/10 text-white/50"}`}
                >
                  {severity}
                </button>
              ))}
            </div>
            <textarea
              value={newIncident}
              onChange={(event) => setNewIncident(event.target.value)}
              placeholder="Ex: Stripe betalning gick igenom men booking saknas..."
              className="mt-3 min-h-28 w-full rounded-3xl border border-white/10 bg-white/10 p-4 text-sm text-white outline-none placeholder:text-white/40"
            />
            <button
              onClick={addIncident}
              disabled={addIncidentMutation.isPending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-4 text-sm font-black text-slate-950"
            >
              {addIncidentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Skapa incident
            </button>
            <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">Incidentmall</p>
              <p className="mt-2 text-xs leading-relaxed text-white/70">
                Spara alltid venue, route/function, user/customer, booking/payment/session ids, containment, fix, verification och owner.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Log</p>
                <h2 className="text-2xl font-black">Incidentlogg</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-black">
                {incidents.filter((incident) => incident.status !== "resolved").length} öppna
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {incidents.length === 0 && (
                <div className="rounded-3xl border border-dashed border-black/10 p-8 text-center">
                  <Sparkles className="mx-auto h-8 w-8 text-emerald-400" />
                  <p className="mt-2 text-sm font-bold text-slate-500">Inga incidenter loggade för denna venue.</p>
                </div>
              )}
              {incidents.map((incident) => (
                <div key={incident.id} className="rounded-3xl border border-black/10 bg-[#f7f4ef] p-4">
                  <div className="flex items-start gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${severityTone[incident.severity]}`}>{incident.severity}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-950">{incident.title}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        {new Date(incident.created_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })} · {incident.status}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteIncidentMutation.mutate(incident.id)}
                      className="rounded-full p-2 text-slate-400 hover:bg-white"
                      aria-label="Ta bort incident"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["open", "contained", "resolved"] as Incident["status"][]).map((status) => (
                      <button
                        key={status}
                        onClick={() => updateIncidentStatus(incident.id, status)}
                        className={`rounded-full px-3 py-1.5 text-xs font-black ${
                          incident.status === status ? "bg-slate-950 text-white" : "bg-white text-slate-500"
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/hub/admin" className="rounded-[1.5rem] border border-black/10 bg-white p-4 font-black shadow-sm">
            Admin hub <ArrowUpRight className="ml-1 inline h-4 w-4" />
          </Link>
          <Link to="/desk" className="rounded-[1.5rem] border border-black/10 bg-white p-4 font-black shadow-sm">
            Desk <ArrowUpRight className="ml-1 inline h-4 w-4" />
          </Link>
          <Link to="/display/venue?v=pickla-arena-sthlm" className="rounded-[1.5rem] border border-black/10 bg-white p-4 font-black shadow-sm">
            Venue display <ArrowUpRight className="ml-1 inline h-4 w-4" />
          </Link>
          <a href="https://github.com/guggeuber/pickla-flow-1b995a61/blob/main/docs/observability-and-ops-agent.md" className="rounded-[1.5rem] border border-black/10 bg-white p-4 font-black shadow-sm">
            Runbook <ArrowUpRight className="ml-1 inline h-4 w-4" />
          </a>
        </section>

        <section className="rounded-[2rem] border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black">V1-gräns</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
                Den här sidan sparar signaler, checks och incidenter i DB via `api-ops`, så staff delar samma driftläge.
                Nästa steg är automatiska signaler från Stripe, Supabase och paddor samt bättre audit log.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default OpsCenterPage;
