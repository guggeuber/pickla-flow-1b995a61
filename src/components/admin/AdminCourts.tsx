import { useState } from "react";
import { useAdminCourts, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, LayoutGrid, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

const SPORT_TYPES = ["pickleball", "darts", "padel"] as const;

const AdminCourts = ({ venueId }: { venueId: string }) => {
  const { data: courts, isLoading } = useAdminCourts(venueId);
  const { addCourt, updateCourt } = useAdminMutation(venueId);
  const [name, setName] = useState("");
  const [courtNumber, setCourtNumber] = useState("");
  const [courtType, setCourtType] = useState("indoor");
  const [sportType, setSportType] = useState("pickleball");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editSportType, setEditSportType] = useState("pickleball");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!name || !courtNumber) return;
    addCourt.mutate(
      { name, court_number: parseInt(courtNumber), court_type: courtType, sport_type: sportType },
      {
        onSuccess: () => {
          toast.success("Court added!");
          setName("");
          setCourtNumber("");
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const toggleAvailability = (court: any) => {
    updateCourt.mutate(
      { courtId: court.id, is_available: !court.is_available },
      { onSuccess: () => toast.success(court.is_available ? "Avstängd" : "Aktiverad") }
    );
  };

  const startEdit = (court: any) => {
    setEditingId(court.id);
    setEditName(court.name);
    setEditType(court.court_type || "indoor");
  };

  const saveEdit = (courtId: string) => {
    updateCourt.mutate(
      { courtId, name: editName, court_type: editType },
      {
        onSuccess: () => {
          toast.success("Uppdaterad");
          setEditingId(null);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny bana</p>
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="Namn (t.ex. Bana 1)"
            className="col-span-2 rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="Nr"
            type="number"
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={courtNumber}
            onChange={(e) => setCourtNumber(e.target.value)}
          />
        </div>
        <select
          value={courtType}
          onChange={(e) => setCourtType(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
        >
          <option value="indoor">Indoor</option>
          <option value="outdoor">Outdoor</option>
        </select>
        <p className="text-[10px] text-muted-foreground">
          Pris styrs av prisregler under Prissättning
        </p>
        <button
          onClick={handleAdd}
          disabled={addCourt.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addCourt.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till bana
        </button>
      </div>

      {/* Court list */}
      <div className="grid grid-cols-2 gap-2">
        {(courts || []).map((court: any) => (
          <div
            key={court.id}
            className={`rounded-2xl p-4 flex flex-col items-center gap-2 transition-all ${
              court.is_available ? "court-free" : "court-active"
            }`}
          >
            {editingId === court.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-center rounded-lg px-2 py-1 text-sm font-bold outline-none bg-white/80 text-neutral-900"
                />
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="w-full text-center rounded-lg px-2 py-1 text-[11px] outline-none bg-white/80 text-neutral-900"
                >
                  <option value="indoor">Indoor</option>
                  <option value="outdoor">Outdoor</option>
                </select>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => saveEdit(court.id)}
                    className="w-7 h-7 rounded-full bg-badge-paid/20 flex items-center justify-center"
                  >
                    <Check className="w-3.5 h-3.5 text-badge-paid" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="w-7 h-7 rounded-full bg-destructive/20 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <LayoutGrid className="w-5 h-5" />
                <span className="text-sm font-bold">{court.name}</span>
                <span className="text-[10px] opacity-70">{court.court_type}</span>
                <div className="flex gap-1.5 mt-1">
                  <button
                    onClick={() => toggleAvailability(court)}
                    className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      court.is_available ? "bg-court-free/20" : "bg-court-active/20"
                    }`}
                  >
                    {court.is_available ? "Tillgänglig" : "Avstängd"}
                  </button>
                  <button
                    onClick={() => startEdit(court)}
                    className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/20"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {(!courts || courts.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-6">Inga banor konfigurerade</p>
      )}
    </div>
  );
};

export default AdminCourts;
