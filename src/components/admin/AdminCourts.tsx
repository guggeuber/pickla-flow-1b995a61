import { useState } from "react";
import { useAdminCourts, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

const AdminCourts = ({ venueId }: { venueId: string }) => {
  const { data: courts, isLoading } = useAdminCourts(venueId);
  const { addCourt, updateCourt } = useAdminMutation(venueId);
  const [name, setName] = useState("");
  const [courtNumber, setCourtNumber] = useState("");
  const [courtType, setCourtType] = useState("indoor");
  const [hourlyRate, setHourlyRate] = useState("");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!name || !courtNumber) return;
    addCourt.mutate({
      name,
      court_number: parseInt(courtNumber),
      court_type: courtType,
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : undefined,
    }, {
      onSuccess: () => { toast.success("Bana tillagd!"); setName(""); setCourtNumber(""); setHourlyRate(""); },
      onError: (e) => toast.error(e.message),
    });
  };

  const toggleAvailability = (court: any) => {
    updateCourt.mutate({ courtId: court.id, is_available: !court.is_available }, {
      onSuccess: () => toast.success(court.is_available ? "Avstängd" : "Aktiverad"),
    });
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny bana</p>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Namn (t.ex. Bana 1)" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Nr" type="number" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={courtNumber} onChange={(e) => setCourtNumber(e.target.value)} />
          <select value={courtType} onChange={(e) => setCourtType(e.target.value)} className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
          </select>
          <input placeholder="Pris/h (kr)" type="number" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
        </div>
        <button onClick={handleAdd} disabled={addCourt.isPending} className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50">
          {addCourt.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till bana
        </button>
      </div>

      {/* Court list */}
      <div className="grid grid-cols-2 gap-2">
        {(courts || []).map((court: any) => (
          <button key={court.id} onClick={() => toggleAvailability(court)} className={`rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${court.is_available ? "court-free" : "court-active"}`}>
            <LayoutGrid className="w-5 h-5" />
            <span className="text-sm font-bold">{court.name}</span>
            <span className="text-[10px] opacity-70">{court.court_type} · {court.hourly_rate || "–"} kr/h</span>
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${court.is_available ? "bg-court-free/20" : "bg-court-active/20"}`}>
              {court.is_available ? "Tillgänglig" : "Avstängd"}
            </span>
          </button>
        ))}
      </div>
      {(!courts || courts.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-6">Inga banor konfigurerade</p>
      )}
    </div>
  );
};

export default AdminCourts;
