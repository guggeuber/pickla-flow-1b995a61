import { useState, useMemo } from "react";
import { useAdminCourts, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, LayoutGrid, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

const SPORT_TYPES = ["pickleball", "darts", "padel"] as const;

const SPORT_EMOJI: Record<string, string> = {
  pickleball: "🏓",
  darts: "🎯",
  padel: "🎾",
};

const AdminCourts = ({ venueId }: { venueId: string }) => {
  const { data: courts, isLoading } = useAdminCourts(venueId);
  const { addCourt, updateCourt } = useAdminMutation(venueId);
  const [name, setName] = useState("");
  const [courtType, setCourtType] = useState("indoor");
  const [sportType, setSportType] = useState("pickleball");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editSportType, setEditSportType] = useState("pickleball");

  // Auto-calculate next court number for selected sport
  const nextCourtNumber = useMemo(() => {
    if (!courts) return 1;
    const sameTypeCourts = (courts as any[]).filter((c: any) => c.sport_type === sportType);
    if (sameTypeCourts.length === 0) return 1;
    const maxNum = Math.max(...sameTypeCourts.map((c: any) => c.court_number || 0));
    return maxNum + 1;
  }, [courts, sportType]);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    const courtName = name.trim() || `${sportType.charAt(0).toUpperCase() + sportType.slice(1)} ${nextCourtNumber}`;
    addCourt.mutate(
      { name: courtName, court_number: nextCourtNumber, court_type: courtType, sport_type: sportType },
      {
        onSuccess: () => {
          toast.success("Court added!");
          setName("");
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const toggleAvailability = (court: any) => {
    updateCourt.mutate(
      { courtId: court.id, is_available: !court.is_available },
      { onSuccess: () => toast.success(court.is_available ? "Disabled" : "Enabled") }
    );
  };

  const startEdit = (court: any) => {
    setEditingId(court.id);
    setEditName(court.name);
    setEditType(court.court_type || "indoor");
    setEditSportType(court.sport_type || "pickleball");
  };

  const saveEdit = (courtId: string) => {
    updateCourt.mutate(
      { courtId, name: editName, court_type: editType, sport_type: editSportType },
      {
        onSuccess: () => {
          toast.success("Updated");
          setEditingId(null);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  // Group courts by sport type
  const groupedCourts = useMemo(() => {
    const groups: Record<string, any[]> = {};
    (courts || []).forEach((c: any) => {
      const sport = c.sport_type || "pickleball";
      if (!groups[sport]) groups[sport] = [];
      groups[sport].push(c);
    });
    return groups;
  }, [courts]);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">New Court</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={sportType}
            onChange={(e) => setSportType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {SPORT_TYPES.map(s => <option key={s} value={s}>{SPORT_EMOJI[s]} {s}</option>)}
          </select>
          <select
            value={courtType}
            onChange={(e) => setCourtType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </div>
        <input
          placeholder={`Name (default: ${sportType.charAt(0).toUpperCase() + sportType.slice(1)} ${nextCourtNumber})`}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Court #{nextCourtNumber} · Pricing is controlled via Pricing Rules
        </p>
        <button
          onClick={handleAdd}
          disabled={addCourt.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addCourt.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Court
        </button>
      </div>

      {/* Court list grouped by sport */}
      {Object.entries(groupedCourts).map(([sport, sportCourts]) => (
        <div key={sport}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-1">
            {SPORT_EMOJI[sport] || "🏟"} {sport} ({sportCourts.length})
          </p>
          <div className="grid grid-cols-2 gap-2">
            {sportCourts.map((court: any) => (
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
                    <select
                      value={editSportType}
                      onChange={(e) => setEditSportType(e.target.value)}
                      className="w-full text-center rounded-lg px-2 py-1 text-[11px] outline-none bg-white/80 text-neutral-900 capitalize"
                    >
                      {SPORT_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
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
                    <span className="text-lg">{SPORT_EMOJI[court.sport_type] || "🏟"}</span>
                    <span className="text-sm font-bold">{court.name}</span>
                    <span className="text-[10px] opacity-70">{court.court_type}</span>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        onClick={() => toggleAvailability(court)}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                          court.is_available ? "bg-court-free/20" : "bg-court-active/20"
                        }`}
                      >
                        {court.is_available ? "Available" : "Disabled"}
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
        </div>
      ))}

      {(!courts || (courts as any[]).length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-6">No courts configured</p>
      )}
    </div>
  );
};

export default AdminCourts;
