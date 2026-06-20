import { useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, CalendarCheck, CheckCircle2, Clock3, CreditCard, Inbox, Loader2, Sparkles, UserCheck, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useTodayBookings, useTodayRevenue, useVenueCourts } from "@/hooks/useDesk";
import { apiGet } from "@/lib/api";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";
import { checkInDeskBooking, deskBookingCheckinEligibility } from "@/lib/deskOps";

interface Props {
  venueId: string | undefined;
  onOpenBooking: (booking: any, sortedRows: any[]) => void;
}

function timeLabel(value: string) {
  const dt = DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm");
  return dt.isValid ? dt.toFormat("HH:mm") : "--:--";
}

export default function DeskToday({ venueId, onOpenBooking }: Props) {
  const qc = useQueryClient();
  const { data: bookings } = useTodayBookings(venueId);
  const { data: revenue } = useTodayRevenue(venueId);
  const { data: courts } = useVenueCourts(venueId);
  const opsQ = useQuery({
    queryKey: ["desk-ops-suggestions", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet<any>("api-checkins", "ops", { venueId: venueId! }),
    refetchInterval: 30000,
  });

  const checkinMutation = useMutation({
    mutationFn: (booking: any) => checkInDeskBooking(booking),
    onSuccess: () => {
      toast.success("Kunden är incheckad");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-ops-suggestions", venueId] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in"),
  });

  const rows = (bookings as any[] | undefined) || [];
  const courtRows = useMemo(
    () => rows.filter((b: any) => b.kind !== "activity_registration" && b.status !== "cancelled"),
    [rows]
  );
  const activityRows = useMemo(
    () => rows.filter((b: any) => b.kind === "activity_registration" && b.status !== "cancelled"),
    [rows]
  );

  const sortedBookings = useMemo(
    () => [...courtRows].sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time)).slice(0, 16),
    [courtRows]
  );

  const activityGroups = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of activityRows) {
      const key = `${row.activity_session_id}:${row.session_date}:${row.start_time}`;
      const current = map.get(key) || {
        ...row,
        registered_count: 0,
        checked_in_count: 0,
      };
      current.registered_count += 1;
      if (row.checked_in || row.consumed || row.status === "checked_in") current.checked_in_count += 1;
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time)).slice(0, 8);
  }, [activityRows]);

  const suggestions = useMemo(() => {
    const now = DateTime.now().setZone("Europe/Stockholm");
    const items: Array<{ id: string; title: string; meta: string; action: string; tone: "sun" | "danger" | "electric" | "lime"; booking?: any }> = [];

    for (const booking of courtRows) {
      const start = DateTime.fromISO(booking.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
      const minutes = start.diff(now, "minutes").minutes;
      if (!booking.checked_in && minutes >= 0 && minutes <= 15) {
        items.push({
          id: `soon:${booking.id}`,
          title: `${booking.booked_by || "Kund"} börjar ${start.toFormat("HH:mm")}`,
          meta: `${booking.venue_courts?.name || "Bana"} · ej incheckad`,
          action: "Checka in kund",
          tone: "sun",
          booking,
        });
      }
      if (String(booking.payment_status || "").toLowerCase() === "pending") {
        items.push({
          id: `payment:${booking.id}`,
          title: `${booking.booked_by || "Kund"} har väntande betalning`,
          meta: booking.booking_ref || "Bokning idag",
          action: "Öppna bokning",
          tone: "danger",
          booking,
        });
      }
    }

    for (const activity of activityGroups) {
      const start = DateTime.fromISO(activity.start_time, { zone: "utc" }).setZone("Europe/Stockholm");
      const minutes = start.diff(now, "minutes").minutes;
      if (minutes >= 0 && minutes <= 30 && activity.registered_count > activity.checked_in_count) {
        items.push({
          id: `activity:${activity.id}`,
          title: `${activity.activity_session?.name || activity.notes || "Aktivitet"} börjar snart`,
          meta: `${activity.checked_in_count}/${activity.registered_count} incheckade`,
          action: "Följ upp deltagare",
          tone: "electric",
        });
      }
    }

    const stale = opsQ.data?.stale_checkins || [];
    if (stale.length > 0) {
      items.push({
        id: "stale-checkins",
        title: `${stale.length} gamla check-ins är fortfarande öppna`,
        meta: "Stängdes inte igår",
        action: "Granska check-ins",
        tone: "danger",
      });
    }

    const unclear = opsQ.data?.unclear_checkins || [];
    if (unclear.length > 0) {
      items.push({
        id: "unclear-checkins",
        title: `${unclear.length} incheckade saknar tydlig access`,
        meta: "Manuell incheckning utan entitlement",
        action: "Öppna Arrivals",
        tone: "sun",
      });
    }

    return items.slice(0, 8);
  }, [activityGroups, courtRows, opsQ.data]);

  const totalCourts = (courts as any[] | undefined)?.length || 0;
  const total = revenue ? `${(revenue as any).total.toLocaleString("sv-SE")} kr` : "–";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Today</p>
          <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
            Live operations
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center md:w-[420px]">
          <MiniStat label="Intäkt" value={total} />
          <MiniStat label="Bokningar" value={String(courtRows.length)} />
          <MiniStat label="Banor" value={String(totalCourts)} />
        </div>
      </div>

      <section className="space-y-2">
        <AxSectionLabel icon={AlertTriangle} accent={suggestions.length ? ax("sun") : ax("lime")}>
          Needs attention
        </AxSectionLabel>
        {suggestions.length === 0 ? (
          <AxEmpty icon={CheckCircle2} title="Inget akut just nu" hint="När något behöver ageras på hamnar det här." tint={ax("lime")} />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((item) => (
              <AttentionCard
                key={item.id}
                item={item}
                onOpenBooking={() => item.booking && onOpenBooking(item.booking, courtRows)}
                onCheckIn={() => item.booking && checkinMutation.mutate(item.booking)}
                checking={checkinMutation.isPending}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="space-y-2">
          <AxSectionLabel icon={CalendarCheck} accent={ax("electric")}>
            Bokningar idag
          </AxSectionLabel>
          {sortedBookings.length === 0 ? (
            <AxEmpty icon={Inbox} title="Inga bokningar idag" hint="När bokningar finns visas kund, bana, betalning och check-in direkt." tint={ax("electric")} />
          ) : (
            <div className="space-y-1.5">
              {sortedBookings.map((booking: any) => (
                <BookingActionRow
                  key={booking.id}
                  booking={booking}
                  rows={courtRows}
                  onOpen={() => onOpenBooking(booking, courtRows)}
                  onCheckIn={() => checkinMutation.mutate(booking)}
                  checking={checkinMutation.isPending}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <AxSectionLabel icon={Sparkles} accent={ax("magenta")}>
            Aktiviteter
          </AxSectionLabel>
          {activityGroups.length === 0 ? (
            <AxEmpty icon={Activity} title="Inga aktiviteter idag" hint="Registrerade pass och check-in-status visas här." tint={ax("magenta")} />
          ) : (
            <div className="space-y-1.5">
              {activityGroups.map((activity: any) => (
                <ActivityRow key={`${activity.activity_session_id}:${activity.start_time}`} activity={activity} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ background: ax("surfaceHi"), borderColor: ax("borderSoft") }}>
      <p className={AX_TYPE.microSoft} style={{ color: ax("muted") }}>{label}</p>
      <p className="mt-0.5 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function AttentionCard({ item, onOpenBooking, onCheckIn, checking }: { item: any; onOpenBooking: () => void; onCheckIn: () => void; checking: boolean }) {
  const canCheckIn = item.booking && deskBookingCheckinEligibility(item.booking).ok;
  return (
    <AxCard glow={item.tone === "danger" ? ax("danger", 0.55) : item.tone === "sun" ? ax("sun", 0.55) : undefined}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: ax(item.tone, 0.16), color: ax(item.tone) }}>
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">{item.title}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>{item.meta}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canCheckIn ? (
              <button type="button" onClick={onCheckIn} disabled={checking} className="rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50" style={{ background: ax("lime"), color: ax("ink") }}>
                {checking ? "Checkar in..." : item.action}
              </button>
            ) : item.booking ? (
              <button type="button" onClick={onOpenBooking} className="rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>
                {item.action}
              </button>
            ) : (
              <span className="rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("borderSoft"), color: "white" }}>{item.action}</span>
            )}
          </div>
        </div>
      </div>
    </AxCard>
  );
}

function BookingActionRow({ booking, onOpen, onCheckIn, checking }: { booking: any; rows: any[]; onOpen: () => void; onCheckIn: () => void; checking: boolean }) {
  const eligibility = deskBookingCheckinEligibility(booking);
  const paymentStatus = booking.payment_status || (Number(booking.total_price || 0) <= 0 ? "free" : "unknown");
  const paymentLabel = paymentStatus === "paid" ? "Betald" : paymentStatus === "free" ? "Gratis" : paymentStatus === "pending" ? "Väntar" : "Okänd";
  const paymentTone = paymentStatus === "paid" || paymentStatus === "free" ? "lime" : paymentStatus === "pending" ? "sun" : "neutral";
  return (
    <AxCard pad="row">
      <div className="grid gap-3 md:grid-cols-[72px_1fr_auto] md:items-center">
        <button type="button" onClick={onOpen} className="text-left">
          <p className="font-mono text-xl font-black tabular-nums" style={{ color: ax("electric") }}>{timeLabel(booking.start_time)}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>{timeLabel(booking.end_time)}</p>
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-sm font-black text-white">{booking.booked_by || "Gäst"}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {booking.venue_courts?.name || booking.court_name || "Bana"}{booking.booking_ref ? ` · ${booking.booking_ref}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <AxChip tone={paymentTone as any}>{paymentLabel}</AxChip>
            <AxChip tone={booking.checked_in ? "lime" : "sun"}>{booking.checked_in ? "Incheckad" : "Ej inne"}</AxChip>
          </div>
        </button>
        <div className="flex gap-2 md:justify-end">
          {booking.checked_in ? (
            <span className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("lime", 0.16), color: ax("lime") }}>
              Inne
            </span>
          ) : eligibility.ok ? (
            <button type="button" onClick={onCheckIn} disabled={checking} className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50" style={{ background: ax("lime"), color: ax("ink") }}>
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
              Checka in
            </button>
          ) : (
            <span className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("borderSoft"), color: ax("muted") }}>
              {eligibility.reason}
            </span>
          )}
          <button type="button" onClick={onOpen} className="rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("electric", 0.18), color: ax("electricSoft") }}>
            Detalj
          </button>
        </div>
      </div>
    </AxCard>
  );
}

function ActivityRow({ activity }: { activity: any }) {
  const name = activity.activity_session?.name || activity.notes || "Aktivitet";
  return (
    <AxCard pad="row">
      <div className="flex items-center gap-3">
        <div className="min-w-[52px]">
          <p className="font-mono text-lg font-black tabular-nums" style={{ color: ax("magenta") }}>
            {timeLabel(activity.start_time)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-white">{name}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {activity.checked_in_count}/{activity.registered_count} incheckade
          </p>
        </div>
        <AxChip tone={activity.checked_in_count === activity.registered_count ? "lime" : "magenta"}>Pass</AxChip>
      </div>
    </AxCard>
  );
}
