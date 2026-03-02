import { useAdminHours, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";

const dayNames = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

interface DayForm {
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const defaultDay: DayForm = { openTime: "08:00", closeTime: "22:00", isClosed: false };

const AdminHours = ({ venueId }: { venueId: string }) => {
  const { data: hours, isLoading } = useAdminHours(venueId);
  const { saveHours } = useAdminMutation(venueId);
  const [days, setDays] = useState<DayForm[]>(Array(7).fill(defaultDay));
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (hours && !initialized) {
      const mapped = Array(7).fill(null).map((_, i) => {
        const h = hours.find((h: any) => h.day_of_week === i);
        if (h) return { openTime: h.open_time?.slice(0, 5) || "08:00", closeTime: h.close_time?.slice(0, 5) || "22:00", isClosed: h.is_closed || false };
        return defaultDay;
      });
      setDays(mapped);
      setInitialized(true);
    }
  }, [hours, initialized]);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleSaveDay = (dayIndex: number) => {
    const d = days[dayIndex];
    saveHours.mutate({ dayOfWeek: dayIndex, openTime: d.openTime, closeTime: d.closeTime, isClosed: d.isClosed }, {
      onSuccess: () => toast.success(`${dayNames[dayIndex]} sparad!`),
      onError: (e) => toast.error(e.message),
    });
  };

  const updateDay = (i: number, field: keyof DayForm, value: any) => {
    setDays((prev) => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  };

  return (
    <div className="space-y-2">
      {dayNames.map((name, i) => (
        <div key={i} className="glass-card rounded-2xl p-3 flex items-center gap-3">
          <div className="min-w-[70px]">
            <p className="text-sm font-semibold">{name}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={days[i].isClosed}
              onChange={(e) => updateDay(i, "isClosed", e.target.checked)}
              className="rounded accent-primary"
            />
            Stängt
          </label>
          {!days[i].isClosed && (
            <>
              <input type="time" value={days[i].openTime} onChange={(e) => updateDay(i, "openTime", e.target.value)} className="rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="time" value={days[i].closeTime} onChange={(e) => updateDay(i, "closeTime", e.target.value)} className="rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            </>
          )}
          <button onClick={() => handleSaveDay(i)} className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <Save className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AdminHours;
