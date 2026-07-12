import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Ban,
  Building2,
  Calendar,
  Camera,
  CalendarCheck,
  ChevronDown,
  Clock,
  Crown,
  FileText,
  Gauge,
  Home,
  LayoutGrid,
  Link2,
  Loader2,
  MessageSquare,
  Package,
  Plus,
  ReceiptText,
  Settings,
  ShieldAlert,
  Sparkles,
  TabletSmartphone,
  Tag,
  Trophy,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useAdminCheck,
  useAdminVenues,
  useAdminMutation,
} from "@/hooks/useAdmin";
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
import AdminCorporate from "@/components/admin/AdminCorporate";
import AdminChannels from "@/components/admin/AdminChannels";
import AdminProducts from "@/components/admin/AdminProducts";
import AdminSchedule from "@/components/admin/AdminSchedule";
import AdminDevices from "@/components/admin/AdminDevices";
import AdminEventLeads from "@/components/admin/AdminEventLeads";
import AdminEventProducts from "@/components/admin/AdminEventProducts";
import AdminResourceBlocks from "@/components/admin/AdminResourceBlocks";
import AdminVenueOperations from "@/components/admin/AdminVenueOperations";
import AdminRevenueLedger from "@/components/admin/AdminRevenueLedger";
import AdminFinancialMaintenance from "@/components/admin/AdminFinancialMaintenance";
import CustomersScreen from "@/screens/CustomersScreen";
import AdminTopNav, { AdminSurfaceDef, AdminSurfaceId } from "@/components/admin/shell/AdminTopNav";
import AdminToday from "@/components/admin/shell/AdminToday";
import AdminCalendar from "@/components/admin/shell/AdminCalendar";
import AdminSettings from "@/components/admin/shell/AdminSettings";
import AdminSoon from "@/components/admin/shell/AdminSoon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ── Surfaces ── */
const SURFACES: AdminSurfaceDef[] = [
  { id: "today", label: "Today", icon: Home, hint: "Live ops + attention" },
  { id: "calendar", label: "Calendar", icon: Calendar, hint: "Hela huset i tid" },
  { id: "pipeline", label: "Pipeline", icon: Workflow, hint: "Leads → levererat" },
  { id: "capacity", label: "Capacity", icon: Gauge, hint: "Occupancy & konflikter" },
  { id: "people", label: "People", icon: Users, hint: "Kunder, medlemmar, företag" },
  { id: "catalog", label: "Catalog", icon: Package, hint: "Produkter, priser, schema" },
  { id: "settings", label: "Settings", icon: Settings, hint: "Alla moduler" },
];

/* ── Create Venue Dialog ── */
function CreateVenueDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const { createVenue } = useAdminMutation(undefined);

  const handleCreate = () => {
    if (!name.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    createVenue.mutate(
      { name: name.trim(), slug, city: city.trim() || undefined },
      {
        onSuccess: (data: any) => {
          toast.success(`${data.name} skapad!`);
          setOpen(false);
          setName("");
          setCity("");
          onCreated(data.id);
        },
        onError: (err: any) => toast.error(err.message),
      },
    );
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

/* ── Settings module detail (renders existing 19 admin modules) ── */
const sectionLabels: Record<string, { label: string; icon: any }> = {
  venue: { label: "Venue Settings", icon: Building2 },
  staff: { label: "Personal", icon: Users },
  courts: { label: "Banor", icon: LayoutGrid },
  devices: { label: "Paddor", icon: TabletSmartphone },
  hours: { label: "Öppettider", icon: Clock },
  pricing: { label: "Priser", icon: Tag },
  products: { label: "Produkter", icon: Package },
  schedule: { label: "Schema", icon: CalendarCheck },
  links: { label: "Länkar", icon: Link2 },
  stories: { label: "Stories", icon: Camera },
  events: { label: "Events", icon: Trophy },
  eventLeads: { label: "Event Leads", icon: MessageSquare },
  eventProducts: { label: "Event Products", icon: Package },
  resourceBlocks: { label: "Blockeringar", icon: Ban },
  operations: { label: "Drift", icon: ShieldAlert },
  revenueLedger: { label: "Revenue Ledger", icon: ReceiptText },
  financialMaintenance: { label: "Financial Maintenance", icon: Wrench },
  memberships: { label: "Medlemskap", icon: Crown },
  templates: { label: "Event-mallar", icon: FileText },
  corporate: { label: "Företag", icon: Building2 },
  channels: { label: "Chat Channels", icon: MessageSquare },
};

function ModuleDetail({ id, venueId, onBack }: { id: string; venueId: string | undefined; onBack: () => void }) {
  const s = sectionLabels[id];
  if (!s) return null;
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto">
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: "hsl(var(--background))" }}>
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
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
        {!venueId ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Välj en venue först</p>
          </div>
        ) : (
          <>
            {id === "venue" && <AdminVenue venueId={venueId} />}
            {id === "staff" && <AdminStaff venueId={venueId} />}
            {id === "courts" && <AdminCourts venueId={venueId} />}
            {id === "devices" && <AdminDevices venueId={venueId} />}
            {id === "hours" && <AdminHours venueId={venueId} />}
            {id === "pricing" && <AdminPricing venueId={venueId} />}
            {id === "products" && <AdminProducts venueId={venueId} />}
            {id === "schedule" && <AdminSchedule venueId={venueId} />}
            {id === "links" && <AdminLinks venueId={venueId} />}
            {id === "stories" && <AdminStories venueId={venueId} />}
            {id === "events" && <AdminEvents venueId={venueId} />}
            {id === "eventLeads" && <AdminEventLeads venueId={venueId} />}
            {id === "eventProducts" && <AdminEventProducts venueId={venueId} />}
            {id === "resourceBlocks" && <AdminResourceBlocks venueId={venueId} />}
            {id === "operations" && <AdminVenueOperations venueId={venueId} />}
            {id === "revenueLedger" && <AdminRevenueLedger venueId={venueId} />}
            {id === "financialMaintenance" && <AdminFinancialMaintenance venueId={venueId} />}
            {id === "memberships" && <AdminMemberships venueId={venueId} />}
            {id === "templates" && <AdminTemplates />}
            {id === "corporate" && <AdminCorporate venueId={venueId} />}
            {id === "channels" && <AdminChannels venueId={venueId} />}
          </>
        )}
      </div>
    </div>
  );
}

