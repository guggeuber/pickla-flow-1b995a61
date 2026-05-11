import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

const DAYS = [
  { key: 1, label: "Mån" },
  { key: 2, label: "Tis" },
  { key: 3, label: "Ons" },
  { key: 4, label: "Tor" },
  { key: 5, label: "Fre" },
  { key: 6, label: "Lör" },
  { key: 0, label: "Sön" },
];

const SESSION_TYPES = [
  { key: "open_play", label: "Open Play" },
  { key: "group_training", label: "Gruppträning" },
  { key: "pickla_open", label: "Pickla Open" },
  { key: "club_night", label: "Klubbkväll" },
  { key: "event", label: "Event" },
];

const SERIES_TYPES = [
  { key: "program", label: "Program" },
  { key: "club_night", label: "Klubbkväll" },
  { key: "training", label: "Träning" },
  { key: "competition", label: "Tävling" },
  { key: "course", label: "Kurs/serie" },
];

const AdminSchedule = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const [seriesName, setSeriesName] = useState("");
  const [seriesType, setSeriesType] = useState("program");
  const [seriesProduct, setSeriesProduct] = useState("");

  const [sessionName, setSessionName] = useState("");
  const [sessionType, setSessionType] = useState("open_play");
  const [seriesId, setSeriesId] = useState("");
  const [productKey, setProductKey] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("");

  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["admin-access-products", venueId],
    queryFn: () => apiGet("api-admin", "products", { venueId }),
  });

  const { data: series = [], isLoading: seriesLoading } = useQuery<any[]>({
    queryKey: ["admin-activity-series", venueId],
    queryFn: () => apiGet("api-admin", "activity-series", { venueId }),
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<any[]>({
    queryKey: ["admin-activity-sessions", venueId],
    queryFn: () => apiGet("api-admin", "activity-sessions", { venueId }),
  });

  const productMap = useMemo(() => {
    const map: Record<string, any> = {};
    products.forEach((product) => { map[product.product_key] = product; });
    return map;
  }, [products]);

  const createSeries = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "activity-series", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      toast.success("Program skapat");
      setSeriesName("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createSession = useMutation({
    mutationFn: (body: any) => apiPost("api-admin", "activity-sessions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Schema-pass skapat");
      setSessionName("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateSession = useMutation({
    mutationFn: (body: any) => apiPatch("api-admin", "activity-sessions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Pass uppdaterat");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => apiDelete("api-admin", "activity-sessions", { venueId, sessionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Pass borttaget");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleDay = (day: number) => {
    setDays((current) => current.includes(day) ? current.filter((d) => d !== day) : [...current, day]);
  };

  const handleCreateSeries = () => {
    if (!seriesName.trim()) {
      toast.error("Namn krävs");
      return;
    }
    createSeries.mutate({
      venueId,
      name: seriesName.trim(),
      series_type: seriesType,
      product_key: seriesProduct || null,
      status: "active",
    });
  };

  const handleCreateSession = () => {
    if (!sessionName.trim() || !days.length) {
      toast.error("Namn och minst en veckodag krävs");
      return;
    }
    createSession.mutate({
      venueId,
      name: sessionName.trim(),
      session_type: sessionType,
      series_id: seriesId || null,
      product_key: productKey || null,
      recurrence_days: days,
      start_time: startTime,
      end_time: endTime,
      price_sek: Math.round(Number(price || 0)),
      capacity: capacity ? Math.round(Number(capacity)) : null,
      access_policy: {
        allows_day_access: productKey === "day_access",
        includes_day_access: productKey === "group_training_day_access",
      },
      is_active: true,
    });
  };

  const dayLabel = (session: any) => {
    const recurrenceDays = session.recurrence_days || session.day_of_week || [];
    return recurrenceDays
      .map((day: number) => DAYS.find((d) => d.key === day)?.label)
      .filter(Boolean)
      .join(", ");
  };

  if (seriesLoading || sessionsLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt program / serie</p>
        <input
          value={seriesName}
          onChange={(e) => setSeriesName(e.target.value)}
          placeholder="Fredagsklubben, Pickla Open, Vårkurs Nybörjare..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={seriesType} onChange={(e) => setSeriesType(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            {SERIES_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesProduct} onChange={(e) => setSeriesProduct(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            <option value="">Ingen standardprodukt</option>
            {products.map((product) => <option key={product.id} value={product.product_key}>{product.name}</option>)}
          </select>
        </div>
        <button onClick={handleCreateSeries} disabled={createSeries.isPending} className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
          {createSeries.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Skapa program
        </button>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt schema-pass</p>
        <input
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          placeholder="Open Play Kväll, Fredagsklubben, Gruppträning..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
            <option value="">Fristående</option>
            {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <select value={productKey} onChange={(e) => setProductKey(e.target.value)} className="w-full rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}>
          <option value="">Ingen produkt kopplad</option>
          {products.map((product) => <option key={product.id} value={product.product_key}>{product.name} · {product.base_price_sek} kr</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button
              key={day.key}
              onClick={() => toggleDay(day.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${days.includes(day.key) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {day.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="rounded-xl px-2 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} />
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="rounded-xl px-2 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} />
          <input type="number" placeholder="Pris" value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} />
          <input type="number" placeholder="Max" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="rounded-xl px-3 py-2.5 text-xs outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} />
        </div>
        <button onClick={handleCreateSession} disabled={createSession.isPending} className="w-full rounded-xl bg-court-free py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
          {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg i schema
        </button>
      </div>

      <div className="space-y-2">
        {sessions.map((session) => {
          const product = session.product_key ? productMap[session.product_key] : null;
          return (
            <motion.div key={session.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{session.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {dayLabel(session)} · {String(session.start_time).slice(0, 5)}-{String(session.end_time).slice(0, 5)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="status-chip bg-primary/15 text-primary text-[9px]">{session.session_type}</span>
                    {session.activity_series?.name && <span className="status-chip bg-muted text-muted-foreground text-[9px]">{session.activity_series.name}</span>}
                    <span className="status-chip bg-court-free/15 text-court-free text-[9px]">{session.price_sek} kr</span>
                    {product && <span className="status-chip bg-badge-vip/15 text-badge-vip text-[9px]">{product.name}</span>}
                    {session.capacity && <span className="status-chip bg-muted text-muted-foreground text-[9px]">max {session.capacity}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <button
                    onClick={() => updateSession.mutate({ sessionId: session.id, is_active: !session.is_active })}
                    className={`text-[10px] px-2 py-1 rounded-full font-semibold ${session.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}
                  >
                    {session.is_active ? "Aktiv" : "Av"}
                  </button>
                  <button onClick={() => { if (confirm("Ta bort passet?")) deleteSession.mutate(session.id); }} className="text-muted-foreground/50 hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminSchedule;
