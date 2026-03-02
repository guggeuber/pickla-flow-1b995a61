import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Building2, Users, LayoutGrid, Clock, Tag, Link2, Loader2, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAdminCheck, useAdminVenue } from "@/hooks/useAdmin";
import AdminStaff from "@/components/admin/AdminStaff";
import AdminCourts from "@/components/admin/AdminCourts";
import AdminHours from "@/components/admin/AdminHours";
import AdminPricing from "@/components/admin/AdminPricing";
import AdminLinks from "@/components/admin/AdminLinks";
import AdminVenue from "@/components/admin/AdminVenue";

const tabs = [
  { id: "venue", label: "Venue", icon: Building2 },
  { id: "staff", label: "Staff", icon: Users },
  { id: "courts", label: "Banor", icon: LayoutGrid },
  { id: "hours", label: "Tider", icon: Clock },
  { id: "pricing", label: "Priser", icon: Tag },
  { id: "links", label: "Länkar", icon: Link2 },
] as const;

type TabId = (typeof tabs)[number]["id"];

const AdminPage = () => {
  const navigate = useNavigate();
  const { data: adminData, isLoading, isError } = useAdminCheck();
  const [activeTab, setActiveTab] = useState<TabId>("venue");
  const venueId = adminData?.venueId;

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
          Du behöver vara venue admin för att komma åt admin-panelen.
        </p>
        <button onClick={() => navigate("/")} className="text-sm text-primary font-semibold hover:underline">
          ← Tillbaka till Desk
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-2" style={{ background: "hsl(var(--background))" }}>
        <div className="flex items-center gap-3 mb-3">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => navigate("/")} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--surface-1))" }}>
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </motion.button>
          <h1 className="text-xl font-display font-bold tracking-tight">Admin</h1>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={activeTab !== tab.id ? { background: "hsl(var(--surface-1))" } : undefined}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-8 pt-3">
        {activeTab === "venue" && <AdminVenue venueId={venueId} />}
        {activeTab === "staff" && <AdminStaff venueId={venueId} />}
        {activeTab === "courts" && <AdminCourts venueId={venueId} />}
        {activeTab === "hours" && <AdminHours venueId={venueId} />}
        {activeTab === "pricing" && <AdminPricing venueId={venueId} />}
        {activeTab === "links" && <AdminLinks venueId={venueId} />}
      </div>
    </div>
  );
};

export default AdminPage;
