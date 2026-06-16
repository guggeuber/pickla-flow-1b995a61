import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronRight,
  Clock,
  Inbox,
  LucideIcon,
  MessageSquare,
  Sparkles,
  Ticket,
  TrendingDown,
  TrendingUp,
  Minus,
  Plus,
  Radio,
  ShieldAlert,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { useAdminStats, useAdminHistory } from "@/hooks/useAdmin";

interface Props {
  venueId: string | undefined;
  venueName?: string;
  onOpenSettings: (sectionId: string) => void;
}

function Sparkline({ data, color = "hsl(var(--primary))" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80,
    h = 22,
    pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const [lx, ly] = points[points.length - 1].split(",");
  return (
    <svg width={w} height={h} className="block mt-1" viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2" fill={color} />
    </svg>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  const diff = previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  if (diff === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
        <Minus className="w-2.5 h-2.5" /> igår
      </span>
    );
  const up = diff > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold ${up ? "text-court-free" : "text-destructive"}`}>
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {up ? "+" : ""}
      {diff}% igår
    </span>
  );
}

function MetricBlock({
  value,
  label,
  icon: Icon,
  cur,
  prev,
  spark,
  color,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  cur?: number;
  prev?: number;
  spark?: number[];
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-display font-black text-foreground leading-none">{value}</p>
      {spark && <Sparkline data={spark} color={color} />}
      <TrendBadge current={cur ?? 0} previous={prev ?? 0} />
    </div>
  );
}

function SectionLabel({ icon: Icon, children, accent }: { icon: LucideIcon; children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Icon className="w-3 h-3" style={{ color: accent ?? "hsl(var(--muted-foreground))" }} />
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>
    </div>
  );
}

function Card({ children, onClick, tone = "default" }: { children: React.ReactNode; onClick?: () => void; tone?: "default" | "warning" | "danger" }) {
  const borderColor =
    tone === "warning"
      ? "hsl(var(--badge-unpaid) / 0.4)"
      : tone === "danger"
      ? "hsl(var(--destructive) / 0.4)"
      : "hsl(var(--border))";
  const Comp = onClick ? motion.button : ("div" as any);
  return (
    <Comp
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className="w-full rounded-2xl p-3.5 border text-left"
      style={{ background: "hsl(var(--surface-1))", borderColor }}
    >
      {children}
    </Comp>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl p-3 border min-w-[80px]"
      style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.12)" }}>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <span className="text-[10px] font-bold text-foreground text-center leading-tight">{label}</span>
    </motion.button>
  );
}

export default function AdminToday({ venueId, venueName, onOpenSettings }: Props) {
  const { data: stats } = useAdminStats(venueId);
  const { data: history } = useAdminHistory(venueId);

  const revenueSpark = (history || []).map((d: any) => d.revenue);
  const bookingsSpark = (history || []).map((d: any) => d.bookings);
  const passesSpark = (history || []).map((d: any) => d.passes);

  // Mocked attention items — Codex hook into useAdminAttention()
  const attention: { id: string; tone: "warning" | "danger" | "default"; icon: LucideIcon; title: string; meta: string; target: string }[] = [
    { id: "lead-1", tone: "warning", icon: MessageSquare, title: "3 event leads väntar svar", meta: "Äldsta · 2 dagar gammal", target: "eventLeads" },
    { id: "drift-1", tone: "default", icon: ShieldAlert, title: "Drift­avvikelse aktiv idag", meta: "Stängt 10:00–14:00", target: "operations" },
  ];

  // Mocked today's plan — Codex: merge activity_sessions + events + blocks
  const todaysPlan = [
    { time: "10:00", title: "Drift: Stängt för städ", kind: "drift", tone: "warning" as const },
    { time: "14:00", title: "Open Play · Eftermiddag", kind: "session", tone: "default" as const },
    { time: "17:00", title: "Pickleball nybörjarkurs", kind: "session", tone: "default" as const },
    { time: "18:30", title: "Kickoff Spotify (TENT)", kind: "event", tone: "warning" as const },
  ];

  return (
    <div className="space-y-5">
      {/* Greeting strip */}
      <div className="flex items-baseline justify-between px-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Today · Mission Control</p>
          <h1 className="text-xl font-display font-black tracking-tight">{venueName || "Pickla"}</h1>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold text-court-free">
          <span className="w-1.5 h-1.5 rounded-full bg-court-free animate-pulse" />
          LIVE
        </div>
      </div>

      {/* Hero metrics */}
      <div className="rounded-3xl p-5 border" style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}>
        <div className="grid grid-cols-3 gap-4">
          <MetricBlock
            value={(stats?.todayRevenue || 0).toLocaleString("sv-SE")}
            label="SEK idag"
            icon={TrendingUp}
            cur={stats?.todayRevenue}
            prev={stats?.yesterdayRevenue}
            spark={revenueSpark}
            color="hsl(var(--primary))"
          />
          <MetricBlock
            value={String(stats?.bookingsToday || 0)}
            label="Bokningar"
            icon={CalendarCheck}
            cur={stats?.bookingsToday}
            prev={stats?.yesterdayBookings}
            spark={bookingsSpark}
            color="hsl(var(--court-free))"
          />
          <MetricBlock
            value={String(stats?.activePasses || 0)}
            label="Dagspass"
            icon={Ticket}
            cur={stats?.activePasses}
            prev={stats?.yesterdayPasses}
            spark={passesSpark}
            color="hsl(var(--sell))"
          />
        </div>
      </div>

      {/* Attention inbox */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel icon={Inbox} accent="hsl(var(--badge-unpaid))">
            Behöver din uppmärksamhet
          </SectionLabel>
          <span className="text-[10px] font-bold text-muted-foreground px-1">{attention.length}</span>
        </div>
        {attention.length === 0 ? (
          <Card>
            <div className="flex items-center gap-2 py-1">
              <Sparkles className="w-4 h-4 text-court-free" />
              <p className="text-sm text-muted-foreground">Inget kräver din tid just nu.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {attention.map((a) => (
              <Card key={a.id} tone={a.tone} onClick={() => onOpenSettings(a.target)}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background:
                        a.tone === "danger"
                          ? "hsl(var(--destructive) / 0.12)"
                          : a.tone === "warning"
                          ? "hsl(var(--badge-unpaid) / 0.15)"
                          : "hsl(var(--primary) / 0.12)",
                    }}
                  >
                    <a.icon
                      className="w-4 h-4"
                      style={{
                        color:
                          a.tone === "danger"
                            ? "hsl(var(--destructive))"
                            : a.tone === "warning"
                            ? "hsl(var(--badge-unpaid))"
                            : "hsl(var(--primary))",
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{a.meta}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Today's plan */}
      <section className="space-y-2">
        <SectionLabel icon={Clock}>Dagens plan</SectionLabel>
        <div className="rounded-2xl border overflow-hidden" style={{ background: "hsl(var(--surface-1))", borderColor: "hsl(var(--border))" }}>
          {todaysPlan.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3.5 py-3 border-t first:border-t-0"
              style={{ borderColor: "hsl(var(--border) / 0.6)" }}
            >
              <div className="w-12 shrink-0">
                <p className="text-xs font-mono font-bold text-foreground">{item.time}</p>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      item.tone === "warning" ? "hsl(var(--badge-unpaid))" : item.kind === "event" ? "hsl(var(--sell))" : "hsl(var(--court-free))",
                  }}
                />
                <p className="text-sm text-foreground truncate">{item.title}</p>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{item.kind}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/70 px-1">
          Concept · slås ihop från Schema, Events och Drift när Calendar-surfacen byggs.
        </p>
      </section>

      {/* Quick actions */}
      <section className="space-y-2">
        <SectionLabel icon={Zap}>Snabbåtgärder</SectionLabel>
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
          <QuickAction icon={Plus} label="Nytt event" onClick={() => onOpenSettings("events")} />
          <QuickAction icon={ShieldAlert} label="Driftavvikelse" onClick={() => onOpenSettings("operations")} />
          <QuickAction icon={CalendarCheck} label="Schema" onClick={() => onOpenSettings("schedule")} />
          <QuickAction icon={Trophy} label="Event lead" onClick={() => onOpenSettings("eventLeads")} />
          <QuickAction icon={Users} label="Personal" onClick={() => onOpenSettings("staff")} />
          <QuickAction icon={Radio} label="Stories" onClick={() => onOpenSettings("stories")} />
        </div>
      </section>

      {/* Live ops strip */}
      <section className="space-y-2">
        <SectionLabel icon={AlertTriangle}>Drift just nu</SectionLabel>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--court-free) / 0.12)" }}>
              <Radio className="w-4 h-4 text-court-free" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">Allt rullar normalt</p>
              <p className="text-[11px] text-muted-foreground">Concept · live occupancy + drift status här i Phase 2.</p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
