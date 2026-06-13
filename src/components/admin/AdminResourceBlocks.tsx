import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Ban, CalendarClock, CheckCircle2, ChevronDown, CircleSlash, Loader2, MapPin, Pencil, ShieldCheck } from "lucide-react";
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

interface ResourceBlockGroup {
  key: string;
  blockRef: string;
  title: string;
  reason: string;
  status: string;
  starts_at: string;
  ends_at: string;
  note: string;
  blocks: ResourceBlock[];
  isVenue: boolean;
  isAdjusted: boolean;
  hasConfirmed: boolean;
  hasHold: boolean;
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

function formatGroupTime(group: ResourceBlockGroup) {
  return formatBlockTime(group.blocks[0]);
}

function groupMetadata(block: ResourceBlock) {
  return block.metadata && typeof block.metadata === "object" ? block.metadata : {};
}

function groupKeyFor(block: ResourceBlock) {
  const metadata = groupMetadata(block);
  return String(metadata.group_id || metadata.block_ref || block.id);
}

function blockRefFor(block: ResourceBlock) {
  const metadata = groupMetadata(block);
  return String(metadata.block_ref || "Äldre block");
}

function noteFor(block: ResourceBlock) {
  const metadata = groupMetadata(block);
  return typeof metadata.note === "string" ? metadata.note : "";
}

function localPartsFor(block: ResourceBlock) {
  const start = DateTime.fromISO(block.starts_at, { zone: "utc" }).setZone("Europe/Stockholm");
  const end = DateTime.fromISO(block.ends_at, { zone: "utc" }).setZone("Europe/Stockholm");
  return {
    date: start.isValid ? start.toISODate() || "" : "",
    startTime: start.isValid ? start.toFormat("HH:mm") : "",
    endTime: end.isValid ? end.toFormat("HH:mm") : "",
  };
}

function buildGroups(blocks: ResourceBlock[]): ResourceBlockGroup[] {
  const buckets = new Map<string, ResourceBlock[]>();
  for (const block of blocks) {
    const key = groupKeyFor(block);
    buckets.set(key, [...(buckets.get(key) || []), block]);
  }

  return Array.from(buckets.entries()).map(([key, rows]) => {
    const first = rows[0];
    const firstTime = `${first.starts_at}|${first.ends_at}`;
    const firstStatus = first.status;
    const firstTitle = first.title;
    const firstNote = noteFor(first);
    const isAdjusted = rows.some((row) =>
      `${row.starts_at}|${row.ends_at}` !== firstTime ||
      row.status !== firstStatus ||
      row.title !== firstTitle ||
      noteFor(row) !== firstNote
    );

    return {
      key,
      blockRef: blockRefFor(first),
      title: first.title,
      reason: first.reason,
      status: first.status,
      starts_at: first.starts_at,
      ends_at: first.ends_at,
      note: firstNote,
      blocks: rows,
      isVenue: rows.some((row) => groupMetadata(row).scope === "venue" || !resourceFor(row)),
      isAdjusted,
      hasConfirmed: rows.some((row) => row.status === "confirmed"),
      hasHold: rows.some((row) => row.status === "hold"),
    };
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
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
  const [note, setNote] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingGroups, setEditingGroups] = useState<Record<string, boolean>>({});
  const [groupDrafts, setGroupDrafts] = useState<Record<string, { date: string; startTime: string; endTime: string; note: string; courtIds: string[] }>>({});

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

  const activeGroups = useMemo(() => buildGroups(activeBlocks), [activeBlocks]);

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
      note,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      setSelectedCourtIds([]);
      setNote("");
      toast.success("Blockering skapad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateBlock = useMutation({
    mutationFn: ({ blockId, blockIds, nextStatus }: { blockId?: string; blockIds?: string[]; nextStatus: string }) => apiPatch("api-admin", "resource-blocks", {
      venueId,
      blockId,
      blockIds,
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
    mutationFn: ({ blockId, blockIds }: { blockId?: string; blockIds?: string[] }) => apiDelete("api-admin", "resource-blocks", {
      venueId,
      ...(blockIds?.length ? { blockIds: blockIds.join(",") } : { blockId: blockId || "" }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      toast.success("Blockering släppt");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateGroup = useMutation({
    mutationFn: ({ group, draft }: { group: ResourceBlockGroup; draft: { date: string; startTime: string; endTime: string; note: string } }) => apiPatch("api-admin", "resource-blocks", {
      venueId,
      blockIds: group.blocks.map((block) => block.id),
      date: draft.date,
      start_time: draft.startTime,
      end_time: draft.endTime,
      note: draft.note,
    }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      setEditingGroups((current) => ({ ...current, [variables.group.key]: false }));
      toast.success("Grupp uppdaterad");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addResourcesToGroup = useMutation({
    mutationFn: ({ group, draft }: { group: ResourceBlockGroup; draft: { date: string; startTime: string; endTime: string; note: string; courtIds: string[] } }) => apiPost("api-admin", "resource-blocks", {
      venueId,
      title: group.title,
      reason: group.reason,
      status: group.status,
      date: draft.date,
      start_time: draft.startTime,
      end_time: draft.endTime,
      scope: "courts",
      venue_court_ids: draft.courtIds,
      blocks_public_booking: true,
      group_id: group.key,
      block_ref: group.blockRef,
      note: draft.note,
    }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["admin-resource-blocks", venueId] });
      setGroupDrafts((current) => ({
        ...current,
        [variables.group.key]: { ...current[variables.group.key], courtIds: [] },
      }));
      toast.success("Resurs tillagd");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canCreate = title.trim() && date && startTime && endTime && (scope === "venue" || selectedCourtIds.length > 0);

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  };

  const startEditGroup = (group: ResourceBlockGroup) => {
    const parts = localPartsFor(group.blocks[0]);
    setGroupDrafts((current) => ({
      ...current,
      [group.key]: current[group.key] || { date: parts.date, startTime: parts.startTime, endTime: parts.endTime, note: group.note, courtIds: [] },
    }));
    setEditingGroups((current) => ({ ...current, [group.key]: true }));
    setExpandedGroups((current) => ({ ...current, [group.key]: true }));
  };

  const setGroupDraft = (groupKey: string, patch: Partial<{ date: string; startTime: string; endTime: string; note: string; courtIds: string[] }>) => {
    setGroupDrafts((current) => ({
      ...current,
      [groupKey]: {
        date: current[groupKey]?.date || today,
        startTime: current[groupKey]?.startTime || "18:00",
        endTime: current[groupKey]?.endTime || "20:00",
        note: current[groupKey]?.note || "",
        courtIds: current[groupKey]?.courtIds || [],
        ...patch,
      },
    }));
  };

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

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-20 w-full rounded-xl bg-muted/40 border border-border px-4 py-3 text-sm outline-none focus:border-primary/60"
          placeholder="Kommentar, t.ex. Softtronic AW eller preliminärt hold"
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
            <h2 className="text-lg font-display font-bold text-foreground mt-1">
              {activeGroups.length} grupper · {activeBlocks.length} resurser
            </h2>
          </div>
          <Ban className="w-5 h-5 text-primary" />
        </div>

        {blocksLoading ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Hämtar blockeringar
          </div>
        ) : activeGroups.length === 0 ? (
          <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            Inga aktiva blockeringar.
          </div>
        ) : (
          <div className="space-y-2">
            {activeGroups.map((group) => {
              const isConfirmed = group.hasConfirmed && !group.hasHold;
              const isExpanded = Boolean(expandedGroups[group.key]);
              const isEditing = Boolean(editingGroups[group.key]);
              const blockIds = group.blocks.map((block) => block.id);
              const draft = groupDrafts[group.key];
              const usedCourtIds = new Set(group.blocks.map((block) => resourceFor(block)?.venue_court_id).filter(Boolean));
              const addableCourts = sortedCourts.filter((court) => !usedCourtIds.has(court.id));
              return (
                <div key={group.key} className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isConfirmed ? "bg-court-free/15" : "bg-primary/15"}`}>
                      {isConfirmed ? <ShieldCheck className="w-5 h-5 text-court-free" /> : <CalendarClock className="w-5 h-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-foreground truncate">{group.title}</p>
                        <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {group.blockRef}
                        </span>
                        {group.isAdjusted && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                            Delvis justerad
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{formatGroupTime(group)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" />
                        {group.isVenue ? "Hela lokalen" : `${group.blocks.length} resurser`}
                      </p>
                      {group.note && <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{group.note}</p>}
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      isConfirmed ? "bg-court-free/15 text-court-free" : "bg-primary/15 text-primary"
                    }`}>
                      {isConfirmed ? "Bekräftad" : group.hasConfirmed ? "Delvis" : "Hold"}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={updateBlock.isPending}
                      onClick={() => updateBlock.mutate({ blockIds, nextStatus: isConfirmed ? "hold" : "confirmed" })}
                      className="rounded-xl bg-muted/50 px-3 py-3 text-xs font-bold text-foreground disabled:opacity-50"
                    >
                      <CheckCircle2 className="inline w-4 h-4 mr-1" />
                      {isConfirmed ? "Gör hold" : "Bekräfta alla"}
                    </button>
                    <button
                      type="button"
                      disabled={releaseBlock.isPending}
                      onClick={() => releaseBlock.mutate({ blockIds })}
                      className="rounded-xl bg-destructive/10 px-3 py-3 text-xs font-bold text-destructive disabled:opacity-50"
                    >
                      <CircleSlash className="inline w-4 h-4 mr-1" />
                      Släpp alla
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="rounded-xl bg-muted/50 px-3 py-3 text-xs font-bold text-foreground"
                    >
                      <ChevronDown className={`inline w-4 h-4 mr-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      {isExpanded ? "Dölj" : "Visa"}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 rounded-2xl border border-border bg-background/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resurser</p>
                        <button
                          type="button"
                          onClick={() => startEditGroup(group)}
                          className="rounded-full bg-muted/60 px-3 py-1.5 text-[11px] font-bold text-foreground"
                        >
                          <Pencil className="inline w-3 h-3 mr-1" />
                          Redigera grupp
                        </button>
                      </div>

                      <div className="space-y-2">
                        {group.blocks.map((block) => {
                          const resource = resourceFor(block);
                          const rowConfirmed = block.status === "confirmed";
                          const isVenue = groupMetadata(block).scope === "venue" || !resource;
                          return (
                            <div key={block.id} className="rounded-xl border border-border bg-muted/20 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-black text-foreground truncate">{isVenue ? "Hela lokalen" : resource?.name || "Resurs"}</p>
                                  <p className="text-[11px] text-muted-foreground">{formatBlockTime(block)}</p>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${rowConfirmed ? "bg-court-free/15 text-court-free" : "bg-primary/15 text-primary"}`}>
                                  {rowConfirmed ? "Bekräftad" : "Hold"}
                                </span>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  disabled={updateBlock.isPending}
                                  onClick={() => updateBlock.mutate({ blockId: block.id, nextStatus: rowConfirmed ? "hold" : "confirmed" })}
                                  className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] font-bold text-foreground disabled:opacity-50"
                                >
                                  {rowConfirmed ? "Gör hold" : "Bekräfta"}
                                </button>
                                <button
                                  type="button"
                                  disabled={releaseBlock.isPending}
                                  onClick={() => releaseBlock.mutate({ blockId: block.id })}
                                  className="rounded-lg bg-destructive/10 px-3 py-2 text-[11px] font-bold text-destructive disabled:opacity-50"
                                >
                                  Släpp rad
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {isEditing && draft && (
                        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Redigera alla rader</p>
                          <textarea
                            value={draft.note}
                            onChange={(event) => setGroupDraft(group.key, { note: event.target.value })}
                            className="min-h-16 w-full rounded-xl bg-background/60 border border-border px-3 py-2 text-xs outline-none focus:border-primary/60"
                            placeholder="Kommentar"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="date"
                              value={draft.date}
                              onChange={(event) => setGroupDraft(group.key, { date: event.target.value })}
                              className="rounded-xl bg-background/60 border border-border px-3 py-2 text-xs outline-none focus:border-primary/60"
                            />
                            <input
                              type="time"
                              value={draft.startTime}
                              onChange={(event) => setGroupDraft(group.key, { startTime: event.target.value })}
                              className="rounded-xl bg-background/60 border border-border px-3 py-2 text-xs outline-none focus:border-primary/60"
                            />
                            <input
                              type="time"
                              value={draft.endTime}
                              onChange={(event) => setGroupDraft(group.key, { endTime: event.target.value })}
                              className="rounded-xl bg-background/60 border border-border px-3 py-2 text-xs outline-none focus:border-primary/60"
                            />
                          </div>
                          {!group.isVenue && addableCourts.length > 0 && (
                            <div>
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lägg till bana</p>
                              <div className="flex flex-wrap gap-2">
                                {addableCourts.map((court) => {
                                  const selected = draft.courtIds.includes(court.id);
                                  return (
                                    <button
                                      key={court.id}
                                      type="button"
                                      onClick={() => setGroupDraft(group.key, {
                                        courtIds: selected ? draft.courtIds.filter((id) => id !== court.id) : [...draft.courtIds, court.id],
                                      })}
                                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                                        selected ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground"
                                      }`}
                                    >
                                      {court.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={updateGroup.isPending}
                              onClick={() => updateGroup.mutate({ group, draft })}
                              className="rounded-xl bg-primary px-3 py-3 text-xs font-black text-primary-foreground disabled:opacity-50"
                            >
                              Spara grupp
                            </button>
                            <button
                              type="button"
                              disabled={addResourcesToGroup.isPending || draft.courtIds.length === 0}
                              onClick={() => addResourcesToGroup.mutate({ group, draft })}
                              className="rounded-xl bg-muted/60 px-3 py-3 text-xs font-black text-foreground disabled:opacity-50"
                            >
                              Lägg till {draft.courtIds.length || ""} resurser
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
