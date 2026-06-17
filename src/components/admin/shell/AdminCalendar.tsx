import { type InputHTMLAttributes, type TextareaHTMLAttributes, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarDays, Clock, ExternalLink, Loader2, Plus, ShieldAlert, Ticket } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { useAdminCalendar, type AdminCalendarItem } from "@/hooks/useAdmin";

interface Props {
  venueId: string | undefined;
  onOpenModule: (id: string) => void;
}

const toneClass: Record<string, string> = {
  activity: "border-lime-400 bg-lime-400/10 text-lime-300",
  event: "border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-200",
  drift: "border-red-400 bg-red-400/10 text-red-200",
  block: "border-amber-300 bg-amber-300/10 text-amber-200",
};

function todayStockholm() {
  return DateTime.now().setZone("Europe/Stockholm").toISODate()!;
}

function labelDate(value: string, compact = false) {
  const date = DateTime.fromISO(value, { zone: "Europe/Stockholm" });
  if (!date.isValid) return value;
  return compact ? date.toFormat("ccc d/M") : date.toFormat("cccc d LLLL");
}

function kindLabel(kind: string) {
  if (kind === "activity") return "Aktivitet";
  if (kind === "event") return "Event";
  if (kind === "drift") return "Drift";
  if (kind === "block") return "Block";
  return kind;
}

function weekRange(selectedDate: string) {
  const day = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });
  const start = (day.isValid ? day : DateTime.now().setZone("Europe/Stockholm")).startOf("week");
  return {
    from: start.toISODate()!,
    to: start.plus({ days: 6 }).toISODate()!,
    dates: Array.from({ length: 7 }, (_, index) => start.plus({ days: index }).toISODate()!),
  };
}

function itemSubtitle(item: AdminCalendarItem) {
  const bits = [item.end_time ? `${item.time}-${item.end_time}` : item.time, kindLabel(item.kind)];
  if (item.kind === "activity" && item.registrations_count != null) bits.push(`${item.registrations_count} anmälda`);
  if (item.kind === "activity" && item.override_status && item.override_status !== "active") bits.push(item.override_status === "hidden" ? "Dold" : "Avbokad");
  if (item.kind === "event" && item.visibility) bits.push(item.visibility);
  if (item.kind === "block" && item.status) bits.push(item.status);
  return bits.filter(Boolean).join(" · ");
}

function ActionInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs outline-none focus:border-primary/60 ${props.className || ""}`}
    />
  );
}

function ActionTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-20 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs outline-none focus:border-primary/60 ${props.className || ""}`}
    />
  );
}

function productKeyForSessionType(sessionType: string) {
  if (sessionType === "group_training") return "group_training";
  if (sessionType === "event") return "event_fee";
  return "open_play_slot";
}

