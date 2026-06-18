import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Radio, Sparkles, Activity } from "lucide-react";
import { useTodayBookings, useVenueCourts } from "@/hooks/useDesk";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";

type Status = "free" | "active" | "soon";

interface Props {
  venueId: string | undefined;
}

function statusTone(s: Status) {
  if (s === "active") return { fg: ax("danger"), bg: ax("danger", 0.18), bd: ax("danger", 0.4), label: "Spelas" };
  if (s === "soon") return { fg: ax("sun"), bg: ax("sun", 0.18), bd: ax("sun", 0.4), label: "Snart slut" };
  return { fg: ax("lime"), bg: ax("lime", 0.16), bd: ax("lime", 0.38), label: "Ledig" };
}

function fmtCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DeskLive({ venueId }: Props) {
  const { data: courts } = useVenueCourts(venueId);
  const { data: bookings } = useTodayBookings(venueId);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const courtCells = useMemo(() => {
    if (!Array.isArray(courts)) return [] as any[];
    const nowMs = tick;
    return (courts as any[]).map((court) => {
      const courtBookings = (bookings || []).filter(
        (b: any) =>
          b.kind !== "activity_registration" &&
          b.venue_court_id === court.id &&
          (b.status === "confirmed" || b.status === "completed")
      );
      const active = courtBookings.find((b: any) => {
        const s = +new Date(b.start_time);
        const e = +new Date(b.end_time);
        return s <= nowMs && e > nowMs;
      });
      const next = courtBookings
        .filter((b: any) => +new Date(b.start_time) > nowMs)
        .sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time))[0];

      if (active) {
        const endMs = +new Date(active.end_time);
        const remaining = endMs - nowMs;
        const isSoon = remaining < 10 * 60 * 1000;
        return {
          id: court.id,
          name: court.name,
          sport: court.sport_type,
          status: (isSoon ? "soon" : "active") as Status,
          player: active.booked_by || "Gäst",
          countdown: fmtCountdown(remaining),
        };
      }
      return {
        id: court.id,
        name: court.name,
        sport: court.sport_type,
        status: "free" as Status,
        next: next
          ? new Date(next.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
          : null,
      };
    });
  }, [courts, bookings, tick]);

  const live = courtCells.filter((c) => c.status !== "free");
  const liveActivities = useMemo(() => {
    const nowMs = tick;
    return (bookings || [])
      .filter((b: any) => b.kind === "activity_registration")
      .filter((b: any) => +new Date(b.start_time) <= nowMs && +new Date(b.end_time) > nowMs);
  }, [bookings, tick]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Live venue</p>
          <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
            Hela hallen
          </h2>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {live.length}/{courtCells.length} banor i spel · {liveActivities.length} aktivitet live
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: ax("lime") }} />
          <span className={`${AX_TYPE.micro}`} style={{ color: ax("lime") }}>Realtime</span>
        </div>
      </div>

      <AxSectionLabel icon={Radio} accent={ax("electric")}>Banor</AxSectionLabel>
      {courtCells.length === 0 ? (
        <AxEmpty icon={Radio} title="Inga banor" hint="Banor visas här när de är konfigurerade." />
      ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {courtCells.map((c) => {
            const tone = statusTone(c.status);
            return (
              <motion.div key={c.id} whileTap={{ scale: 0.98 }}>
                <AxCard glow={c.status !== "free" ? tone.bd : undefined} pad="card">
                  <div className="flex items-center justify-between">
                    <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>{c.name}</p>
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-[0.18em]"
                      style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}` }}
                    >
                      {tone.label}
                    </span>
                  </div>
                  {c.status !== "free" ? (
                    <>
                      <p
                        className="mt-2 font-mono text-2xl font-black tabular-nums"
                        style={{ color: tone.fg }}
                      >
                        {c.countdown}
                      </p>
                      <p className="text-xs font-semibold truncate" style={{ color: "white" }}>
                        {c.player}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 font-mono text-2xl font-black tabular-nums" style={{ color: ax("lime") }}>
                        —
                      </p>
                      <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
                        {c.next ? `Nästa · ${c.next}` : "Inget bokat"}
                      </p>
                    </>
                  )}
                </AxCard>
              </motion.div>
            );
          })}
        </div>
      )}

      <AxSectionLabel icon={Sparkles} accent={ax("magenta")}>Aktiviteter live nu</AxSectionLabel>
      {liveActivities.length === 0 ? (
        <AxEmpty
          icon={Activity}
          title="Inga aktiviteter just nu"
          hint="Open Play, kurser och pass visas live när de pågår."
          tint={ax("magenta")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {liveActivities.map((b: any) => (
            <AxCard key={b.id}>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${ax("magenta", 0.3)}, hsl(0 0% 0% / 0.3))`,
                    border: `1px solid ${ax("magenta", 0.4)}`,
                  }}
                >
                  <Activity className="w-5 h-5" style={{ color: ax("magenta") }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "white" }}>
                    {b.activity_session?.name || b.notes || "Aktivitet"}
                  </p>
                  <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
                    {new Date(b.start_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {new Date(b.end_time).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <AxChip tone="magenta">Live</AxChip>
              </div>
            </AxCard>
          ))}
        </div>
      )}
    </div>
  );
}
