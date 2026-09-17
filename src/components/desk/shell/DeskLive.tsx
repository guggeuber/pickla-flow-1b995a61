import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Radio, Sparkles, Activity } from "lucide-react";
import { DateTime } from "luxon";
import { useLiveResources, useTodayBookings, useVenueCourts } from "@/hooks/useDesk";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";
import {
  currentReservationConflict,
  DESK_TIMEZONE,
  projectLiveActivityOccurrences,
  resourceBreakdownLabel,
  resourceTypeLabel,
  type DeskLiveRow,
  type LiveReservationConflict,
} from "@/lib/deskTruth";

type ReservationState = "free" | "booking" | "activity" | "blocked" | "closed" | "unknown";

type LiveResourceResponse = {
  as_of: string;
  interval_semantics: "[start,end)";
  resources: Array<{
    id: string;
    name: string;
    court_number?: number | null;
    sport_type?: string | null;
    is_available?: boolean | null;
  }>;
  conflicts: LiveReservationConflict[];
};

interface Props {
  venueId: string | undefined;
}

function statusTone(state: ReservationState) {
  if (state === "activity") return { fg: ax("magenta"), bg: ax("magenta", 0.18), bd: ax("magenta", 0.4), label: "Aktivitet nu" };
  if (state === "booking") return { fg: ax("electricSoft"), bg: ax("electric", 0.18), bd: ax("electric", 0.4), label: "Bokad nu" };
  if (state === "blocked") return { fg: ax("sun"), bg: ax("sun", 0.18), bd: ax("sun", 0.4), label: "Blockerad" };
  if (state === "closed") return { fg: ax("danger"), bg: ax("danger", 0.18), bd: ax("danger", 0.4), label: "Stängd" };
  if (state === "unknown") return { fg: ax("muted"), bg: ax("surfaceHi"), bd: ax("borderSoft"), label: "Okänt" };
  return { fg: ax("lime"), bg: ax("lime", 0.16), bd: ax("lime", 0.38), label: "Ledig" };
}

function reservationState(conflict: LiveReservationConflict | null, truthAvailable: boolean): ReservationState {
  if (!truthAvailable) return "unknown";
  if (!conflict) return "free";
  if (conflict.type === "venue_closed") return "closed";
  if (conflict.type === "court_unavailable" || conflict.type === "resource_block") return "blocked";
  if (conflict.type === "activity_occurrence") return "activity";
  return "booking";
}

function fmtCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function timeLabel(value: string) {
  const time = DateTime.fromISO(value, { zone: "utc" }).setZone(DESK_TIMEZONE);
  return time.isValid ? time.toFormat("HH:mm") : "--:--";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDisplayName(value: unknown) {
  const text = String(value || "").trim();
  if (!text || UUID_PATTERN.test(text)) return "";
  return text;
}

function liveBookingTitle(row: DeskLiveRow | null) {
  if (row?.kind === "activity_court_block") {
    return safeDisplayName(row.activity_session?.name) || safeDisplayName(row.booked_by) || "Aktivitet";
  }
  return safeDisplayName(row?.customer_name) || safeDisplayName(row?.customer_contact?.name) || safeDisplayName(row?.booked_by) || safeDisplayName(row?.guest_name) || "Gästbokning";
}

function matchingReservationRow(rows: DeskLiveRow[], conflict: LiveReservationConflict | null) {
  if (!conflict?.source_id) return null;
  if (conflict.type === "activity_occurrence") {
    return rows.find((row) =>
      (row.kind === "activity_court_block" || row.kind === "activity_registration")
      && (row.activity_session_id || row.activity_session?.id) === conflict.source_id
      && (!conflict.occurrence_date || row.session_date === conflict.occurrence_date)
    ) || null;
  }
  if (conflict.type === "booking") return rows.find((row) => row.id === conflict.source_id) || null;
  return null;
}

function nextReservation(rows: DeskLiveRow[], resourceId: string, nowMs: number) {
  const next = rows
    .filter((row) => row.kind !== "activity_registration" && row.status !== "cancelled" && row.venue_court_id === resourceId)
    .filter((row) => +new Date(row.start_time || "") > nowMs)
    .sort((left, right) => +new Date(left.start_time || "") - +new Date(right.start_time || ""))[0];
  if (!next) return null;
  return {
    time: timeLabel(next.start_time || ""),
    label: next.kind === "activity_court_block" ? "Nästa aktivitet" : "Nästa bokning",
  };
}

export default function DeskLive({ venueId }: Props) {
  const { data: fallbackResources } = useVenueCourts(venueId);
  const { data: liveResourceData, isError: liveResourceError } = useLiveResources(venueId);
  const { data: bookings } = useTodayBookings(venueId);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const liveTruth = liveResourceData as LiveResourceResponse | undefined;
  const resources = useMemo(
    () => (liveTruth?.resources || (Array.isArray(fallbackResources) ? fallbackResources : [])) as LiveResourceResponse["resources"],
    [fallbackResources, liveTruth?.resources],
  );
  const rows = useMemo(() => (bookings as DeskLiveRow[] | undefined) || [], [bookings]);
  const liveActivities = useMemo(() => projectLiveActivityOccurrences(rows, tick), [rows, tick]);
  const activityByIdentity = useMemo(
    () => new Map(liveActivities.map((activity) => [activity.key, activity])),
    [liveActivities],
  );
  const truthAvailable = Boolean(liveTruth && !liveResourceError);

  const resourceCells = useMemo(() => resources.map((resource) => {
    const conflict = currentReservationConflict((liveTruth?.conflicts || []).filter((item) => item.resource_id === resource.id));
    const state = reservationState(conflict, truthAvailable);
    const reservationRow = matchingReservationRow(rows, conflict);
    const occurrenceKey = conflict?.type === "activity_occurrence" && conflict.source_id
      ? `${conflict.source_id}:${conflict.occurrence_date || ""}`
      : null;
    const activity = occurrenceKey ? activityByIdentity.get(occurrenceKey) : null;
    const remaining = conflict ? +new Date(conflict.ends_at) - tick : null;
    const title = state === "activity"
      ? activity?.title || liveBookingTitle(reservationRow) || "Aktivitet"
      : state === "booking"
        ? liveBookingTitle(reservationRow)
        : state === "blocked"
          ? "Resursblock"
          : state === "closed"
            ? "Anläggningen är stängd"
            : null;
    const presence = state === "booking"
      ? reservationRow?.checked_in ? "Incheckad" : "Närvaro okänd"
      : state === "activity" && activity?.participant_count
        ? `${activity.checked_in_count}/${activity.participant_count} incheckade`
        : state === "activity"
          ? "Närvaro okänd"
          : null;
    return {
      ...resource,
      state,
      title,
      presence,
      countdown: remaining != null && remaining > 0 && (state === "booking" || state === "activity" || state === "blocked")
        ? fmtCountdown(remaining)
        : null,
      next: nextReservation(rows, resource.id, tick),
    };
  }), [activityByIdentity, liveTruth?.conflicts, resources, rows, tick, truthAvailable]);

  const resourceSummary = resourceBreakdownLabel(resources);

  return (
    <div className="space-y-4">
      <div>
        <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Live venue</p>
        <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
          Hela hallen
        </h2>
        <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
          {resourceSummary || "Inga bokningsresurser"}
          {liveActivities.length > 0 ? ` · ${liveActivities.length} ${liveActivities.length === 1 ? "aktivitet" : "aktiviteter"} nu` : ""}
        </p>
      </div>

      <AxSectionLabel icon={Radio} accent={ax("electric")}>Bokningsresurser</AxSectionLabel>
      {resourceCells.length === 0 ? (
        <AxEmpty icon={Radio} title="Inga bokningsresurser" hint="Resurser visas här när de är konfigurerade." />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {resourceCells.map((resource) => {
            const tone = statusTone(resource.state);
            return (
              <motion.div key={resource.id} whileTap={{ scale: 0.98 }}>
                <AxCard glow={resource.state !== "free" && resource.state !== "unknown" ? tone.bd : undefined} pad="card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`${AX_TYPE.micro} truncate`} style={{ color: "white" }}>{resource.name}</p>
                      <p className="truncate text-[10px] font-bold" style={{ color: ax("muted") }}>{resourceTypeLabel(resource.sport_type)}</p>
                    </div>
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}` }}
                    >
                      {tone.label}
                    </span>
                  </div>
                  {resource.state !== "free" && resource.state !== "unknown" ? (
                    <>
                      <p className="mt-2 font-mono text-xl font-black tabular-nums" style={{ color: tone.fg }}>
                        {resource.countdown || "—"}
                      </p>
                      <p className="truncate text-xs font-semibold" style={{ color: "white" }}>{resource.title}</p>
                      {resource.presence ? <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>{resource.presence}</p> : null}
                    </>
                  ) : (
                    <>
                      <p className="mt-2 font-mono text-xl font-black tabular-nums" style={{ color: tone.fg }}>—</p>
                      <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
                        {resource.state === "unknown"
                          ? "Reservationstillstånd saknas"
                          : resource.next ? `${resource.next.label} · ${resource.next.time}` : "Inget mer bokat idag"}
                      </p>
                    </>
                  )}
                </AxCard>
              </motion.div>
            );
          })}
        </div>
      )}

      <AxSectionLabel icon={Sparkles} accent={ax("magenta")}>Aktiviteter nu</AxSectionLabel>
      {liveActivities.length === 0 ? (
        <AxEmpty
          icon={Activity}
          title="Inga aktiviteter just nu"
          hint="Open Play, kurser och pass visas när de pågår."
          tint={ax("magenta")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {liveActivities.map((activity) => (
            <AxCard key={activity.key}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${ax("magenta", 0.3)}, hsl(0 0% 0% / 0.3))`,
                    border: `1px solid ${ax("magenta", 0.4)}`,
                  }}
                >
                  <Activity className="h-5 w-5" style={{ color: ax("magenta") }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={{ color: "white" }}>{activity.title}</p>
                  <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
                    {timeLabel(activity.start_time)}–{timeLabel(activity.end_time)}
                    {activity.resource_names.length ? ` · ${activity.resource_names.join(", ")}` : ""}
                  </p>
                  <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
                    {activity.participant_count > 0
                      ? `${activity.participant_count} deltagare · ${activity.checked_in_count} incheckade`
                      : "Deltagarantal saknas"}
                  </p>
                </div>
                <AxChip tone="magenta">Aktivitet nu</AxChip>
              </div>
            </AxCard>
          ))}
        </div>
      )}
    </div>
  );
}
