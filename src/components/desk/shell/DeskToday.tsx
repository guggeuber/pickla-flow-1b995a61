import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CalendarCheck, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Inbox, Loader2, Mail, Phone, ReceiptText, Sparkles, UserCheck, UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useTodayBookings, useTodayRevenue, useVenueCourts } from "@/hooks/useDesk";
import { apiGet } from "@/lib/api";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";
import Customer360Drawer from "@/components/customers/Customer360Drawer";
import { activityRegistrationCheckinEligibility, addManualBookingParticipant, bookingParticipantCheckinEligibility, checkInActivityRegistration, checkInBookingParticipant, checkInDeskBooking, deskBookingCheckinEligibility, markBookingParticipantPaid } from "@/lib/deskOps";
import { shareOrCopy } from "@/lib/share";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";

interface Props {
  venueId: string | undefined;
  onOpenBooking: (booking: any, sortedRows: any[]) => void;
}

const STOCKHOLM_ZONE = "Europe/Stockholm";
const DESK_LOOKAHEAD_DAYS = 7;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function todayStockholm() {
  return DateTime.now().setZone(STOCKHOLM_ZONE).toISODate()!;
}

function toStockholmDate(value: string) {
  return DateTime.fromISO(value, { zone: STOCKHOLM_ZONE }).startOf("day");
}

function dateDiffFromToday(date: string, today: string) {
  return Math.round(toStockholmDate(date).diff(toStockholmDate(today), "days").days);
}

function clampDeskDate(date: string, today: string) {
  const min = toStockholmDate(today);
  const max = min.plus({ days: DESK_LOOKAHEAD_DAYS });
  const selected = toStockholmDate(date);
  if (!selected.isValid || selected < min) return today;
  if (selected > max) return max.toISODate()!;
  return selected.toISODate()!;
}

function dateHeading(date: string, today: string) {
  const dt = toStockholmDate(date).setLocale("sv");
  const diff = dateDiffFromToday(date, today);
  if (diff === 0) return "Live operations";
  if (diff === 1) return `Imorgon ${dt.toFormat("cccc d/M")}`;
  return dt.toFormat("cccc d/M");
}

function dateNavLabel(date: string, today: string) {
  const dt = toStockholmDate(date).setLocale("sv");
  const diff = dateDiffFromToday(date, today);
  if (diff === 0) return "Idag";
  if (diff === 1) return "Imorgon";
  return dt.toFormat("ccc d/M");
}

function timeLabel(value: string) {
  const dt = DateTime.fromISO(value, { zone: "utc" }).setZone(STOCKHOLM_ZONE);
  return dt.isValid ? dt.toFormat("HH:mm") : "--:--";
}

function safeDisplayName(value: unknown) {
  const text = String(value || "").trim();
  if (!text || UUID_PATTERN.test(text)) return "";
  return text;
}

function bookingCode(booking: any) {
  return safeDisplayName(booking?.access_code) || safeDisplayName(booking?.booking_ref);
}

function bookingTitle(booking: any) {
  if (booking?.kind === "activity_court_block" || booking?.is_grouped_activity_block) {
    return safeDisplayName(booking?.activity_session?.name) || safeDisplayName(booking?.customer_name) || safeDisplayName(booking?.booked_by) || "Aktivitet";
  }
  const name =
    safeDisplayName(booking?.customer_name) ||
    safeDisplayName(booking?.customer_contact?.name) ||
    safeDisplayName(booking?.booked_by) ||
    safeDisplayName(booking?.guest_name) ||
    safeDisplayName(booking?.player_name);
  if (name) return name;
  const code = bookingCode(booking);
  return code ? `Gästbokning ${code}` : "Gästbokning";
}

function courtNameForRow(row: any) {
  return safeDisplayName(row?.venue_courts?.name) || safeDisplayName(row?.court_name) || safeDisplayName(row?.venue_court_name) || "";
}

function shortCourtName(name: string) {
  return name.replace(/^Bana\s+/i, "");
}

function groupedCourtLabel(courtNames: string[]) {
  const unique = Array.from(new Set(courtNames.filter(Boolean)));
  return unique.length ? `Banor: ${unique.map(shortCourtName).join(", ")}` : "Banor";
}

