import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Loader2, LogOut, Settings, RefreshCw, UserCheck, Gauge, Radio, AlertTriangle, ScanLine, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import QrScanner from "@/components/desk/QrScanner";
import CustomersScreen from "@/screens/CustomersScreen";
import {
  OperationsBookingDrawer,
  bookingRowsForGroup,
  buildOperationsBookingDetailFromRows,
  type OperationsBookingDetail,
} from "@/components/operations/OperationsBookingDrawer";
import picklaLogo from "@/assets/pickla-logo.svg";

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
  const queryClient = useQueryClient();
  const { data: staffVenue, isLoading: venueLoading } = useVenueForStaff();
  const venueId = staffVenue?.venue_id;

  const [active, setActive] = useState<DeskSurfaceId>("arrivals");
  const [showScanner, setShowScanner] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [openBooking, setOpenBooking] = useState<OperationsBookingDetail | null>(null);
  const now = useClock();

  const { data: bookings } = useTodayBookings(venueId);
  const courtRows = useMemo(
    () => ((bookings as any[] | undefined) || []).filter((b: any) => b.kind !== "activity_registration"),
    [bookings]
  );
  const pendingCount = useMemo(
    () =>
      courtRows.filter((b: any) => (b.payment_status || "").toLowerCase() === "pending").length +
      courtRows.filter((b: any) => b.status === "cancelled").length,
    [courtRows]
  );

  const openBookingFromRow = (booking: any, sourceRows: any[] = courtRows) => {
    const detail = buildOperationsBookingDetailFromRows(bookingRowsForGroup(sourceRows, booking));
    if (detail) setOpenBooking(detail);
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

  const venueName = (staffVenue as any)?.venues?.name || "Venue";

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
                onClick={() => setShowCustomerSearch(true)}
                className="hidden sm:flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black uppercase tracking-wider"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: "white" }}
              >
                <Search className="w-4 h-4" />
                Kund
              </button>
              <button
                onClick={() => queryClient.invalidateQueries()}
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: ax("muted") }}
                aria-label="Uppdatera"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowScanner(true)}
                className="hidden sm:flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black uppercase tracking-wider"
                style={{
                  background: `linear-gradient(135deg, ${ax("lime")}, ${ax("electric")})`,
                  color: ax("ink"),
                  boxShadow: `0 6px 20px -8px ${ax("lime", 0.6)}`,
                }}
              >
                <ScanLine className="w-4 h-4" />
                Skanna
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
          <button
            type="button"
            onClick={() => setShowCustomerSearch(true)}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black sm:hidden"
            style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}`, color: "white" }}
          >
            <Search className="h-4 w-4" />
            Sök kund
          </button>
        </div>
      </header>

      {/* Subtle grid bg behind content */}
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={AX_GRID_BG as any}
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
            {active === "arrivals" && <DeskArrivals venueId={venueId} onScan={() => setShowScanner(true)} />}
            {active === "today" && <DeskToday venueId={venueId} onOpenBooking={openBookingFromRow} />}
            {active === "live" && <DeskLive venueId={venueId} />}
            {active === "queue" && <DeskQueue venueId={venueId} onOpenBooking={openBookingFromRow} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showCustomerSearch && venueId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCustomerSearch(false)}
              className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-[81] mx-auto flex max-h-[92vh] max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#101524] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: ax("muted") }}>Desk</p>
                  <h2 className="text-xl font-black text-white">Sök kund</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomerSearch(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                  aria-label="Stäng kundsök"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-4">
                <CustomersScreen venueId={venueId} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScanner && venueId && (
          <QrScanner
            venueId={venueId}
            onClose={() => setShowScanner(false)}
            onCheckedIn={() => {
              queryClient.invalidateQueries({ queryKey: ["desk-checkins-today", venueId] });
            }}
          />
        )}
      </AnimatePresence>

      <OperationsBookingDrawer
        open={!!openBooking}
        booking={openBooking}
        onClose={() => setOpenBooking(null)}
      />
    </div>
  );
};

export default Index;
