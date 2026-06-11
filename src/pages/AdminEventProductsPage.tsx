import { ArrowLeft, Package2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAdminCheck, useAdminVenues } from "@/hooks/useAdmin";
import AdminEventProducts from "@/components/admin/AdminEventProducts";

export default function AdminEventProductsPage() {
  const navigate = useNavigate();
  const { data: adminData, isLoading } = useAdminCheck();
  const { data: venues } = useAdminVenues();
  const venueId = adminData?.venueId || venues?.[0]?.id;
  const venue = (venues || []).find((v: any) => v.id === venueId);

  if (isLoading) {
    return <div className="min-h-screen bg-background grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto">
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3" style={{ background: "hsl(var(--background))" }}>
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate("/hub/admin")}
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--surface-1))" }}
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </motion.button>
          <Package2 className="w-4 h-4 text-primary" />
          <div>
            <h1 className="text-lg font-display font-bold tracking-tight">Event Products</h1>
            <p className="text-[10px] text-muted-foreground">{venue?.name || "Pickla"} · Paket, resurser & add-ons</p>
          </div>
        </div>
      </div>
      <div className="px-4 pb-8 pt-1">
        {venueId ? <AdminEventProducts venueId={venueId} /> : <p className="text-sm text-muted-foreground">Välj venue först</p>}
      </div>
    </div>
  );
}
