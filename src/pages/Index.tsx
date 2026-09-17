import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Loader2, LogOut, Settings, RefreshCw, UserCheck, Gauge, Radio, AlertTriangle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useVenueForStaff, useTodayBookings } from "@/hooks/useDesk";
import { ax, AX_GRID_BG } from "@/components/admin/shell/axTheme";
import { AX_TYPE } from "@/components/admin/shell/axPrimitives";
import DeskTopNav, { type DeskSurfaceId, type DeskSurfaceDef } from "@/components/desk/shell/DeskTopNav";
import DeskArrivals from "@/components/desk/shell/DeskArrivals";
import DeskToday from "@/components/desk/shell/DeskToday";
import DeskLive from "@/components/desk/shell/DeskLive";
import DeskQueue from "@/components/desk/shell/DeskQueue";
import DeskCommandBar from "@/components/desk/shell/DeskCommandBar";
import { DeskOperationalDetailDrawer } from "@/components/operations/DeskOperationalDetailDrawer";
import picklaLogo from "@/assets/pickla-logo.svg";
import {
  completeStartupTiming,
  markReliabilityMilestone,
} from "@/lib/reliabilityTiming";

type DeskBookingRow = {
  id?: string;
  kind?: string;
  payment_status?: string | null;
  source_id?: string | null;
  source_ids?: string[] | null;
  status?: string | null;
  detail_target?: unknown;
  [key: string]: unknown;
};

