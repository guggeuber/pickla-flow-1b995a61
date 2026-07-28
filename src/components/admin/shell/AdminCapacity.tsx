import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  Layers3,
  Loader2,
  MapPin,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  useAdminCapacity,
  type AdminCapacityInterval,
  type AdminCapacityOpeningInterval,
  type AdminCapacityResource,
} from "@/hooks/useAdmin";
import { OperationsBookingDrawer, type OperationsBookingDetail } from "@/components/operations/OperationsBookingDrawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AX_GRID_BG, ax } from "./axTheme";
import { AX_TYPE, AxCard, AxChip, AxEmpty, AxSectionLabel, AxSkeleton } from "./axPrimitives";

const ZONE = "Europe/Stockholm";
const CAPACITY_WINDOW_DAYS = 366;

type CapacityView = "day" | "week";

const CLASSIFICATION = {
  booking: { label: "Bokning", color: ax("electric") },
  activity: { label: "Aktivitet", color: ax("lime") },
  resource_block: { label: "Blockering", color: ax("sun") },
  closure: { label: "Stängt", color: ax("danger") },
  event: { label: "Event", color: ax("magenta") },
  free: { label: "Ledigt", color: ax("surface") },
} as const;

function stockholmCapacityRange(anchorDate: string, view: CapacityView) {
  const anchor = DateTime.fromISO(anchorDate, { zone: ZONE }).startOf("day");
  const safe = anchor.isValid ? anchor : DateTime.now().setZone(ZONE).startOf("day");
  return {
    from: safe.toISODate()!,
    to: view === "week" ? safe.plus({ days: 6 }).toISODate()! : safe.toISODate()!,
  };
}

function capacityAnchorBounds(today: string, view: CapacityView) {
  const current = DateTime.fromISO(today, { zone: ZONE }).startOf("day");
  return {
    min: current.minus({ days: CAPACITY_WINDOW_DAYS }).toISODate()!,
    max: current.plus({ days: CAPACITY_WINDOW_DAYS - (view === "week" ? 6 : 0) }).toISODate()!,
  };
}

function clampCapacityAnchor(value: string, today: string, view: CapacityView) {
  const bounds = capacityAnchorBounds(today, view);
  const candidate = DateTime.fromISO(value, { zone: ZONE }).startOf("day");
  if (!candidate.isValid || value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return candidate.toISODate()!;
}

function formatHours(minutes: number) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
}

function formatTime(iso: string) {
  const value = DateTime.fromISO(iso, { zone: "utc" }).setZone(ZONE);
  return value.isValid ? value.toFormat("HH:mm") : "--:--";
}

function intervalMillis(interval: { starts_at: string; ends_at: string }) {
  return {
    start: DateTime.fromISO(interval.starts_at, { zone: "utc" }).toMillis(),
    end: DateTime.fromISO(interval.ends_at, { zone: "utc" }).toMillis(),
  };
}

function assignLanes(intervals: AdminCapacityInterval[]) {
  const laneEnds: number[] = [];
  return [...intervals]
    .sort((a, b) => intervalMillis(a).start - intervalMillis(b).start || intervalMillis(a).end - intervalMillis(b).end)
    .map((interval) => {
      const { start, end } = intervalMillis(interval);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { interval, lane, laneCount: laneEnds.length };
    });
}

