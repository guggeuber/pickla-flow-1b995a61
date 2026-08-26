import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { AlertTriangle, CalendarDays, Check, ChevronDown, Gift, ImagePlus, Loader2, Pencil, Plus, Save, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import SeriesMemberPricingEditor from "@/components/admin/SeriesMemberPricingEditor";
import {
  createCourseFormat,
  createCourseSeries,
  cancelSeriesStaffPlace,
  fetchCourseAdmin,
  fetchSeriesMemberPricing,
  findSeriesGrantParticipants,
  grantSeriesStaffPlace,
  previewCourseSeries,
  saveSeriesEarlyBird,
  saveSeriesIncludedAccess,
  type CourseFormat,
  type CourseResourcePreviewRow,
  type CourseSeries,
  type SeriesGrantParticipant,
  updateCourseFormat,
  updateCourseSeries,
} from "@/lib/courses";
import { namedEventImagePath, nextNamedEventImageSlot, removeNamedEventImage, uploadNamedEventImage } from "@/lib/eventMedia";
import { occurrenceCountLabel, SERIES_PRESENTATION_TYPES, seriesPresentation, type SeriesPresentationType } from "@/lib/seriesPresentation";

const DAYS = [
  { value: 1, label: "Mån" }, { value: 2, label: "Tis" }, { value: 3, label: "Ons" },
  { value: 4, label: "Tor" }, { value: 5, label: "Fre" }, { value: 6, label: "Lör" }, { value: 0, label: "Sön" },
];

const inputClass = "h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const SERIES_STATUS_LABELS: Record<string, string> = {
  draft: "Utkast",
  active: "Publicerad",
  paused: "Avpublicerad",
  completed: "Avslutad",
  cancelled: "Arkiverad",
};

function seriesScheduleLockCopy(reason?: NonNullable<CourseSeries["edit_policy"]>["schedule_lock_reason"]) {
  if (reason === "series_started") return "Schemat är låst eftersom omgången har startat.";
  if (reason === "participants_or_payments_exist") return "Schemat är låst eftersom deltagare eller betalningshistorik finns. Titel, registreringsfönster, framtida pris och säker kapacitet kan fortfarande ändras.";
  if (reason === "active_checkout_holds") return "Schemat är tillfälligt låst medan en betalning pågår.";
  if (reason === "staffing_exists") return "Ta bort aktiva bemanningsuppdrag i Operations innan schemat ändras.";
  if (reason === "lifecycle_locked") return "Omgången är avslutad eller arkiverad och kan inte redigeras.";
  return null;
}

