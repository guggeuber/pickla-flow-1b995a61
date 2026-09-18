import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Mail, RefreshCw, ShieldCheck, UserMinus, Users } from "lucide-react";
import { apiGet } from "@/lib/api";

type CommunicationSummary = {
  topic: string;
  topic_label: string;
  active_subscribers: number;
  new_subscribers_30d: number;
  unsubscribes_30d: number;
  suppressed: number;
  sync_failures: number;
  broadcast_send_available: false;
  provider: "resend";
};

const cards = [
  { key: "active_subscribers", label: "Aktiva", icon: Users, tone: "text-emerald-400" },
  { key: "new_subscribers_30d", label: "Nya · 30 dagar", icon: Mail, tone: "text-blue-400" },
  { key: "unsubscribes_30d", label: "Avslutade · 30 dagar", icon: UserMinus, tone: "text-amber-400" },
  { key: "suppressed", label: "Leveransspärrade", icon: AlertTriangle, tone: "text-rose-400" },
] as const;

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
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5"><Mail className="h-5 w-5 text-primary" aria-hidden="true" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Pickla Mail · V1</p>
            <h2 className="mt-1 text-xl font-bold">{data.topic_label}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Pickla-databasen bestämmer alltid vem som får marknadsföringsmail. Resend är endast synkad leveransmotor.
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
            <p className="text-sm font-bold">Resend-synk</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${data.sync_failures ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>
            {data.sync_failures ? `${data.sync_failures} fel` : "Frisk"}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Synkfel gör aldrig en avslutad eller spärrad adress behörig igen.
        </p>
      </section>

      <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-5">
        <p className="text-sm font-bold">Broadcast är låst i Pickla V1</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Inget massutskick kan startas här. Framtida utkast måste förhandsvisas, få en ny serverberäknad målgrupp och godkännas av en människa före sändning.
        </p>
      </section>
    </div>
  );
}
