import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Loader2,
  MapPin,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAdminOperationsStaffing,
  useAdminOperationsWeek,
  type AdminCapacityInterval,
  type AdminOperationsOccurrence,
  type AdminOperationsStaffRole,
} from "@/hooks/useAdmin";
import { OperationsBookingDrawer, type OperationsBookingDetail } from "@/components/operations/OperationsBookingDrawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimelineDay } from "./AdminCapacity";
import { AX_GRID_BG, ax } from "./axTheme";
import { AX_TYPE, AxCard, AxChip, AxEmpty, AxSectionLabel, AxSkeleton } from "./axPrimitives";

const ZONE = "Europe/Stockholm";

const ORIGIN_STYLE: Record<string, { label: string; tone: "lime" | "electric" | "magenta" | "sun" | "danger" }> = {
  activity: { label: "Aktivitet", tone: "lime" },
  series: { label: "Serie", tone: "lime" },
  private_booking: { label: "Privat bokning", tone: "electric" },
  contract: { label: "Avtalstid", tone: "electric" },
  event: { label: "Event", tone: "magenta" },
  maintenance: { label: "Underhåll", tone: "sun" },
  operational_block: { label: "Driftblock", tone: "danger" },
};

const ROLE_LABEL: Record<AdminOperationsStaffRole, string> = {
  host: "Värd",
  instructor: "Instruktör",
  service: "Service",
};

function mondayFor(value: string) {
  const parsed = DateTime.fromISO(value, { zone: ZONE });
  return (parsed.isValid ? parsed : DateTime.now().setZone(ZONE)).startOf("week").toISODate()!;
}

function weekRange(monday: string) {
  const start = DateTime.fromISO(monday, { zone: ZONE }).startOf("week");
  return { from: start.toISODate()!, to: start.plus({ days: 6 }).toISODate()! };
}

function formatTime(value: string) {
  const parsed = DateTime.fromISO(value, { zone: "utc" }).setZone(ZONE);
  return parsed.isValid ? parsed.toFormat("HH:mm") : "--:--";
}

function formatFreeMinutes(minutes: number) {
  const hours = minutes / 60;
  return `${hours.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h ledigt`;
}

function OccurrenceCard({
  occurrence,
  onOpen,
  onStaff,
}: {
  occurrence: AdminOperationsOccurrence;
  onOpen: () => void;
  onStaff: () => void;
}) {
  const style = ORIGIN_STYLE[occurrence.origin] || ORIGIN_STYLE.operational_block;
  const hasWarning = occurrence.warnings.length > 0;
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ background: ax("surfaceHi"), border: `1px solid ${hasWarning ? ax("danger", 0.55) : ax("borderSoft")}` }}
    >
      <button type="button" onClick={onOpen} className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <AxChip tone={style.tone}>{style.label}</AxChip>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" style={{ color: ax("muted") }} />
        </div>
        <p className="mt-2 font-mono text-[10px] font-bold" style={{ color: ax("electricSoft") }}>
          {formatTime(occurrence.starts_at)}–{formatTime(occurrence.ends_at)}
        </p>
        <p className="mt-1 line-clamp-2 text-sm font-black leading-tight text-white">{occurrence.title}</p>
        <p className="mt-1 line-clamp-2 text-[10px]" style={{ color: ax("muted") }}>
          {occurrence.resource_names.length ? occurrence.resource_names.join(", ") : "Resurs ej bekräftad"}
        </p>
        {(occurrence.booked_count != null || occurrence.checked_in_count != null) && (
          <p className="mt-2 text-[10px] font-bold" style={{ color: ax("muted") }}>
            {occurrence.booked_count != null ? `${occurrence.booked_count}${occurrence.capacity ? `/${occurrence.capacity}` : ""} bokade` : ""}
            {occurrence.checked_in_count != null ? ` · ${occurrence.checked_in_count} inne` : ""}
          </p>
        )}
      </button>

      <div className="border-t px-3 py-2" style={{ borderColor: ax("borderSoft") }}>
        {occurrence.assignments.filter((assignment) => assignment.valid).length ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {occurrence.assignments.filter((assignment) => assignment.valid).map((assignment) => (
              <span key={assignment.id} className="rounded-full px-2 py-1 text-[9px] font-bold" style={{ background: ax("electric", 0.12), color: ax("electricSoft") }}>
                {assignment.display_name} · {ROLE_LABEL[assignment.role]}
              </span>
            ))}
          </div>
        ) : null}
        {occurrence.warnings.map((warning) => (
          <p key={`${warning.code}:${warning.label}`} className="mb-1 flex items-start gap-1 text-[9px] font-bold last:mb-0" style={{ color: ax("danger") }}>
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {warning.label}
          </p>
        ))}
        <button
          type="button"
          onClick={onStaff}
          className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[10px] font-black"
          style={{ background: ax("surface"), color: "white", border: `1px solid ${ax("borderSoft")}` }}
        >
          <UserPlus className="h-3.5 w-3.5" /> Bemanna
        </button>
      </div>
    </div>
  );
}