function isoLocal(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}`, { zone: "Europe/Stockholm" }).toUTC().toISO();
}

function stockholmDate(value: string) {
  return DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm").toISODate() || "";
}

function formatSek(value: number) {
  return `${Number(value || 0).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} kr`;
}

function SeriesEarlyBirdEditor({ venueId, series }: { venueId: string; series: CourseSeries }) {
  const queryClient = useQueryClient();
  const configured = series.product.scarcity_mode === "early_bird";
  const [enabled, setEnabled] = useState(configured);
  const [price, setPrice] = useState(String(series.product.early_bird_price_minor == null ? "" : series.product.early_bird_price_minor / 100));
  const [slots, setSlots] = useState(String(series.product.early_bird_slots ?? ""));

  useEffect(() => {
    setEnabled(configured);
    setPrice(String(series.product.early_bird_price_minor == null ? "" : series.product.early_bird_price_minor / 100));
    setSlots(String(series.product.early_bird_slots ?? ""));
  }, [configured, series.product.early_bird_price_minor, series.product.early_bird_slots]);

  const save = useMutation({
    mutationFn: () => saveSeriesEarlyBird({
      seriesId: series.id,
      enabled,
      priceSek: Number(price),
      slots: Number(slots),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-courses", venueId] }),
        queryClient.invalidateQueries({ queryKey: ["series-member-pricing", venueId] }),
      ]);
      toast.success(enabled ? "Early Bird är sparat" : "Early Bird är avstängt");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const numericPrice = Number(price);
  const numericSlots = Number(slots);
  const invalid = enabled && (
    !Number.isFinite(numericPrice)
    || numericPrice <= 0
    || numericPrice >= Number(series.product.base_price_sek || 0)
    || !Number.isInteger(numericSlots)
    || numericSlots < 1
    || numericSlots > series.capacity.capacity
  );
  const unchanged = enabled === configured
    && (!enabled || (
      Math.round(numericPrice * 100) === Number(series.product.early_bird_price_minor)
      && numericSlots === Number(series.product.early_bird_slots)
    ));

  return <div className="mt-3 rounded-xl border border-border bg-background p-3" data-testid="series-early-bird">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wider">Early Bird</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Första vinnande betalda platserna</p>
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-bold">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Early Bird
      </label>
    </div>
    {enabled ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label htmlFor={`series-early-bird-price-${series.id}`} className="grid gap-1 text-xs font-semibold">
        Early Bird-pris
        <span className="relative">
          <input id={`series-early-bird-price-${series.id}`} className={`${inputClass} w-full pr-8`} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kr</span>
        </span>
      </label>
      <label htmlFor={`series-early-bird-slots-${series.id}`} className="grid gap-1 text-xs font-semibold">
        Första
        <span className="relative">
          <input id={`series-early-bird-slots-${series.id}`} className={`${inputClass} w-full pr-16`} inputMode="numeric" value={slots} onChange={(event) => setSlots(event.target.value)} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">platser</span>
        </span>
      </label>
      <button type="button" onClick={() => save.mutate()} disabled={save.isPending || invalid || unchanged} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-40">
        {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Spara
      </button>
    </div> : <button type="button" onClick={() => save.mutate()} disabled={save.isPending || unchanged} className="mt-3 inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-40">
      {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Spara
    </button>}
    <div className="mt-3 grid gap-1 border-t border-border pt-3 text-xs">
      <p className="flex justify-between gap-3"><span className="text-muted-foreground">Ordinarie</span><strong>{formatSek(series.product.base_price_sek)}</strong></p>
      {enabled && !invalid ? <>
        <p className="flex justify-between gap-3"><span className="text-muted-foreground">Early Bird</span><strong>{formatSek(numericPrice)}</strong></p>
        <p className="flex justify-between gap-3"><span className="text-muted-foreground">Första</span><strong>{numericSlots} platser</strong></p>
      </> : null}
    </div>
  </div>;
}

function SeriesIncludedAccessEditor({ venueId, series }: { venueId: string; series: CourseSeries }) {
  const queryClient = useQueryClient();
  const configured = series.included_access?.open_play_series_period.enabled === true;
  const [enabled, setEnabled] = useState(configured);
  const rule = series.included_access?.open_play_series_period;
  const commerciallyLocked = Number(series.edit_policy?.commitment_count || 0) > 0
    || Number(series.edit_policy?.order_history_count || 0) > 0;

  useEffect(() => setEnabled(configured), [configured]);

  const save = useMutation({
    mutationFn: () => saveSeriesIncludedAccess({
      seriesId: series.id,
      openPlaySeriesPeriodEnabled: enabled,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-courses", venueId] });
      toast.success(enabled ? "Open Play ingår under erbjudandets period" : "Inkluderad Open Play är avstängd");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const startDate = rule?.start_date;
  const endDate = rule?.end_date;
  return <div className="mt-3 rounded-xl border border-border bg-background p-3" data-testid="series-included-access">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wider">Inkluderad access</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Förmånen följer de faktiska tillfällena.</p>
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-bold">
        <input type="checkbox" checked={enabled} disabled={commerciallyLocked} onChange={(event) => setEnabled(event.target.checked)} />
        Open Play under erbjudandets period
      </label>
    </div>
    {enabled ? <p className="mt-3 text-xs font-semibold">
      Gäller: {startDate && endDate
        ? `${DateTime.fromISO(startDate).setLocale("sv").toFormat("d MMM").replaceAll(".", "")} → ${DateTime.fromISO(endDate).setLocale("sv").toFormat("d MMM").replaceAll(".", "")}`
        : "när omgångens aktiva tillfällen finns"}
    </p> : null}
    {commerciallyLocked ? <p className="mt-2 text-[11px] text-muted-foreground">Inställningen är låst eftersom deltagare eller betalningshistorik finns.</p> : null}
    <button type="button" onClick={() => save.mutate()} disabled={save.isPending || enabled === configured || commerciallyLocked} className="mt-3 inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-40">
      {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Spara
    </button>
  </div>;
}

type AdminCoursesProps = {
  venueId: string;
  catalogMode?: boolean;
  initialSeriesId?: string | null;
  initialPresentationType?: SeriesPresentationType;
  onDone?: () => void;
};

export default function AdminCourses({
  venueId,
  catalogMode = false,
  initialSeriesId = null,
  initialPresentationType = "course",
  onDone,
}: AdminCoursesProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(catalogMode);
  const seriesEditorRef = useRef<HTMLDivElement>(null);

  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const [formatName, setFormatName] = useState("");
  const [formatDescription, setFormatDescription] = useState("");
  const [formatFullDescription, setFormatFullDescription] = useState("");
  const [formatImages, setFormatImages] = useState<string[]>([]);
  const [formatImageBusy, setFormatImageBusy] = useState(false);
  const [ageGroup, setAgeGroup] = useState("adult");
  const [level, setLevel] = useState("beginner");
  const [requiresInstructor, setRequiresInstructor] = useState(true);
  const [presentationType, setPresentationType] = useState<SeriesPresentationType>(initialPresentationType);

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
  const [seriesImages, setSeriesImages] = useState<string[]>([]);
  const [seriesImageBusy, setSeriesImageBusy] = useState(false);

  const [grantSeriesId, setGrantSeriesId] = useState<string | null>(null);
  const [grantSearch, setGrantSearch] = useState("");
  const [grantParticipant, setGrantParticipant] = useState<SeriesGrantParticipant | null>(null);
  const [grantReason, setGrantReason] = useState("");
  const [grantRequestId, setGrantRequestId] = useState("");
  const [cancelGrantId, setCancelGrantId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRequestId, setCancelRequestId] = useState("");

  const query = useQuery({
    queryKey: ["admin-courses", venueId],
    queryFn: () => fetchCourseAdmin(venueId),
    enabled: Boolean(venueId),
  });
  const data = query.data;
  const editingSeries = data?.series.find((series) => series.id === editingSeriesId);
  const editingFormat = data?.formats.find((format) => format.id === formatId);
  const scheduleEditable = !editingSeriesId || editingSeries?.edit_policy?.schedule_editable !== false;
  const scheduleLockCopy = seriesScheduleLockCopy(editingSeries?.edit_policy?.schedule_lock_reason);
  const memberPricing = useQuery({
    queryKey: ["series-member-pricing", venueId],
    queryFn: () => fetchSeriesMemberPricing(venueId),
    enabled: Boolean(venueId && open),
    retry: false,
  });
  const normalizedGrantSearch = grantSearch.trim();
  const participantSearch = useQuery({
    queryKey: ["series-grant-participants", venueId, normalizedGrantSearch],
    queryFn: () => findSeriesGrantParticipants(venueId, normalizedGrantSearch),
    enabled: Boolean(grantSeriesId && normalizedGrantSearch.length >= 2),
    staleTime: 15_000,
  });

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
  const seriesDirty = Boolean(editingSeries && (
    name !== editingSeries.name
    || startDate !== editingSeries.start_date
    || endDate !== editingSeries.end_date
    || registrationOpen !== stockholmDate(editingSeries.registration_opens_at)
    || registrationClose !== stockholmDate(editingSeries.registration_closes_at)
    || startTime !== editingSeries.start_time.slice(0, 5)
    || endTime !== editingSeries.end_time.slice(0, 5)
    || Number(totalSessions) !== editingSeries.total_sessions
    || Number(capacity) !== editingSeries.capacity.capacity
    || Number(price) !== editingSeries.product.base_price_sek
    || JSON.stringify([...days].sort()) !== JSON.stringify([...editingSeries.recurrence_days].sort())
    || JSON.stringify([...courtIds].sort()) !== JSON.stringify([...editingSeries.court_ids].sort())
    || JSON.stringify(seriesImages) !== JSON.stringify(editingSeries.image_urls || [])
  ));
  const publicationReady = Boolean(
    editingSeries
    && previewEnabled
    && previewDates.length === Number(totalSessions)
    && !resourcePreview.isFetching
    && resourcePreview.data
    && !resourcePreview.data.has_conflicts
    && Number(capacity) >= Number(editingSeries.edit_policy?.minimum_capacity || 0)
    && Number(price) > 0
    && editingSeries.product?.is_active,
  );

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["admin-courses", venueId] }),
    queryClient.invalidateQueries({ queryKey: ["series-member-pricing", venueId] }),
  ]);
  const resetFormat = () => {
    setEditingFormatId(null);
    setFormatName("");
    setFormatDescription("");
    setFormatFullDescription("");
    setFormatImages([]);
    setAgeGroup("adult");
    setLevel("beginner");
    setRequiresInstructor(true);
    setPresentationType(initialPresentationType);
  };
  const editFormat = (format: CourseFormat) => {
    setEditingFormatId(format.id);
    setFormatName(format.name);
    setFormatDescription(format.description || "");
    setFormatFullDescription(format.full_description || "");
    setFormatImages(format.image_urls || []);
    setAgeGroup(format.age_group);
    setLevel(format.level);
    setRequiresInstructor(format.requires_instructor);
    setPresentationType(format.presentation_type || "course");
  };
  const saveFormat = useMutation({
    mutationFn: () => {
      const input = {
        venue_id: venueId,
        name: formatName,
        description: formatDescription,
        full_description: formatFullDescription,
        image_urls: formatImages,
        age_group: ageGroup,
        level,
        requires_instructor: requiresInstructor,
        presentation_type: presentationType,
      };
      return editingFormatId
        ? updateCourseFormat({ ...input, format_id: editingFormatId })
        : createCourseFormat(input);
    },
    onSuccess: async (format) => {
      const savedPaths = new Set(formatImages.map(namedEventImagePath).filter(Boolean));
      const removedImages = (data?.formats.find((item) => item.id === editingFormatId)?.image_urls || []).filter((url) => !savedPaths.has(namedEventImagePath(url)));
      if (!editingFormatId) setFormatId(format.id);
      const message = editingFormatId ? "Format uppdaterat" : "Format skapat";
      resetFormat();
      await refresh();
      await Promise.allSettled(removedImages.map(removeNamedEventImage));
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const addFormatImage = async (file?: File) => {
    if (!file || !editingFormatId || formatImages.length >= 3) return;
    const slot = nextNamedEventImageSlot(formatImages); if (!slot) return;
    setFormatImageBusy(true);
    try {
      const url = await uploadNamedEventImage({ owner: "activity-formats", ownerId: editingFormatId, slot, file });
      setFormatImages((current) => [...current, url].slice(0, 3));
      toast.success("Bilden är uppladdad. Spara formatet för att publicera den.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Bilden kunde inte laddas upp."); }
    finally { setFormatImageBusy(false); }
  };
  const deleteFormatImage = (url: string) => setFormatImages((current) => current.filter((item) => item !== url));

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
    setSeriesImages([]);
  };
  const editSeries = useCallback((series: CourseSeries) => {
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
    setSeriesImages(series.image_urls || []);
    requestAnimationFrame(() => {
      if (typeof seriesEditorRef.current?.scrollIntoView === "function") {
        seriesEditorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, []);
  useEffect(() => {
    if (!catalogMode || !initialSeriesId || !data || editingSeriesId === initialSeriesId) return;
    const series = data.series.find((item) => item.id === initialSeriesId);
    if (series) editSeries(series);
  }, [catalogMode, data, editSeries, editingSeriesId, initialSeriesId]);
  useEffect(() => {
    if (catalogMode && !initialSeriesId && !editingSeriesId) setPresentationType(initialPresentationType);
  }, [catalogMode, editingSeriesId, initialPresentationType, initialSeriesId]);
  const saveSeries = useMutation({
    mutationFn: () => {
      const input = {
        ...previewInput,
        format_id: formatId,
        name,
        image_urls: seriesImages,
        registration_opens_at: isoLocal(registrationOpen, "00:00"),
        registration_closes_at: isoLocal(registrationClose, "23:59"),
        capacity: Number(capacity),
        price_sek: Number(price),
        total_sessions: Number(totalSessions),
      };
      return editingSeriesId ? updateCourseSeries(input) : createCourseSeries(input);
    },
    onSuccess: async () => {
      const savedPaths = new Set(seriesImages.map(namedEventImagePath).filter(Boolean));
      const removedImages = (editingSeries?.image_urls || []).filter((url) => !savedPaths.has(namedEventImagePath(url)));
      const message = editingSeriesId ? "Omgången är uppdaterad" : "Omgång skapad med konkreta tillfällen";
      if (!catalogMode) resetSeries();
      await refresh();
      await Promise.allSettled(removedImages.map(removeNamedEventImage));
      toast.success(message);
      if (catalogMode) onDone?.();
    },
    onError: async (error: Error) => {
      await resourcePreview.refetch();
      toast.error(error.message);
    },
  });
  const addSeriesImage = async (file?: File) => {
    if (!file || !editingSeriesId || seriesImages.length >= 3) return;
    const slot = nextNamedEventImageSlot(seriesImages); if (!slot) return;
    setSeriesImageBusy(true);
    try {
      const url = await uploadNamedEventImage({ owner: "activity-series", ownerId: editingSeriesId, slot, file });
      setSeriesImages((current) => [...current, url].slice(0, 3));
      toast.success("Bilden är uppladdad. Spara omgången för att publicera den.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Bilden kunde inte laddas upp."); }
    finally { setSeriesImageBusy(false); }
  };
  const deleteSeriesImage = (url: string) => setSeriesImages((current) => current.filter((item) => item !== url));
  const changeStatus = useMutation({
    mutationFn: ({ seriesId, status }: { seriesId: string; status: "active" | "paused" | "cancelled" }) => updateCourseSeries({ series_id: seriesId, status }),
    onSuccess: async (_result, variables) => {
      await refresh();
      toast.success(variables.status === "active" ? "Omgången är publicerad" : variables.status === "paused" ? "Omgången är avpublicerad" : "Utkastet är arkiverat");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetGrant = () => {
    setGrantSeriesId(null);
    setGrantSearch("");
    setGrantParticipant(null);
    setGrantReason("");
    setGrantRequestId("");
    setCancelGrantId(null);
    setCancelReason("");
    setCancelRequestId("");
  };
  const openGrant = (seriesId: string) => {
    if (grantSeriesId === seriesId) {
      resetGrant();
      return;
    }
    resetGrant();
    setGrantSeriesId(seriesId);
    setGrantRequestId(crypto.randomUUID());
  };
  const selectGrantParticipant = (participant: SeriesGrantParticipant) => {
    setGrantParticipant(participant);
    setGrantSearch(participant.name);
  };
  const grantPlace = useMutation({
    mutationFn: () => grantSeriesStaffPlace({
      venue_id: venueId,
      series_id: grantSeriesId!,
      participant_kind: grantParticipant!.kind,
      participant_id: grantParticipant!.id,
      reason: grantReason.trim(),
      request_id: grantRequestId,
    }),
    onSuccess: async () => {
      await refresh();
      resetGrant();
      toast.success("Plats given");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const startCancelGrant = (grantId: string) => {
    setCancelGrantId(grantId);
    setCancelReason("");
    setCancelRequestId(crypto.randomUUID());
  };
  const cancelPlace = useMutation({
    mutationFn: () => cancelSeriesStaffPlace({
      venue_id: venueId,
      commitment_id: cancelGrantId!,
      reason: cancelReason.trim(),
      request_id: cancelRequestId,
    }),
    onSuccess: async () => {
      await refresh();
      setCancelGrantId(null);
      setCancelReason("");
      setCancelRequestId("");
      toast.success("Friplatsen är borttagen");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveSeriesDisabled = !formatId || !name || !startDate || !endDate || !registrationOpen || !registrationClose
    || !previewEnabled || resourcePreview.isFetching || !resourcePreview.data || resourcePreview.data.has_conflicts
    || Number(capacity) < Number(editingSeries?.edit_policy?.minimum_capacity || 1) || Number(price) <= 0
    || editingSeries?.edit_policy?.lifecycle_editable === false || saveSeries.isPending;

  return (
    <section
      className={catalogMode ? "min-w-0" : "mb-6 rounded-2xl border border-border bg-card p-4"}
      data-testid="admin-courses"
      data-surface={catalogMode ? "catalog" : "legacy-schedule"}
      style={catalogMode ? ({ "--primary": "217 100% 62%", "--primary-foreground": "220 25% 8%" } as CSSProperties) : undefined}
    >
      {!catalogMode ? <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left">
        <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Program & Event</p><h2 className="mt-1 text-lg font-black">Koncept och omgångar</h2><p className="mt-1 text-xs text-muted-foreground">Koncept → omgång → tillfällen</p></div>
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button> : null}
      {catalogMode || open ? <div className={`${catalogMode ? "space-y-6" : "mt-5 space-y-6 border-t border-border pt-5"}`}>
        {!catalogMode ? <div data-testid="managed-series-list">
          <div className="flex items-end justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Omgångar</p><h3 className="mt-1 font-bold">Program & Event</h3></div>
            <span className="text-xs text-muted-foreground">{data?.series.length || 0} st</span>
          </div>
          <div className="mt-3 grid gap-2">
            {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (data?.series || []).map((series) => {
              const canEdit = series.edit_policy?.lifecycle_editable ?? ["draft", "active", "paused"].includes(series.status);
              const statusLabel = SERIES_STATUS_LABELS[series.status] || series.status;
              const presentationLabel = seriesPresentation(series.format?.presentation_type || "course").label;
              return <div key={series.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold">{series.name}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">{presentationLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${series.status === "active" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{statusLabel}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {DateTime.fromISO(series.start_date).setLocale("sv").toFormat("d MMM")}–{DateTime.fromISO(series.end_date).setLocale("sv").toFormat("d MMM yyyy")} · {series.sessions.length} {series.sessions.length === 1 ? "tillfälle" : "tillfällen"} · {series.capacity.capacity} platser
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {canEdit ? <button type="button" aria-label={`Redigera omgång ${series.name}`} onClick={() => editSeries(series)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Redigera</button> : null}
                    {series.status === "draft" ? <button type="button" onClick={() => editSeries(series)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"><Check className="h-3 w-3" />Publicera</button> : null}
                    {series.status === "paused" ? <button type="button" onClick={() => editSeries(series)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"><Check className="h-3 w-3" />Publicera igen</button> : null}
                  </div>
                </div>
              </div>;
            })}
          </div>
        </div> : null}

        {(!catalogMode || !initialSeriesId || editingFormatId) ? <div className={catalogMode ? "rounded-2xl border border-border bg-card p-4" : "border-t border-border pt-5"}>
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Koncept & innehåll</h3>{editingFormatId ? <button type="button" onClick={resetFormat} className="inline-flex items-center gap-1 text-xs font-bold"><X className="h-3.5 w-3.5" />Avbryt</button> : null}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input aria-label="Formatnamn" className={inputClass} value={formatName} onChange={(event) => setFormatName(event.target.value)} placeholder="Pickla 101 · Vuxen Nybörjare" />
            <input aria-label="Kort beskrivning" className={inputClass} value={formatDescription} onChange={(event) => setFormatDescription(event.target.value)} placeholder="Dina första fyra veckor med pickleball." />
            <textarea aria-label="Full beskrivning och innehåll" className={`${inputClass} min-h-44 py-3 sm:col-span-2`} value={formatFullDescription} onChange={(event) => setFormatFullDescription(event.target.value)} placeholder={"Introduktion\n\nUpplägg\n...\n\nDetta ingår\n...\n\nPraktisk information\n..."} />
            <select aria-label="Presentationstyp" className={inputClass} value={presentationType} onChange={(event) => setPresentationType(event.target.value as SeriesPresentationType)}>{SERIES_PRESENTATION_TYPES.map((type) => <option key={type} value={type}>{seriesPresentation(type).label}</option>)}</select>
            <select aria-label="Åldersgrupp" className={inputClass} value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}><option value="adult">Vuxen</option><option value="youth">Barn/ungdom</option><option value="all_ages">Alla åldrar</option></select>
            <select aria-label="Nivå" className={inputClass} value={level} onChange={(event) => setLevel(event.target.value)}><option value="intro">Introduktion</option><option value="beginner">Nybörjare</option><option value="intermediate">Fortsättning</option><option value="advanced">Avancerad</option></select>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={requiresInstructor} onChange={(event) => setRequiresInstructor(event.target.checked)} /> Kräver instruktör</label>
          {editingFormatId ? <div className="mt-4"><p className="text-xs font-bold">Konceptbilder · 16:9 · max 3</p><div className="mt-2 flex flex-wrap gap-2">{formatImages.map((url) => <div key={url} className="relative overflow-hidden rounded-xl border border-border"><img src={url} alt="" className="aspect-video w-28 object-cover" /><button type="button" onClick={() => deleteFormatImage(url)} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white" aria-label="Ta bort bild"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>{formatImages.length < 3 ? <label className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-xs font-bold"><ImagePlus className="h-4 w-4" />{formatImageBusy ? "Laddar..." : "Lägg till bild"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={formatImageBusy} onChange={(event) => void addFormatImage(event.target.files?.[0])} /></label> : null}</div> : <p className="mt-3 text-xs text-muted-foreground">Skapa formatet först för att lägga till återanvändbara bilder.</p>}
          <button type="button" onClick={() => saveFormat.mutate()} disabled={!formatName.trim() || saveFormat.isPending} className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40">{saveFormat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingFormatId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingFormatId ? "Spara format" : "Skapa format"}</button>
          {(data?.formats || []).length ? <div className="mt-4 grid gap-2">{data!.formats.map((format) => <div key={format.id} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3"><div><p className="text-sm font-bold">{format.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{format.description || "Ingen kort beskrivning"}</p></div><button type="button" aria-label={`Redigera koncept ${format.name}`} onClick={() => editFormat(format)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Redigera</button></div>)}</div> : null}
        </div> : null}

        {catalogMode && initialSeriesId && !editingSeries ? <div className="flex min-h-40 items-center justify-center rounded-2xl border border-border bg-card p-5">
          {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <p className="text-sm text-muted-foreground">Erbjudandet kunde inte öppnas.</p>}
        </div> : null}
        {(!catalogMode || !initialSeriesId || editingSeries) ? <div ref={seriesEditorRef} className={catalogMode ? "scroll-mt-4 rounded-2xl border border-border bg-card p-4" : "scroll-mt-4 border-t border-border pt-5"} data-testid="managed-series-editor">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{editingSeriesId ? "Redigera omgång" : "Ny omgång"}</p>
              <h3 className="mt-1 font-bold">{editingSeriesId ? name || "Befintlig omgång" : "Skapa program eller event"}</h3>
              {editingSeries ? <p className="mt-1 text-xs text-muted-foreground">{SERIES_STATUS_LABELS[editingSeries.status] || editingSeries.status} · {editingSeries.capacity.committed_count} av {editingSeries.capacity.capacity} platser</p> : null}
            </div>
            {editingSeriesId ? <button type="button" onClick={() => catalogMode ? onDone?.() : resetSeries()} className="inline-flex items-center gap-1 text-xs font-bold"><X className="h-3.5 w-3.5" />Stäng</button> : null}
          </div>
          {editingSeries && editingFormat ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
            <div><p className="text-xs font-bold">Innehåll · {editingFormat.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Beskrivning, nivå, målgrupp och instruktörskrav ägs av konceptet.</p></div>
            <button type="button" onClick={() => editFormat(editingFormat)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Redigera koncept</button>
          </div> : null}
          {editingSeries && scheduleLockCopy ? <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{scheduleLockCopy}</span></div> : null}
          <p className="mt-4 text-xs font-black uppercase tracking-wider text-muted-foreground">Innehåll</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select aria-label={catalogMode ? "Koncept" : "Format"} className={inputClass} value={formatId} disabled={Boolean(editingSeriesId)} onChange={(event) => setFormatId(event.target.value)}><option value="">Välj koncept</option>{(data?.formats || []).filter((format) => !catalogMode || Boolean(editingSeriesId) || format.presentation_type === initialPresentationType).map((format) => <option key={format.id} value={format.id}>{format.name}</option>)}</select>
            <input aria-label="Omgångens namn" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Pickla 101 · Höst 2026" />
          </div>
          {editingSeriesId ? <div className="mt-3"><p className="text-xs font-bold">Omgångsbild · 16:9 · max 3</p><p className="mt-0.5 text-[11px] text-muted-foreground">Valfri bild här ersätter konceptbilden för just denna omgång.</p><div className="mt-2 flex flex-wrap gap-2">{seriesImages.map((url) => <div key={url} className="relative overflow-hidden rounded-xl border border-border"><img src={url} alt="" className="aspect-video w-28 object-cover" /><button type="button" onClick={() => deleteSeriesImage(url)} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white" aria-label="Ta bort omgångsbild"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>{seriesImages.length < 3 ? <label className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-xs font-bold"><ImagePlus className="h-4 w-4" />{seriesImageBusy ? "Laddar..." : "Lägg till omgångsbild"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={seriesImageBusy} onChange={(event) => void addSeriesImage(event.target.files?.[0])} /></label> : null}</div> : null}

          <p className="mt-5 text-xs font-black uppercase tracking-wider text-muted-foreground">När</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">Start<input className={inputClass} disabled={!scheduleEditable} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Slut<input className={inputClass} disabled={!scheduleEditable} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Anmälan öppnar<input className={inputClass} type="date" value={registrationOpen} onChange={(event) => setRegistrationOpen(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Anmälan stänger<input className={inputClass} type="date" value={registrationClose} onChange={(event) => setRegistrationClose(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Starttid<input className={inputClass} disabled={!scheduleEditable} type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Sluttid<input className={inputClass} disabled={!scheduleEditable} type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            <label className="grid gap-1 text-xs text-muted-foreground">Tillfällen<input className={inputClass} disabled={!scheduleEditable} inputMode="numeric" value={totalSessions} onChange={(event) => setTotalSessions(event.target.value)} /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{DAYS.map((day) => <button key={day.value} type="button" disabled={!scheduleEditable} onClick={() => setDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value])} className={`rounded-full border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${days.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{day.label}</button>)}</div>
          <p className="mt-5 text-xs font-black uppercase tracking-wider text-muted-foreground">Banor</p>
          <div className="mt-3 flex flex-wrap gap-2">{(data?.courts || []).filter((court) => court.sport_type === "pickleball").map((court) => <button key={court.id} type="button" disabled={!scheduleEditable} onClick={() => setCourtIds((current) => current.includes(court.id) ? current.filter((id) => id !== court.id) : [...current, court.id])} className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50 ${courtIds.includes(court.id) ? "border-primary" : "border-border"}`}>{court.name}</button>)}</div>
          {previewDates.length ? <div className="mt-4 rounded-xl border border-border p-3" data-testid="course-resource-preview"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">Förhandsvisning · {occurrenceCountLabel(previewDates.length)}</p>{resourcePreview.isFetching ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Kontrollerar resurser</span> : null}</div>
            {!courtIds.length ? <p className="mt-2 text-xs text-destructive">Välj minst en bana för att kontrollera fysisk beläggning.</p> : null}
            {resourcePreview.isError ? <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />Resurskontrollen kunde inte genomföras. Serien kan inte sparas.</p> : null}
            {previewOccurrences.length ? <ol className="mt-3 grid gap-2">{previewOccurrences.map(([index, rows]) => {
              const occurrenceHasConflict = rows.some((row) => !row.is_available);
              const first = rows[0];
              return <li key={index} className={`rounded-lg border p-3 ${occurrenceHasConflict ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">{index}. {DateTime.fromISO(first.occurrence_date).setLocale("sv").toFormat("ccc d MMM")} · {startTime}–{endTime}</p><span className={`text-[11px] font-black uppercase tracking-wide ${occurrenceHasConflict ? "text-destructive" : "text-emerald-700"}`}>{occurrenceHasConflict ? "Konflikt" : "Ledig"}</span></div>
                <div className="mt-2 grid gap-2">{rows.map((row) => <div key={row.court_id} className="text-xs"><p className="font-semibold">{row.court_name}</p>{row.conflicts.map((conflict) => <p key={`${conflict.source_type}:${conflict.source_id}`} className="mt-1 flex items-start gap-1 text-destructive"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{conflict.title} · {DateTime.fromISO(conflict.starts_at).setZone("Europe/Stockholm").toFormat("HH:mm")}–{DateTime.fromISO(conflict.ends_at).setZone("Europe/Stockholm").toFormat("HH:mm")}</span></p>)}</div>)}</div>
              </li>;
            })}</ol> : null}
            {resourcePreview.data?.has_conflicts ? <p className="mt-3 text-xs font-semibold text-destructive">Ändra schema eller resurser innan serien kan sparas.</p> : null}
          </div> : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Platser</p><label className="mt-2 grid gap-1 text-xs text-muted-foreground">Total kapacitet<input className={inputClass} inputMode="numeric" min={editingSeries?.edit_policy?.minimum_capacity || 1} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>{editingSeries ? <p className="mt-1 text-[11px] text-muted-foreground">Minst {editingSeries.edit_policy?.minimum_capacity ?? editingSeries.capacity.committed_count} med aktiva platser och checkout-håll.</p> : null}</div>
            <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Pris</p><label className="mt-2 grid gap-1 text-xs text-muted-foreground">Ordinarie pris SEK<input className={inputClass} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} /></label>{editingSeries?.edit_policy?.historical_prices_frozen ? <p className="mt-1 text-[11px] text-muted-foreground">Ändringen gäller endast framtida köp. Tidigare order, kvitto och huvudbok förblir frusna.</p> : null}</div>
          </div>

          {editingSeries?.product ? <SeriesEarlyBirdEditor venueId={venueId} series={editingSeries} /> : null}
          {editingSeries?.product ? <SeriesIncludedAccessEditor venueId={venueId} series={editingSeries} /> : null}
          {editingSeriesId && memberPricing.isLoading ? <p className="mt-3 text-xs text-muted-foreground">Hämtar medlemspriser…</p> : null}
          {editingSeriesId && memberPricing.isError ? <p className="mt-3 text-xs text-destructive">Medlemspriserna kunde inte hämtas.</p> : null}
          {editingSeriesId && !memberPricing.isLoading && !memberPricing.isError ? <SeriesMemberPricingEditor
            venueId={venueId}
            item={memberPricing.data?.series.find((item) => item.series_id === editingSeriesId)}
          /> : null}

          <button type="button" onClick={() => saveSeries.mutate()} disabled={saveSeriesDisabled} className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40">{saveSeries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingSeriesId ? <Check className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}{editingSeriesId ? "Spara ändringar" : "Skapa omgång och tillfällen"}</button>

          {editingSeries ? <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3" data-testid="series-publication-readiness">
            <p className="text-xs font-black uppercase tracking-wider">Publicering</p>
            <ul className="mt-2 grid gap-1 text-xs">
              <li>{seriesDirty ? "○" : "✓"} {seriesDirty ? "Spara ändringarna före publicering" : "Alla ändringar är sparade"}</li>
              <li>{previewDates.length === Number(totalSessions) ? "✓" : "○"} Schema · {previewDates.length}/{totalSessions} tillfällen</li>
              <li>{resourcePreview.data && !resourcePreview.data.has_conflicts ? "✓" : "○"} Banor · konfliktkontroll</li>
              <li>{Number(capacity) >= Number(editingSeries.edit_policy?.minimum_capacity || 0) ? "✓" : "○"} Kapacitet · minst aktiva platser och håll</li>
              <li>{Number(price) > 0 && editingSeries.product?.is_active ? "✓" : "○"} Produkt och pris</li>
              <li>{editingFormat?.requires_instructor ? "✓ Instruktör krävs · bemannas i Operations" : "✓ Inget instruktörskrav"}</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {editingSeries.status === "draft" || editingSeries.status === "paused" ? <button type="button" onClick={() => changeStatus.mutate({ seriesId: editingSeries.id, status: "active" })} disabled={changeStatus.isPending || seriesDirty || !publicationReady} className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40"><Check className="h-3.5 w-3.5" />{editingSeries.status === "paused" ? "Publicera igen" : "Publicera"}</button> : null}
              {editingSeries.status === "active" ? <button type="button" onClick={() => changeStatus.mutate({ seriesId: editingSeries.id, status: "paused" })} disabled={changeStatus.isPending || seriesDirty} className="inline-flex h-10 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-bold disabled:opacity-40">Avpublicera</button> : null}
              {editingSeries.status === "draft" ? <button type="button" onClick={() => changeStatus.mutate({ seriesId: editingSeries.id, status: "cancelled" })} disabled={changeStatus.isPending || Boolean(editingSeries.edit_policy?.commitment_count || editingSeries.edit_policy?.order_history_count)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-destructive/30 px-3 text-xs font-bold text-destructive disabled:opacity-40">Arkivera utkast</button> : null}
            </div>
          </div> : null}
        </div> : null}

        {(!catalogMode || Boolean(editingSeriesId)) ? <div className={catalogMode ? "rounded-2xl border border-border bg-card p-4" : "border-t border-border pt-5"}>
          <h3 className="font-bold">Deltagare & tillfällen</h3>
          <div className="mt-3 grid gap-2">
            {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (data?.series || []).filter((series) => !catalogMode || series.id === editingSeriesId).map((series) => {
              const grantOpen = grantSeriesId === series.id;
              const activeGrants = series.staff_grants || [];
              return <div key={series.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{series.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {series.sessions.length} tillfällen · {series.capacity.committed_count}/{series.capacity.capacity} platser
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {series.sessions.some((session) => session.requires_staffing) ? "Instruktör krävs" : "Ingen instruktör krävs"}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${series.status === "active" ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{SERIES_STATUS_LABELS[series.status] || series.status}</span>
                    {series.status === "active" ? <button type="button" onClick={() => openGrant(series.id)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold"><Gift className="h-3.5 w-3.5" />Ge plats</button> : null}
                  </div>
                </div>

                {grantOpen ? <div className="mt-3 rounded-xl border border-border bg-background p-3" data-testid="series-staff-grant">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">Ge plats · {series.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {series.capacity.committed_count} av {series.capacity.capacity} bokade · {series.capacity.available_count} platser kvar
                      </p>
                    </div>
                    <button type="button" onClick={resetGrant} aria-label="Stäng Ge plats"><X className="h-4 w-4" /></button>
                  </div>

                  <label className="mt-3 grid gap-1 text-xs font-semibold">
                    Sök deltagare
                    <input
                      className={inputClass}
                      value={grantSearch}
                      onChange={(event) => { setGrantSearch(event.target.value); setGrantParticipant(null); }}
                      placeholder="Namn eller e-post"
                    />
                  </label>
                  {participantSearch.isFetching ? <p className="mt-2 text-xs text-muted-foreground">Söker…</p> : null}
                  {!grantParticipant && participantSearch.data?.items.length ? <div className="mt-2 grid gap-1">
                    {participantSearch.data.items.map((participant) => <button
                      key={`${participant.kind}:${participant.id}`}
                      type="button"
                      onClick={() => selectGrantParticipant(participant)}
                      className="rounded-lg border border-border p-2 text-left"
                    >
                      <span className="block text-xs font-bold">{participant.name}</span>
                      {participant.detail ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{participant.detail}</span> : null}
                    </button>)}
                  </div> : null}
                  {grantParticipant ? <p className="mt-2 rounded-lg bg-muted p-2 text-xs"><span className="font-bold">Vald:</span> {grantParticipant.name}{grantParticipant.kind === "dependent" ? " · barn/ungdom" : ""}</p> : null}

                  <label className="mt-3 grid gap-1 text-xs font-semibold">
                    Anledning
                    <textarea
                      className={`${inputClass} min-h-20 py-2`}
                      value={grantReason}
                      onChange={(event) => setGrantReason(event.target.value)}
                      placeholder="Varför ger Pickla den här platsen?"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => grantPlace.mutate()}
                    disabled={!grantParticipant || !grantReason.trim() || !grantRequestId || grantPlace.isPending || series.capacity.available_count <= 0}
                    className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
                  >
                    {grantPlace.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                    Ge plats
                  </button>

                  {activeGrants.length ? <div className="mt-4 border-t border-border pt-3">
                    <p className="text-xs font-bold">Givna platser</p>
                    <div className="mt-2 grid gap-2">{activeGrants.map((grant) => <div key={grant.id} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold">{grant.participant.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{grant.provenance_label}</p>
                          {grant.grant_reason ? <p className="mt-1 text-[11px] text-muted-foreground">{grant.grant_reason}</p> : null}
                        </div>
                        {cancelGrantId !== grant.id ? <button type="button" onClick={() => startCancelGrant(grant.id)} className="text-xs font-bold text-destructive">Ta bort plats</button> : null}
                      </div>
                      {cancelGrantId === grant.id ? <div className="mt-2 grid gap-2">
                        <input aria-label={`Anledning till att ta bort ${grant.participant.name}`} className={inputClass} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Anledning krävs" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => cancelPlace.mutate()} disabled={!cancelReason.trim() || cancelPlace.isPending} className="h-9 rounded-lg bg-destructive px-3 text-xs font-bold text-destructive-foreground disabled:opacity-40">Bekräfta</button>
                          <button type="button" onClick={() => setCancelGrantId(null)} className="h-9 rounded-lg border border-border px-3 text-xs font-bold">Avbryt</button>
                        </div>
                      </div> : null}
                    </div>)}</div>
                  </div> : null}
                </div> : null}

                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-bold">Kommande tillfällen</p>
                  <ol className="mt-2 grid gap-1.5">{series.sessions.filter((session) => session.is_active).map((session) => <li key={session.id} className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{session.series_occurrence_index}. {DateTime.fromISO(session.session_date).setLocale("sv").toFormat("ccc d MMM")}</span><span>{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</span></li>)}</ol>
                </div>
              </div>;
            })}
          </div>
        </div> : null}
      </div> : null}
    </section>
  );
}
