import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CalendarCheck, CheckCircle2, ChevronDown, Inbox, Loader2, Mail, Phone, ReceiptText, Sparkles, UserCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useTodayBookings, useTodayRevenue, useVenueCourts } from "@/hooks/useDesk";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";
import Customer360Drawer from "@/components/customers/Customer360Drawer";
import { activityRegistrationCheckinEligibility, checkInActivityRegistration, checkInDeskBooking, deskBookingCheckinEligibility } from "@/lib/deskOps";

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
  const [expandedActivityKey, setExpandedActivityKey] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);
  const { data: bookings } = useTodayBookings(venueId);
  const { data: revenue } = useTodayRevenue(venueId);
  const { data: courts } = useVenueCourts(venueId);
  const checkinMutation = useMutation({
    mutationFn: (booking: any) => checkInDeskBooking(booking),
    onSuccess: () => {
      toast.success("Kunden är incheckad");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in"),
  });
  const activityCheckinMutation = useMutation({
    mutationFn: (registration: any) => checkInActivityRegistration(registration),
    onSuccess: () => {
      toast.success("Biljetten är incheckad");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
      qc.invalidateQueries({ queryKey: ["customer-360"] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in biljetten"),
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
        key,
        participants: [],
        registered_count: 0,
        checked_in_count: 0,
      };
      current.participants.push(row);
      current.registered_count += 1;
      if (row.checked_in || row.consumed || row.status === "checked_in") current.checked_in_count += 1;
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time)).slice(0, 8);
  }, [activityRows]);

  const suggestions = useMemo(() => {
    const now = DateTime.now().setZone("Europe/Stockholm");
    const items: Array<{ id: string; title: string; meta: string; action: string; tone: "sun" | "danger" | "electric" | "lime"; booking?: any; activityKey?: string }> = [];

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
          activityKey: activity.key,
        });
      }
    }

    return items.slice(0, 8);
  }, [activityGroups, courtRows]);

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
                onOpenActivity={() => {
                  if (item.activityKey) setExpandedActivityKey(item.activityKey);
                }}
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
                <ActivityRow
                  key={activity.key}
                  activity={activity}
                  expanded={expandedActivityKey === activity.key}
                  onToggle={() => setExpandedActivityKey((current) => (current === activity.key ? null : activity.key))}
                  onCheckIn={(participant) => activityCheckinMutation.mutate(participant)}
                  checkingId={(activityCheckinMutation.variables as any)?.session_registration_id || (activityCheckinMutation.variables as any)?.registration_id || null}
                  checking={activityCheckinMutation.isPending}
                  onOpenCustomer={(participant) => setCustomerTarget({ customerId: participant.customer_id || null, userId: participant.user_id || null })}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      <Customer360Drawer
        open={!!customerTarget}
        onClose={() => setCustomerTarget(null)}
        venueId={venueId || null}
        customerId={customerTarget?.customerId || undefined}
        userId={customerTarget?.userId || undefined}
      />
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

function AttentionCard({ item, onOpenBooking, onOpenActivity, onCheckIn, checking }: { item: any; onOpenBooking: () => void; onOpenActivity: () => void; onCheckIn: () => void; checking: boolean }) {
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
            ) : item.activityKey ? (
              <button type="button" onClick={onOpenActivity} className="rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("electric"), color: ax("ink") }}>
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

function ActivityRow({
  activity,
  expanded,
  onToggle,
  onCheckIn,
  checkingId,
  checking,
  onOpenCustomer,
}: {
  activity: any;
  expanded: boolean;
  onToggle: () => void;
  onCheckIn: (participant: any) => void;
  checkingId: string | null;
  checking: boolean;
  onOpenCustomer: (participant: any) => void;
}) {
  const name = activity.activity_session?.name || activity.notes || "Aktivitet";
  return (
    <AxCard pad="row">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
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
        <div className="flex items-center gap-2">
          <AxChip tone={activity.checked_in_count === activity.registered_count ? "lime" : "magenta"}>Pass</AxChip>
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} style={{ color: ax("muted") }} />
        </div>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: ax("borderSoft") }}>
          {activity.participants.map((participant: any) => (
            <ActivityParticipantRow
              key={participant.session_registration_id || participant.registration_id}
              participant={participant}
              onCheckIn={() => onCheckIn(participant)}
              checking={checking && checkingId === (participant.session_registration_id || participant.registration_id)}
              onOpenCustomer={() => onOpenCustomer(participant)}
            />
          ))}
        </div>
      )}
    </AxCard>
  );
}

function ActivityParticipantRow({
  participant,
  onCheckIn,
  checking,
  onOpenCustomer,
}: {
  participant: any;
  onCheckIn: () => void;
  checking: boolean;
  onOpenCustomer: () => void;
}) {
  const eligibility = activityRegistrationCheckinEligibility(participant);
  const checkedIn = participant.checked_in || participant.consumed || participant.status === "checked_in";
  const paymentStatus = String(participant.payment_status || "").toLowerCase();
  const paymentLabel = paymentStatus === "paid" ? "Betald" : paymentStatus === "free" ? "Gratis" : paymentStatus === "confirmed" ? "Betald" : "Okänd";
  const receiptRef = participant.receipt_number || participant.receipt?.receipt_number || null;
  const hasCustomer = Boolean(participant.customer_id || participant.user_id);

  return (
    <div className="rounded-xl border p-3" style={{ background: ax("surfaceHi"), borderColor: ax("borderSoft") }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{participant.customer_name || participant.booked_by || "Deltagare"}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {participant.customer_email && (
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: ax("muted") }}>
                <Mail className="h-3 w-3" />
                {participant.customer_email}
              </span>
            )}
            {participant.customer_phone && (
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: ax("muted") }}>
                <Phone className="h-3 w-3" />
                {participant.customer_phone}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AxChip tone={paymentStatus === "paid" || paymentStatus === "free" || paymentStatus === "confirmed" ? "lime" : "sun"}>{paymentLabel}</AxChip>
            <AxChip tone={checkedIn ? "lime" : "sun"}>
              {checkedIn ? `Incheckad${participant.checked_in_at ? ` ${timeLabel(participant.checked_in_at)}` : ""}` : "Ej incheckad"}
            </AxChip>
            {receiptRef && <AxChip tone="neutral">Kvitto {receiptRef}</AxChip>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {checkedIn ? (
            <span className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("lime", 0.16), color: ax("lime") }}>
              Använd
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
          <button type="button" onClick={onOpenCustomer} disabled={!hasCustomer} className="rounded-xl px-3 py-2 text-xs font-black disabled:opacity-40" style={{ background: ax("electric", 0.18), color: ax("electricSoft") }}>
            Kund
          </button>
          {receiptRef && (
            <button
              type="button"
              onClick={() => window.open(`/receipt/${encodeURIComponent(receiptRef)}`, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-black"
              style={{ background: ax("magenta", 0.16), color: ax("magentaSoft") }}
            >
              <ReceiptText className="h-3.5 w-3.5" />
              Kvitto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