function groupActivityCourtBlocks(rows: any[]) {
  const result: any[] = [];
  const groups = new Map<string, any>();

  for (const row of rows) {
    if (row.kind !== "activity_court_block") {
      result.push(row);
      continue;
    }

    const sessionId = row.activity_session_id || row.activity_session?.id || row.id;
    const key = `activity:${sessionId}:${row.session_date || ""}:${row.start_time}:${row.end_time}`;
    const courtName = courtNameForRow(row);
    const current = groups.get(key);
    if (current) {
      current.source_rows.push(row);
      current.source_ids.push(row.id);
      if (courtName) current.court_names.push(courtName);
      current.activity_court_count += 1;
      current.activity_court_label = groupedCourtLabel(current.court_names);
      continue;
    }

    const grouped = {
      ...row,
      id: key,
      booking_group_key: key,
      is_grouped_activity_block: true,
      source_rows: [row],
      source_ids: [row.id].filter(Boolean),
      court_names: courtName ? [courtName] : [],
      activity_court_count: 1,
      activity_court_label: groupedCourtLabel(courtName ? [courtName] : []),
    };
    groups.set(key, grouped);
    result.push(grouped);
  }

  return result;
}

function isPlayingHostParticipant(participant: any) {
  const metadata = participant?.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
  return Boolean(
    participant?.is_playing_host ||
      participant?.role === "playing_host" ||
      participant?.source_type === "playing_host" ||
      participant?.source_type === "host_comp" ||
      metadata.role === "playing_host" ||
      metadata.entitlement_type === "playing_host" ||
      metadata.entitlement_type === "host_comp" ||
      metadata.pricing_reason === "playing_host" ||
      metadata.pricing_reason === "host_comp" ||
      metadata.compensation_type === "playing_host" ||
      metadata.compensation_type === "host_comp"
  );
}

function participantName(participant: any) {
  return participant?.customer_name || participant?.booked_by || participant?.player_name || "Deltagare";
}

function customerSuggestionTitle(row: any) {
  return row?.identity_title || row?.display_name || row?.full_name || row?.email || "Kund utan namn";
}

function customerSuggestionMeta(row: any) {
  return [row?.phone, row?.email, row?.active_membership_tier?.name].filter(Boolean).join(" · ") || "Kund";
}