function dayBounds(openings: AdminCapacityOpeningInterval[]) {
  const starts = openings.map((opening) => intervalMillis(opening).start).filter(Number.isFinite);
  const ends = openings.map((opening) => intervalMillis(opening).end).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

function positionPercent(value: number, bounds: { start: number; end: number }) {
  if (bounds.end <= bounds.start) return 0;
  return Math.max(0, Math.min(100, ((value - bounds.start) / (bounds.end - bounds.start)) * 100));
}

function TimelineDay({
  date,
  resources,
  openings,
  intervals,
  onOpen,
}: {
  date: string;
  resources: AdminCapacityResource[];
  openings: AdminCapacityOpeningInterval[];
  intervals: AdminCapacityInterval[];
  onOpen: (interval: AdminCapacityInterval) => void;
}) {
  const dayOpenings = openings.filter((opening) => opening.venue_date === date && resources.some((resource) => resource.id === opening.resource_id));
  const bounds = dayBounds(dayOpenings);
  const dateLabel = DateTime.fromISO(date, { zone: ZONE });

  return (
    <section className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${ax("borderSoft")}`, background: ax("surface") }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: ax("borderSoft") }}>
        <div>
          <p className="font-display text-base font-black capitalize text-white">{dateLabel.toFormat("cccc d LLL")}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {bounds ? `${formatTime(DateTime.fromMillis(bounds.start, { zone: "utc" }).toISO()!)}–${formatTime(DateTime.fromMillis(bounds.end, { zone: "utc" }).toISO()!)}` : "Inga öppettider"}
          </p>
        </div>
        <AxChip tone={intervals.some((interval) => interval.conflict.is_conflict) ? "danger" : "lime"}>
          {intervals.filter((interval) => interval.classification !== "free").length} intervall
        </AxChip>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {resources.map((resource) => {
            const opening = dayOpenings.find((row) => row.resource_id === resource.id);
            const occupied = intervals.filter((row) => row.resource_id === resource.id && row.venue_date === date && row.classification !== "free");
            const lanes = assignLanes(occupied);
            const laneCount = Math.max(1, lanes.reduce((max, row) => Math.max(max, row.lane + 1), 1));
            const rowHeight = Math.max(48, laneCount * 26 + 12);

            return (
              <div key={resource.id} className="flex border-b last:border-b-0" style={{ borderColor: ax("borderSoft") }}>
                <div className="flex w-36 shrink-0 items-center gap-2 px-3 py-2" style={{ background: ax("surfaceHi") }}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: ax("electricSoft") }} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{resource.name}</p>
                    <p className="truncate text-[10px] uppercase tracking-wider" style={{ color: ax("muted") }}>{resource.sport_type || "Resurs"}</p>
                  </div>
                </div>
                <div className="relative flex-1" style={{ height: rowHeight, background: opening ? ax("surfaceHi") : ax("ink") }}>
                  {opening && bounds ? (
                    <>
                      <div className="absolute inset-y-0 left-1/4 w-px" style={{ background: ax("borderSoft") }} />
                      <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: ax("borderSoft") }} />
                      <div className="absolute inset-y-0 left-3/4 w-px" style={{ background: ax("borderSoft") }} />
                      {lanes.map(({ interval, lane }) => {
                        const times = intervalMillis(interval);
                        const start = Math.max(times.start, intervalMillis(opening).start);
                        const end = Math.min(times.end, intervalMillis(opening).end);
                        if (end <= start) return null;
                        const left = positionPercent(start, bounds);
                        const right = positionPercent(end, bounds);
                        const style = CLASSIFICATION[interval.classification];
                        return (
                          <motion.button
                            key={interval.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onOpen(interval)}
                            className="absolute overflow-hidden rounded-md px-2 text-left text-[10px] font-bold text-white"
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(1.2, right - left)}%`,
                              top: 6 + lane * 26,
                              height: 22,
                              background: interval.conflict.is_conflict ? ax("danger", 0.82) : style.color,
                              border: interval.conflict.is_conflict ? "1px solid white" : `1px solid ${ax("ink", 0.35)}`,
                            }}
                            title={`${style.label}: ${interval.title} ${formatTime(interval.starts_at)}–${formatTime(interval.ends_at)}`}
                          >
                            <span className="block truncate">{interval.title}</span>
                          </motion.button>
                        );
                      })}
                      {occupied.length === 0 && (
                        <p className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest" style={{ color: ax("lime") }}>
                          Ledigt
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest" style={{ color: ax("muted") }}>
                      Stängt
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function IntervalDetails({
  interval,
  resource,
  onOpenModule,
}: {
  interval: AdminCapacityInterval | null;
  resource?: AdminCapacityResource;
  onOpenModule: (moduleId: string) => void;
}) {
  if (!interval) return null;
  const style = CLASSIFICATION[interval.classification];
  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${style.color}` }}>
        <div className="flex flex-wrap items-center gap-2">
          <AxChip tone={interval.conflict.is_conflict ? "danger" : interval.classification === "activity" ? "lime" : interval.classification === "event" ? "magenta" : interval.classification === "resource_block" ? "sun" : "electric"}>
            {style.label}
          </AxChip>
          <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: ax("muted") }}>{interval.status}</span>
        </div>
        <p className="mt-3 text-lg font-black text-white">{interval.title}</p>
        <p className="mt-1 text-sm" style={{ color: ax("muted") }}>
          {resource?.name || "Resurs"} · {formatTime(interval.starts_at)}–{formatTime(interval.ends_at)}
        </p>
        <p className="mt-3 break-all font-mono text-[10px]" style={{ color: ax("muted") }}>
          {interval.source_type}:{interval.source_id}
        </p>
      </div>

      {interval.outside_opening_hours && (
        <div className="flex gap-2 rounded-xl p-3" style={{ background: ax("sun", 0.12), color: ax("sun") }}>
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs font-bold">Intervallet ligger helt utanför registrerad öppettid.</p>
        </div>
      )}

      {interval.conflict.is_conflict && (
        <div className="rounded-xl p-3" style={{ background: ax("danger", 0.12), border: `1px solid ${ax("danger", 0.4)}` }}>
          <p className="text-xs font-black" style={{ color: ax("danger") }}>Överlapp med</p>
          <ul className="mt-2 space-y-1 text-xs text-white">
            {interval.conflict.with.map((peer) => <li key={`${peer.source_type}:${peer.source_id}`}>{peer.title}</li>)}
          </ul>
        </div>
      )}

      {interval.detail_target?.kind === "module" && interval.detail_target.module_id && (
        <button
          onClick={() => onOpenModule(interval.detail_target!.module_id!)}
          className="w-full rounded-xl py-3 text-sm font-black"
          style={{ background: ax("electric"), color: ax("ink") }}
        >
          Öppna befintlig detaljvy
        </button>
      )}
    </div>
  );
}

export default function AdminCapacity({ venueId, onOpenModule }: { venueId: string; onOpenModule: (moduleId: string) => void }) {
  const today = DateTime.now().setZone(ZONE).toISODate()!;
  const [view, setView] = useState<CapacityView>("day");
  const [anchorDate, setAnchorDate] = useState(today);
  const [group, setGroup] = useState("all");
  const [resourceId, setResourceId] = useState("all");
  const [openInterval, setOpenInterval] = useState<AdminCapacityInterval | null>(null);
  const [openBooking, setOpenBooking] = useState<OperationsBookingDetail | null>(null);
  const anchorBounds = useMemo(() => capacityAnchorBounds(today, view), [today, view]);
  const range = useMemo(() => stockholmCapacityRange(anchorDate, view), [anchorDate, view]);
  const capacityQ = useAdminCapacity(venueId, range.from, range.to, view);
  const data = capacityQ.data;

  const groups = useMemo(() => Array.from(new Set((data?.resources || []).map((resource) => resource.group))).sort(), [data?.resources]);
  const filteredResources = useMemo(() => (data?.resources || []).filter((resource) =>
    (group === "all" || resource.group === group) && (resourceId === "all" || resource.id === resourceId)
  ), [data?.resources, group, resourceId]);
  const filteredResourceIds = useMemo(() => new Set(filteredResources.map((resource) => resource.id)), [filteredResources]);
  const visibleIntervals = useMemo(() => (data?.intervals || []).filter((interval) => filteredResourceIds.has(interval.resource_id)), [data?.intervals, filteredResourceIds]);
  const occupiedCount = visibleIntervals.filter((interval) => interval.classification !== "free").length;
  const sourceFailures = Object.entries(data?.source_status || {}).filter(([, status]) => status.status === "error");
  const errorStatus = capacityQ.error && typeof capacityQ.error === "object" && "status" in capacityQ.error
    ? Number((capacityQ.error as { status?: unknown }).status)
    : null;

  const move = (direction: number) => {
    const days = view === "week" ? 7 : 1;
    const next = DateTime.fromISO(anchorDate, { zone: ZONE }).plus({ days: direction * days }).toISODate()!;
    setAnchorDate(clampCapacityAnchor(next, today, view));
  };
  const changeView = (nextView: CapacityView) => {
    setView(nextView);
    setAnchorDate((current) => clampCapacityAnchor(current, today, nextView));
  };
  const openDetails = (interval: AdminCapacityInterval) => {
    if (interval.detail_target?.kind === "booking_drawer" && interval.detail_target.booking) {
      setOpenBooking(interval.detail_target.booking as unknown as OperationsBookingDetail);
      return;
    }
    setOpenInterval(interval);
  };

  if (!venueId) return <AxEmpty icon={MapPin} title="Välj venue" hint="Capacity visas för en venue i taget." />;

  return (
    <div className="space-y-4 pb-28">
      <div className="relative overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg, ${ax("electric", 0.14)}, ${ax("magenta", 0.08)})`, border: `1px solid ${ax("borderSoft")}` }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={AX_GRID_BG} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4" style={{ color: ax("electricSoft") }} />
              <p className={AX_TYPE.micro} style={{ color: ax("electricSoft") }}>Capacity · Read only</p>
            </div>
            <h1 className="mt-2 font-display text-3xl font-black text-white">Husets kapacitet</h1>
            <p className="mt-1 text-sm" style={{ color: ax("muted") }}>Öppet, upptaget, ledigt och överlapp att granska — utan operativa ändringar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl p-1" style={{ background: ax("surfaceHi") }}>
              {(["day", "week"] as CapacityView[]).map((option) => (
                <button key={option} onClick={() => changeView(option)} className="rounded-lg px-3 py-2 text-xs font-black" style={{ background: view === option ? ax("electric") : "transparent", color: view === option ? ax("ink") : "white" }}>
                  {option === "day" ? "Dag" : "Vecka"}
                </button>
              ))}
            </div>
            <button disabled={anchorDate <= anchorBounds.min} onClick={() => move(-1)} aria-label="Föregående period" className="rounded-xl p-2.5 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: ax("surfaceHi"), color: "white" }}><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setAnchorDate(today)} className="rounded-xl px-3 py-2.5 text-xs font-black" style={{ background: anchorDate === today ? ax("electric") : ax("surfaceHi"), color: anchorDate === today ? ax("ink") : "white" }}>Idag</button>
            <button disabled={anchorDate >= anchorBounds.max} onClick={() => move(1)} aria-label="Nästa period" className="rounded-xl p-2.5 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: ax("surfaceHi"), color: "white" }}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}>
          <CalendarDays className="h-4 w-4" style={{ color: ax("muted") }} />
          <input aria-label="Startdatum" type="date" min={anchorBounds.min} max={anchorBounds.max} value={anchorDate} onChange={(event) => event.target.value && setAnchorDate(clampCapacityAnchor(event.target.value, today, view))} className="bg-transparent text-xs font-bold text-white outline-none" />
        </label>
        <button onClick={() => setAnchorDate(today)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: ax("surfaceHi"), color: ax("muted") }}><RefreshCcw className="h-3.5 w-3.5" /> Återställ period</button>
        <span className="text-xs font-mono" style={{ color: ax("muted") }}>{range.from}{range.to !== range.from ? ` → ${range.to}` : ""}</span>
      </div>

      {capacityQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <AxCard key={index}><AxSkeleton height={54} /></AxCard>)}</div>
      ) : capacityQ.isError ? (
        <AxEmpty
          icon={ShieldAlert}
          title={errorStatus === 401 ? "Sessionen behöver förnyas" : errorStatus === 403 ? "Behörighet saknas" : "Capacity kunde inte laddas"}
          hint={errorStatus === 401
            ? "Ladda om sidan och logga in igen."
            : errorStatus === 403
              ? "Du har inte administratörsbehörighet för vald venue."
              : capacityQ.error instanceof Error ? capacityQ.error.message : "Försök igen."}
          tint={ax("danger")}
        />
      ) : data ? (
        <>
          {data.partial && (
            <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: ax("sun", 0.1), border: `1px solid ${ax("sun", 0.35)}` }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ax("sun") }} />
              <div><p className="text-sm font-black text-white">Delvis data</p><p className="text-xs" style={{ color: ax("muted") }}>{sourceFailures.map(([source]) => source).join(", ")} kunde inte läsas. Beslut bör vänta tills vyn är komplett.</p></div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              ["Öppet", formatHours(data.summary.open_resource_minutes), Clock3, "electric"],
              ["Upptaget", formatHours(data.summary.occupied_resource_minutes), Layers3, "magenta"],
              ["Ledigt", formatHours(data.summary.available_resource_minutes), CalendarDays, "lime"],
              ["Nyttjande", `${data.summary.utilization_percentage.toLocaleString("sv-SE")}%`, Gauge, "sun"],
              ["Att granska", String(data.summary.conflict_count), AlertTriangle, data.summary.conflict_count ? "danger" : "lime"],
            ].map(([label, value, Icon, tone]) => (
              <AxCard key={String(label)} glow={ax(tone as "electric" | "magenta" | "lime" | "sun" | "danger", 0.35)}>
                <Icon className="h-4 w-4" style={{ color: ax(tone as "electric" | "magenta" | "lime" | "sun" | "danger") }} />
                <p className="mt-3 font-display text-2xl font-black text-white">{value}</p>
                <p className={AX_TYPE.microSoft} style={{ color: ax("muted") }}>{label} · alla banor</p>
              </AxCard>
            ))}
          </div>

          <p className="text-xs" style={{ color: ax("muted") }}>
            Ledigt är ett planeringsmått, inte ett löfte om en kundbokningsbar tid.
          </p>

          <div className="space-y-3">
            <AxSectionLabel icon={Layers3} accent={ax("electricSoft")}>Resursfilter</AxSectionLabel>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setGroup("all"); setResourceId("all"); }} className="rounded-lg px-3 py-2 text-xs font-bold" style={{ background: group === "all" && resourceId === "all" ? ax("electric") : ax("surfaceHi"), color: group === "all" && resourceId === "all" ? ax("ink") : "white" }}>Alla</button>
              {groups.map((value) => <button key={value} onClick={() => { setGroup(value); setResourceId("all"); }} className="rounded-lg px-3 py-2 text-xs font-bold capitalize" style={{ background: group === value && resourceId === "all" ? ax("electric") : ax("surfaceHi"), color: group === value && resourceId === "all" ? ax("ink") : "white" }}>{value}</button>)}
              {data.resources.filter((resource) => group === "all" || resource.group === group).map((resource) => <button key={resource.id} onClick={() => setResourceId(resource.id)} className="rounded-lg px-3 py-2 text-xs font-bold" style={{ background: resourceId === resource.id ? ax("magenta") : ax("surfaceHi"), color: "white" }}>{resource.name}</button>)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl px-3 py-2" style={{ background: ax("surfaceHi") }}>
              {Object.values(CLASSIFICATION).map((item) => (
                <span key={item.label} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: ax("muted") }}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color, border: `1px solid ${ax("border")}` }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {data.resources.length === 0 ? (
            <AxEmpty icon={MapPin} title="Inga aktiva resurser" hint="Capacity visar endast aktiva banor från venue-konfigurationen." />
          ) : data.opening_intervals.length === 0 ? (
            <AxEmpty icon={Clock3} title="Inga öppettider" hint="Perioden saknar aktiva öppettider. Stängd tid räknas aldrig som kapacitet." />
          ) : (
            <div className="space-y-3">
              <AxSectionLabel icon={Gauge} accent={ax("electricSoft")} trailing={capacityQ.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ax("muted") }} /> : null}>
                {occupiedCount ? `${occupiedCount} operativa intervall` : "All kapacitet ledig"}
              </AxSectionLabel>
              {data.dates.map((date) => <TimelineDay key={date} date={date} resources={filteredResources} openings={data.opening_intervals} intervals={visibleIntervals} onOpen={openDetails} />)}
            </div>
          )}

          {data.summary.conflict_count > 0 && (
            <div className="space-y-3">
              <AxSectionLabel icon={AlertTriangle} accent={ax("danger")}>Överlapp att granska</AxSectionLabel>
              <div className="grid gap-2 lg:grid-cols-2">
                {visibleIntervals.filter((interval) => interval.conflict.is_conflict).map((interval) => (
                  <AxCard key={`conflict-${interval.id}`} onClick={() => openDetails(interval)} glow={ax("danger", 0.4)}>
                    <p className="text-sm font-black text-white">{interval.title}</p>
                    <p className="mt-1 text-xs" style={{ color: ax("muted") }}>{data.resources.find((resource) => resource.id === interval.resource_id)?.name} · {formatTime(interval.starts_at)}–{formatTime(interval.ends_at)}</p>
                  </AxCard>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      <OperationsBookingDrawer readOnly open={!!openBooking} booking={openBooking} onClose={() => setOpenBooking(null)} />
      <Dialog open={!!openInterval} onOpenChange={(open) => !open && setOpenInterval(null)}>
        <DialogContent className="border-white/10 bg-[hsl(220_25%_8%)] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kapacitetsdetalj</DialogTitle>
            <DialogDescription className="sr-only">Skrivskyddad detalj för valt kapacitetsintervall.</DialogDescription>
          </DialogHeader>
          <IntervalDetails interval={openInterval} resource={data?.resources.find((resource) => resource.id === openInterval?.resource_id)} onOpenModule={(moduleId) => { setOpenInterval(null); onOpenModule(moduleId); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
