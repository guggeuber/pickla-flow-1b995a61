import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Building2, Users, LayoutGrid, Clock, Tag, Link2,
  Loader2, ShieldAlert, ChevronDown, TrendingUp, TrendingDown, Minus,
  Ticket, CalendarCheck, ChevronRight, Plus, Camera, Trophy, Crown, FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminCheck, useAdminVenues, useAdminStats, useAdminHistory } from "@/hooks/useAdmin";
import { useAdminMutation } from "@/hooks/useAdmin";
import AdminStaff from "@/components/admin/AdminStaff";
import AdminCourts from "@/components/admin/AdminCourts";
import AdminHours from "@/components/admin/AdminHours";
import AdminPricing from "@/components/admin/AdminPricing";
import AdminLinks from "@/components/admin/AdminLinks";
import AdminVenue from "@/components/admin/AdminVenue";
import AdminStories from "@/components/admin/AdminStories";
import AdminEvents from "@/components/admin/AdminEvents";
import AdminMemberships from "@/components/admin/AdminMemberships";
import AdminTemplates from "@/components/admin/AdminTemplates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type SectionId = "venue" | "staff" | "courts" | "hours" | "pricing" | "links" | "stories" | "events" | "memberships" | "templates" | null;

/* ── Sparkline SVG ── */
function Sparkline({ data, color = "hsl(var(--primary))" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 80, h = 24, pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className="block mx-auto mt-1" viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={points[points.length - 1].split(",")[0]} cy={points[points.length - 1].split(",")[1]} r="2" fill={color} />
    </svg>
  );
}