export default function DeskToday({ venueId, onOpenBooking }: Props) {
  const qc = useQueryClient();
  const today = useMemo(() => todayStockholm(), []);
  const [expandedActivityKey, setExpandedActivityKey] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<{ customerId?: string | null; userId?: string | null } | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedOffset = dateDiffFromToday(selectedDate, today);
  const isToday = selectedOffset === 0;
  const maxDate = toStockholmDate(today).plus({ days: DESK_LOOKAHEAD_DAYS }).toISODate()!;
  const { data: bookings } = useTodayBookings(venueId, selectedDate);
  const { data: revenue } = useTodayRevenue(venueId);
  const { data: courts } = useVenueCourts(venueId);
  const changeDateBy = (days: number) => {
    const next = toStockholmDate(selectedDate).plus({ days }).toISODate()!;
    setSelectedDate(clampDeskDate(next, today));
  };
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
  const participantCheckinMutation = useMutation({
    mutationFn: ({ participant, booking }: { participant: any; booking: any }) => checkInBookingParticipant(participant, booking),
    onSuccess: () => {
      toast.success("Medspelaren är incheckad");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
      qc.invalidateQueries({ queryKey: ["customer-360"] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte checka in medspelare"),
  });
  const participantPaidMutation = useMutation({
    mutationFn: (participant: any) => markBookingParticipantPaid(participant),
    onSuccess: () => {
      toast.success("Medspelaren är markerad betald");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
      qc.invalidateQueries({ queryKey: ["revenue-ledger"] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte markera betald"),
  });
  const participantManualMutation = useMutation({
    mutationFn: ({ booking, input }: { booking: any; input: { displayName: string; email?: string; phone?: string } }) => addManualBookingParticipant(booking, input),
    onSuccess: () => {
      toast.success("Spelaren är tillagd");
      qc.invalidateQueries({ queryKey: ["today-bookings", venueId] });
    },
    onError: (error: any) => toast.error(error?.message || "Kunde inte lägga till spelaren"),
  });

  const rows = (bookings as any[] | undefined) || [];
  const courtRows = useMemo(
    () => groupActivityCourtBlocks(rows.filter((b: any) => b.kind !== "activity_registration" && b.status !== "cancelled")),
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
        playing_host_count: 0,
      };
      current.participants.push(row);
      current.registered_count += 1;
      if (isPlayingHostParticipant(row)) current.playing_host_count += 1;
      if (row.checked_in || row.consumed || row.status === "checked_in") current.checked_in_count += 1;
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time)).slice(0, 8);
  }, [activityRows]);

  const suggestions = useMemo(() => {
    const now = DateTime.now().setZone(STOCKHOLM_ZONE);
    const items: Array<{ id: string; title: string; meta: string; action: string; tone: "sun" | "danger" | "electric" | "lime"; booking?: any; activityKey?: string }> = [];

    for (const booking of courtRows) {
      if (booking.kind === "activity_court_block" || booking.is_grouped_activity_block) continue;
      const start = DateTime.fromISO(booking.start_time, { zone: "utc" }).setZone(STOCKHOLM_ZONE);
      const minutes = start.diff(now, "minutes").minutes;
      if (!booking.checked_in && minutes >= 0 && minutes <= 15) {
        items.push({
          id: `soon:${booking.id}`,
          title: `${bookingTitle(booking)} börjar ${start.toFormat("HH:mm")}`,
          meta: `${booking.venue_courts?.name || "Bana"} · ej incheckad`,
          action: "Checka in kund",
          tone: "sun",
          booking,
        });
      }
      if (String(booking.payment_status || "").toLowerCase() === "pending") {
        items.push({
          id: `payment:${booking.id}`,
          title: `${bookingTitle(booking)} har väntande betalning`,
          meta: booking.booking_ref || "Bokning idag",
          action: "Öppna bokning",
          tone: "danger",
          booking,
        });
      }
    }

    for (const activity of activityGroups) {
      const start = DateTime.fromISO(activity.start_time, { zone: "utc" }).setZone(STOCKHOLM_ZONE);
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
            {dateHeading(selectedDate, today)}
          </h2>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => changeDateBy(-1)}
              disabled={selectedOffset <= 0}
              className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-35"
              style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
              aria-label="Föregående dag"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <label
              className="relative flex h-10 min-w-[150px] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-3 text-sm font-black"
              style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: "white" }}
            >
              <CalendarDays className="h-4 w-4" style={{ color: ax("electric") }} />
              {dateNavLabel(selectedDate, today)}
              <input
                type="date"
                value={selectedDate}
                min={today}
                max={maxDate}
                onChange={(event) => setSelectedDate(clampDeskDate(event.target.value, today))}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Välj datum"
              />
            </label>
            <button
              type="button"
              onClick={() => changeDateBy(1)}
              disabled={selectedOffset >= DESK_LOOKAHEAD_DAYS}
              className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-35"
              style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
              aria-label="Nästa dag"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {isToday ? (
            <div className="grid grid-cols-3 gap-2 text-center md:w-[420px]">
              <MiniStat label="Intäkt" value={total} />
              <MiniStat label="Bokningar" value={String(courtRows.length)} />
              <MiniStat label="Banor" value={String(totalCourts)} />
            </div>
          ) : null}
        </div>
      </div>

      {isToday ? (
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
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="space-y-2">
          <AxSectionLabel icon={CalendarCheck} accent={ax("electric")}>
            {isToday ? "Bokningar idag" : "Bokningar"}
          </AxSectionLabel>
          {sortedBookings.length === 0 ? (
            <AxEmpty icon={Inbox} title={isToday ? "Inga bokningar idag" : "Inga bokningar denna dag"} hint="När bokningar finns visas kund, bana, betalning och check-in direkt." tint={ax("electric")} />
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
                  onParticipantCheckIn={(participant) => participantCheckinMutation.mutate({ participant, booking })}
                  participantCheckingId={(participantCheckinMutation.variables as any)?.participant?.id || null}
                  participantChecking={participantCheckinMutation.isPending}
                  onParticipantMarkPaid={(participant) => participantPaidMutation.mutate(participant)}
                  participantPayingId={(participantPaidMutation.variables as any)?.id || null}
                  participantPaying={participantPaidMutation.isPending}
                  onParticipantManualAdd={(input) => participantManualMutation.mutateAsync({ booking, input })}
                  participantManualAdding={participantManualMutation.isPending}
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
            <AxEmpty icon={Activity} title={isToday ? "Inga aktiviteter idag" : "Inga aktiviteter denna dag"} hint="Registrerade pass och check-in-status visas här." tint={ax("magenta")} />
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

function BookingActionRow({
  booking,
  onOpen,
  onCheckIn,
  checking,
  onParticipantCheckIn,
  participantCheckingId,
  participantChecking,
  onParticipantMarkPaid,
  participantPayingId,
  participantPaying,
  onParticipantManualAdd,
  participantManualAdding,
}: {
  booking: any;
  rows: any[];
  onOpen: () => void;
  onCheckIn: () => void;
  checking: boolean;
  onParticipantCheckIn: (participant: any) => void;
  participantCheckingId: string | null;
  participantChecking: boolean;
  onParticipantMarkPaid: (participant: any) => void;
  participantPayingId: string | null;
  participantPaying: boolean;
  onParticipantManualAdd: (input: { displayName: string; email?: string; phone?: string; customerId?: string | null }) => Promise<any>;
  participantManualAdding: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [selectedManualCustomer, setSelectedManualCustomer] = useState<any | null>(null);
  const eligibility = deskBookingCheckinEligibility(booking);
  const isActivityBlock = booking.kind === "activity_court_block" || booking.is_grouped_activity_block;
  const paymentStatus = booking.payment_status || (Number(booking.total_price || 0) <= 0 ? "free" : "unknown");
  const paymentLabel = isActivityBlock ? "Aktivitetsblock" : paymentStatus === "paid" ? "Betald" : paymentStatus === "free" ? "Gratis" : paymentStatus === "pending" ? "Väntar" : "Okänd";
  const paymentTone = isActivityBlock ? "electric" : paymentStatus === "paid" || paymentStatus === "free" ? "lime" : paymentStatus === "pending" ? "sun" : "neutral";
  const participants = Array.isArray(booking.participants) ? booking.participants : [];
  const manualSearch = (manualEmail.trim() || manualPhone.trim() || manualName.trim()).trim();
  const customerSuggestions = useQuery<any[]>({
    queryKey: ["booking-participant-manual-customer-search", booking?.venue_id, manualSearch],
    enabled: manualOpen && !!booking?.venue_id && manualSearch.length >= 2,
    queryFn: () => apiGet("api-customers", "list", { venueId: booking.venue_id, search: manualSearch, limit: "5" }),
    staleTime: 15_000,
  });
  const selectManualCustomer = (customer: any) => {
    setSelectedManualCustomer(customer);
    setManualName(customerSuggestionTitle(customer));
    setManualPhone(customer.phone || "");
    setManualEmail(customer.email || "");
  };
  const clearSelectedManualCustomer = () => {
    if (selectedManualCustomer) setSelectedManualCustomer(null);
  };
  const handleManualSubmit = async () => {
    const displayName = manualName.trim();
    if (!displayName) {
      toast.error("Skriv spelarens namn");
      return;
    }
    try {
      await onParticipantManualAdd({
        displayName,
        email: manualEmail.trim(),
        phone: manualPhone.trim(),
        customerId: selectedManualCustomer?.customer_id || null,
      });
      setManualName("");
      setManualEmail("");
      setManualPhone("");
      setSelectedManualCustomer(null);
      setManualOpen(false);
    } catch {
      // Mutation toast handles the visible error.
    }
  };

  return (
    <AxCard pad="row">
      <div className="grid gap-3 md:grid-cols-[72px_1fr_auto] md:items-center">
        <button type="button" onClick={onOpen} className="text-left">
          <p className="font-mono text-xl font-black tabular-nums" style={{ color: ax("electric") }}>{timeLabel(booking.start_time)}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>{timeLabel(booking.end_time)}</p>
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-sm font-black text-white">{bookingTitle(booking)}</p>
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {isActivityBlock ? booking.activity_court_label : booking.venue_courts?.name || booking.court_name || "Bana"}
            {!isActivityBlock && booking.booking_ref ? ` · ${booking.booking_ref}` : ""}
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
      {!isActivityBlock && (
        <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: ax("borderSoft") }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>Deltagare</p>
            <button
              type="button"
              onClick={() => setManualOpen((current) => !current)}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black"
              style={{ background: ax("electric", 0.16), color: ax("electricSoft") }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Lägg till spelare manuellt
            </button>
          </div>
          {manualOpen ? (
            <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: ax("borderSoft"), background: ax("surfaceHi") }}>
              <p className="text-xs font-bold" style={{ color: ax("muted") }}>
                Skapar en väntande plats. Ingen kundprofil skapas förrän spelaren identifierar sig.
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  value={manualName}
                  onChange={(event) => {
                    setManualName(event.target.value);
                    clearSelectedManualCustomer();
                  }}
                  placeholder="Sök namn eller skriv nytt namn"
                  className="h-10 rounded-xl border border-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                  style={{ background: "white" }}
                />
                <input
                  value={manualPhone}
                  onChange={(event) => {
                    setManualPhone(event.target.value);
                    clearSelectedManualCustomer();
                  }}
                  placeholder="Telefon / sök"
                  className="h-10 rounded-xl border border-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                  style={{ background: "white" }}
                />
                <input
                  value={manualEmail}
                  onChange={(event) => {
                    setManualEmail(event.target.value);
                    clearSelectedManualCustomer();
                  }}
                  placeholder="E-post / sök"
                  className="h-10 rounded-xl border border-white px-3 text-sm font-bold text-neutral-950 caret-neutral-950 outline-none placeholder:text-neutral-400"
                  style={{ background: "white" }}
                />
              </div>
              {selectedManualCustomer ? (
                <div className="rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: ax("lime", 0.35), background: ax("lime", 0.12), color: ax("lime") }}>
                  Vald kund: {customerSuggestionTitle(selectedManualCustomer)}
                </div>
              ) : manualSearch.length >= 2 ? (
                <div className="rounded-xl border p-2" style={{ borderColor: ax("borderSoft"), background: ax("panel") }}>
                  {customerSuggestions.isFetching ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-xs font-bold" style={{ color: ax("muted") }}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Söker kunder...
                    </div>
                  ) : customerSuggestions.data?.length ? (
                    <div className="space-y-1">
                      {customerSuggestions.data.map((customer) => (
                        <button
                          key={customer.customer_id || customer.id || customer.auth_user_id}
                          type="button"
                          onClick={() => selectManualCustomer(customer)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-white">{customerSuggestionTitle(customer)}</span>
                            <span className="block truncate text-xs font-bold" style={{ color: ax("muted") }}>{customerSuggestionMeta(customer)}</span>
                          </span>
                          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: ax("electric") }}>Välj</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-2 text-xs font-bold" style={{ color: ax("muted") }}>
                      Ingen kundträff. Du kan ändå lägga till som väntande plats.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="rounded-xl px-3 py-2 text-xs font-black"
                  style={{ background: ax("borderSoft"), color: ax("muted") }}
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={participantManualAdding || !manualName.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50"
                  style={{ background: ax("lime"), color: ax("ink") }}
                >
                  {participantManualAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Lägg till
                </button>
              </div>
            </div>
          ) : null}
          {participants.length === 0 ? (
            <p className="rounded-xl border p-3 text-sm font-bold" style={{ borderColor: ax("borderSoft"), color: ax("muted") }}>
              Inga personliga platser är kopplade än.
            </p>
          ) : null}
          {participants.map((participant: any) => {
            const participantEligibility = bookingParticipantCheckinEligibility(participant, booking);
            const paid = participant.payment_status === "paid";
            const free = participant.payment_status === "free";
            const checkedIn = Boolean(participant.checked_in || participant.checked_in_at);
            const claimed = Boolean(participant.customer_id || participant.user_id);
            const metadata = participant.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
            const manualPlaceholder = !claimed && metadata.source === "manual_placeholder";
            const claimUrl = participant.invite_token ? canonicalAppUrl(`/booking/invite/${encodeURIComponent(participant.invite_token)}`) : "";
            const amountSek = Number(participant.amount_sek || 0);
            return (
              <div key={participant.id} className="grid gap-2 rounded-xl border p-2 md:grid-cols-[1fr_auto]" style={{ borderColor: ax("borderSoft"), background: ax("panel") }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-white">{participant.display_name || "Medspelare"}</p>
                  {(participant.phone || participant.email) && (
                    <p className="mt-0.5 truncate text-xs font-bold" style={{ color: ax("muted") }}>
                      {[participant.phone, participant.email].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <AxChip tone={claimed ? "lime" : "sun"}>{claimed ? "Claimad" : "Behöver identitet"}</AxChip>
                    <AxChip tone={checkedIn ? "lime" : "sun"}>{checkedIn ? "Incheckad" : "Ej inne"}</AxChip>
                    <AxChip tone={paid || free ? "lime" : "sun"}>
                      {manualPlaceholder ? "Pris efter identitet" : paid ? "Betald" : free ? "Ingår" : `${amountSek.toLocaleString("sv-SE")} kr obetalt`}
                    </AxChip>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {!claimed && claimUrl ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await shareOrCopy({ copyText: claimUrl });
                          toast.success("Claim-länk kopierad");
                        } catch {
                          toast.error("Kunde inte kopiera länken");
                        }
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black"
                      style={{ background: ax("electric", 0.16), color: ax("electricSoft") }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Kopiera länk
                    </button>
                  ) : null}
                  {claimed && !paid && !free && (
                    <button
                      type="button"
                      onClick={() => onParticipantMarkPaid(participant)}
                      disabled={participantPaying && participantPayingId === participant.id}
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50"
                      style={{ background: ax("sun", 0.18), color: ax("sun") }}
                    >
                      {participantPaying && participantPayingId === participant.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
                      Betald på plats
                    </button>
                  )}
                  {checkedIn ? (
                    <span className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("lime", 0.16), color: ax("lime") }}>
                      Inne
                    </span>
                  ) : participantEligibility.ok ? (
                    <button
                      type="button"
                      onClick={() => onParticipantCheckIn(participant)}
                      disabled={participantChecking && participantCheckingId === participant.id}
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50"
                      style={{ background: ax("lime"), color: ax("ink") }}
                    >
                      {participantChecking && participantCheckingId === participant.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                      Checka in
                    </button>
                  ) : (
                    <span className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black" style={{ background: ax("borderSoft"), color: ax("muted") }}>
                      {participantEligibility.reason}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const participants = Array.isArray(activity.participants) ? activity.participants : [];
  const playingHosts = participants.filter(isPlayingHostParticipant);
  const playerCount = Math.max(Number(activity.registered_count || 0) - playingHosts.length, 0);
  const capacity = Number(activity.activity_session?.capacity || activity.capacity || 0);
  const hostNames = playingHosts.map(participantName).filter(Boolean);
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
            Players: {playerCount}/{capacity || Number(activity.registered_count || 0)}
          </p>
          {hostNames.length > 0 ? (
            <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
              Playing hosts: {hostNames.join(", ")}
            </p>
          ) : null}
          <p className={AX_TYPE.meta} style={{ color: ax("muted") }}>
            {activity.checked_in_count}/{activity.registered_count} incheckade totalt
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
  const playingHost = isPlayingHostParticipant(participant);
  const paymentStatus = String(participant.payment_status || "").toLowerCase();
  const paymentLabel = playingHost ? "0 kr · playing_host" : paymentStatus === "paid" ? "Betald" : paymentStatus === "free" ? "Gratis" : paymentStatus === "confirmed" ? "Betald" : "Okänd";
  const receiptRef = participant.receipt_number || participant.receipt?.receipt_number || null;
  const hasCustomer = Boolean(participant.customer_id || participant.user_id);

  return (
    <div className="rounded-xl border p-3" style={{ background: ax("surfaceHi"), borderColor: ax("borderSoft") }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{participantName(participant)}</p>
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
            {playingHost && <AxChip tone="electric">Playing host</AxChip>}
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
              {playingHost ? "Checka in som värd" : "Checka in"}
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
