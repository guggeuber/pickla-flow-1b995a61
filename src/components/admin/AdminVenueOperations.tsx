import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Activity, Ban, Building2, CalendarClock, CircleSlash, Loader2, MapPin, ShieldAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

interface Court {
  id: string;
  name: string;
  court_number: number;
  sport_type: string | null;
}

interface OperationOverride {
  id: string;
  title: string;
  reason: string | null;
  override_type: string;
  starts_at: string;
  ends_at: string;
  affects_entire_venue: boolean;
  status: string;
  metadata?: {
    venue_court_ids?: string[];
    impact_snapshot?: {
      bookings_count?: number;
      activities_count?: number;
      blocks_count?: number;
    };
  } | null;
}

interface ImpactAnalysis {
  bookings: { count: number; samples: unknown[] };
  activities: { count: number; samples: unknown[]; limited?: boolean };
  blocks: { count: number; samples: unknown[] };
}

const OVERRIDE_TYPES = [
  { value: "closed", label: "Stängt", icon: ShieldAlert },
  { value: "maintenance", label: "Underhåll", icon: Wrench },
  { value: "private_event", label: "Privat event", icon: Building2 },
  { value: "staffing", label: "Bemanning", icon: Activity },
  { value: "other", label: "Övrigt", icon: Ban },
];

