import { motion, AnimatePresence } from "framer-motion";
import { Activity, Users, TrendingUp, Zap, Check, Clock, ChevronRight, Timer, Plus, ArrowRight, X, AlertCircle, ScanLine } from "lucide-react";
import QrScanner from "@/components/desk/QrScanner";
import { BookingsSection } from "@/components/desk/BookingsSection";
import { useState, useEffect, useMemo } from "react";
import { useVenueForStaff, useVenueCourts, useTodayBookings, useTodayRevenue } from "@/hooks/useDesk";

// Define types for court status and display
type CourtStatus = "free" | "active" | "soon" | "vip";

interface CourtDisplay {
  id: string;
  name: string;
  status: CourtStatus;
  players?: string;
  endsAt?: number;
  startsAt?: string;
}

const statusConfig: Record<CourtStatus, { class: string; label: string; dot: string }> = {
  free: { class: "court-free", label: "Free", dot: "bg-court-free" },
  active: { class: "court-active", label: "In Play", dot: "bg-court-active" },
  soon: { class: "court-soon", label: "Ending Soon", dot: "bg-court-soon" },
  vip: { class: "court-vip", label: "VIP", dot: "bg-court-vip" },
};

const courtActions = [
  { label: "Check In", icon: Check, color: "bg-court-free text-court-free" },
  { label: "Extend 30 min", icon: Timer, color: "bg-primary/15 text-primary" },
  { label: "Add Drinks", icon: Plus, color: "bg-sell/15 text-sell" },
  { label: "Move Court", icon: ArrowRight, color: "bg-badge-vip/15 text-badge-vip" },
];

function useRealtimeClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCountdown(endsAt: number, now: number) {
  const diff = Math.max(0, endsAt - now);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getVenueStatus(occupancy: number) {
  if (occupancy >= 80) return { label: "Peak", color: "bg-court-active", textColor: "text-court-active" };
  if (occupancy >= 50) return { label: "Live", color: "bg-court-free", textColor: "text-court-free" };
  return { label: "Quiet", color: "bg-court-soon", textColor: "text-court-soon" };
}

const TodayScreen = () => {
  const now = useRealtimeClock();
  const [selectedCourt, setSelectedCourt] = useState<CourtDisplay | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const { data: staffVenue, isLoading: venueLoading } = useVenueForStaff();
  const venueId = staffVenue?.venue_id;
  const { data: courts } = useVenueCourts(venueId);
  const { data: bookings } = useTodayBookings(venueId);
  const { data: revenue } = useTodayRevenue(venueId);

  // Map courts + bookings to display state
  const courtDisplays: CourtDisplay[] = useMemo(() => {
    if (!courts) return [];
    const nowMs = now.getTime();

    return courts.map((court) => {
      const courtBookings = bookings?.filter(
        (b) => b.venue_court_id === court.id && (b.status === "confirmed" || b.status === "completed")
      ) || [];

      const activeBooking = courtBookings.find((b) => {
        const start = new Date(b.start_time).getTime();
        const end = new Date(b.end_time).getTime();
        return start <= nowMs && end > nowMs;
      });

      const nextBooking = courtBookings.find((b) => {
        const start = new Date(b.start_time).getTime();
        return start > nowMs;
      });

      if (activeBooking) {
        const endTime = new Date(activeBooking.end_time).getTime();
        const remaining = endTime - nowMs;
        const isSoon = remaining < 10 * 60 * 1000;
        return {
          id: court.id,
          name: court.name,
          status: (isSoon ? "soon" : "active") as CourtStatus,
          players: activeBooking.booked_by || undefined,
          endsAt: endTime,
        };
      }

      if (nextBooking) {
        const startTime = new Date(nextBooking.start_time);
        return {
          id: court.id,
          name: court.name,
          status: "free" as CourtStatus,
          startsAt: startTime.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }),
        };
      }

      return { id: court.id, name: court.name, status: "free" as CourtStatus };
    });
  }, [courts, bookings, now]);

  const activeCourts = courtDisplays.filter((c) => c.status === "active" || c.status === "soon").length;
  const totalCourts = courtDisplays.length;
  const occupancy = totalCourts > 0 ? Math.round((activeCourts / totalCourts) * 100) : 0;
  const venueStatus = getVenueStatus(occupancy);

  const upcomingBookings = useMemo(() => {
    if (!bookings) return [];
    const nowMs = now.getTime();
    return bookings
      .filter((b) => new Date(b.start_time).getTime() > nowMs && b.status !== "cancelled")
      .slice(0, 6);
  }, [bookings, now]);

  if (!venueLoading && !staffVenue) {
    return (
      <div className="pb-24 px-4 pt-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-badge-unpaid/15 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-badge-unpaid" />
        </div>
        <h2 className="text-lg font-display font-bold">Ingen venue kopplad</h2>
        <p className="text-sm text-muted-foreground">
          Ditt konto är inte kopplat till en venue. Kontakta admin för att bli tilldelad.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-24 px-4 pt-2 space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${venueStatus.color} pulse-live`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${venueStatus.textColor}`}>{venueStatus.label}</span>
          {staffVenue?.venues && (
            <span className="text-xs text-muted-foreground ml-1">
              · {(staffVenue.venues as any).name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span className="text-[11px] font-medium tabular-nums">
            {now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      {/* Revenue Strip */}
      <div className="revenue-hero rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Today</p>
            <p className="text-2xl font-display font-bold text-foreground">
              {revenue ? `${revenue.total.toLocaleString("sv-SE")} kr` : "–"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {occupancy}% occupied · {revenue?.bookingCount || 0} bookings
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Courts", value: `${activeCourts}/${totalCourts}`, icon: Activity },
          { label: "Bookings", value: String(bookings?.length || 0), icon: Zap },
          { label: "Upcoming", value: String(upcomingBookings.length), icon: Users },
          { label: "Passes", value: String(revenue?.passCount || 0), icon: TrendingUp },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-xl p-2.5 text-center"
            style={{ background: "hsl(var(--surface-1))" }}
          >
            <stat.icon className="w-3.5 h-3.5 text-primary mx-auto mb-1" />
            <p className="text-base font-display font-bold">{stat.value}</p>
            <p className="text-[9px] text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Court Grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Courts</h2>
          <div className="flex gap-3">
            {Object.entries(statusConfig).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${val.dot}`} />
                <span className="text-[9px] text-muted-foreground">{val.label}</span>
              </div>
            ))}
          </div>
        </div>
        {courtDisplays.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {courtDisplays.map((court, i) => (
              <motion.button
                key={court.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.04 }}
                className={`court-cell min-h-[80px] ${statusConfig[court.status].class}`}
                whileTap={{ scale: 0.92 }}
                onClick={() => setSelectedCourt(court)}
              >
                <span className="text-[10px] font-bold opacity-60">{court.name}</span>
                <span className="text-xs font-extrabold">{statusConfig[court.status].label}</span>
                {court.players && <span className="text-[9px] opacity-70 truncate max-w-full">{court.players}</span>}
                {court.endsAt && (
                  <span className="text-lg font-display font-black tabular-nums">
                    {formatCountdown(court.endsAt, now.getTime())}
                  </span>
                )}
                {court.startsAt && <span className="text-[10px] opacity-60">Next: {court.startsAt}</span>}
              </motion.button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">
            {venueLoading ? "Laddar banor..." : "Inga banor konfigurerade"}
          </p>
        )}
      </div>

      {/* All Bookings with date picker */}
      <BookingsSection venueId={venueId} />

      {/* Upcoming Bookings */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Upcoming</h2>
        {upcomingBookings.length > 0 ? (
          <div className="space-y-1.5">
            {upcomingBookings.map((booking, i) => {
              const startTime = new Date(booking.start_time);
              const courtName = (booking.venue_courts as any)?.name || "–";
              return (
                <motion.div
                  key={booking.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className="glass-card rounded-2xl p-3 flex items-center gap-3"
                >
                  <div className="text-center min-w-[40px]">
                    <p className="text-sm font-display font-bold text-primary">
                      {startTime.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{booking.booked_by || "Gäst"}</p>
                    <p className="text-[11px] text-muted-foreground">{courtName}</p>
                  </div>
                  <span className={`status-chip text-[9px] ${booking.status === "confirmed" ? "bg-badge-paid/15 text-badge-paid" : "bg-badge-unpaid/15 text-badge-unpaid"}`}>
                    {booking.status === "confirmed" ? "Paid" : booking.status}
                  </span>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Inga kommande bokningar idag</p>
        )}
      </div>

      {/* Court Action Sheet */}
      <AnimatePresence>
        {selectedCourt && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
              onClick={() => setSelectedCourt(null)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto rounded-t-3xl p-5 pb-10 space-y-3"
              style={{ background: "hsl(var(--surface-1))", borderTop: "1px solid hsl(var(--border))" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-lg font-display font-bold">{selectedCourt.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {statusConfig[selectedCourt.status].label}
                    {selectedCourt.players && ` · ${selectedCourt.players}`}
                    {selectedCourt.endsAt && ` · ${formatCountdown(selectedCourt.endsAt, now.getTime())} left`}
                  </p>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedCourt(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--surface-3))" }}>
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
              {courtActions.map((action, i) => (
                <motion.button
                  key={action.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.97 }}
                  className="action-sheet-item"
                >
                  <div className={`w-10 h-10 rounded-xl ${action.color} flex items-center justify-center`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-semibold flex-1">{action.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TodayScreen;