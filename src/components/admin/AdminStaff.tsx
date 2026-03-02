import { useState } from "react";
import { useAdminStaff, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, UserMinus, Shield } from "lucide-react";
import { toast } from "sonner";

const roleLabels: Record<string, string> = {
  venue_admin: "Admin",
  desk_staff: "Desk",
  customer: "Kund",
  super_admin: "Super",
};

const AdminStaff = ({ venueId }: { venueId: string }) => {
  const { data: staff, isLoading } = useAdminStaff(venueId);
  const { addStaff, updateStaff } = useAdminMutation(venueId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("desk_staff");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!email) return;
    addStaff.mutate({ email, role }, {
      onSuccess: () => { toast.success("Personal tillagd!"); setEmail(""); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleToggle = (s: any) => {
    updateStaff.mutate({ staffId: s.id, isActive: !s.is_active }, {
      onSuccess: () => toast.success(s.is_active ? "Inaktiverad" : "Aktiverad"),
    });
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Lägg till personal</p>
        <input
          placeholder="E-post (måste vara registrerad)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="flex gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="desk_staff">Desk Staff</option>
            <option value="venue_admin">Venue Admin</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={addStaff.isPending}
            className="flex items-center gap-1.5 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
          >
            {addStaff.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Lägg till
          </button>
        </div>
      </div>

      {/* Staff list */}
      <div className="space-y-1.5">
        {(staff || []).map((s: any) => (
          <div key={s.id} className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{s.display_name}</p>
              <p className="text-[10px] text-muted-foreground">{s.phone || "–"}</p>
            </div>
            <span className={`text-[9px] px-2 py-1 rounded-full font-bold uppercase ${
              s.role === "venue_admin" ? "bg-badge-vip/15 text-badge-vip" : "bg-primary/10 text-primary"
            }`}>
              {roleLabels[s.role] || s.role}
            </span>
            <button
              onClick={() => handleToggle(s)}
              className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                s.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"
              }`}
            >
              {s.is_active ? "Aktiv" : "Inaktiv"}
            </button>
          </div>
        ))}
        {(!staff || staff.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Ingen personal tillagd ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminStaff;