function formatRange(startsAt: string, endsAt: string) {
  const start = DateTime.fromISO(startsAt, { zone: "utc" }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(endsAt, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!start.isValid || !end.isValid) return "Okänd tid";
  return `${start.toFormat("ccc d LLL HH:mm")}–${end.toFormat("HH:mm")}`;
}

function typeLabel(value: string) {
  return OVERRIDE_TYPES.find((item) => item.value === value)?.label || value;
}

function courtNames(courts: Court[], ids: string[]) {
  const byId = new Map(courts.map((court) => [court.id, court.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean).join(", ");
}

export default function AdminVenueOperations({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const today = DateTime.now().setZone("Europe/Stockholm").toISODate() || "";
  const from = DateTime.now().setZone("Europe/Stockholm").minus({ days: 1 }).startOf("day").toUTC().toISO() || "";
  const [title, setTitle] = useState("Driftavvikelse");
  const [reason, setReason] = useState("");
  const [overrideType, setOverrideType] = useState("closed");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [affectsEntireVenue, setAffectsEntireVenue] = useState(true);
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [impact, setImpact] = useState<ImpactAnalysis | null>(null);

  const { data: courts = [], isLoading: courtsLoading } = useQuery<Court[]>({
    queryKey: ["admin-courts", venueId],
    queryFn: () => apiGet("api-admin", "courts", { venueId }),
    enabled: Boolean(venueId),
  });

  const { data: overrides = [], isLoading: overridesLoading } = useQuery<OperationOverride[]>({
    queryKey: ["admin-venue-operation-overrides", venueId, from],
    queryFn: () => apiGet("api-admin", "venue-operation-overrides", { venueId, from }),
    enabled: Boolean(venueId),
  });

  const sortedCourts = useMemo(
    () => [...courts].sort((a, b) => (a.sport_type || "").localeCompare(b.sport_type || "") || a.court_number - b.court_number),
    [courts],
  );

  const activeOverrides = useMemo(
    () => overrides.filter((row) => row.status === "active"),
    [overrides],
  );

  const requestBody = {
    venueId,
    title: title.trim(),
    reason: reason.trim(),
    override_type: overrideType,
    date,
    start_time: startTime,
    end_time: endTime,
    affects_entire_venue: affectsEntireVenue,
    venue_court_ids: affectsEntireVenue ? [] : selectedCourtIds,
  };

  const analyzeImpact = useMutation({
    mutationFn: () => apiPost<ImpactAnalysis>("api-admin", "venue-operation-impact", requestBody),
    onSuccess: (data) => setImpact(data),
    onError: (err: Error) => toast.error(err.message),
  });

  const createOverride = useMutation({
    mutationFn: () => apiPost<{ impact: ImpactAnalysis }>("api-admin", "venue-operation-overrides", requestBody),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin-venue-operation-overrides", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      setImpact(data.impact);
      setReason("");
      setSelectedCourtIds([]);
      toast.success("Driftavvikelse skapad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelOverride = useMutation({
    mutationFn: (overrideId: string) => apiPatch("api-admin", "venue-operation-overrides", { venueId, overrideId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-venue-operation-overrides", venueId] });
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      toast.success("Driftavvikelse avslutad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds((current) =>
      current.includes(courtId) ? current.filter((id) => id !== courtId) : [...current, courtId],
    );
    setImpact(null);
  };

  const canCreate = title.trim() && date && startTime && endTime && (affectsEntireVenue || selectedCourtIds.length > 0);

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ny driftavvikelse</p>
            <h2 className="mt-1 text-lg font-display font-bold text-foreground">Planerad påverkan</h2>
          </div>
          <CalendarClock className="w-5 h-5 text-primary" />
        </div>

        <input
          value={title}
          onChange={(event) => { setTitle(event.target.value); setImpact(null); }}
          className="w-full rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm font-semibold outline-none focus:border-primary/60"
          placeholder="Titel, t.ex. Morgonstängt"
        />

        <textarea
          value={reason}
          onChange={(event) => { setReason(event.target.value); setImpact(null); }}
          className="min-h-20 w-full rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          placeholder="Orsak eller intern kommentar"
        />

        <div className="grid grid-cols-2 gap-2">
          {OVERRIDE_TYPES.map((item) => {
            const Icon = item.icon;
            const selected = overrideType === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => { setOverrideType(item.value); setImpact(null); }}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  selected ? "border-primary bg-primary/10" : "border-border bg-muted/30"
                }`}
              >
                <Icon className={`mb-2 w-4 h-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                <span className="text-xs font-bold text-foreground">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setAffectsEntireVenue(true); setImpact(null); }}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              affectsEntireVenue ? "border-primary bg-primary/10" : "border-border bg-muted/30"
            }`}
          >
            <p className="text-sm font-bold">Hela lokalen</p>
            <p className="text-[11px] text-muted-foreground">Skapar venue-block</p>
          </button>
          <button
            type="button"
            onClick={() => { setAffectsEntireVenue(false); setImpact(null); }}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              !affectsEntireVenue ? "border-primary bg-primary/10" : "border-border bg-muted/30"
            }`}
          >
            <p className="text-sm font-bold">Valda banor</p>
            <p className="text-[11px] text-muted-foreground">{selectedCourtIds.length} valda</p>
          </button>
        </div>

        {!affectsEntireVenue && (
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Banor</p>
              <span className="text-[11px] text-muted-foreground">{selectedCourtIds.length} valda</span>
            </div>
            {courtsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Hämtar banor
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedCourts.map((court) => {
                  const selected = selectedCourtIds.includes(court.id);
                  return (
                    <button
                      key={court.id}
                      type="button"
                      onClick={() => toggleCourt(court.id)}
                      className={`rounded-full border px-3 py-2 text-xs font-bold transition-colors ${
                        selected ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground"
                      }`}
                    >
                      {court.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => { setDate(event.target.value); setImpact(null); }}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
          <input
            type="time"
            value={startTime}
            onChange={(event) => { setStartTime(event.target.value); setImpact(null); }}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
          <input
            type="time"
            value={endTime}
            onChange={(event) => { setEndTime(event.target.value); setImpact(null); }}
            className="col-span-2 rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
        </div>

        {impact && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
              <p className="text-xl font-display font-black text-foreground">{impact.bookings.count}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Bokningar</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
              <p className="text-xl font-display font-black text-foreground">{impact.activities.count}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Aktiviteter</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
              <p className="text-xl font-display font-black text-foreground">{impact.blocks.count}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Block</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canCreate || analyzeImpact.isPending}
            onClick={() => analyzeImpact.mutate()}
            className="rounded-2xl bg-muted/60 px-4 py-4 text-sm font-black text-foreground disabled:opacity-50"
          >
            {analyzeImpact.isPending ? "Analyserar..." : "Analysera"}
          </button>
          <button
            type="button"
            disabled={!canCreate || createOverride.isPending}
            onClick={() => createOverride.mutate()}
            className="rounded-2xl bg-primary px-4 py-4 text-sm font-black text-primary-foreground disabled:opacity-50"
          >
            {createOverride.isPending ? "Skapar..." : "Skapa drift"}
          </button>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Aktiva driftavvikelser</p>
            <h2 className="mt-1 text-lg font-display font-bold text-foreground">{activeOverrides.length} aktiva</h2>
          </div>
          <Ban className="w-5 h-5 text-primary" />
        </div>

        {overridesLoading ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Hämtar drift
          </div>
        ) : activeOverrides.length === 0 ? (
          <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            Inga aktiva driftavvikelser.
          </div>
        ) : (
          <div className="space-y-2">
            {activeOverrides.map((override) => {
              const courtIds = override.metadata?.venue_court_ids || [];
              const impactSnapshot = override.metadata?.impact_snapshot;
              return (
                <div key={override.id} className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                      <CalendarClock className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-black text-foreground">{override.title}</p>
                        <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {typeLabel(override.override_type)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatRange(override.starts_at, override.ends_at)}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        {override.affects_entire_venue ? "Hela lokalen" : courtNames(courts, courtIds) || `${courtIds.length} banor`}
                      </p>
                      {override.reason && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{override.reason}</p>}
                    </div>
                    <span className="rounded-full bg-court-free/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-court-free">
                      Aktiv
                    </span>
                  </div>

                  {impactSnapshot && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <span className="rounded-lg bg-background/40 px-2 py-2 text-[11px] font-bold text-muted-foreground">
                        {impactSnapshot.bookings_count || 0} bokn.
                      </span>
                      <span className="rounded-lg bg-background/40 px-2 py-2 text-[11px] font-bold text-muted-foreground">
                        {impactSnapshot.activities_count || 0} akt.
                      </span>
                      <span className="rounded-lg bg-background/40 px-2 py-2 text-[11px] font-bold text-muted-foreground">
                        {impactSnapshot.blocks_count || 0} block
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={cancelOverride.isPending}
                    onClick={() => cancelOverride.mutate(override.id)}
                    className="w-full rounded-xl bg-destructive/10 px-3 py-3 text-xs font-bold text-destructive disabled:opacity-50"
                  >
                    <CircleSlash className="inline w-4 h-4 mr-1" />
                    Avsluta driftavvikelse
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