const AdminPage = ({ initialModule = null }: { initialModule?: string | null }) => {
  const navigate = useNavigate();
  const { data: adminDataRaw, isLoading, isError } = useAdminCheck();
  const { data: venuesRaw } = useAdminVenues();
  const adminData = adminDataRaw as any;
  const venues = (venuesRaw as any[]) || [];

  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [active, setActive] = useState<AdminSurfaceId>("today");
  const [openModule, setOpenModule] = useState<string | null>(initialModule);

  const venueId = selectedVenueId || adminData?.venueId;
  const currentVenue = venues.find((v: any) => v.id === venueId);

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

  if (openModule) {
    return <ModuleDetail id={openModule} venueId={venueId} onBack={() => {
      if (initialModule) navigate("/hub/admin");
      else setOpenModule(null);
    }} />;
  }

  const openSettingsModule = (id: string) => {
    if (id === "products") navigate("/hub/admin/products");
    else setOpenModule(id);
  };

  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-2" style={{ background: "hsl(var(--background))" }}>
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate("/")}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--surface-1))" }}
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Admin OS</p>
            <p className="text-sm font-display font-bold text-foreground truncate">{currentVenue?.name || "Pickla"}</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowVenuePicker((v) => !v)}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--surface-1))" }}
          >
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </motion.button>
        </div>

        {/* Venue picker dropdown */}
        <AnimatePresence>
          {showVenuePicker && venues.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              className="mt-2 rounded-2xl overflow-hidden"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            >
              {venues.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVenueId(v.id);
                    setShowVenuePicker(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 ${
                    v.id === venueId ? "bg-primary/10" : ""
                  }`}
                >
                  <Building2 className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{v.name}</p>
                    <p className="text-[10px] text-muted-foreground">{v.city}</p>
                  </div>
                </button>
              ))}
              {adminData?.isSuperAdmin && (
                <CreateVenueDialog
                  onCreated={(id) => {
                    setSelectedVenueId(id);
                    setShowVenuePicker(false);
                  }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-3">
          <AdminTopNav surfaces={SURFACES} active={active} onChange={setActive} />
        </div>
      </div>

      <div className="px-4 pt-4 pb-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {active === "today" && (
              <AdminToday venueId={venueId} venueName={currentVenue?.name} onOpenSettings={openSettingsModule} />
            )}
            {active === "calendar" && (
              <AdminCalendar venueId={venueId} onOpenModule={openSettingsModule} />
            )}
            {active === "pipeline" && (
              <AdminSoon
                icon={Workflow}
                phase="Phase 3"
                title="Pipeline"
                tagline="Lead → tentativ → bokat → klart → körd. Inga prospekt som tappas."
                bullets={[
                  { title: "Kanban-vy", desc: "Drag mellan stages, SLA-färger på äldre leads, ägare per lead." },
                  { title: "Lead-drawer", desc: "Kund, kommunikationshistorik, kalenderlucka och readiness-checklist." },
                  { title: "Auto-attention", desc: "Hot leads och tysta tråder bubblar upp till Today." },
                ]}
              />
            )}
            {active === "capacity" && (
              <AdminSoon
                icon={Gauge}
                phase="Phase 4"
                title="Capacity"
                tagline="Vad säljer? Vad är tomt? Var krockar saker?"
                bullets={[
                  { title: "Heatmap", desc: "Timme × dag, per sport / resurs. Fill rate i siffror." },
                  { title: "Konfliktlista", desc: "Överbokningar, dubbletter, drift som krockar med events." },
                  { title: "Revenue overlay", desc: "Read-only intäkt per tidsblock — beslutsstöd, ingen edit." },
                ]}
              />
            )}
            {active === "people" && (
              <CustomersScreen venueId={venueId} />
            )}
            {active === "catalog" && (
              <AdminSoon
                icon={Package}
                phase="Phase 6"
                title="Catalog"
                tagline="Produkter, priser, medlemskap och schema — på samma yta."
                bullets={[
                  { title: "En produktsida", desc: "Produkter, eventutbud och medlemskap samlade på en tydlig yta." },
                  { title: "Pris-koppling", desc: "Dynamiska prisregler visas direkt på produkten de styr." },
                  { title: "Schema bredvid", desc: "Activity sessions och series länkade till sin produkt." },
                ]}
              />
            )}
            {active === "settings" && (
              <AdminSettings onOpen={openSettingsModule} isSuperAdmin={!!adminData?.isSuperAdmin} />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/50">
          <Sparkles className="w-3 h-3" />
          <span>Admin OS · Phase 0–1 design</span>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
