import { useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, CalendarCheck, Coins, Sparkles, Users, Clock3, Inbox } from "lucide-react";
import { useTodayBookings, useTodayRevenue, useVenueCourts } from "@/hooks/useDesk";
import { AxCard, AxChip, AxEmpty, AxSectionLabel, AX_TYPE } from "@/components/admin/shell/axPrimitives";
import { ax } from "@/components/admin/shell/axTheme";

interface Props {
  venueId: string | undefined;
  onOpenBooking: (booking: any, sortedRows: any[]) => void;
}

function Metric({
  label,
  value,
  hint,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: string;
  icon: any;
}) {
  return (
    <AxCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>{label}</p>
          <p className={`${AX_TYPE.display} mt-1.5 text-3xl md:text-4xl`} style={{ color: "white" }}>
            {value}
          </p>
          {hint && (
            <p className={`${AX_TYPE.meta} mt-1`} style={{ color: ax("muted") }}>{hint}</p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent}, hsl(0 0% 0% / 0.3))`,
            boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15)`,
          }}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </AxCard>
  );
}

export default function DeskToday({ venueId, onOpenBooking }: Props) {
  const { data: bookings } = useTodayBookings(venueId);
  const { data: revenue } = useTodayRevenue(venueId);
  const { data: courts } = useVenueCourts(venueId);

  const rows = (bookings as any[] | undefined) || [];
  const courtRows = useMemo(
    () => rows.filter((b: any) => b.kind !== "activity_registration"),
    [bookings]
  );
  const activityRows = useMemo(
    () => rows.filter((b: any) => b.kind === "activity_registration"),
    [bookings]
  );

  const now = Date.now();
  const upcomingBookings = useMemo(
    () =>
      courtRows
        .filter((b: any) => new Date(b.start_time).getTime() > now && b.status !== "cancelled")
        .sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time))
        .slice(0, 8),
    [courtRows, now]
  );
  const upcomingActivities = useMemo(
    () =>
      activityRows
        .filter((b: any) => new Date(b.start_time).getTime() > now && b.status !== "cancelled")
        .sort((a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time))
        .slice(0, 6),
    [activityRows, now]
  );

  const totalCourts = (courts as any[] | undefined)?.length || 0;
  const total = revenue ? `${(revenue as any).total.toLocaleString("sv-SE")} kr` : "–";

  return (
    <div className="space-y-4">
      <div>
        <p className={AX_TYPE.micro} style={{ color: ax("muted") }}>Today</p>
        <h2 className={`${AX_TYPE.display} text-3xl md:text-4xl`} style={{ color: "white" }}>
          Dagens puls
        </h2>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Intäkt idag"
          value={total}
          hint="exkl. avbokade"
          icon={Coins}
          accent={ax("lime")}
        />
        <Metric
          label="Bokningar"
          value={String(courtRows.length)}
          hint={`${upcomingBookings.length} kommande`}
          icon={CalendarCheck}
          accent={ax("electric")}
        />
        <Metric
          label="Aktiviteter"
          value={String(activityRows.length)}
          hint={`${upcomingActivities.length} kommande`}
          icon={Activity}
          accent={ax("magenta")}
        />
        <Metric
          label="Banor"
          value={String(totalCourts)}
          hint="i drift"
          icon={Users}
          accent={ax("sun")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <AxSectionLabel icon={Clock3} accent={ax("electric")}>
            Kommande bokningar
          </AxSectionLabel>
          {upcomingBookings.length === 0 ? (
            <AxEmpty
              icon={Inbox}
              title="Inga kommande bokningar"
              hint="Bokningar visas här när nästa block startar."
              tint={ax("electric")}
            />
          ) : (
            <div className="space-y-1.5">
              {upcomingBookings.map((b: any) => (
                <BookingRow key={b.id} booking={b} onOpen={() => onOpenBooking(b, courtRows)} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <AxSectionLabel icon={Sparkles} accent={ax("magenta")}>
            Kommande aktiviteter
          </AxSectionLabel>
          {upcomingActivities.length === 0 ? (
            <AxEmpty
              icon={Activity}
              title="Inga kommande aktiviteter"
              hint="Open Play, kurser och pass visas här när de börjar."
              tint={ax("magenta")}
            />
          ) : (
            <div className="space-y-1.5">
              {upcomingActivities.map((b: any) => (
                <ActivityRow key={b.id} booking={b} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BookingRow({ booking, onOpen }: { booking: any; onOpen: () => void }) {
  const start = new Date(booking.start_time);
  const courtName = booking.venue_courts?.name || "–";
  const paymentStatus = booking.payment_status || (Number(booking.total_price || 0) <= 0 ? "free" : "unknown");
  const tone =
    paymentStatus === "paid" || paymentStatus === "free"
      ? "lime"
      : paymentStatus === "pending"
      ? "sun"
      : "neutral";
  const label =
    paymentStatus === "paid" ? "Betald" : paymentStatus === "free" ? "Gratis" : paymentStatus === "pending" ? "Väntar" : "—";
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onOpen}
      className="w-full text-left"
    >
      <AxCard pad="row">
        <div className="flex items-center gap-3">
          <div className="min-w-[52px]">
            <p className="font-mono text-lg font-black tabular-nums" style={{ color: ax("electric") }}>
              {start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: "white" }}>
              {booking.booked_by || "Gäst"}
            </p>
            <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
              {courtName}
              {booking.booking_ref ? ` · ${booking.booking_ref}` : ""}
            </p>
          </div>
          <AxChip tone={tone as any}>{label}</AxChip>
        </div>
      </AxCard>
    </motion.button>
  );
}

function ActivityRow({ booking }: { booking: any }) {
  const start = new Date(booking.start_time);
  const name = booking.activity_session?.name || booking.notes || "Aktivitet";
  return (
    <AxCard pad="row">
      <div className="flex items-center gap-3">
        <div className="min-w-[52px]">
          <p className="font-mono text-lg font-black tabular-nums" style={{ color: ax("magenta") }}>
            {start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: "white" }}>{name}</p>
          <p className={`${AX_TYPE.meta}`} style={{ color: ax("muted") }}>
            {booking.booked_by || "Aktivitet"}
          </p>
        </div>
        <AxChip tone="magenta">Pass</AxChip>
      </div>
    </AxCard>
  );
}
