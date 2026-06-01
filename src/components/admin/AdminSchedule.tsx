import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, Edit3, Loader2, Plus, Save, Trash2, X } from "lucide-react";
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

const inputStyle = {
  background: "hsl(var(--surface-2))",
  border: "1px solid hsl(var(--border))",
};

const baseInputClass = "rounded-xl px-3 py-2.5 text-xs outline-none";

const sortDays = (days: number[]) => {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

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

  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [seriesDrafts, setSeriesDrafts] = useState<Record<string, any>>({});
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, any>>({});

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

  const updateSeries = useMutation({
    mutationFn: (body: any) => apiPatch("api-admin", "activity-series", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Program uppdaterat");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSeries = useMutation({
    mutationFn: (seriesId: string) => apiDelete("api-admin", "activity-series", { venueId, seriesId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-activity-series", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-activity-sessions", venueId] });
      toast.success("Program borttaget");
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
    setDays((current) => current.includes(day) ? current.filter((d) => d !== day) : sortDays([...current, day]));
  };

  const toggleDraftDay = (sessionId: string, day: number) => {
    setSessionDrafts((current) => {
      const draft = current[sessionId] || {};
      const currentDays = draft.recurrence_days || [];
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((d: number) => d !== day)
        : sortDays([...currentDays, day]);
      return { ...current, [sessionId]: { ...draft, recurrence_days: nextDays } };
    });
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

  const startEditSeries = (item: any) => {
    setEditingSeriesId(item.id);
    setSeriesDrafts((current) => ({
      ...current,
      [item.id]: {
        name: item.name || "",
        series_type: item.series_type || "program",
        product_key: item.product_key || "",
        status: item.status || "active",
      },
    }));
  };

  const saveSeries = (item: any) => {
    const draft = seriesDrafts[item.id];
    if (!draft?.name?.trim()) {
      toast.error("Programmet behöver ett namn");
      return;
    }
    updateSeries.mutate({
      seriesId: item.id,
      name: draft.name.trim(),
      series_type: draft.series_type || "program",
      product_key: draft.product_key || null,
      status: draft.status || "active",
    }, {
      onSuccess: () => setEditingSeriesId(null),
    });
  };

  const startEditSession = (session: any) => {
    setEditingSessionId(session.id);
    setSessionDrafts((current) => ({
      ...current,
      [session.id]: {
        name: session.name || "",
        session_type: session.session_type || "open_play",
        series_id: session.series_id || "",
        product_key: session.product_key || "",
        recurrence_days: session.recurrence_days || [],
        start_time: String(session.start_time || "10:00").slice(0, 5),
        end_time: String(session.end_time || "12:00").slice(0, 5),
        price_sek: session.price_sek ?? 0,
        capacity: session.capacity ?? "",
        is_active: Boolean(session.is_active),
        publish_status: session.publish_status || "published",
      },
    }));
  };

  const saveSession = (session: any) => {
    const draft = sessionDrafts[session.id];
    if (!draft?.name?.trim() || !draft?.recurrence_days?.length) {
      toast.error("Passet behöver namn och minst en veckodag");
      return;
    }
    updateSession.mutate({
      sessionId: session.id,
      name: draft.name.trim(),
      session_type: draft.session_type || "open_play",
      series_id: draft.series_id || null,
      product_key: draft.product_key || null,
      recurrence_days: draft.recurrence_days,
      start_time: draft.start_time,
      end_time: draft.end_time,
      price_sek: Math.max(0, Math.round(Number(draft.price_sek || 0))),
      capacity: draft.capacity === "" || draft.capacity == null ? null : Math.max(0, Math.round(Number(draft.capacity))),
      is_active: Boolean(draft.is_active),
      publish_status: draft.publish_status || "published",
      access_policy: {
        allows_day_access: draft.product_key === "day_access",
        includes_day_access: draft.product_key === "group_training_day_access",
      },
    }, {
      onSuccess: () => setEditingSessionId(null),
    });
  };

  if (seriesLoading || sessionsLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Schema bygger på två nivåer</p>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-xl bg-muted/50 p-3">
            <span className="font-bold text-foreground">Program / serie</span> är gruppen, till exempel Fredagsklubben eller Vårkurs.
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <span className="font-bold text-foreground">Schema-pass</span> är tiden, priset och kapaciteten som kunder kan boka.
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt program / serie</p>
        <input
          value={seriesName}
          onChange={(e) => setSeriesName(e.target.value)}
          placeholder="Fredagsklubben, Pickla Open, Vårkurs Nybörjare..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={seriesType} onChange={(e) => setSeriesType(e.target.value)} className={baseInputClass} style={inputStyle}>
            {SERIES_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesProduct} onChange={(e) => setSeriesProduct(e.target.value)} className={baseInputClass} style={inputStyle}>
            <option value="">Ingen standardprodukt</option>
            {products.map((product) => <option key={product.id} value={product.product_key}>{product.name}</option>)}
          </select>
        </div>
        <button onClick={handleCreateSeries} disabled={createSeries.isPending} className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 flex items-center justify-center gap-2">
          {createSeries.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Skapa program
        </button>
      </div>

      {series.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Program / serier</p>
          {series.map((item) => {
            const draft = seriesDrafts[item.id] || {};
            const isEditing = editingSeriesId === item.id;
            return (
              <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <input value={draft.name || ""} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, name: e.target.value } }))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
                    <div className="grid grid-cols-3 gap-2">
                      <select value={draft.series_type || "program"} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, series_type: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        {SERIES_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                      <select value={draft.product_key || ""} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, product_key: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        <option value="">Ingen produkt</option>
                        {products.map((product) => <option key={product.id} value={product.product_key}>{product.name}</option>)}
                      </select>
                      <select value={draft.status || "active"} onChange={(e) => setSeriesDrafts((current) => ({ ...current, [item.id]: { ...draft, status: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                        <option value="active">Aktiv</option>
                        <option value="draft">Utkast</option>
                        <option value="archived">Arkiv</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveSeries(item)} disabled={updateSeries.isPending} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50">
                        <Save className="h-3.5 w-3.5" /> Spara
                      </button>
                      <button onClick={() => setEditingSeriesId(null)} className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {SERIES_TYPES.find((type) => type.key === item.series_type)?.label || item.series_type}
                        {item.product_key ? ` · ${productMap[item.product_key]?.name || item.product_key}` : ""}
                      </p>
                    </div>
                    <button onClick={() => startEditSeries(item)} className="rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                      <Edit3 className="h-3 w-3" /> Redigera
                    </button>
                    <button onClick={() => { if (confirm("Ta bort programmet? Pass kopplade till serien kan påverkas.")) deleteSeries.mutate(item.id); }} className="text-muted-foreground/50 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nytt schema-pass</p>
        <input
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          placeholder="Open Play Kväll, Fredagsklubben, Gruppträning..."
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value)} className={baseInputClass} style={inputStyle}>
            {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={baseInputClass} style={inputStyle}>
            <option value="">Fristående</option>
            {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <select value={productKey} onChange={(e) => setProductKey(e.target.value)} className={`w-full ${baseInputClass}`} style={inputStyle}>
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
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={baseInputClass} style={inputStyle} />
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={baseInputClass} style={inputStyle} />
          <input type="number" placeholder="Pris" value={price} onChange={(e) => setPrice(e.target.value)} className={baseInputClass} style={inputStyle} />
          <input type="number" placeholder="Max" value={capacity} onChange={(e) => setCapacity(e.target.value)} className={baseInputClass} style={inputStyle} />
        </div>
        <button onClick={handleCreateSession} disabled={createSession.isPending} className="w-full rounded-xl bg-court-free py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
          {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg i schema
        </button>
      </div>

      <div className="space-y-2">
        <p className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Schema-pass</p>
        {sessions.map((session) => {
          const product = session.product_key ? productMap[session.product_key] : null;
          const isEditing = editingSessionId === session.id;
          const draft = sessionDrafts[session.id] || {};
          return (
            <motion.div key={session.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4">
              {isEditing ? (
                <div className="space-y-3">
                  <input value={draft.name || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, name: e.target.value } }))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={draft.session_type || "open_play"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, session_type: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                      {SESSION_TYPES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                    </select>
                    <select value={draft.series_id || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, series_id: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                      <option value="">Fristående</option>
                      {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <select value={draft.product_key || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, product_key: e.target.value } }))} className={`w-full ${baseInputClass}`} style={inputStyle}>
                    <option value="">Ingen produkt kopplad</option>
                    {products.map((product) => <option key={product.id} value={product.product_key}>{product.name} · {product.base_price_sek} kr</option>)}
                  </select>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day) => (
                      <button
                        key={day.key}
                        onClick={() => toggleDraftDay(session.id, day.key)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold ${(draft.recurrence_days || []).includes(day.key) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <input type="time" value={draft.start_time || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, start_time: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                    <input type="time" value={draft.end_time || ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, end_time: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                    <input type="number" value={draft.price_sek ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, price_sek: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                    <input type="number" value={draft.capacity ?? ""} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, capacity: e.target.value } }))} className={baseInputClass} style={inputStyle} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={draft.is_active ? "true" : "false"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, is_active: e.target.value === "true" } }))} className={baseInputClass} style={inputStyle}>
                      <option value="true">Aktiv</option>
                      <option value="false">Avstängd</option>
                    </select>
                    <select value={draft.publish_status || "published"} onChange={(e) => setSessionDrafts((current) => ({ ...current, [session.id]: { ...draft, publish_status: e.target.value } }))} className={baseInputClass} style={inputStyle}>
                      <option value="published">Publicerad</option>
                      <option value="draft">Utkast</option>
                      <option value="hidden">Dold</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveSession(session)} disabled={updateSession.isPending} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50">
                      <Save className="h-3.5 w-3.5" /> Spara
                    </button>
                    <button onClick={() => setEditingSessionId(null)} className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
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
                      <span className={`status-chip text-[9px] ${session.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}>
                        {session.is_active ? "Aktiv" : "Av"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <button onClick={() => startEditSession(session)} className="rounded-full bg-muted px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                      <Edit3 className="h-3 w-3" /> Redigera
                    </button>
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
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminSchedule;
