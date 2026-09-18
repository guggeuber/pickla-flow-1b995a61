import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import { apiGet } from "@/lib/api";

type CommunicationSummary = {
  topic: string;
  topic_label: string;
  active_subscribers: number;
  pending_confirmations: number;
  new_subscribers_30d: number;
  unsubscribes_30d: number;
  suppressed: number;
  bounces: number;
  complaints: number;
  sync_failures: number;
  confirmation_delivery_failures: number;
  provider_setup: {
    domain_verified: boolean;
    sending_enabled: boolean;
    tracking_off: boolean;
    topic_name_valid: boolean;
    topic_default_opt_out: boolean;
    topic_public: boolean;
    ready: boolean;
  };
  production_gates: {
    send_mode: string;
    canary_allowlist_configured: boolean;
    rate_limit_secret_ring_configured: boolean;
    confirmation_secret_ring_configured: boolean;
    unsubscribe_secret_ring_configured: boolean;
    webhook_secret_configured: boolean;
    waf_verified: boolean;
  };
  broadcast_send_available: false;
  provider: "resend";
};

const cards = [
  { key: "active_subscribers", label: "Bekräftade", icon: Users, tone: "text-emerald-400" },
  { key: "pending_confirmations", label: "Väntar på bekräftelse", icon: Clock3, tone: "text-blue-400" },
  { key: "new_subscribers_30d", label: "Nya · 30 dagar", icon: Mail, tone: "text-cyan-400" },
  { key: "unsubscribes_30d", label: "Avslutade · 30 dagar", icon: UserMinus, tone: "text-amber-400" },
  { key: "suppressed", label: "Leveransspärrade", icon: AlertTriangle, tone: "text-rose-400" },
  { key: "confirmation_delivery_failures", label: "Bekräftelsemail fel", icon: XCircle, tone: "text-rose-400" },
  { key: "bounces", label: "Hårda studsar", icon: AlertTriangle, tone: "text-amber-400" },
  { key: "complaints", label: "Spamklagomål", icon: ShieldCheck, tone: "text-red-400" },
] as const;

function Gate({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{children}</span>
      {ok
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Godkänd" />
        : <XCircle className="h-4 w-4 shrink-0 text-rose-400" aria-label="Inte klar" />}
    </li>
  );
}

export default function AdminCommunications() {
  const summary = useQuery({
    queryKey: ["admin-communication-summary"],
    queryFn: () => apiGet<CommunicationSummary>("api-communications", "admin-summary"),
    staleTime: 30_000,
    retry: false,
  });

  if (summary.isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-label="Hämtar Pickla Mail" />;
  }
  if (summary.isError || !summary.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-bold">Pickla Mail kunde inte hämtas</p>
        <button
          type="button"
          onClick={() => void summary.refetch()}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Försök igen
        </button>
      </div>
    );
  }

  const data = summary.data;
  const provider = data.provider_setup;
  const gates = data.production_gates;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5"><Mail className="h-5 w-5 text-primary" aria-hidden="true" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Pickla Mail · Double opt-in</p>
            <h2 className="mt-1 text-xl font-bold">{data.topic_label}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Endast bekräftade Pickla-samtycken är aktiva. Resend är en kontrollerad leveransprojektion.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <section key={card.key} className="rounded-2xl border border-border bg-card p-4">
            <card.icon className={`h-4 w-4 ${card.tone}`} aria-hidden="true" />
            <p className="mt-3 text-2xl font-black tabular-nums">{data[card.key]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.label}</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <p className="text-sm font-bold">Resend och release gates</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${provider.ready ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
            {provider.ready ? "Provider klar" : "Blockerad"}
          </span>
        </div>
        <ul className="mt-3 divide-y divide-border/60">
          <Gate ok={provider.domain_verified && provider.sending_enabled}>playpickla.com verifierad för sändning</Gate>
          <Gate ok={provider.tracking_off}>Open/click tracking avstängt</Gate>
          <Gate ok={provider.topic_name_valid && provider.topic_default_opt_out && provider.topic_public}>Topic är publikt och default opt_out</Gate>
          <Gate ok={gates.send_mode === "canary" && gates.canary_allowlist_configured}>Releaseverifiering är låst till godkänd canary-lista</Gate>
          <Gate ok={gates.confirmation_secret_ring_configured && gates.unsubscribe_secret_ring_configured}>Token-secret rings konfigurerade</Gate>
          <Gate ok={gates.rate_limit_secret_ring_configured}>Server-rate limiting konfigurerad</Gate>
          <Gate ok={gates.webhook_secret_configured}>Webhook-signatur konfigurerad</Gate>
          <Gate ok={gates.waf_verified}>WAF/rate-limit verifierad</Gate>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Operativ ägare: <strong className="text-foreground">Pickla Admin</strong>. Sändläge: <strong className="text-foreground">{gates.send_mode}</strong>. Resend-synkfel: <strong className="text-foreground">{data.sync_failures}</strong>.
        </p>
      </section>

      <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-5">
        <p className="text-sm font-bold">Broadcast är låst i Pickla V1</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Inget massutskick kan startas här. Framtida målgrupp måste beräknas på nytt från bekräftad canonical eligibility och godkännas av en människa.
        </p>
      </section>
    </div>
  );
}