export default function AdminCalendar({ venueId, onOpenModule }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<"day" | "week">("day");
  const [selectedDate, setSelectedDate] = useState(todayStockholm());
  const [activityTitle, setActivityTitle] = useState("Fredagsklubben Oasen Wednesday Midsummer Edition");
  const [activityDate, setActivityDate] = useState(todayStockholm());
  const [activityStart, setActivityStart] = useState("17:00");
  const [activityEnd, setActivityEnd] = useState("21:00");
  const [activityPrice, setActivityPrice] = useState("99");
  const [activityCapacity, setActivityCapacity] = useState("32");
  const [activityType, setActivityType] = useState("open_play");
  const [activityNote, setActivityNote] = useState("Midsommarvärme, pickleball, musik och community.");
  const [activityVisibility, setActivityVisibility] = useState<"public" | "private">("public");
  const [includedInDayPass, setIncludedInDayPass] = useState(true);
  const [includedInUnlimited, setIncludedInUnlimited] = useState(true);
  const [driftTitle, setDriftTitle] = useState("Driftavvikelse");
  const [driftStart, setDriftStart] = useState("18:00");
  const [driftEnd, setDriftEnd] = useState("21:00");

  useEffect(() => {
    setActivityDate(selectedDate);
  }, [selectedDate]);

  const range = useMemo(() => view === "week"
    ? weekRange(selectedDate)
    : { from: selectedDate, to: selectedDate, dates: [selectedDate] },
  [selectedDate, view]);

  const calendarQ = useAdminCalendar(venueId, range.from, range.to);
  const items = calendarQ.data?.items || [];
  const visibleDates = view === "week" ? (calendarQ.data?.dates || range.dates) : [selectedDate];

  const invalidateCalendar = () => {
    qc.invalidateQueries({ queryKey: ["admin-calendar", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-todays-plan", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-venue-operation-overrides", venueId] });
    qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
  };

  const activityOverride = useMutation({
    mutationFn: ({ item, status }: { item: AdminCalendarItem; status: "hidden" | "cancelled" }) => {
      const registrations = Number(item.registrations_count || 0);
      if (registrations > 0 && !window.confirm(`${item.title} har ${registrations} anmälda. Vill du fortsätta?`)) {
        throw new Error("Avbrutet");
      }
      return apiPost("api-admin", "activity-session-overrides", {
        venueId,
        activity_session_id: item.activity_session_id || item.source_id,
        session_date: item.date,
        status,
        reason: "Calendar operation",
        confirm: true,
      });
    },
    onSuccess: (_, vars) => {
      toast.success(vars.status === "hidden" ? "Aktivitet dold" : "Aktivitet avbokad");
      invalidateCalendar();
    },
    onError: (error: Error) => {
      if (error.message !== "Avbrutet") toast.error(error.message);
    },
  });

  const createActivity = useMutation({
    mutationFn: () => apiPost("api-admin", "activity-sessions", {
      venueId,
      name: activityTitle.trim(),
      session_type: activityType,
      product_key: productKeyForSessionType(activityType),
      session_date: activityDate,
      recurrence_days: null,
      start_time: activityStart,
      end_time: activityEnd,
      price_sek: Math.max(0, Math.round(Number(activityPrice || 0))),
      capacity: activityCapacity ? Math.max(0, Math.round(Number(activityCapacity))) : null,
      is_active: true,
      publish_status: activityVisibility === "public" ? "published" : "hidden",
      access_policy: {
        sold_as: "activity_ticket",
        allows_day_access: includedInDayPass,
        includes_day_access: false,
        member_benefit_key: includedInUnlimited ? "open_play_unlimited" : null,
      },
      metadata: {
        public_note: activityNote.trim() || null,
        created_from: "admin_calendar",
        visibility: activityVisibility,
      },
    }),
    onSuccess: () => {
      toast.success("One-off aktivitet publicerad");
      setSelectedDate(activityDate);
      invalidateCalendar();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createDrift = useMutation({
    mutationFn: () => apiPost("api-admin", "venue-operation-overrides", {
      venueId,
      title: driftTitle.trim() || "Driftavvikelse",
      reason: "Created from Admin Calendar",
      override_type: "other",
      date: selectedDate,
      start_time: driftStart,
      end_time: driftEnd,
      affects_entire_venue: true,
      venue_court_ids: [],
    }),
    onSuccess: () => {
      toast.success("Drift skapad");
      invalidateCalendar();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const moveDate = (days: number) => {
    const base = DateTime.fromISO(selectedDate, { zone: "Europe/Stockholm" });
    setSelectedDate(base.plus({ days: view === "week" ? days * 7 : days }).toISODate()!);
  };

  if (!venueId) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Välj venue först.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg font-bold">Calendar</h2>
              {calendarQ.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Aktiviteter, events, drift och block i samma tidslinje.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setView("day")} className={`rounded-xl px-3 py-2 text-xs font-bold ${view === "day" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>Day</button>
            <button onClick={() => setView("week")} className={`rounded-xl px-3 py-2 text-xs font-bold ${view === "week" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>Week</button>
            <button onClick={() => moveDate(-1)} className="rounded-xl bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">Föregående</button>
            <button onClick={() => setSelectedDate(todayStockholm())} className="rounded-xl bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">Idag</button>
            <button onClick={() => moveDate(1)} className="rounded-xl bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">Nästa</button>
          </div>
        </div>
      </div>

      {view === "week" && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {range.dates.map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={`min-w-[92px] rounded-xl border px-3 py-2 text-left text-xs ${selectedDate === date ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted/30 text-muted-foreground"}`}
            >
              <span className="block font-bold">{labelDate(date, true)}</span>
              <span>{items.filter((item) => item.date === date).length} saker</span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card/70 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-primary" />
              <p className="text-sm font-bold">Create paid one-off</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Ett publikt aktivitetspass för valt datum. Upprepas inte nästa vecka.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">One-off</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">1. Pick time</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ActionInput type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
              <ActionInput type="time" value={activityStart} onChange={(e) => setActivityStart(e.target.value)} />
              <ActionInput type="time" value={activityEnd} onChange={(e) => setActivityEnd(e.target.value)} />
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
            <p className="mb-2 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">2. Add title</p>
            <ActionInput value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} placeholder="Titel" />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs outline-none">
                <option value="club_night">Klubbkväll</option>
                <option value="open_play">Open Play</option>
                <option value="group_training">Gruppträning</option>
                <option value="event">Event</option>
              </select>
              <select value={activityVisibility} onChange={(e) => setActivityVisibility(e.target.value as "public" | "private")} className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs outline-none">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
            <p className="mb-2 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground">3. Price/capacity</p>
            <div className="grid grid-cols-2 gap-2">
              <ActionInput type="number" value={activityPrice} onChange={(e) => setActivityPrice(e.target.value)} placeholder="Pris" />
              <ActionInput type="number" value={activityCapacity} onChange={(e) => setActivityCapacity(e.target.value)} placeholder="Max" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between rounded-xl bg-background/50 px-2.5 py-2 text-[11px] font-semibold text-muted-foreground">
                Day pass
                <input type="checkbox" checked={includedInDayPass} onChange={(e) => setIncludedInDayPass(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-xl bg-background/50 px-2.5 py-2 text-[11px] font-semibold text-muted-foreground">
                Membership
                <input type="checkbox" checked={includedInUnlimited} onChange={(e) => setIncludedInUnlimited(e.target.checked)} />
              </label>
            </div>
          </div>

          <button
            onClick={() => createActivity.mutate()}
            disabled={!activityTitle.trim() || !activityDate || !activityStart || !activityEnd || !activityPrice || !activityCapacity || createActivity.isPending}
            className="flex min-h-28 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground disabled:opacity-50"
          >
            {createActivity.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            4. Publish
          </button>
        </div>

        <ActionTextarea
          value={activityNote}
          onChange={(e) => setActivityNote(e.target.value)}
          placeholder="Public note"
          className="mt-3 w-full"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-1">
        <div className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <p className="text-sm font-bold">Skapa drift</p>
          </div>
          <div className="space-y-2">
            <ActionInput value={driftTitle} onChange={(e) => setDriftTitle(e.target.value)} placeholder="Titel" />
            <div className="grid grid-cols-2 gap-2">
              <ActionInput type="time" value={driftStart} onChange={(e) => setDriftStart(e.target.value)} />
              <ActionInput type="time" value={driftEnd} onChange={(e) => setDriftEnd(e.target.value)} />
            </div>
            <button
              onClick={() => createDrift.mutate()}
              disabled={createDrift.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/15 py-2.5 text-sm font-bold text-destructive disabled:opacity-50"
            >
              {createDrift.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Skapa drift {labelDate(selectedDate, true)}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {visibleDates.map((date) => {
          const dayItems = items.filter((item) => item.date === date);
          return (
            <section key={date} className="rounded-2xl border border-border bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-base font-bold capitalize">{labelDate(date)}</h3>
                <span className="text-xs text-muted-foreground">{dayItems.length} poster</span>
              </div>
              {calendarQ.isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : dayItems.length === 0 ? (
                <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">Inget planerat.</p>
              ) : (
                <div className="space-y-2">
                  {dayItems.map((item) => {
                    const disabled = item.override_status === "hidden" || item.override_status === "cancelled";
                    return (
                      <div key={item.id} className={`rounded-xl border-l-4 bg-muted/20 p-3 ${toneClass[item.kind] || "border-primary"}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] opacity-80">
                              {item.end_time ? `${item.time}-${item.end_time}` : item.time}
                            </p>
                            <p className="truncate text-sm font-black text-foreground">{item.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{itemSubtitle(item)}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            {item.moduleTarget && (
                              <button
                                onClick={() => onOpenModule(item.moduleTarget!)}
                                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground"
                              >
                                Öppna <ExternalLink className="h-3 w-3" />
                              </button>
                            )}
                            {item.kind === "activity" && (
                              <>
                                <button
                                  disabled={disabled || activityOverride.isPending}
                                  onClick={() => activityOverride.mutate({ item, status: "hidden" })}
                                  className="rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-foreground disabled:opacity-40"
                                >
                                  Dölj
                                </button>
                                <button
                                  disabled={disabled || activityOverride.isPending}
                                  onClick={() => activityOverride.mutate({ item, status: "cancelled" })}
                                  className="rounded-full bg-destructive/15 px-2.5 py-1.5 text-[10px] font-bold text-destructive disabled:opacity-40"
                                >
                                  Avboka
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