function StaffingDialog({
  occurrence,
  staffOptions,
  open,
  onClose,
  venueId,
}: {
  occurrence: AdminOperationsOccurrence | null;
  staffOptions: Array<{ id: string; display_name: string }>;
  open: boolean;
  onClose: () => void;
  venueId: string;
}) {
  const { assign, remove } = useAdminOperationsStaffing(venueId);
  const [staffId, setStaffId] = useState("");
  const [role, setRole] = useState<AdminOperationsStaffRole>("host");
  const pending = assign.isPending || remove.isPending;

  const add = async () => {
    if (!occurrence || !staffId) return;
    try {
      await assign.mutateAsync({
        source_type: occurrence.source_type,
        source_id: occurrence.source_id,
        occurrence_date: occurrence.occurrence_date,
        venue_staff_id: staffId,
        role,
      });
      toast.success("Bemanning sparad");
      setStaffId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bemanningen kunde inte sparas");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="border-white/10 bg-[hsl(220_25%_8%)] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bemanna förekomst</DialogTitle>
          <DialogDescription className="text-white/55">
            {occurrence ? `${occurrence.title} · ${formatTime(occurrence.starts_at)}–${formatTime(occurrence.ends_at)}` : "Välj en förekomst."}
          </DialogDescription>
        </DialogHeader>

        {occurrence ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {occurrence.assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: ax("surfaceHi") }}>
                  <div>
                    <p className="text-sm font-black">{assignment.display_name}</p>
                    <p className="text-[10px]" style={{ color: assignment.valid ? ax("muted") : ax("danger") }}>
                      {ROLE_LABEL[assignment.role]}{assignment.valid ? "" : " · inaktiv"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove.mutateAsync(assignment.id).then(() => toast.success("Bemanning borttagen")).catch((error: Error) => toast.error(error.message))}
                    aria-label={`Ta bort ${assignment.display_name}`}
                    className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-50"
                    style={{ background: ax("danger", 0.12), color: ax("danger") }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {!occurrence.assignments.length && <p className="rounded-xl p-3 text-xs" style={{ background: ax("surfaceHi"), color: ax("muted") }}>Ingen personal tilldelad.</p>}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="min-h-11 rounded-xl px-3 text-sm text-white outline-none" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("border")}` }}>
                <option value="">Välj personal</option>
                {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.display_name}</option>)}
              </select>
              <select value={role} onChange={(event) => setRole(event.target.value as AdminOperationsStaffRole)} className="min-h-11 rounded-xl px-3 text-sm text-white outline-none" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("border")}` }}>
                {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <button type="button" onClick={add} disabled={!staffId || pending} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Lägg till
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminOperationsWeek({
  venueId,
  venueName,
  onOpenModule,
}: {
  venueId: string;
  venueName?: string;
  onOpenModule: (moduleId: string) => void;
}) {
  const today = DateTime.now().setZone(ZONE).toISODate()!;
  const currentMonday = mondayFor(today);
  const [monday, setMonday] = useState(currentMonday);
  const [openBooking, setOpenBooking] = useState<OperationsBookingDetail | null>(null);
  const [staffingOccurrenceId, setStaffingOccurrenceId] = useState<string | null>(null);
  const range = useMemo(() => weekRange(monday), [monday]);
  const weekQ = useAdminOperationsWeek(venueId, range.from, range.to);
  const data = weekQ.data;
  const occurrences = data?.operations.occurrences || [];
  const staffingOccurrence = occurrences.find((occurrence) => occurrence.id === staffingOccurrenceId) || null;

  const openCanonical = (occurrence: AdminOperationsOccurrence) => {
    if (occurrence.detail_target?.kind === "booking_drawer" && occurrence.detail_target.booking) {
      setOpenBooking(occurrence.detail_target.booking as unknown as OperationsBookingDetail);
      return;
    }
    if (occurrence.detail_target?.kind === "module" && occurrence.detail_target.module_id) {
      onOpenModule(occurrence.detail_target.module_id);
    }
  };

  const openCapacity = (interval: AdminCapacityInterval) => {
    if (interval.classification === "free") return;
    if (interval.detail_target?.kind === "booking_drawer" && interval.detail_target.booking) {
      setOpenBooking(interval.detail_target.booking as unknown as OperationsBookingDetail);
      return;
    }
    if (interval.detail_target?.kind === "module" && interval.detail_target.module_id) {
      onOpenModule(interval.detail_target.module_id);
    }
  };

  const moveWeek = (weeks: number) => {
    setMonday(DateTime.fromISO(monday, { zone: ZONE }).plus({ weeks }).startOf("week").toISODate()!);
  };

  return (
    <div className="space-y-4 pb-28">
      <div className="relative overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg, ${ax("electric", 0.13)}, ${ax("magenta", 0.07)})`, border: `1px solid ${ax("borderSoft")}` }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={AX_GRID_BG} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" style={{ color: ax("electricSoft") }} />
              <p className={AX_TYPE.micro} style={{ color: ax("electricSoft") }}>Calendar · Operations Week</p>
            </div>
            <h1 className="mt-2 font-display text-3xl font-black text-white">{venueName || "Vald venue"}</h1>
            <p className="mt-1 text-sm capitalize" style={{ color: ax("muted") }}>
              {DateTime.fromISO(range.from, { zone: ZONE }).setLocale("sv").toFormat("d LLL")}–{DateTime.fromISO(range.to, { zone: ZONE }).setLocale("sv").toFormat("d LLL yyyy")} · måndag–söndag
            </p>
          </div>
          <div className="flex items-center gap-2">
            <motion.button whileTap={{ scale: 0.94 }} type="button" onClick={() => moveWeek(-1)} aria-label="Föregående vecka" className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }}><ChevronLeft className="h-4 w-4" /></motion.button>
            <button type="button" onClick={() => setMonday(currentMonday)} className="min-h-10 rounded-xl px-3 text-xs font-black" style={{ background: monday === currentMonday ? ax("electric") : ax("surfaceHi"), color: monday === currentMonday ? ax("ink") : "white" }}>Denna vecka</button>
            <motion.button whileTap={{ scale: 0.94 }} type="button" onClick={() => moveWeek(1)} aria-label="Nästa vecka" className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ax("surfaceHi"), color: "white" }}><ChevronRight className="h-4 w-4" /></motion.button>
          </div>
        </div>
      </div>

      {weekQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">{Array.from({ length: 7 }).map((_, index) => <AxCard key={index}><AxSkeleton height={78} /></AxCard>)}</div>
      ) : weekQ.isError ? (
        <AxEmpty icon={AlertTriangle} title="Veckan kunde inte laddas" hint={weekQ.error instanceof Error ? weekQ.error.message : "Försök igen."} tint={ax("danger")} />
      ) : data ? (
        <>
          {data.partial && <div className="rounded-2xl p-4 text-sm font-bold" style={{ background: ax("sun", 0.1), border: `1px solid ${ax("sun", 0.35)}`, color: ax("sun") }}>Veckan är ofullständig. Gör inga planeringsbeslut innan alla källor är tillgängliga.</div>}

          <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            <div className="grid min-w-[980px] grid-cols-7 gap-2.5">
              {data.operations.daily.map((day) => {
                const parsed = DateTime.fromISO(day.date, { zone: ZONE });
                const isToday = day.date === today;
                return (
                  <AxCard key={day.date} glow={day.missing_staff_count ? ax("danger", 0.35) : isToday ? ax("electric", 0.3) : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-sm font-black capitalize text-white">{parsed.setLocale("sv").toFormat("ccc d/M")}</p>
                      {isToday && <AxChip tone="electric">Idag</AxChip>}
                    </div>
                    <div className="mt-3 space-y-1 text-[10px] font-bold" style={{ color: ax("muted") }}>
                      <p>{day.occurrence_count} förekomster</p>
                      <p style={{ color: day.missing_staff_count ? ax("danger") : ax("muted") }}>{day.missing_staff_count} saknar personal</p>
                      <p>{day.queue_count} i befintlig kö</p>
                      <p style={{ color: ax("lime") }}>{formatFreeMinutes(day.free_resource_minutes)}</p>
                    </div>
                  </AxCard>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <AxSectionLabel icon={Users} accent={ax("electricSoft")} trailing={weekQ.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}>Veckans operativa förekomster</AxSectionLabel>
            <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
              <div className="grid min-w-[1120px] grid-cols-7 gap-3">
                {data.dates.map((date) => {
                  const rows = occurrences.filter((occurrence) => occurrence.occurrence_date === date);
                  return (
                    <section key={date} className="space-y-2">
                      <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: ax("borderSoft") }}>
                        <p className="text-xs font-black capitalize text-white">{DateTime.fromISO(date, { zone: ZONE }).setLocale("sv").toFormat("cccc")}</p>
                        <span className="font-mono text-[10px]" style={{ color: ax("muted") }}>{rows.length}</span>
                      </div>
                      {rows.map((occurrence) => <OccurrenceCard key={occurrence.id} occurrence={occurrence} onOpen={() => openCanonical(occurrence)} onStaff={() => setStaffingOccurrenceId(occurrence.id)} />)}
                      {!rows.length && <div className="rounded-2xl border border-dashed p-4 text-center text-[10px]" style={{ borderColor: ax("borderSoft"), color: ax("muted") }}>Inget operativt</div>}
                    </section>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <AxSectionLabel icon={MapPin} accent={ax("lime")}>Resurser, upptaget och lediga luckor</AxSectionLabel>
            <p className="text-xs" style={{ color: ax("muted") }}>Gröna fält är ledig fysisk kapacitet inom registrerad öppettid. Det är ett planeringsmått, inte ett kundlöfte.</p>
            {data.dates.map((date) => <TimelineDay key={date} date={date} resources={data.resources} openings={data.opening_intervals} intervals={data.intervals} onOpen={openCapacity} />)}
          </div>

          <div className="rounded-xl px-3 py-2 text-[10px]" style={{ background: ax("surfaceHi"), color: ax("muted") }}>
            <Clock3 className="mr-1 inline h-3 w-3" /> Europe/Stockholm · högst {data.operations.query_strategy.maximum_queries} bundna källfrågor · ingen N+1
          </div>
        </>
      ) : null}

      <OperationsBookingDrawer readOnly open={!!openBooking} booking={openBooking} onClose={() => setOpenBooking(null)} />
      <StaffingDialog occurrence={staffingOccurrence} staffOptions={data?.operations.staff_options || []} open={!!staffingOccurrenceId} onClose={() => setStaffingOccurrenceId(null)} venueId={venueId} />
    </div>
  );
}
