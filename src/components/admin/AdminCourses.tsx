import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { AlertTriangle, CalendarDays, Check, ChevronDown, Loader2, Pencil, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  createCourseFormat,
  createCourseSeries,
  fetchCourseAdmin,
  previewCourseSeries,
  type CourseFormat,
  type CourseResourcePreviewRow,
  type CourseSeries,
  updateCourseFormat,
  updateCourseSeries,
} from "@/lib/courses";

const DAYS = [
  { value: 1, label: "Mån" }, { value: 2, label: "Tis" }, { value: 3, label: "Ons" },
  { value: 4, label: "Tor" }, { value: 5, label: "Fre" }, { value: 6, label: "Lör" }, { value: 0, label: "Sön" },
];

const inputClass = "h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

function isoLocal(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}`, { zone: "Europe/Stockholm" }).toUTC().toISO();
}

function stockholmDate(value: string) {
  return DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm").toISODate() || "";
}

export default function AdminCourses({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const [formatName, setFormatName] = useState("");
  const [formatDescription, setFormatDescription] = useState("");
  const [formatFullDescription, setFormatFullDescription] = useState("");
  const [ageGroup, setAgeGroup] = useState("adult");
  const [level, setLevel] = useState("beginner");
  const [requiresInstructor, setRequiresInstructor] = useState(true);

  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [formatId, setFormatId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState("");
  const [registrationClose, setRegistrationClose] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [totalSessions, setTotalSessions] = useState("6");
  const [capacity, setCapacity] = useState("12");
  const [price, setPrice] = useState("1495");
  const [days, setDays] = useState<number[]>([2]);
  const [courtIds, setCourtIds] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["admin-courses", venueId],
    queryFn: () => fetchCourseAdmin(venueId),
    enabled: Boolean(venueId),
  });
  const data = query.data;

  const previewDates = useMemo(() => {
    if (!startDate || !endDate || !days.length) return [];
    const result: string[] = [];
    let cursor = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);
    while (cursor <= end && result.length < Number(totalSessions || 0)) {
      if (days.includes(cursor.weekday % 7)) result.push(cursor.toISODate()!);
      cursor = cursor.plus({ days: 1 });
    }
    return result;
  }, [days, endDate, startDate, totalSessions]);
  const previewInput = useMemo(() => ({
    venue_id: venueId,
    ...(editingSeriesId ? { series_id: editingSeriesId } : {}),
    start_date: startDate,
    end_date: endDate,
    recurrence_days: days,
    start_time: startTime,
    end_time: endTime,
    total_sessions: Number(totalSessions || 0),
    court_ids: courtIds,
  }), [courtIds, days, editingSeriesId, endDate, endTime, startDate, startTime, totalSessions, venueId]);
  const previewEnabled = Boolean(
    venueId && startDate && endDate && startTime && endTime && startTime !== endTime
    && days.length && courtIds.length && Number(totalSessions) > 0 && previewDates.length === Number(totalSessions),
  );
  const resourcePreview = useQuery({
    queryKey: ["admin-course-resource-preview", previewInput],
    queryFn: () => previewCourseSeries(previewInput),
    enabled: previewEnabled,
    retry: false,
    staleTime: 0,
  });
  const previewOccurrences = useMemo(() => {
    const groups = new Map<number, CourseResourcePreviewRow[]>();
    for (const row of resourcePreview.data?.rows || []) groups.set(row.occurrence_index, [...(groups.get(row.occurrence_index) || []), row]);
    return [...groups.entries()].sort(([left], [right]) => left - right);
  }, [resourcePreview.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-courses", venueId] });
  const resetFormat = () => {
    setEditingFormatId(null);
    setFormatName("");
    setFormatDescription("");
    setFormatFullDescription("");
    setAgeGroup("adult");
    setLevel("beginner");
    setRequiresInstructor(true);
  };
  const editFormat = (format: CourseFormat) => {
    setEditingFormatId(format.id);
    setFormatName(format.name);
    setFormatDescription(format.description || "");
    setFormatFullDescription(format.full_description || "");
    setAgeGroup(format.age_group);
    setLevel(format.level);
    setRequiresInstructor(format.requires_instructor);
  };
  const saveFormat = useMutation({
    mutationFn: () => {
      const input = {
        venue_id: venueId,
        name: formatName,
        description: formatDescription,
        full_description: formatFullDescription,
        age_group: ageGroup,
        level,
        requires_instructor: requiresInstructor,
      };
      return editingFormatId
        ? updateCourseFormat({ ...input, format_id: editingFormatId })
        : createCourseFormat(input);
    },
    onSuccess: async (format) => {
      if (!editingFormatId) setFormatId(format.id);
      const message = editingFormatId ? "Kursformat uppdaterat" : "Kursformat skapat";
      resetFormat();
      await refresh();
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetSeries = () => {
    setEditingSeriesId(null);
    setFormatId("");
    setName("");
    setStartDate("");
    setEndDate("");
    setRegistrationOpen("");
    setRegistrationClose("");
    setStartTime("18:00");
    setEndTime("19:00");
    setTotalSessions("6");
    setCapacity("12");
    setPrice("1495");
    setDays([2]);
    setCourtIds([]);
  };
  const editSeries = (series: CourseSeries) => {
    setEditingSeriesId(series.id);
    setFormatId(series.format_id);
    setName(series.name);
    setStartDate(series.start_date);
    setEndDate(series.end_date);
    setRegistrationOpen(stockholmDate(series.registration_opens_at));
    setRegistrationClose(stockholmDate(series.registration_closes_at));
    setStartTime(series.start_time.slice(0, 5));
    setEndTime(series.end_time.slice(0, 5));
    setTotalSessions(String(series.total_sessions));
    setCapacity(String(series.capacity.capacity));
    setPrice(String(series.product.base_price_sek));
    setDays(series.recurrence_days);
    setCourtIds(series.court_ids);
  };
  const saveSeries = useMutation({
    mutationFn: () => {
      const input = {
        ...previewInput,
        format_id: formatId,
        name,
        registration_opens_at: isoLocal(registrationOpen, "00:00"),
        registration_closes_at: isoLocal(registrationClose, "23:59"),
        capacity: Number(capacity),
        price_sek: Number(price),
        total_sessions: Number(totalSessions),
      };
      return editingSeriesId ? updateCourseSeries(input) : createCourseSeries(input);
    },
    onSuccess: async () => {
      const message = editingSeriesId ? "Kursutkast uppdaterat" : "Kurs skapad med konkreta tillfällen";
      resetSeries();
      await refresh();
      toast.success(message);
    },
    onError: async (error: Error) => {
      await resourcePreview.refetch();
      toast.error(error.message);
    },
  });
  const publish = useMutation({
    mutationFn: (seriesId: string) => updateCourseSeries({ series_id: seriesId, status: "active" }),
    onSuccess: async () => { await refresh(); toast.success("Kursanmälan publicerad"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveSeriesDisabled = !formatId || !name || !startDate || !endDate || !registrationOpen || !registrationClose
    || !previewEnabled || resourcePreview.isFetching || !resourcePreview.data || resourcePreview.data.has_conflicts || saveSeries.isPending;

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4" data-testid="admin-courses">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left">
        <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Course V1</p><h2 className="mt-1 text-lg font-black">Kurser</h2><p className="mt-1 text-xs text-muted-foreground">Format → serie → tillfällen</p></div>
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="mt-5 space-y-6 border-t border-border pt-5">
        <div>
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold">1. Kursformat</h3>{editingFormatId ? <button type="button" onClick={resetFormat} className="inline-flex items-center gap-1 text-xs font-bold"><X className="h-3.5 w-3.5" />Avbryt</button> : null}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input aria-label="Formatnamn" className={inputClass} value={formatName} onChange={(event) => setFormatName(event.target.value)} placeholder="Pickla 101 · Vuxen Nybörjare" />
            <input aria-label="Kort beskrivning" className={inputClass} value={formatDescription} onChange={(event) => setFormatDescription(event.target.value)} placeholder="Dina första fyra veckor med pickleball." />
            <textarea aria-label="Full beskrivning och kursinnehåll" className={`${inputClass} min-h-44 py-3 sm:col-span-2`} value={formatFullDescription} onChange={(event) => setFormatFullDescription(event.target.value)} placeholder={"Introduktion\n\nTillfälle 1 · ...\nTillfälle 2 · ...\n\nDetta ingår\n...\n\nPraktisk information\n..."} />
            <select aria-label="Åldersgrupp" className={inputClass} value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}><option value="adult">Vuxen</option><option value="youth">Barn/ungdom</option><option value="all_ages">Alla åldrar</option></select>
            <select aria-label="Nivå" className={inputClass} value={level} onChange={(event) => setLevel(event.target.value)}><option value="intro">Introduktion</option><option value="beginner">Nybörjare</option><option value="intermediate">Fortsättning</option><option value="advanced">Avancerad</option></select>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={requiresInstructor} onChange={(event) => setRequiresInstructor(event.target.checked)} /> Kräver instruktör</label>
          <button type="button" onClick={() => saveFormat.mutate()} disabled={!formatName.trim() || saveFormat.isPending} className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40">{saveFormat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingFormatId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingFormatId ? "Spara format" : "Skapa format"}</button>
          {(data?.formats || []).length ? <div className="mt-4 grid gap-2">{data!.formats.map((format) => <div key={format.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-bold">{format.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{format.description || "Ingen kort beskrivning"}</p></div><button type="button" onClick={() => editFormat(format)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Redigera</button></div>)}</div> : null}
        </div>

        <div className="border-t border-border pt-5">
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold">2. {editingSeriesId ? "Redigera kursutkast" : "Konkret kursserie"}</h3>{editingSeriesId ? <button type="button" onClick={resetSeries} className="inline-flex items-center gap-1 text-xs font-bold"><X className="h-3.5 w-3.5" />Avbryt</button> : null}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select aria-label="Kursformat" className={inputClass} value={formatId} disabled={Boolean(editingSeriesId)} onChange={(event) => setFormatId(event.target.value)}><option value="">Välj format</option>{(data?.formats || []).map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select>
            <input aria-label="Serienamn" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Pickla 101 · Höst 2026" />
            <label className="grid gap-1 text-xs text-muted-foreground">Start<input className={inputClass} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Slut<input className={inputClass} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Anmälan öppnar<input className={inputClass} type="date" value={registrationOpen} onChange={(event) => setRegistrationOpen(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Anmälan stänger<input className={inputClass} type="date" value={registrationClose} onChange={(event) => setRegistrationClose(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Starttid<input className={inputClass} type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Sluttid<input className={inputClass} type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Tillfällen<input className={inputClass} inputMode="numeric" value={totalSessions} onChange={(event) => setTotalSessions(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Kursplatser<input className={inputClass} inputMode="numeric" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Pris SEK<input className={inputClass} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{DAYS.map((day) => <button key={day.value} type="button" onClick={() => setDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value])} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${days.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{day.label}</button>)}</div>
          <div className="mt-3 flex flex-wrap gap-2">{(data?.courts || []).filter((court) => court.sport_type === "pickleball").map((court) => <button key={court.id} type="button" onClick={() => setCourtIds((current) => current.includes(court.id) ? current.filter((id) => id !== court.id) : [...current, court.id])} className={`rounded-lg border px-3 py-2 text-xs font-bold ${courtIds.includes(court.id) ? "border-primary" : "border-border"}`}>{court.name}</button>)}</div>
          {previewDates.length ? <div className="mt-4 rounded-xl border border-border p-3" data-testid="course-resource-preview"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">Förhandsvisning · {previewDates.length} tillfällen</p>{resourcePreview.isFetching ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Kontrollerar resurser</span> : null}</div>
            {!courtIds.length ? <p className="mt-2 text-xs text-destructive">Välj minst en bana för att kontrollera fysisk beläggning.</p> : null}
            {resourcePreview.isError ? <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />Resurskontrollen kunde inte genomföras. Kursen kan inte sparas.</p> : null}
            {previewOccurrences.length ? <ol className="mt-3 grid gap-2">{previewOccurrences.map(([index, rows]) => {
              const occurrenceHasConflict = rows.some((row) => !row.is_available);
              const first = rows[0];
              return <li key={index} className={`rounded-lg border p-3 ${occurrenceHasConflict ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">{index}. {DateTime.fromISO(first.occurrence_date).setLocale("sv").toFormat("ccc d MMM")} · {startTime}–{endTime}</p><span className={`text-[11px] font-black uppercase tracking-wide ${occurrenceHasConflict ? "text-destructive" : "text-emerald-700"}`}>{occurrenceHasConflict ? "Konflikt" : "Ledig"}</span></div>
                <div className="mt-2 grid gap-2">{rows.map((row) => <div key={row.court_id} className="text-xs"><p className="font-semibold">{row.court_name}</p>{row.conflicts.map((conflict) => <p key={`${conflict.source_type}:${conflict.source_id}`} className="mt-1 flex items-start gap-1 text-destructive"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{conflict.title} · {DateTime.fromISO(conflict.starts_at).setZone("Europe/Stockholm").toFormat("HH:mm")}–{DateTime.fromISO(conflict.ends_at).setZone("Europe/Stockholm").toFormat("HH:mm")}</span></p>)}</div>)}</div>
              </li>;
            })}</ol> : null}
            {resourcePreview.data?.has_conflicts ? <p className="mt-3 text-xs font-semibold text-destructive">Ändra schema eller resurser innan kursen kan sparas.</p> : null}
          </div> : null}
          <button type="button" onClick={() => saveSeries.mutate()} disabled={saveSeriesDisabled} className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40">{saveSeries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingSeriesId ? <Check className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}{editingSeriesId ? "Spara kursutkast" : "Skapa kurs och tillfällen"}</button>
        </div>

        <div className="border-t border-border pt-5">
          <h3 className="font-bold">Kursserier</h3>
          <div className="mt-3 grid gap-2">{query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (data?.series || []).map((series) => <div key={series.id} className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{series.name}</p><p className="mt-1 text-xs text-muted-foreground">{series.sessions.length} tillfällen · {series.capacity.committed_count}/{series.capacity.capacity} platser</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{series.sessions.some((session) => session.requires_staffing) ? "Instruktör krävs" : "Ingen instruktör krävs"}</p></div>{series.status === "draft" ? <div className="flex gap-2"><button type="button" onClick={() => editSeries(series)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Redigera</button><button type="button" onClick={() => publish.mutate(series.id)} disabled={publish.isPending} className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"><Check className="h-3 w-3" />Publicera</button></div> : <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700">Öppen</span>}</div><div className="mt-3 border-t border-border pt-3"><p className="text-xs font-bold">Kommande tillfällen</p><ol className="mt-2 grid gap-1.5">{series.sessions.filter((session) => session.is_active).map((session) => <li key={session.id} className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{session.series_occurrence_index}. {DateTime.fromISO(session.session_date).setLocale("sv").toFormat("ccc d MMM")}</span><span>{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</span></li>)}</ol></div></div>)}</div>
        </div>
      </div> : null}
    </section>
  );
}