type StaffVenueIdentity = {
  name?: string | null;
  slug?: string | null;
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useMemo(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const Index = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { bookingId: deepLinkedBookingId } = useParams<{ bookingId?: string }>();
  const queryClient = useQueryClient();
  const { data: staffVenue, isLoading: venueLoading } = useVenueForStaff();
  const venueId = staffVenue?.venue_id;

  const [active, setActive] = useState<DeskSurfaceId>("arrivals");
  const [openDetail, setOpenDetail] = useState<{ target: unknown; sourceItem?: DeskBookingRow | null } | null>(
    deepLinkedBookingId ? { target: { kind: "booking", booking_id: deepLinkedBookingId } } : null,
  );
  const now = useClock();

  useEffect(() => {
    if (!staffVenue) return;
    const frame = window.requestAnimationFrame(() => {
      markReliabilityMilestone("first_meaningful_render", { surface: "desk" });
      markReliabilityMilestone("first_actionable_ui", { surface: "desk" });
      completeStartupTiming("desk");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [staffVenue]);

  useEffect(() => {
    setOpenDetail(deepLinkedBookingId ? { target: { kind: "booking", booking_id: deepLinkedBookingId } } : null);
  }, [deepLinkedBookingId]);

  const { data: bookings } = useTodayBookings(venueId);
  useEffect(() => {
    if (bookings === undefined) return;
    markReliabilityMilestone("primary_state_committed", { surface: "desk" });
  }, [bookings]);
  const courtRows = useMemo(
    () => ((bookings as DeskBookingRow[] | undefined) || []).filter((booking) =>
      booking.kind !== "activity_registration" && booking.kind !== "activity_court_block"
    ),
    [bookings]
  );
  const pendingCount = useMemo(
    () =>
      courtRows.filter((booking) => (booking.payment_status || "").toLowerCase() === "pending").length +
      courtRows.filter((booking) => booking.status === "cancelled").length,
    [courtRows]
  );

  const openDetailFromRow = (booking: DeskBookingRow, _sourceRows: DeskBookingRow[] = courtRows) => {
    setOpenDetail({ target: booking.detail_target, sourceItem: booking });
  };

  const surfaces: DeskSurfaceDef[] = [
    { id: "arrivals", label: "Arrivals", icon: UserCheck, hint: "Senaste incheckningar" },
    { id: "today", label: "Today", icon: Gauge, hint: "Intäkt och kommande" },
    { id: "live", label: "Live", icon: Radio, hint: "Hela hallen i realtid" },
    { id: "queue", label: "Queue", icon: AlertTriangle, hint: "Undantag", badge: pendingCount || undefined },
  ];

  if (venueLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: ax("ink") }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: ax("electric") }} />
      </div>
    );
  }

  if (!staffVenue) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ background: ax("ink") }}>
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: ax("danger", 0.18), border: `1px solid ${ax("danger", 0.4)}` }}>
            <AlertCircle className="w-7 h-7" style={{ color: ax("danger") }} />
          </div>
          <h1 className={`${AX_TYPE.display} text-2xl`} style={{ color: "white" }}>Ingen desk-åtkomst</h1>
          <p className="text-sm" style={{ color: ax("muted") }}>
            Ditt konto är inte kopplat till någon venue som personal.
          </p>
          <div className="grid gap-2">
            <button onClick={() => navigate("/")}
              className="rounded-xl px-4 py-3 text-sm font-bold"
              style={{ background: ax("electric"), color: "white" }}>
              Till startsidan
            </button>
            <button onClick={signOut}
              className="rounded-xl px-4 py-3 text-sm font-bold"
              style={{ background: ax("surfaceHi"), color: ax("muted"), border: `1px solid ${ax("borderSoft")}` }}>
              Logga ut
            </button>
          </div>
        </div>
      </div>
    );
  }

  const venue = staffVenue.venues as StaffVenueIdentity | null | undefined;
  const venueName = venue?.name || "Venue";

  return (
    <div className="min-h-screen" style={{ background: ax("ink"), color: "white" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-xl"
        style={{
          borderColor: ax("borderSoft"),
          background: `hsl(220 25% 8% / 0.85)`,
        }}
      >
        <div className="mx-auto max-w-[1600px] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img src={picklaLogo} alt="Pickla" className="h-7 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
              <span
                className="hidden sm:inline-flex rounded-md px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-[0.22em]"
                style={{ background: ax("electric", 0.15), color: ax("electricSoft"), border: `1px solid ${ax("electric", 0.35)}` }}
              >
                Desk OS
              </span>
              <span className="hidden md:inline truncate text-sm font-semibold" style={{ color: ax("muted") }}>
                · {venueName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 rounded-xl px-3 py-1.5"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: ax("lime") }} />
                <span className="font-mono text-xs font-bold tabular-nums" style={{ color: "white" }}>
                  {now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
              <button
                onClick={() => queryClient.invalidateQueries()}
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
                aria-label="Uppdatera"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={() => navigate("/hub/admin")}
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
                aria-label="Admin"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={signOut}
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
                aria-label="Logga ut"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="mt-3">
            <DeskTopNav surfaces={surfaces} active={active} onChange={setActive} />
          </div>
          <div className="mt-3">
            <DeskCommandBar
              venueId={venueId}
              venueSlug={venue?.slug || "solna"}
              bookings={courtRows}
              onOpenBooking={openDetailFromRow}
            />
          </div>
        </div>
      </header>

      {/* Subtle grid bg behind content */}
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={AX_GRID_BG}
      />

      <main className="relative mx-auto max-w-[1600px] px-4 py-5 pb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {active === "arrivals" && <DeskArrivals venueId={venueId} />}
            {active === "today" && <DeskToday venueId={venueId} onOpenDetail={openDetailFromRow} />}
            {active === "live" && <DeskLive venueId={venueId} />}
            {active === "queue" && <DeskQueue venueId={venueId} onOpenBooking={openDetailFromRow} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <DeskOperationalDetailDrawer
        open={!!openDetail}
        venueId={venueId}
        target={openDetail?.target}
        sourceItem={openDetail?.sourceItem}
        onClose={() => {
          setOpenDetail(null);
          if (deepLinkedBookingId) navigate("/desk", { replace: true });
        }}
      />
    </div>
  );
};

export default Index;
