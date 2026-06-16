import { motion } from "framer-motion";
import {
  Ban,
  Bot,
  CalendarCheck,
  ChevronRight,
  Clock,
  Inbox,
  LucideIcon,
  Plus,
  Radio,
  ShieldAlert,
  Sparkles,
  Ticket,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Camera,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAdminAgentInbox, useAdminAttention, useAdminHistory, useAdminStats, useAdminTodaysPlan } from "@/hooks/useAdmin";
import { AX, ax, AX_GRID_BG } from "./axTheme";
import {
  AxCard,
  AxChip,
  AxEmpty,
  AxMetricSkeleton,
  AxSectionLabel,
  AX_RADIUS,
  AX_TYPE,
} from "./axPrimitives";

interface Props {
  venueId: string | undefined;
  venueName?: string;
  onOpenSettings: (sectionId: string) => void;
}

const stockholmDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function stockholmIsoDate(date: Date) {
  return stockholmDateFormatter.format(date);
}

function attentionIcon(kind: string): LucideIcon {
  if (kind === "lead") return Trophy;
  if (kind === "drift") return ShieldAlert;
  if (kind === "event") return CalendarCheck;
  if (kind === "block") return Ban;
  return Inbox;
}

function toneColor(tone: string | undefined) {
  if (tone === "lime") return ax("lime");
  if (tone === "magenta") return ax("magenta");
  if (tone === "sun") return ax("sun");
  if (tone === "danger") return ax("danger");
  return ax("electric");
}

function riskColor(risk: string | undefined) {
  if (risk === "high") return ax("danger");
  if (risk === "medium") return ax("sun");
  return ax("lime");
}

function nextActionLabel(action: string | undefined) {
  const labels: Record<string, string> = {
    approve_offer: "Godkänn offert",
    create_offer: "Skapa offert",
    review_activity_capacity: "Granska kapacitet",
    resolve_conflicts: "Lös konflikt",
    set_schedule: "Sätt datum/tid",
    review: "Granska",
  };
  return labels[String(action || "review")] || String(action || "Granska").replace(/_/g, " ");
}

/* ───────────── Atoms ───────────── */

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
  const gid = `g-${color.replace(/\W/g, "")}`;
  return (
    <svg width={w} height={h} className="block mt-1.5" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`${pad},${h - pad} ${points.join(" ")} ${w - pad},${h - pad}`}
        fill={`url(#${gid})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
      <circle cx={lx} cy={ly} r="5" fill={color} opacity="0.25" />
    </svg>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0)
    return <span className="text-[9px] font-mono" style={{ color: ax("muted") }}>—</span>;
  const diff =
    previous === 0
      ? current > 0 ? 100 : 0
      : Math.round(((current - previous) / previous) * 100);
  if (diff === 0)
    return <span className="text-[9px] font-mono" style={{ color: ax("muted") }}>±0%</span>;
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
        <p className="text-[9px] font-mono font-bold uppercase tracking-[0.18em]" style={{ color: ax("muted") }}>
          {label}
        </p>
      </div>
      <p className={`text-3xl ${AX_TYPE.display} leading-none`} style={{ color: "white" }}>
        {value}
      </p>
      {spark && <Sparkline data={spark} color={color} />}
      <TrendBadge current={cur ?? 0} previous={prev ?? 0} />
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tint: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 ${AX_RADIUS.card} p-3 min-w-[88px]`}
      style={{
        background: ax("surfaceHi"),
        border: `1px solid ${ax("borderSoft")}`,
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${tint}, hsl(0 0% 0% / 0.25))`,
          boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15), 0 4px 14px -6px ${tint}`,
        }}
      >
        <Icon className="w-4 h-4 text-white" />
      </div>
      <span className="text-[10px] font-bold text-center leading-tight" style={{ color: "white" }}>
        {label}
      </span>
    </motion.button>
  );
}

/* ───────────── Main ───────────── */

