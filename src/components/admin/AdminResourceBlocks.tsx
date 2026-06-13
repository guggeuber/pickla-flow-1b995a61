import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Ban, CalendarClock, CheckCircle2, CircleSlash, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

interface Court {
  id: string;
  name: string;
  court_number: number;
  sport_type: string | null;
  is_available?: boolean | null;
}

interface ResourceCatalog {
  id: string;
  name: string;
  resource_type: string;
  venue_court_id?: string | null;
}

interface ResourceBlock {
  id: string;
  title: string;
  reason: string;
  status: string;
  starts_at: string;
  ends_at: string;
  blocks_public_booking: boolean;
  metadata?: Record<string, unknown> | null;
  event_resource_catalog?: ResourceCatalog | ResourceCatalog[] | null;
}

const REASONS = [
  { value: "manual", label: "Manuell" },
  { value: "event", label: "Event" },
  { value: "maintenance", label: "Underhåll" },
  { value: "private", label: "Privat" },
  { value: "internal", label: "Intern" },
];

const STATUSES = [
  { value: "hold", label: "Hold" },
  { value: "confirmed", label: "Bekräftad" },
];

function resourceFor(block: ResourceBlock) {
  const resource = block.event_resource_catalog;
  return Array.isArray(resource) ? resource[0] : resource;
}

