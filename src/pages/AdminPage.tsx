import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Building2, Users, LayoutGrid, Clock, Tag, Link2,
  Loader2, ShieldAlert, ChevronDown, TrendingUp, Ticket, DollarSign,
  CalendarCheck, ChevronRight, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminCheck, useAdminVenues, useAdminStats } from "@/hooks/useAdmin";
import AdminStaff from "@/components/admin/AdminStaff";
import AdminCourts from "@/components/admin/AdminCourts";
import AdminHours from "@/components/admin/AdminHours";
import AdminPricing from "@/components/admin/AdminPricing";
import AdminLinks from "@/components/admin/AdminLinks";
import AdminVenue from "@/components/admin/AdminVenue";

type SectionId = "venue" | "staff" | "courts" | "hours" | "pricing" | "links" | null;

const AdminPage = () => {
  const navigate = useNavigate();
  const { data: adminData, isLoading, isError } = useAdminCheck();
  const { data: venues } = useAdminVenues();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(null);

  const venueId = selectedVenueId || adminData?.venueId;
  const { data: stats } = useAdminStats(venueId);

  const currentVenue = (venues || []).find((v: any) => v.id === venueId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !adminData?.isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-14 h-14 rounded-2xl bg-destructive/15 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="text-xl font-display font-bold text-foreground">Ingen access</h1>
        <p className="text-sm text-muted-foreground text-center">
          Du behöver vara venue admin för att komma åt cockpiten.
        </p>
        <button onClick={() => navigate("/")} className="text-sm text-primary font-semibold hover:underline">
          ← Tillbaka till Desk
        </button>
      </div>
    );
  }

  // Section detail view
  if (activeSection) {
    const sectionLabels: Record<string, { label: string; icon: any }> = {
      venue: { label: "Venue Settings", icon: Building2 },
      staff: { label: "Personal", icon: Users },
      courts: { label: "Banor", icon: LayoutGrid },
      hours: { label: "Öppettider", icon: Clock },
      pricing: { label: "Priser", icon: Tag },
      links: { label: "Länkar", icon: Link2 },
    };
    const s = sectionLabels[activeSection];

    return (
      <div className="min-h-screen bg-background max-w-2xl mx-auto">
        <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: "hsl(var(--background))" }}>
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setActiveSection(null)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--surface-1))" }}
            >
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </motion.button>
            <s.icon className="w-4 h-4 text-primary" />
            <h1 className="text-lg font-display font-bold tracking-tight">{s.label}</h1>
          </div>
        </div>
        <div className="px-4 pb-8 pt-1">
          {activeSection === "venue" && <AdminVenue venueId={venueId} />}
          {activeSection === "staff" && <AdminStaff venueId={venueId} />}
          {activeSection === "courts" && <AdminCourts venueId={venueId} />}
          {activeSection === "hours" && <AdminHours venueId={venueId} />}
          {activeSection === "pricing" && <AdminPricing venueId={venueId} />}
          {activeSection === "links" && <AdminLinks venueId={venueId} />}
        </div>
      </div>
    );
  }

  const actionCards = [
    {
      id: "courts" as SectionId,
      icon: LayoutGrid,
      label: "Banor",
      stat: `${stats?.totalCourts || 0} banor`,
      color: "var(--court-free)",
    },
    {
      id: "pricing" as SectionId,
      icon: Tag,
      label: "Priser",
      stat: `${stats?.pricingRules || 0} aktiva regler`,
      color: "var(--sell)",
    },
    {
      id: "staff" as SectionId,
      icon: Users,
      label: "Personal",
      stat: `${stats?.activeStaff || 0} aktiva`,
      color: "var(--primary)",
    },
    {
      id: "hours" as SectionId,
      icon: Clock,
      label: "Öppettider",
      stat: "Veckoschema",
      color: "var(--badge-unpaid)",
    },
    {
      id: "links" as SectionId,
      icon: Link2,
      label: "Länkar",
      stat: `${stats?.linksCount || 0} aktiva`,
      color: "var(--badge-vip)",
    },
    {
      id: "venue" as SectionId,
      icon: Building2,
      label: "Venue",
      stat: "Inställningar",
      color: "var(--muted-foreground)",
    },
  ];

  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: "hsl(var(--background))" }}>
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate("/")}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--surface-1))" }}
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </motion.button>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Revenue Cockpit</p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-4">
        {/* Venue Picker */}
        {venues && venues.length > 0 && (
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowVenuePicker(!showVenuePicker)}
              className="w-full glass-card rounded-2xl p-4 flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: `hsl(${currentVenue?.primary_color ? "24 85% 52%" : "var(--primary)"} / 0.15)`,
                }}
              >
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-foreground">
                  {currentVenue?.name || "Välj venue"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {currentVenue?.city || "–"} · {currentVenue?.status || "–"}
                </p>
              </div>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showVenuePicker ? "rotate-180" : ""}`} />
            </motion.button>

            <AnimatePresence>
              {showVenuePicker && venues.length > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  className="absolute top-full left-0 right-0 z-30 mt-1 rounded-2xl overflow-hidden"
                  style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                >
                  {venues.map((v: any) => (
                    <button
                      key={v.id}
                      onClick={() => { setSelectedVenueId(v.id); setShowVenuePicker(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5 ${v.id === venueId ? "bg-primary/10" : ""}`}
                    >
                      <Building2 className="w-4 h-4 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">{v.name}</p>
                        <p className="text-[10px] text-muted-foreground">{v.city}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Revenue Hero */}
        <div className="revenue-hero rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Idag</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-2xl font-display font-black text-foreground animate-count-up">
                {stats?.todayRevenue?.toLocaleString("sv-SE") || "0"}
              </p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">SEK Revenue</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <CalendarCheck className="w-4 h-4 text-court-free" />
                <p className="text-2xl font-display font-black text-foreground animate-count-up">
                  {stats?.bookingsToday || 0}
                </p>
              </div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Bokningar</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <Ticket className="w-4 h-4 text-sell" />
                <p className="text-2xl font-display font-black text-foreground animate-count-up">
                  {stats?.activePasses || 0}
                </p>
              </div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Dagspass</p>
            </div>
          </div>
        </div>

        {/* Action Cards Grid */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-1">Hantera</p>
          <div className="grid grid-cols-2 gap-2">
            {actionCards.map((card) => (
              <motion.button
                key={card.id}
                whileTap={{ scale: 0.95 }}
                onClick={() => setActiveSection(card.id)}
                className="glass-card rounded-2xl p-4 flex flex-col items-start gap-3 text-left transition-all hover:border-primary/20"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `hsl(${card.color} / 0.12)` }}
                >
                  <card.icon className="w-4.5 h-4.5" style={{ color: `hsl(${card.color})` }} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground">{card.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{card.stat}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 self-end" />
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