function TrendBadge({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (previous === 0 && current === 0) return null;
  const diff = previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  if (diff === 0) return (
    <span className="inline-flex items-center gap-0.5 text-[8px] text-muted-foreground">
      <Minus className="w-2.5 h-2.5" /> {label}
    </span>
  );
  const isUp = diff > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[8px] font-semibold ${isUp ? "text-court-free" : "text-destructive"}`}>
      {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {isUp ? "+" : ""}{diff}% {label}
    </span>
  );
}

function MetricCell({ value, label, icon, prevValue, weekValue, currentValue, sparkData, sparkColor }: {
  value: string; label: string; icon?: React.ReactNode;
  prevValue?: number; weekValue?: number; currentValue?: number;
  sparkData?: number[]; sparkColor?: string;
}) {
  const cur = currentValue ?? 0;
  const prev = prevValue ?? 0;
  const week = weekValue ?? 0;
  return (
    <div className="text-center space-y-1">
      <div className="flex items-center justify-center gap-1">
        {icon}
        <p className="text-2xl font-display font-black text-foreground">{value}</p>
      </div>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
      {sparkData && <Sparkline data={sparkData} color={sparkColor} />}
      <div className="flex flex-col items-center gap-0.5">
        <TrendBadge current={cur} previous={prev} label="igår" />
        <TrendBadge current={cur} previous={week} label="v." />
      </div>
    </div>
  );
}

/* ── Create Venue Dialog ── */
function CreateVenueDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const { createVenue } = useAdminMutation(undefined);

  const handleCreate = () => {
    if (!name.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    createVenue.mutate({ name: name.trim(), slug, city: city.trim() || undefined }, {
      onSuccess: (data: any) => {
        toast.success(`${data.name} skapad!`);
        setOpen(false);
        setName("");
        setCity("");
        onCreated(data.id);
      },
      onError: (err: any) => toast.error(err.message),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <motion.button
          whileTap={{ scale: 0.95 }}
          className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5 border-t border-border"
        >
          <Plus className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Skapa ny venue</span>
        </motion.button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skapa ny venue</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input placeholder="Venue-namn *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Stad (valfritt)" value={city} onChange={(e) => setCity(e.target.value)} />
          <Button onClick={handleCreate} disabled={!name.trim() || createVenue.isPending} className="w-full">
            {createVenue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skapa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const AdminPage = () => {
  const navigate = useNavigate();
  const { data: adminData, isLoading, isError } = useAdminCheck();
  const { data: venues } = useAdminVenues();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(null);

  const venueId = selectedVenueId || adminData?.venueId;
  const { data: stats } = useAdminStats(venueId);
  const { data: history } = useAdminHistory(venueId);

  const currentVenue = (venues || []).find((v: any) => v.id === venueId);

  // Extract sparkline data from history
  const revenueSparkData = history?.map((d) => d.revenue) || [];
  const bookingsSparkData = history?.map((d) => d.bookings) || [];
  const passesSparkData = history?.map((d) => d.passes) || [];

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
      stories: { label: "Stories", icon: Camera },
      events: { label: "Events", icon: Trophy },
      memberships: { label: "Medlemskap", icon: Crown },
      templates: { label: "Event-mallar", icon: FileText },
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
          {activeSection === "stories" && <AdminStories venueId={venueId} />}
          {activeSection === "events" && <AdminEvents venueId={venueId} />}
          {activeSection === "memberships" && <AdminMemberships venueId={venueId} />}
          {activeSection === "templates" && <AdminTemplates />}
        </div>
      </div>
    );
  }

  const actionCards = [
    { id: "courts" as SectionId, icon: LayoutGrid, label: "Banor", stat: `${stats?.totalCourts || 0} banor`, color: "var(--court-free)" },
    { id: "pricing" as SectionId, icon: Tag, label: "Priser", stat: `${stats?.pricingRules || 0} aktiva regler`, color: "var(--sell)" },
    { id: "staff" as SectionId, icon: Users, label: "Personal", stat: `${stats?.activeStaff || 0} aktiva`, color: "var(--primary)" },
    { id: "hours" as SectionId, icon: Clock, label: "Öppettider", stat: "Veckoschema", color: "var(--badge-unpaid)" },
    { id: "links" as SectionId, icon: Link2, label: "Länkar", stat: `${stats?.linksCount || 0} aktiva`, color: "var(--badge-vip)" },
    { id: "venue" as SectionId, icon: Building2, label: "Venue", stat: "Inställningar", color: "var(--muted-foreground)" },
    { id: "stories" as SectionId, icon: Camera, label: "Stories", stat: "Community", color: "var(--primary)" },
    { id: "events" as SectionId, icon: Trophy, label: "Events", stat: "Turneringar", color: "var(--sell)" },
    { id: "memberships" as SectionId, icon: Crown, label: "Medlemskap", stat: "Nivåer & rabatter", color: "var(--badge-vip)" },
    ...(adminData?.isSuperAdmin ? [{ id: "templates" as SectionId, icon: FileText, label: "Event-mallar", stat: "Franchise", color: "var(--primary)" }] : []),
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
                style={{ background: `hsl(var(--primary) / 0.15)` }}
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
              {showVenuePicker && (
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
                  {/* Create venue button for super_admin */}
                  {adminData?.isSuperAdmin && (
                    <CreateVenueDialog onCreated={(id) => { setSelectedVenueId(id); setShowVenuePicker(false); }} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Revenue Hero */}
        <div className="revenue-hero rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Idag · 7 dagars trend</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MetricCell
              value={stats?.todayRevenue?.toLocaleString("sv-SE") || "0"}
              label="SEK Revenue"
              prevValue={stats?.yesterdayRevenue}
              weekValue={stats?.lastWeekRevenue}
              currentValue={stats?.todayRevenue}
              sparkData={revenueSparkData}
              sparkColor="hsl(var(--primary))"
            />
            <MetricCell
              value={String(stats?.bookingsToday || 0)}
              label="Bokningar"
              icon={<CalendarCheck className="w-4 h-4 text-court-free" />}
              prevValue={stats?.yesterdayBookings}
              weekValue={stats?.lastWeekBookings}
              currentValue={stats?.bookingsToday}
              sparkData={bookingsSparkData}
              sparkColor="hsl(var(--court-free))"
            />
            <MetricCell
              value={String(stats?.activePasses || 0)}
              label="Dagspass"
              icon={<Ticket className="w-4 h-4 text-sell" />}
              prevValue={stats?.yesterdayPasses}
              weekValue={stats?.lastWeekPasses}
              currentValue={stats?.activePasses}
              sparkData={passesSparkData}
              sparkColor="hsl(var(--sell))"
            />
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
