import { motion } from "framer-motion";
import {
  CalendarCheck,
  ChevronRight,
  Clock,
  Inbox,
  LucideIcon,
  MessageSquare,
  Plus,
  Radio,
  ShieldAlert,
  Sparkles,
  Ticket,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAdminStats, useAdminHistory } from "@/hooks/useAdmin";
import { AX, ax, AX_GRID_BG } from "./axTheme";

interface Props {
  venueId: string | undefined;
  venueName?: string;
  onOpenSettings: (sectionId: string) => void;
}

/* ─────────── tiny atoms ─────────── */

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 84, h = 26, pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const [lx, ly] = points[points.length - 1].split(",");
  return (
    <svg width={w} height={h} className="block mt-1.5" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={`g-${color.replace(/\W/g, "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`${pad},${h - pad} ${points.join(" ")} ${w - pad},${h - pad}`}
        fill={`url(#g-${color.replace(/\W/g, "")})`}
      />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
      <circle cx={lx} cy={ly} r="5" fill={color} opacity="0.25" />
    </svg>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="text-[9px] text-muted-foreground">—</span>;
  const diff = previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  if (diff === 0) return <span className="text-[9px] font-mono text-muted-foreground">±0%</span>;
  const up = diff > 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-mono font-bold"
      style={{ color: up ? ax("lime") : ax("danger") }}
    >
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {up ? "+" : ""}{diff}%
    </span>
  );
}

function MetricBlock({
  value, label, icon: Icon, cur, prev, spark, color,
}: {
  value: string; label: string; icon: LucideIcon;
  cur?: number; prev?: number; spark?: number[]; color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <p className="text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: ax("muted") }}>{label}</p>
      </div>
      <p className="text-3xl font-display font-black leading-none" style={{ color: "white" }}>{value}</p>
      {spark && <Sparkline data={spark} color={color} />}
      <TrendBadge current={cur ?? 0} previous={prev ?? 0} />
    </div>
  );
}

function SectionLabel({ icon: Icon, children, accent }: { icon: LucideIcon; children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Icon className="w-3 h-3" style={{ color: accent ?? ax("muted") }} />
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.22em]" style={{ color: ax("muted") }}>{children}</p>
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${ax("border")}, transparent)` }} />
    </div>
  );
}

function Card({
  children, onClick, glow,
}: { children: React.ReactNode; onClick?: () => void; glow?: string }) {
  const Comp = onClick ? motion.button : ("div" as any);
  return (
    <Comp
      whileTap={onClick ? { scale: 0.98 } : undefined}
      onClick={onClick}
      className="relative w-full rounded-2xl p-3.5 text-left overflow-hidden"
      style={{
        background: ax("surfaceHi"),
        border: `1px solid ${glow ?? ax("borderSoft")}`,
        boxShadow: glow ? `0 8px 24px -16px ${glow}` : "none",
      }}
    >
      {children}
    </Comp>
  );
}

function QuickAction({ icon: Icon, label, onClick, tint }: { icon: LucideIcon; label: string; onClick: () => void; tint: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl p-3 min-w-[88px] transition-shadow"
      style={{
        background: ax("surfaceHi"),
        border: `1px solid ${ax("borderSoft")}`,
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${tint}, hsl(0 0% 0% / 0.2))`,
          boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15), 0 4px 14px -6px ${tint}`,
        }}
      >
        <Icon className="w-4 h-4" style={{ color: "white" }} />
      </div>
      <span className="text-[10px] font-bold text-center leading-tight" style={{ color: "white" }}>{label}</span>
    </motion.button>
  );
}

/* ─────────── main ─────────── */

export default function AdminToday({ venueId, venueName, onOpenSettings }: Props) {
  const { data: statsData } = useAdminStats(venueId);
  const { data: historyData } = useAdminHistory(venueId);
  const stats = (statsData as any) || {};
  const history = (historyData as any[]) || [];

  const revenueSpark = history.map((d: any) => d.revenue);
  const bookingsSpark = history.map((d: any) => d.bookings);
  const passesSpark = history.map((d: any) => d.passes);

  // Live clock — mission control vibe
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hhmmss = now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateLong = now.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" });

  // Attention inbox + flightplan will be wired to real data in Phase 2.
  // Until then we render proper empty states — no fake numbers, no fake events.
  const attention: { id: string; tone: "warn" | "info"; icon: LucideIcon; title: string; meta: string; target: string }[] = [];
  const todaysPlan: { time: string; title: string; kind: string; color: string }[] = [];

  // playful rotating one-liner
  const vibes = ["Allt rullar 💯", "Smörig drift 🧈", "Sjukt fint flow ✨", "Inga konflikter, bara hugs 🤝", "Pickla på maxvarv 🚀"];
  const vibe = vibes[now.getSeconds() % vibes.length];

  return (
    <div className="space-y-5">
      {/* ── Mission control header ── */}
      <div
        className="relative rounded-3xl p-5 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${ax("ink")} 0%, ${ax("surface")} 60%, ${ax("electric", 0.18)} 100%)`,
          border: `1px solid ${ax("border")}`,
        }}
      >
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={AX_GRID_BG} />
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
          style={{ background: `radial-gradient(circle, ${ax("magenta", 0.6)}, transparent 70%)` }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-mono font-bold uppercase tracking-[0.2em]"
                style={{
                  background: ax("lime", 0.15),
                  color: ax("lime"),
                  border: `1px solid ${ax("lime", 0.4)}`,
                }}
              >
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: ax("lime") }} />
                LIVE
              </span>
              <span className="text-[9px] font-mono uppercase tracking-[0.22em]" style={{ color: ax("muted") }}>
                {dateLong}
              </span>
            </div>
            <h1 className="text-2xl font-display font-black tracking-tight" style={{ color: "white" }}>
              {venueName || "Pickla"} <span style={{ color: ax("electricSoft") }}>/ Today</span>
            </h1>
            <p className="text-[11px] mt-1" style={{ color: ax("muted") }}>{vibe}</p>
          </div>
          <div className="text-right shrink-0">
            <p
              className="font-mono text-2xl font-black tabular-nums leading-none"
              style={{
                color: "white",
                textShadow: `0 0 18px ${ax("electric", 0.6)}`,
              }}
            >
              {hhmmss}
            </p>
            <p className="text-[9px] font-mono uppercase tracking-[0.22em] mt-1" style={{ color: ax("muted") }}>
              T+ uptime
            </p>
          </div>
        </div>
      </div>

      {/* ── Hero metrics ── */}
      <div
        className="relative rounded-3xl p-5 overflow-hidden"
        style={{
          background: ax("surface"),
          border: `1px solid ${ax("border")}`,
        }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${ax("electric")}, ${ax("magenta")}, transparent)` }}
        />
        <div className="grid grid-cols-3 gap-4">
          <MetricBlock
            value={(stats?.todayRevenue || 0).toLocaleString("sv-SE")}
            label="SEK idag" icon={TrendingUp}
            cur={stats?.todayRevenue} prev={stats?.yesterdayRevenue} spark={revenueSpark}
            color={`hsl(${AX.electric})`}
          />
          <MetricBlock
            value={String(stats?.bookingsToday || 0)}
            label="Bokningar" icon={CalendarCheck}
            cur={stats?.bookingsToday} prev={stats?.yesterdayBookings} spark={bookingsSpark}
            color={`hsl(${AX.lime})`}
          />
          <MetricBlock
            value={String(stats?.activePasses || 0)}
            label="Dagspass" icon={Ticket}
            cur={stats?.activePasses} prev={stats?.yesterdayPasses} spark={passesSpark}
            color={`hsl(${AX.magenta})`}
          />
        </div>
      </div>

      {/* ── Attention inbox ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel icon={Inbox} accent={ax("sun")}>Behöver dig</SectionLabel>
          <span
            className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: ax("sun", 0.15), color: ax("sun"), border: `1px solid ${ax("sun", 0.3)}` }}
          >
            {attention.length} ITEM{attention.length === 1 ? "" : "S"}
          </span>
        </div>
        {attention.length === 0 ? (
          <Card>
            <div className="flex items-center gap-2 py-1">
              <Sparkles className="w-4 h-4" style={{ color: ax("lime") }} />
              <p className="text-sm" style={{ color: ax("muted") }}>Inbox zero. Du är en legend. 🏆</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {attention.map((a) => {
              const c = a.tone === "warn" ? ax("sun") : ax("electric");
              return (
                <Card key={a.id} onClick={() => onOpenSettings(a.target)} glow={c}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${c}, hsl(0 0% 0% / 0.3))`,
                        boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
                      }}
                    >
                      <a.icon className="w-4 h-4" style={{ color: "white" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "white" }}>{a.title}</p>
                      <p className="text-[11px] truncate" style={{ color: ax("muted") }}>{a.meta}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0" style={{ color: ax("muted") }} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Today's plan timeline ── */}
      <section className="space-y-2">
        <SectionLabel icon={Clock} accent={ax("electric")}>Dagens flightplan</SectionLabel>
        {todaysPlan.length === 0 ? (
          <Card>
            <div className="flex items-center gap-3 py-1">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${ax("electric", 0.6)}, hsl(0 0% 0% / 0.3))`,
                  boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
                }}
              >
                <Clock className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: "white" }}>Flightplan tom</p>
                <p className="text-[11px]" style={{ color: ax("muted") }}>
                  Slås ihop från Schema, Events och Drift när Calendar-surfacen byggs.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}
          >
            {todaysPlan.map((item, i) => (
              <div
                key={i}
                className="relative flex items-center gap-3 px-3.5 py-3"
                style={{
                  borderTop: i === 0 ? "none" : `1px solid ${ax("borderSoft")}`,
                }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{ background: item.color, opacity: 0.85 }}
                />
                <div className="w-12 shrink-0 pl-1">
                  <p className="text-xs font-mono font-bold tabular-nums" style={{ color: "white" }}>{item.time}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "white" }}>{item.title}</p>
                </div>
                <span
                  className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
                  style={{ background: `${item.color.replace(")", " / 0.15)")}`, color: item.color, border: `1px solid ${item.color.replace(")", " / 0.3)")}` }}
                >
                  {item.kind}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>


      {/* ── Quick actions ── */}
      <section className="space-y-2">
        <SectionLabel icon={Zap} accent={ax("magenta")}>Snabbåtgärder</SectionLabel>
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
          <QuickAction icon={Plus}         label="Nytt event"     tint={ax("magenta", 0.7)} onClick={() => onOpenSettings("events")} />
          <QuickAction icon={ShieldAlert}  label="Driftavvikelse" tint={ax("sun", 0.7)}     onClick={() => onOpenSettings("operations")} />
          <QuickAction icon={CalendarCheck}label="Schema"         tint={ax("electric", 0.7)}onClick={() => onOpenSettings("schedule")} />
          <QuickAction icon={Trophy}       label="Event lead"     tint={ax("lime", 0.7)}    onClick={() => onOpenSettings("eventLeads")} />
          <QuickAction icon={Users}        label="Personal"       tint={ax("electric", 0.7)}onClick={() => onOpenSettings("staff")} />
          <QuickAction icon={Radio}        label="Stories"        tint={ax("magenta", 0.7)} onClick={() => onOpenSettings("stories")} />
        </div>
      </section>

      {/* ── Status strip ── */}
      <section className="space-y-2">
        <SectionLabel icon={Radio} accent={ax("lime")}>System status</SectionLabel>
        <Card glow={ax("lime", 0.5)}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${ax("lime", 0.8)}, hsl(0 0% 0% / 0.3))`,
                boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
              }}
            >
              <Radio className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: "white" }}>Alla system nominella</p>
              <p className="text-[11px]" style={{ color: ax("muted") }}>Live occupancy + drift status flyttar hit i Phase 2.</p>
            </div>
            <span className="text-[10px] font-mono font-bold" style={{ color: ax("lime") }}>100%</span>
          </div>
        </Card>
      </section>

      {/* Easter egg footer */}
      <p className="text-center text-[9px] font-mono tracking-[0.2em]" style={{ color: ax("muted") }}>
        ⌁ PICKLA ADMIN OS · v0.1 · BUILT FOR SPEED ⌁
      </p>
    </div>
  );
}