function formatBlockTime(block: ResourceBlock) {
  const start = DateTime.fromISO(block.starts_at, { zone: "utc" }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(block.ends_at, { zone: "utc" }).setZone("Europe/Stockholm");
  if (!start.isValid || !end.isValid) return "Okänd tid";
  return `${start.toFormat("ccc d LLL HH:mm")}–${end.toFormat("HH:mm")}`;
}

export default function AdminResourceBlocks({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const today = DateTime.now().setZone("Europe/Stockholm").toISODate() || "";
  const [title, setTitle] = useState("Eventblockering");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [reason, setReason] = useState("manual");
  const [status, setStatus] = useState("hold");
  const [scope, setScope] = useState<"courts" | "venue">("courts");
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);

  const from = DateTime.now().setZone("Europe/Stockholm").minus({ days: 1 }).startOf("day").toUTC().toISO() || "";

  const { data: courts = [], isLoading: courtsLoading } = useQuery<Court[]>({
    queryKey: ["admin-courts", venueId],
    queryFn: () => apiGet("api-admin", "courts", { venueId }),
    enabled: Boolean(venueId),
  });

  const { data: blocks = [], isLoading: blocksLoading } = useQuery<ResourceBlock[]>({
    queryKey: ["admin-resource-blocks", venueId, from],
    queryFn: () => apiGet("api-admin", "resource-blocks", { venueId, from }),
    enabled: Boolean(venueId),
  });

  const sortedCourts = useMemo(
    () => [...courts].sort((a, b) => (a.sport_type || "").localeCompare(b.sport_type || "") || a.court_number - b.court_number),
    [courts],
  );

  const activeBlocks = useMemo(
    () => blocks.filter((block) => block.status === "hold" || block.status === "confirmed"),
    [blocks],
  );

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds((current) =>
      current.includes(courtId) ? current.filter((id) => id !== courtId) : [...current, courtId],
    );
  };

  const createBlock = useMutation({
    mutationFn: () => apiPost("api-admin", "resource-blocks", {
      venueId,
      title: title.trim(),
      reason,
      status,
      date,
      start_time: startTime,
      end_time: endTime,
      scope,
      venue_court_ids: scope === "courts" ? selectedCourtIds : [],
      blocks_public_booking: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      setSelectedCourtIds([]);
      toast.success("Blockering skapad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateBlock = useMutation({
    mutationFn: ({ blockId, nextStatus }: { blockId: string; nextStatus: string }) => apiPatch("api-admin", "resource-blocks", {
      venueId,
      blockId,
      status: nextStatus,
      blocks_public_booking: nextStatus === "hold" || nextStatus === "confirmed",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      toast.success("Blockering uppdaterad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const releaseBlock = useMutation({
    mutationFn: (blockId: string) => apiDelete("api-admin", "resource-blocks", { venueId, blockId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      toast.success("Blockering släppt");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canCreate = title.trim() && date && startTime && endTime && (scope === "venue" || selectedCourtIds.length > 0);

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ny blockering</p>
          <h2 className="text-lg font-display font-bold text-foreground mt-1">Blockera resurser</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Skapar holds som stoppar publik banbokning när status är hold eller bekräftad.
          </p>
        </div>

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm font-semibold outline-none focus:border-primary/60"
          placeholder="Titel, t.ex. Företagsevent"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScope("courts")}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              scope === "courts" ? "border-primary bg-primary/10" : "border-border bg-muted/30"
            }`}
          >
            <p className="text-sm font-bold">Banor</p>
            <p className="text-[11px] text-muted-foreground">Välj en eller flera</p>
          </button>
          <button
            type="button"
            onClick={() => setScope("venue")}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              scope === "venue" ? "border-primary bg-primary/10" : "border-border bg-muted/30"
            }`}
          >
            <p className="text-sm font-bold">Hela lokalen</p>
            <p className="text-[11px] text-muted-foreground">Stoppar alla banor</p>
          </button>
        </div>

        {scope === "courts" && (
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-3">
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
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          >
            {REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
          <input
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="col-span-2 rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          >
            {STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        <button
          type="button"
          disabled={!canCreate || createBlock.isPending}
          onClick={() => createBlock.mutate()}
          className="w-full rounded-2xl bg-primary px-4 py-4 text-sm font-black text-primary-foreground disabled:opacity-50"
        >
          {createBlock.isPending ? "Skapar..." : "Skapa blockering"}
        </button>
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Aktiva blockeringar</p>
            <h2 className="text-lg font-display font-bold text-foreground mt-1">{activeBlocks.length} holds</h2>
          </div>
          <Ban className="w-5 h-5 text-primary" />
        </div>

        {blocksLoading ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Hämtar blockeringar
          </div>
        ) : activeBlocks.length === 0 ? (
          <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            Inga aktiva blockeringar.
          </div>
        ) : (
          <div className="space-y-2">
            {activeBlocks.map((block) => {
              const resource = resourceFor(block);
              const isVenue = block.metadata?.scope === "venue" || !resource;
              const isConfirmed = block.status === "confirmed";
              return (
                <div key={block.id} className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isConfirmed ? "bg-court-free/15" : "bg-primary/15"}`}>
                      {isConfirmed ? <ShieldCheck className="w-5 h-5 text-court-free" /> : <CalendarClock className="w-5 h-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-foreground truncate">{block.title}</p>
                      <p className="text-xs text-muted-foreground">{formatBlockTime(block)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" />
                        {isVenue ? "Hela lokalen" : resource?.name || "Resurs"}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      isConfirmed ? "bg-court-free/15 text-court-free" : "bg-primary/15 text-primary"
                    }`}>
                      {isConfirmed ? "Bekräftad" : "Hold"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={updateBlock.isPending}
                      onClick={() => updateBlock.mutate({ blockId: block.id, nextStatus: isConfirmed ? "hold" : "confirmed" })}
                      className="col-span-2 rounded-xl bg-muted/50 px-3 py-3 text-xs font-bold text-foreground disabled:opacity-50"
                    >
                      <CheckCircle2 className="inline w-4 h-4 mr-1" />
                      {isConfirmed ? "Gör hold" : "Bekräfta"}
                    </button>
                    <button
                      type="button"
                      disabled={releaseBlock.isPending}
                      onClick={() => releaseBlock.mutate(block.id)}
                      className="rounded-xl bg-destructive/10 px-3 py-3 text-xs font-bold text-destructive disabled:opacity-50"
                    >
                      <CircleSlash className="inline w-4 h-4 mr-1" />
                      Släpp
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
