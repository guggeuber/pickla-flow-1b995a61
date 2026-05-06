import { useState } from "react";
import { useAdminPricing, useAdminMutation } from "@/hooks/useAdmin";
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const DAY_LABELS = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SPORT_TYPES = [
  { value: "", label: "Alla sporter" },
  { value: "pickleball", label: "Pickleball" },
  { value: "dart", label: "Dart" },
];
const COURT_TYPES = [
  { value: "", label: "Alla bantyper" },
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "vip", label: "VIP" },
];

const AdminPricing = ({ venueId }: { venueId: string }) => {
  const { data: pricing, isLoading } = useAdminPricing(venueId);
  const { addPricing, updatePricing, deletePricing } = useAdminMutation(venueId);
  const [name, setName] = useState("");
  const [type, setType] = useState("hourly");
  const [price, setPrice] = useState("");
  const [desc, setDesc] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(ALL_DAYS);
  const [timeFrom, setTimeFrom] = useState("06:00");
  const [timeTo, setTimeTo] = useState("23:00");
  const [sportType, setSportType] = useState("");
  const [courtType, setCourtType] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any | null>(null);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleAdd = () => {
    if (!name || !price || daysOfWeek.length === 0) {
      toast.error("Fyll i namn, pris och minst en dag");
      return;
    }
    addPricing.mutate(
      {
        name,
        type,
        price: parseFloat(price),
        description: desc || undefined,
        days_of_week: daysOfWeek,
        time_from: timeFrom,
        time_to: timeTo,
        sport_type: sportType || null,
        court_type: courtType || null,
      },
      {
        onSuccess: () => {
          toast.success("Prisregel tillagd!");
          setName("");
          setPrice("");
          setDesc("");
          setDaysOfWeek(ALL_DAYS);
          setTimeFrom("06:00");
          setTimeTo("23:00");
          setSportType("");
          setCourtType("");
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const toggleActive = (rule: any) => {
    updatePricing.mutate(
      { ruleId: rule.id, is_active: !rule.is_active },
      { onSuccess: () => toast.success(rule.is_active ? "Inaktiverad" : "Aktiverad") }
    );
  };

  const startEdit = (rule: any) => {
    setEditingRuleId(rule.id);
    setEditForm({
      name: rule.name || "",
      type: rule.type || "hourly",
      price: String(rule.price || ""),
      description: rule.description || "",
      days_of_week: rule.days_of_week?.length ? rule.days_of_week : ALL_DAYS,
      time_from: (rule.time_from || "06:00").slice(0, 5),
      time_to: (rule.time_to || "23:00").slice(0, 5),
      sport_type: rule.sport_type || "",
      court_type: rule.court_type || "",
    });
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setEditForm(null);
  };

  const saveEdit = () => {
    if (!editingRuleId || !editForm) return;
    updatePricing.mutate(
      {
        ruleId: editingRuleId,
        name: editForm.name,
        type: editForm.type,
        price: parseFloat(editForm.price),
        description: editForm.description || null,
        days_of_week: editForm.days_of_week,
        time_from: editForm.time_from,
        time_to: editForm.time_to,
        sport_type: editForm.sport_type || null,
        court_type: editForm.court_type || null,
      },
      {
        onSuccess: () => {
          toast.success("Prisregel uppdaterad");
          cancelEdit();
        },
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  const handleDelete = (ruleId: string) => {
    if (!confirm("Ta bort denna prisregel?")) return;
    deletePricing.mutate(ruleId, {
      onSuccess: () => toast.success("Borttagen"),
      onError: (e: any) => toast.error(e.message),
    });
  };

  const formatDays = (days: number[] | null) => {
    if (!days || days.length === 0 || days.length === 7) return "alla dagar";
    return days.map((d) => DAY_LABELS[d]).join(", ");
  };

  const formatTimeRange = (from: string | null, to: string | null) => {
    const f = from || "00:00";
    const t = to || "23:59";
    if (f === "00:00" && (t === "23:59" || t === "23:00")) return "hela dagen";
    return `${f.slice(0, 5)}–${t.slice(0, 5)}`;
  };

  const formatScope = (rule: any) => {
    const sport = SPORT_TYPES.find((s) => s.value === rule.sport_type)?.label;
    const court = COURT_TYPES.find((c) => c.value === rule.court_type)?.label;
    return [sport, court].filter(Boolean).join(" · ") || "Alla banor";
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny prisregel</p>

        <input
          placeholder="Namn (t.ex. Peak Hour)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            <option value="hourly">Per timme</option>
            <option value="day_pass">Dagspass</option>
            <option value="event">Event (per deltagare)</option>
            <option value="guest_pass">Gästpass</option>
            <option value="membership">Medlemskap</option>
            <option value="other">Övrigt</option>
          </select>
          <input
            placeholder="Pris (kr)"
            type="number"
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={sportType}
            onChange={(e) => setSportType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {SPORT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={courtType}
            onChange={(e) => setCourtType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {COURT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* Day picker */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Gäller dagar</p>
          <div className="flex gap-1">
            {ALL_DAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  daysOfWeek.includes(day)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>

        {/* Time range */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Tidsfönster</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
        </div>

        <input
          placeholder="Beskrivning (valfritt)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />

        <button
          onClick={handleAdd}
          disabled={addPricing.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addPricing.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till
        </button>
      </div>

      <div className="space-y-1.5">
        {(pricing || []).map((rule: any) => {
          const isEditing = editingRuleId === rule.id && editForm;

          return (
            <div key={rule.id} className="glass-card rounded-2xl p-4">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      <option value="hourly">Per timme</option>
                      <option value="day_pass">Dagspass</option>
                      <option value="event">Event</option>
                      <option value="guest_pass">Gästpass</option>
                      <option value="membership">Medlemskap</option>
                      <option value="other">Övrigt</option>
                    </select>
                    <input
                      type="number"
                      value={editForm.price}
                      onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.sport_type}
                      onChange={(e) => setEditForm({ ...editForm, sport_type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      {SPORT_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={editForm.court_type}
                      onChange={(e) => setEditForm({ ...editForm, court_type: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    >
                      {COURT_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      value={editForm.time_from}
                      onChange={(e) => setEditForm({ ...editForm, time_from: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                    <input
                      type="time"
                      value={editForm.time_to}
                      onChange={(e) => setEditForm({ ...editForm, time_to: e.target.value })}
                      className="rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                  </div>
                  <div className="flex gap-1">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day}
                        onClick={() => {
                          const nextDays = editForm.days_of_week.includes(day)
                            ? editForm.days_of_week.filter((d: number) => d !== day)
                            : [...editForm.days_of_week, day].sort();
                          setEditForm({ ...editForm, days_of_week: nextDays });
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                          editForm.days_of_week.includes(day)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {DAY_LABELS[day]}
                      </button>
                    ))}
                  </div>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Beskrivning"
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 rounded-xl py-2.5 bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Spara
                    </button>
                    <button onClick={cancelEdit} className="flex-1 rounded-xl py-2.5 bg-muted text-muted-foreground text-xs font-semibold flex items-center justify-center gap-1">
                      <X className="w-3.5 h-3.5" /> Avbryt
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sell/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Tag className="w-4 h-4 text-sell" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{rule.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {rule.type === "hourly" ? "Per timme" : rule.type === "day_pass" ? "Dagspass" : rule.type === "event" ? "Event" : rule.type === "guest_pass" ? "Gästpass" : rule.type}
                      {" · "}
                      {formatScope(rule)}
                      {" · "}
                      {formatDays(rule.days_of_week)}
                      {" · "}
                      {formatTimeRange(rule.time_from, rule.time_to)}
                    </p>
                    {rule.description && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{rule.description}</p>
                    )}
                  </div>
                  <span className="text-sm font-display font-bold text-foreground whitespace-nowrap">{rule.price} kr</span>
                  <div className="flex flex-col gap-1 items-end">
                    <button
                      onClick={() => toggleActive(rule)}
                      className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                        rule.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {rule.is_active ? "Aktiv" : "Av"}
                    </button>
                    <button onClick={() => startEdit(rule)} className="text-muted-foreground/50 hover:text-primary transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="text-muted-foreground/50 hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {(!pricing || pricing.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga prisregler ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminPricing;