export default function AdminToday({ venueId, venueName, onOpenSettings }: Props) {
  const statsQ = useAdminStats(venueId);
  const histQ = useAdminHistory(venueId);
  const [now, setNow] = useState(new Date());
  const todayIso = stockholmIsoDate(now);
  const attentionQ = useAdminAttention(venueId);
  const agentInboxQ = useAdminAgentInbox(venueId);
  const planQ = useAdminTodaysPlan(venueId, todayIso);
  const stats = (statsQ.data as any) || {};
  const history = (histQ.data as any[]) || [];
  const statsLoading = statsQ.isLoading;

  const revenueSpark = history.map((d: any) => d.revenue);
  const bookingsSpark = history.map((d: any) => d.bookings);
  const passesSpark = history.map((d: any) => d.passes);

  // Live clock — mission control vibe
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hhmmss = now.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateLong = now.toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  const attention = (attentionQ.data || []).map((item) => ({
    ...item,
    icon: attentionIcon(item.kind),
    target: item.moduleTarget || "events",
  }));
  const todaysPlan = (planQ.data || []).map((item) => ({
    ...item,
    color: toneColor(item.tone),
  }));
  const agentInbox = agentInboxQ.data || [];

  return (
    <div className="space-y-5">
      {/* ── Mission control header ── */}
      <header
        className={`relative ${AX_RADIUS.hero} p-5 overflow-hidden`}
        style={{
          background: `linear-gradient(135deg, ${ax("ink")} 0%, ${ax("surface")} 60%, ${ax(
            "electric",
            0.18
          )} 100%)`,
          border: `1px solid ${ax("border")}`,
        }}
      >
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={AX_GRID_BG} />
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${ax("magenta", 0.6)}, transparent 70%)`,
          }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <AxChip tone="lime">
                <span
                  className="w-1 h-1 rounded-full animate-pulse"
                  style={{ background: ax("lime") }}
                />
                LIVE
              </AxChip>
              <span
                className="text-[9px] font-mono uppercase tracking-[0.22em]"
                style={{ color: ax("muted") }}
              >
                {dateLong}
              </span>
            </div>
            <h1 className={`text-2xl ${AX_TYPE.display}`} style={{ color: "white" }}>
              {venueName || "Pickla"}{" "}
              <span style={{ color: ax("electricSoft") }}>/ Today</span>
            </h1>
            <p className="text-[11px] mt-1" style={{ color: ax("muted") }}>
              Read-only driftläge från live data
            </p>
          </div>
          <div className="text-right shrink-0">
            <p
              className="font-mono text-2xl font-black tabular-nums leading-none"
              style={{ color: "white", textShadow: `0 0 18px ${ax("electric", 0.6)}` }}
            >
              {hhmmss}
            </p>
            <p
              className="text-[9px] font-mono uppercase tracking-[0.22em] mt-1"
              style={{ color: ax("muted") }}
            >
              T+ uptime
            </p>
          </div>
        </div>
      </header>

      {/* ── Hero metrics ── */}
      <div
        className={`relative ${AX_RADIUS.hero} p-5 overflow-hidden`}
        style={{ background: ax("surface"), border: `1px solid ${ax("border")}` }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${ax("electric")}, ${ax(
              "magenta"
            )}, transparent)`,
          }}
        />
        <div className="grid grid-cols-3 gap-4">
          {statsLoading ? (
            <>
              <AxMetricSkeleton />
              <AxMetricSkeleton />
              <AxMetricSkeleton />
            </>
          ) : (
            <>
              <MetricBlock
                value={(stats?.todayRevenue || 0).toLocaleString("sv-SE")}
                label="SEK idag"
                icon={TrendingUp}
                cur={stats?.todayRevenue}
                prev={stats?.yesterdayRevenue}
                spark={revenueSpark}
                color={`hsl(${AX.electric})`}
              />
              <MetricBlock
                value={String(stats?.bookingsToday || 0)}
                label="Bokningar"
                icon={CalendarCheck}
                cur={stats?.bookingsToday}
                prev={stats?.yesterdayBookings}
                spark={bookingsSpark}
                color={`hsl(${AX.lime})`}
              />
              <MetricBlock
                value={String(stats?.activePasses || 0)}
                label="Dagspass"
                icon={Ticket}
                cur={stats?.activePasses}
                prev={stats?.yesterdayPasses}
                spark={passesSpark}
                color={`hsl(${AX.magenta})`}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Attention inbox ── */}
      <section className="space-y-2">
        <AxSectionLabel
          icon={Inbox}
          accent={ax("sun")}
          trailing={
            attention.length > 0 ? (
              <AxChip tone="sun">
                {attention.length} ITEM{attention.length === 1 ? "" : "S"}
              </AxChip>
            ) : (
              <AxChip tone="lime">INBOX 0</AxChip>
            )
          }
        >
          Behöver dig
        </AxSectionLabel>
        {attentionQ.isLoading ? (
          <AxEmpty
            icon={Inbox}
            tint={ax("sun", 0.7)}
            title="Laddar attention"
            hint="Hämtar leads, driftavvikelser, eventluckor och resursblockeringar."
          />
        ) : attention.length === 0 ? (
          <AxEmpty
            icon={Sparkles}
            tint={ax("lime", 0.7)}
            title="Inget behöver din uppmärksamhet"
            hint="Inga sena leads, aktiva driftavvikelser, eventluckor eller resursblockeringar hittades just nu."
          />
        ) : (
          <div className="space-y-2">
            {attention.map((a) => {
              const c = a.tone === "warn" ? ax("sun") : ax("electric");
              return (
                <AxCard key={a.id} onClick={() => onOpenSettings(a.target)} glow={c}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${c}, hsl(0 0% 0% / 0.3))`,
                        boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
                      }}
                    >
                      <a.icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`${AX_TYPE.bodyBold} truncate`} style={{ color: "white" }}>
                        {a.title}
                      </p>
                      <p
                        className={`${AX_TYPE.meta} truncate`}
                        style={{ color: ax("muted") }}
                      >
                        {a.meta}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 shrink-0" style={{ color: ax("muted") }} />
                  </div>
                </AxCard>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Agent inbox ── */}
      <section className="space-y-2">
        <AxSectionLabel
          icon={Bot}
          accent={ax("magenta")}
          trailing={
            agentInbox.length > 0 ? (
              <AxChip tone="magenta">{agentInbox.length} FÖRSLAG</AxChip>
            ) : (
              <AxChip tone="lime">AGENT 0</AxChip>
            )
          }
        >
          Agent Inbox
        </AxSectionLabel>
        {agentInboxQ.isLoading ? (
          <AxEmpty
            icon={Bot}
            tint={ax("magenta", 0.7)}
            title="Laddar agentförslag"
            hint="Hämtar senaste rekommendationer från event leads."
          />
        ) : agentInbox.length === 0 ? (
          <AxEmpty
            icon={Bot}
            tint={ax("lime", 0.7)}
            title="Inga agentförslag väntar"
            hint="Nya eller om-analyserade event leads dyker upp här tills någon godkänner eller avvisar rekommendationen."
          />
        ) : (
          <div className="space-y-2">
            {agentInbox.map((item) => {
              const c = riskColor(item.risk);
              return (
                <AxCard key={item.id} onClick={() => onOpenSettings(item.moduleTarget || "eventLeads")} glow={c}>
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${c}, hsl(0 0% 0% / 0.3))`,
                        boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
                      }}
                    >
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`${AX_TYPE.bodyBold} truncate`} style={{ color: "white" }}>
                          {item.lead_name}
                        </p>
                        <span className="text-[9px] font-mono uppercase" style={{ color: c }}>
                          {item.risk}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] line-clamp-2" style={{ color: ax("muted") }}>
                        {item.summary}
                      </p>
                      <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: ax("muted") }}>
                        {[item.event_date, item.event_time, nextActionLabel(item.next_action)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <ChevronRight className="mt-2 w-4 h-4 shrink-0" style={{ color: ax("muted") }} />
                  </div>
                </AxCard>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Today's plan timeline ── */}
      <section className="space-y-2">
        <AxSectionLabel icon={Clock} accent={ax("electric")}>
          Dagens flightplan
        </AxSectionLabel>
        {planQ.isLoading ? (
          <AxEmpty
            icon={Clock}
            tint={ax("electric", 0.7)}
            title="Laddar dagens plan"
            hint="Hämtar schema, events, blockeringar och drift för idag."
          />
        ) : todaysPlan.length === 0 ? (
          <AxEmpty
            icon={Clock}
            tint={ax("electric", 0.7)}
            title="Dagens plan är tom"
            hint="Inga aktiviteter, events, resursblockeringar eller driftavvikelser hittades för idag."
          />
        ) : (
          <div
            className={`${AX_RADIUS.card} overflow-hidden`}
            style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}
          >
            {todaysPlan.map((item, i) => (
              <motion.button
                key={item.id}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => item.moduleTarget && onOpenSettings(item.moduleTarget)}
                className="relative flex w-full items-center gap-3 px-3.5 py-3 text-left"
                style={{
                  borderTop: i === 0 ? "none" : `1px solid ${ax("borderSoft")}`,
                }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{ background: item.color, opacity: 0.85 }}
                />
                <div className="w-12 shrink-0 pl-1">
                  <p
                    className="text-xs font-mono font-bold tabular-nums"
                    style={{ color: "white" }}
                  >
                    {item.time}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "white" }}>
                    {item.title}
                  </p>
                </div>
                <span
                  className="text-[9px] font-mono font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
                  style={{
                    background: item.color.replace(")", " / 0.15)"),
                    color: item.color,
                    border: `1px solid ${item.color.replace(")", " / 0.3)")}`,
                  }}
                >
                  {item.kind}
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      {/* ── Quick actions ── */}
      <section className="space-y-2">
        <AxSectionLabel icon={Zap} accent={ax("magenta")}>
          Snabbåtgärder
        </AxSectionLabel>
        <div
          className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <QuickAction icon={Plus}          label="Nytt event"     tint={ax("magenta", 0.7)}  onClick={() => onOpenSettings("events")} />
          <QuickAction icon={ShieldAlert}   label="Driftavvikelse" tint={ax("sun", 0.7)}      onClick={() => onOpenSettings("operations")} />
          <QuickAction icon={CalendarCheck} label="Schema"         tint={ax("electric", 0.7)} onClick={() => onOpenSettings("schedule")} />
          <QuickAction icon={Trophy}        label="Event lead"     tint={ax("lime", 0.7)}     onClick={() => onOpenSettings("eventLeads")} />
          <QuickAction icon={Users}         label="Personal"       tint={ax("electric", 0.7)} onClick={() => onOpenSettings("staff")} />
          <QuickAction icon={Camera}        label="Stories"        tint={ax("magenta", 0.7)}  onClick={() => onOpenSettings("stories")} />
        </div>
      </section>

      {/* ── System status ── */}
      <section className="space-y-2">
        <AxSectionLabel icon={Radio} accent={ax("lime")}>
          System status
        </AxSectionLabel>
        <AxEmpty
          icon={Radio}
          tint={ax("lime", 0.7)}
          title="Live status"
          hint="Occupancy och drift-signaler flyttar hit när Capacity-surfacen byggs."
        />
      </section>

      {/* Footer */}
      <p
        className="text-center text-[9px] font-mono tracking-[0.2em] pt-1"
        style={{ color: ax("muted") }}
      >
        ⌁ PICKLA ADMIN OS · v0.1 · BUILT FOR SPEED ⌁
      </p>
    </div>
  );
}
