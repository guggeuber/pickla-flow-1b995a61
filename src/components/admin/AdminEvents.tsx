import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, ChevronRight, Trash2, Tag, Copy, ExternalLink, Upload, X, FileText, CalendarDays, Columns3, Presentation, Users, Eye, LayoutGrid, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

interface EventRow {
  id: string;
  name: string;
  display_name: string | null;
  event_type: string;
  format: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  entry_fee: number | null;
  entry_fee_type: string;
  is_public: boolean | null;
  show_on_sticker: boolean;
  number_of_courts: number | null;
  description?: string | null;
  category?: string;
  is_drop_in?: boolean;
  registration_fields?: string[];
  whatsapp_url?: string | null;
  slug?: string | null;
  logo_url?: string | null;
  planning_status?: string | null;
  visibility?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  expected_participants?: number | null;
  owner_name?: string | null;
  partner_notes?: string | null;
  internal_notes?: string | null;
  resources?: string[] | null;
  staffing?: string | null;
  event_courts?: { id: string; name: string; court_number: number }[];
}

interface CourtOption {
  id: string;
  name: string;
  court_number: number;
}

interface CategoryOption {
  key: string;
  label: string;
}

const DEFAULT_CATEGORIES: CategoryOption[] = [
  { key: "tournament", label: "Turnering" },
  { key: "open_play", label: "Open Play" },
  { key: "training", label: "Träning" },
  { key: "social", label: "Social / Klubb" },
];

const PIPELINE_STAGES = [
  { key: "inquiry", label: "Förfrågan", tone: "bg-sky-500" },
  { key: "tentative", label: "Preliminär", tone: "bg-amber-500" },
  { key: "booked", label: "Bokad", tone: "bg-blue-500" },
  { key: "ready", label: "Redo att publicera", tone: "bg-violet-500" },
  { key: "published", label: "Publicerad", tone: "bg-emerald-500" },
  { key: "done", label: "Genomförd", tone: "bg-muted-foreground" },
  { key: "cancelled", label: "Avbokad", tone: "bg-red-500" },
];

const VISIBILITY_LABELS: Record<string, string> = {
  internal: "Intern",
  partners: "Partners",
  public: "Publik",
};

type AdminEventView = "pipeline" | "calendar" | "meeting";
type EventTimeFilter = "upcoming" | "all" | "archive";

const RESOURCE_PRESETS = [
  "Hela hallen",
  "Hela darten",
  "Lounge",
  "Restaurang",
  "Scen",
  "Bar",
  "Reception",
  "AV/ljud",
  "Projektor",
  "Catering",
];

function parseResources(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatEventDate(evt: EventRow) {
  return evt.start_date ? format(new Date(evt.start_date), "d MMM yyyy") : "Datum sätts";
}

function formatEventTime(evt: EventRow) {
  if (!evt.start_time) return "Tid sätts";
  return `${evt.start_time.slice(0, 5)}${evt.end_time ? `-${evt.end_time.slice(0, 5)}` : ""}`;
}

function isArchivedEvent(evt: EventRow) {
  const planning = evt.planning_status || (evt.is_public ? "published" : "booked");
  if (planning === "done" || planning === "cancelled") return true;
  if (!evt.start_date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(evt.start_date);
  eventDay.setHours(0, 0, 0, 0);
  return eventDay < today;
}

function useVenueCategories(venueId?: string) {
  return useQuery<CategoryOption[]>({
    queryKey: ["venue-categories", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("venue_event_categories")
        .select("category_key, display_name")
        .eq("venue_id", venueId!);
      if (!data || data.length === 0) return DEFAULT_CATEGORIES;
      const dbMap = new Map(data.map((d) => [d.category_key, d.display_name]));
      const merged = DEFAULT_CATEGORIES.map((c) => ({
        key: c.key,
        label: dbMap.get(c.key) || c.label,
      }));
      data.forEach((d) => {
        if (!DEFAULT_CATEGORIES.find((c) => c.key === d.category_key)) {
          merged.push({ key: d.category_key, label: d.display_name });
        }
      });
      return merged;
    },
  });
}

function useVenueCourts(venueId?: string) {
  return useQuery<CourtOption[]>({
    queryKey: ["venue-courts-list", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data } = await supabase
        .from("venue_courts")
        .select("id, name, court_number")
        .eq("venue_id", venueId!)
        .eq("is_available", true)
        .order("court_number");
      return (data || []) as CourtOption[];
    },
  });
}

function useVenueEvents(venueId?: string) {
  return useQuery<EventRow[]>({
    queryKey: ["admin-events", venueId],
    enabled: !!venueId,
    queryFn: () => apiGet("api-events", "list", {
      venueId: venueId!,
      status: "upcoming,active,in_progress,completed",
    }),
  });
}

function generateSlug(name: string): string {
  return name.toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* ── Template picker for "create from template" ── */
interface TemplateOption {
  id: string;
  name: string;
  display_name: string | null;
  event_type: string;
  format: string;
  entry_fee: number;
  currency: string;
  logo_url: string | null;
  is_active: boolean;
}

function useTemplates() {
  return useQuery<TemplateOption[]>({
    queryKey: ["event-templates"],
    queryFn: () => apiGet("api-event-templates", "list"),
  });
}

/* ── Create Event Dialog ── */
function CreateEventDialog({ venueId, onCreated, categories }: { venueId: string; onCreated: () => void; categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);
  const { data: templates } = useTemplates();
  const { data: venueCourts } = useVenueCourts(venueId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [eventType, setEventType] = useState("tournament");
  const [eventFormat, setEventFormat] = useState("round_robin");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [numberOfCourts, setNumberOfCourts] = useState("1");
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [entryFee, setEntryFee] = useState("");
  const [entryFeeType, setEntryFeeType] = useState("fixed");
  const [planningStatus, setPlanningStatus] = useState("inquiry");
  const [visibility, setVisibility] = useState("internal");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [expectedParticipants, setExpectedParticipants] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [partnerNotes, setPartnerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [resourcesText, setResourcesText] = useState("");
  const [staffing, setStaffing] = useState("");
  const [isPending, setIsPending] = useState(false);

  const activeTemplates = (templates || []).filter(t => t.is_active);
  const selectedTemplate = activeTemplates.find(t => t.id === selectedTemplateId);

  const handleSelectTemplate = (tpl: TemplateOption) => {
    setSelectedTemplateId(tpl.id);
    setName(tpl.display_name || tpl.name);
    setDisplayName(tpl.display_name || "");
    setEventType(tpl.event_type);
    setEventFormat(tpl.format);
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds(prev =>
      prev.includes(courtId) ? prev.filter(id => id !== courtId) : [...prev, courtId]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsPending(true);
    try {
      await apiPost("api-events", "create", {
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        eventType,
        format: eventFormat,
        venueId,
        startDate: startDate || undefined,
        numberOfCourts: Number(numberOfCourts) || 1,
        isPublic: visibility === "public" || planningStatus === "published",
        templateId: selectedTemplateId || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        entryFee: entryFee ? Number(entryFee) : undefined,
        entryFeeType,
        planningStatus,
        visibility,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        expectedParticipants: expectedParticipants ? Number(expectedParticipants) : undefined,
        ownerName: ownerName.trim() || undefined,
        partnerNotes: partnerNotes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        resources: parseResources(resourcesText),
        staffing: staffing.trim() || undefined,
        courtIds: selectedCourtIds.length > 0 ? selectedCourtIds : undefined,
      });
      toast.success("Event skapat!");
      setOpen(false);
      setName(""); setDisplayName(""); setStartDate(""); setStartTime(""); setEndTime("");
      setSelectedTemplateId(null); setNumberOfCourts("1"); setSelectedCourtIds([]);
      setEntryFee(""); setEntryFeeType("fixed");
      setPlanningStatus("inquiry"); setVisibility("internal");
      setCustomerName(""); setCustomerEmail(""); setCustomerPhone("");
      setExpectedParticipants(""); setOwnerName(""); setPartnerNotes(""); setInternalNotes("");
      setResourcesText(""); setStaffing("");
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-colors hover:bg-primary/5 border border-dashed border-border">
          <Plus className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Skapa nytt event</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skapa event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {/* Template picker */}
          {activeTemplates.length > 0 && (
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Välj mall (franchise)</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {activeTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleSelectTemplate(tpl)}
                    className={`rounded-xl p-3 text-left border transition-all ${
                      selectedTemplateId === tpl.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {tpl.logo_url ? (
                        <img src={tpl.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{tpl.display_name || tpl.name}</p>
                        {tpl.entry_fee > 0 && (
                          <p className="text-[10px] text-primary font-semibold">{tpl.entry_fee} {tpl.currency}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => { setSelectedTemplateId(null); setName(""); setDisplayName(""); }}
                  className={`rounded-xl p-3 text-left border transition-all ${
                    !selectedTemplateId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-xs font-bold">Utan mall</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {selectedTemplate && (
            <Badge variant="secondary" className="text-[10px]">
              Pris, logga, format & scoring ärvs från mallen
            </Badge>
          )}

          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Namn *</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Fredagsklubben 7 mars" />
          </div>
          {!selectedTemplate && (
            <>
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Visningsnamn</Label>
                <Input className="mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="fredagsklubben 🎉" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Typ</Label>
                  <Select value={eventType} onValueChange={setEventType}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tournament">Turnering</SelectItem>
                      <SelectItem value="team_competition">Lagtävling</SelectItem>
                      <SelectItem value="corporate_event">Företagsevent</SelectItem>
                      <SelectItem value="mini_cup">Mini Cup</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Format</Label>
                  <Select value={eventFormat} onValueChange={setEventFormat}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round Robin</SelectItem>
                      <SelectItem value="knockout">Knockout</SelectItem>
                      <SelectItem value="amerikano">Amerikano</SelectItem>
                      <SelectItem value="ladder">Stege</SelectItem>
                      <SelectItem value="mini_cup_2h">Mini Cup 2h</SelectItem>
                      <SelectItem value="team_vs_team">Team vs Team</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* Date + Time */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Datum</Label>
              <Input className="mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Start</Label>
              <Input className="mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Slut</Label>
              <Input className="mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pipeline</Label>
              <Select value={planningStatus} onValueChange={setPlanningStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map((stage) => (
                    <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Synlighet</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Intern</SelectItem>
                  <SelectItem value="partners">Partners</SelectItem>
                  <SelectItem value="public">Publik</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Kund / partner</Label>
              <Input className="mt-1" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Bolag eller kontakt" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Deltagare</Label>
              <Input className="mt-1" type="number" value={expectedParticipants} onChange={(e) => setExpectedParticipants(e.target.value)} placeholder="24" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="email" />
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="telefon" />
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="ansvarig" />
          </div>

          <Textarea value={partnerNotes} onChange={(e) => setPartnerNotes(e.target.value)} placeholder="Partner-/mötesnotering: kort text som går att visa externt" />
          <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Intern notering: offert, beslut, risker, todo" />

          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Eventresurser</Label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {RESOURCE_PRESETS.map((resource) => {
                const selected = parseResources(resourcesText).includes(resource);
                return (
                  <button
                    key={resource}
                    type="button"
                    onClick={() => {
                      const current = parseResources(resourcesText);
                      setResourcesText(selected ? current.filter((r) => r !== resource).join(", ") : [...current, resource].join(", "));
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                  >
                    {resource}
                  </button>
                );
              })}
            </div>
            <Input className="mt-2" value={resourcesText} onChange={(e) => setResourcesText(e.target.value)} placeholder="Egen resurs, separera med komma" />
          </div>

          <Textarea value={staffing} onChange={(e) => setStaffing(e.target.value)} placeholder="Personal: t.ex. 1 eventlead, 2 bar, 1 reception" />

          {/* Entry fee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pristyp</Label>
              <Select value={entryFeeType} onValueChange={setEntryFeeType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fast pris</SelectItem>
                  <SelectItem value="day_pass">Dagspass</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pris (kr)</Label>
              <Input className="mt-1" type="number" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Court selection */}
          {(venueCourts || []).length > 0 && (
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Banor</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(venueCourts || []).map((court) => (
                  <button
                    key={court.id}
                    onClick={() => toggleCourt(court.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      selectedCourtIds.includes(court.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {court.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Antal banor (fallback)</Label>
            <Input className="mt-1" type="number" value={numberOfCourts} onChange={(e) => setNumberOfCourts(e.target.value)} />
          </div>

          <Button onClick={handleCreate} disabled={!name.trim() || isPending} className="w-full">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skapa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Event Detail Editor ── */
function EventDetail({ event, venueId, onBack, categories }: { event: EventRow; venueId: string; onBack: () => void; categories: CategoryOption[] }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: venueCourts } = useVenueCourts(venueId);
  const [showOnSticker, setShowOnSticker] = useState(event.show_on_sticker);
  const [isPublic, setIsPublic] = useState(event.is_public !== false);
  const [displayName, setDisplayName] = useState(event.display_name || "");
  const [status, setStatus] = useState(event.status || "upcoming");
  const [description, setDescription] = useState(event.description || "");
  const [category, setCategory] = useState(event.category || "tournament");
  const [isDropIn, setIsDropIn] = useState(event.is_drop_in || false);
  const [whatsappUrl, setWhatsappUrl] = useState(event.whatsapp_url || "");
  const [slug, setSlug] = useState(event.slug || "");
  const [regFields, setRegFields] = useState<string[]>(event.registration_fields || ["name", "phone"]);
  const [logoUrl, setLogoUrl] = useState(event.logo_url || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Date fields
  const [startDate, setStartDate] = useState(event.start_date ? new Date(event.start_date).toISOString().slice(0, 10) : "");
  const [endDate, setEndDate] = useState(event.end_date ? new Date(event.end_date).toISOString().slice(0, 10) : "");
  // New fields
  const [startTime, setStartTime] = useState(event.start_time || "");
  const [endTime, setEndTime] = useState(event.end_time || "");
  const [entryFee, setEntryFee] = useState(event.entry_fee != null ? String(event.entry_fee) : "");
  const [entryFeeType, setEntryFeeType] = useState(event.entry_fee_type || "fixed");
  const [planningStatus, setPlanningStatus] = useState(event.planning_status || (event.is_public ? "published" : "booked"));
  const [visibility, setVisibility] = useState(event.visibility || (event.is_public ? "public" : "internal"));
  const [customerName, setCustomerName] = useState(event.customer_name || "");
  const [customerEmail, setCustomerEmail] = useState(event.customer_email || "");
  const [customerPhone, setCustomerPhone] = useState(event.customer_phone || "");
  const [expectedParticipants, setExpectedParticipants] = useState(event.expected_participants != null ? String(event.expected_participants) : "");
  const [ownerName, setOwnerName] = useState(event.owner_name || "");
  const [partnerNotes, setPartnerNotes] = useState(event.partner_notes || "");
  const [internalNotes, setInternalNotes] = useState(event.internal_notes || "");
  const [resourcesText, setResourcesText] = useState((event.resources || []).join(", "));
  const [staffing, setStaffing] = useState(event.staffing || "");
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>(
    (event.event_courts || []).map(c => c.id)
  );

  const toggleRegField = (field: string) => {
    setRegFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds(prev =>
      prev.includes(courtId) ? prev.filter(id => id !== courtId) : [...prev, courtId]
    );
  };

  const eventUrl = slug
    ? `${window.location.origin}/e/${slug}`
    : `${window.location.origin}/event/${event.id}`;

  const copyLink = () => {
    navigator.clipboard.writeText(eventUrl);
    toast.success("Länk kopierad!");
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Välj en bildfil");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${event.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("event-logos")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage
        .from("event-logos")
        .getPublicUrl(path);
      const url = urlData.publicUrl + `?t=${Date.now()}`;
      setLogoUrl(url);
      toast.success("Logga uppladdad!");
    } catch (err: any) {
      toast.error(err.message || "Uppladdning misslyckades");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    setLogoUrl("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Auto-derive status from date
      let derivedStatus = status;
      if (startDate) {
        const today = new Date().toISOString().slice(0, 10);
        if (startDate > today) derivedStatus = "upcoming";
        else if (startDate === today) derivedStatus = "active";
        else if (startDate < today) derivedStatus = "completed";
      }

      await apiPatch("api-events", "update", {
        id: event.id,
        displayName: displayName.trim() || null,
        isPublic,
        showOnSticker,
        status: derivedStatus,
        description: description.trim() || null,
        category,
        isDropIn: isDropIn,
        whatsappUrl: whatsappUrl.trim() || null,
        slug: slug.trim() || null,
        registrationFields: regFields,
        logoUrl: logoUrl.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
        startTime: startTime || null,
        endTime: endTime || null,
        entryFee: entryFee ? Number(entryFee) : null,
        entryFeeType,
        planningStatus,
        visibility,
        customerName: customerName.trim() || null,
        customerEmail: customerEmail.trim() || null,
        customerPhone: customerPhone.trim() || null,
        expectedParticipants: expectedParticipants ? Number(expectedParticipants) : null,
        ownerName: ownerName.trim() || null,
        partnerNotes: partnerNotes.trim() || null,
        internalNotes: internalNotes.trim() || null,
        resources: parseResources(resourcesText),
        staffing: staffing.trim() || null,
        courtIds: selectedCourtIds,
      });
      toast.success("Event uppdaterat!");
      qc.invalidateQueries({ queryKey: ["admin-events", venueId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Ta bort eventet permanent?")) return;
    try {
      await apiDelete("api-events", `delete?id=${event.id}`);
      toast.success("Event borttaget");
      qc.invalidateQueries({ queryKey: ["admin-events", venueId] });
      onBack();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-primary font-semibold hover:underline">← Tillbaka</button>

      {/* Shareable link */}
      <div className="glass-card rounded-2xl p-4">
        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Delbar länk</Label>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 text-xs text-muted-foreground bg-secondary rounded-xl px-3 py-2.5 truncate font-mono">
            {eventUrl}
          </div>
          <Button size="icon" variant="ghost" onClick={copyLink} className="shrink-0">
            <Copy className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" asChild className="shrink-0">
            <a href={eventUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>

      {/* Logo upload */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Event-logga</Label>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
        {logoUrl ? (
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Event logo" className="w-16 h-16 rounded-2xl object-cover border border-border" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{logoUrl.split("/").pop()?.split("?")[0]}</p>
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={removeLogo}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            Ladda upp logga
          </Button>
        )}
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-4">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Namn</Label>
          <p className="text-sm font-bold text-foreground mt-1">{event.name}</p>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Visningsnamn (sticker-text)</Label>
          <Input className="mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="T.ex. fredagsklubben 🎉" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Slug (för snygg URL)</Label>
          <div className="flex gap-2 mt-1">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="t.ex. fredagsklubben-mars" />
            <Button variant="outline" size="sm" onClick={() => setSlug(generateSlug(displayName || event.name))}>
              Auto
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Lämna tomt för att använda event-ID</p>
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Kategori</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="in_progress">Pågår</SelectItem>
              <SelectItem value="completed">Avslutad</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pipeline</Label>
            <Select value={planningStatus} onValueChange={setPlanningStatus}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((stage) => (
                  <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Synlighet</Label>
            <Select value={visibility} onValueChange={setVisibility}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Intern</SelectItem>
                <SelectItem value="partners">Partners</SelectItem>
                <SelectItem value="public">Publik</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-secondary/40 p-3 space-y-3">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Kund & ansvar</Label>
          <div className="grid grid-cols-2 gap-3">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Kund / partner" />
            <Input type="number" value={expectedParticipants} onChange={(e) => setExpectedParticipants(e.target.value)} placeholder="Antal deltagare" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="email" />
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="telefon" />
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="ansvarig" />
          </div>
        </div>

        {/* Date fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Startdatum</Label>
            <Input className="mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Slutdatum</Label>
            <Input className="mt-1" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        {startDate && (
          <p className="text-[10px] text-muted-foreground">
            Status sätts automatiskt: {startDate > new Date().toISOString().slice(0, 10) ? "Upcoming" : startDate === new Date().toISOString().slice(0, 10) ? "Aktiv" : "Avslutad"}
          </p>
        )}

        {/* Time fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Starttid</Label>
            <Input className="mt-1" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Sluttid</Label>
            <Input className="mt-1" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        {/* Entry fee */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pristyp</Label>
            <Select value={entryFeeType} onValueChange={setEntryFeeType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fast pris</SelectItem>
                <SelectItem value="day_pass">Dagspass</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pris (kr)</Label>
            <Input className="mt-1" type="number" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0" />
          </div>
        </div>

        {/* Court selection */}
        {(venueCourts || []).length > 0 && (
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Banor</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(venueCourts || []).map((court) => (
                <button
                  key={court.id}
                  onClick={() => toggleCourt(court.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    selectedCourtIds.includes(court.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {court.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Beskrivning</Label>
          <Textarea
            className="mt-1 min-h-[100px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beskriv eventet, regler, tider, pris..."
          />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Partner-/mötesnotering</Label>
          <Textarea
            className="mt-1 min-h-[80px]"
            value={partnerNotes}
            onChange={(e) => setPartnerNotes(e.target.value)}
            placeholder="Kort, säljbar notering som kan visas i möten."
          />
        </div>

        <div className="rounded-2xl border border-border bg-secondary/40 p-3 space-y-3">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Eventresurser</Label>
          <div className="flex flex-wrap gap-1.5">
            {RESOURCE_PRESETS.map((resource) => {
              const selected = parseResources(resourcesText).includes(resource);
              return (
                <button
                  key={resource}
                  type="button"
                  onClick={() => {
                    const current = parseResources(resourcesText);
                    setResourcesText(selected ? current.filter((r) => r !== resource).join(", ") : [...current, resource].join(", "));
                  }}
                  className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30"}`}
                >
                  {resource}
                </button>
              );
            })}
          </div>
          <Input value={resourcesText} onChange={(e) => setResourcesText(e.target.value)} placeholder="Hela darten, lounge, scen..." />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Personal</Label>
          <Textarea
            className="mt-1 min-h-[80px]"
            value={staffing}
            onChange={(e) => setStaffing(e.target.value)}
            placeholder="T.ex. eventlead, bar, reception, instruktör."
          />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Intern notering</Label>
          <Textarea
            className="mt-1 min-h-[90px]"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Offert, kontakt, beslut, todo, intern risk."
          />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">WhatsApp-grupplänk</Label>
          <Input className="mt-1" value={whatsappUrl} onChange={(e) => setWhatsappUrl(e.target.value)} placeholder="https://chat.whatsapp.com/..." />
        </div>

        {/* Toggles */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Drop-in</p>
              <p className="text-[10px] text-muted-foreground">Ingen föranmälan krävs</p>
            </div>
            <Switch checked={isDropIn} onCheckedChange={setIsDropIn} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Visa som sticker</p>
              <p className="text-[10px] text-muted-foreground">Klickbar sticker på landningssidan</p>
            </div>
            <Switch checked={showOnSticker} onCheckedChange={setShowOnSticker} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Publikt event</p>
              <p className="text-[10px] text-muted-foreground">Synligt för alla besökare</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </div>
      </div>

      {/* Registration fields config */}
      {!isDropIn && (
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Anmälningsfält</Label>
          <p className="text-[10px] text-muted-foreground">Välj vilka fält som visas i anmälningsformuläret</p>
          {[
            { id: "name", label: "Namn", desc: "Alltid med" },
            { id: "phone", label: "Telefon", desc: "För WhatsApp-kommunikation" },
            { id: "email", label: "E-post", desc: "Valfritt kontaktfält" },
            { id: "level", label: "Nivå", desc: "Nybörjare / Medel / Avancerad" },
          ].map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <Checkbox
                id={`reg-${f.id}`}
                checked={regFields.includes(f.id)}
                onCheckedChange={() => f.id === "name" ? null : toggleRegField(f.id)}
                disabled={f.id === "name"}
              />
              <label htmlFor={`reg-${f.id}`} className="flex-1">
                <p className="text-sm font-medium text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground">{f.desc}</p>
              </label>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Spara"}
        </Button>
        <Button variant="destructive" size="icon" onClick={handleDelete}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Main Component ── */
const AdminEvents = ({ venueId }: { venueId: string }) => {
  const { data: events, isLoading } = useVenueEvents(venueId);
  const { data: categories } = useVenueCategories(venueId);
  const cats = categories || DEFAULT_CATEGORIES;
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [view, setView] = useState<AdminEventView>("pipeline");
  const [timeFilter, setTimeFilter] = useState<EventTimeFilter>("upcoming");
  const qc = useQueryClient();

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  if (selectedEvent) {
    return <EventDetail event={selectedEvent} venueId={venueId} onBack={() => setSelectedEvent(null)} categories={cats} />;
  }

  const allEventRows = events || [];
  const eventRows = allEventRows.filter((evt) => {
    const archived = isArchivedEvent(evt);
    if (timeFilter === "upcoming") return !archived;
    if (timeFilter === "archive") return archived;
    return true;
  });
  const livePipeline = allEventRows.filter((evt) => !isArchivedEvent(evt));
  const upcomingMeetingEvents = eventRows
    .filter((evt) => ["partners", "public"].includes(evt.visibility || (evt.is_public ? "public" : "internal")))
    .filter((evt) => !isArchivedEvent(evt))
    .sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || "")))
    .slice(0, 12);
  const monthGroups = eventRows.reduce<Record<string, EventRow[]>>((acc, evt) => {
    const key = evt.start_date ? format(new Date(evt.start_date), "MMM yyyy") : "Utan datum";
    acc[key] = acc[key] || [];
    acc[key].push(evt);
    return acc;
  }, {});

  const renderEventMini = (evt: EventRow, compact = false) => {
    const planning = evt.planning_status || (evt.is_public ? "published" : "booked");
    const stage = PIPELINE_STAGES.find((s) => s.key === planning) || PIPELINE_STAGES[2];
    const resources = evt.resources || [];
    return (
      <button
        key={evt.id}
        onClick={() => setSelectedEvent(evt)}
        className={`w-full rounded-2xl border border-border bg-card text-left transition-all hover:border-primary/30 ${compact ? "p-3" : "p-0 overflow-hidden"}`}
      >
        <div className={compact ? "flex items-start gap-3" : "grid grid-cols-[6px_minmax(0,1.7fr)_92px_96px_minmax(0,1fr)_32px] items-stretch"}>
          {!compact && <div className={`w-1.5 ${stage.tone}`} />}
          {evt.logo_url ? (
            <img src={evt.logo_url} alt="" className={`${compact ? "w-10 h-10 rounded-xl" : "hidden"} object-cover flex-shrink-0`} />
          ) : (
            <div className={`${compact ? "w-10 h-10 rounded-xl" : "hidden"} flex-shrink-0 bg-muted items-center justify-center text-xs font-bold text-muted-foreground`}>
              {(evt.display_name || evt.name || "?")[0].toUpperCase()}
            </div>
          )}
          <div className={compact ? "min-w-0 flex-1" : "min-w-0 p-3"}>
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{evt.display_name || evt.name}</p>
              {evt.show_on_sticker && <Tag className="w-3 h-3 text-primary flex-shrink-0" />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${stage.tone}`} />
              <span className="text-[10px] text-muted-foreground">{stage.label}</span>
              <span className="text-[10px] text-muted-foreground">· {VISIBILITY_LABELS[evt.visibility || (evt.is_public ? "public" : "internal")]}</span>
              {evt.start_date && <span className="text-[10px] text-muted-foreground">· {format(new Date(evt.start_date), "d MMM")}</span>}
              {evt.start_time && <span className="text-[10px] text-muted-foreground">· {evt.start_time.slice(0, 5)}{evt.end_time ? `-${evt.end_time.slice(0, 5)}` : ""}</span>}
            </div>
            {!compact && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {evt.customer_name && <Badge variant="secondary" className="text-[10px]">{evt.customer_name}</Badge>}
                {evt.expected_participants != null && <Badge variant="secondary" className="text-[10px]">{evt.expected_participants} pers</Badge>}
                {evt.owner_name && <Badge variant="outline" className="text-[10px]">{evt.owner_name}</Badge>}
                {resources.slice(0, 3).map((resource) => <Badge key={resource} variant="outline" className="text-[10px]">{resource}</Badge>)}
              </div>
            )}
          </div>
          {!compact && (
            <>
              <div className="border-l border-border p-3 flex flex-col justify-center">
                <span className="text-[10px] text-muted-foreground">Datum</span>
                <span className="text-xs font-bold text-foreground">{evt.start_date ? format(new Date(evt.start_date), "d MMM") : "TBD"}</span>
              </div>
              <div className="border-l border-border p-3 flex flex-col justify-center">
                <span className="text-[10px] text-muted-foreground">Tid</span>
                <span className="text-xs font-bold text-foreground">{formatEventTime(evt)}</span>
              </div>
              <div className="border-l border-border p-3 min-w-0 flex flex-col justify-center">
                <span className="text-[10px] text-muted-foreground">Resurs</span>
                <span className="text-xs font-bold text-foreground truncate">{resources[0] || `${evt.event_courts?.length || evt.number_of_courts || 0} banor`}</span>
              </div>
            </>
          )}
          <div className={compact ? "" : "border-l border-border flex items-center justify-center"}>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Eventplanering</p>
            <h2 className="text-xl font-bold text-foreground">Pipeline & kalender</h2>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Users className="w-3 h-3" />
            {livePipeline.length} aktiva
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
          {[
            { key: "pipeline", label: "Pipeline", icon: Columns3 },
            { key: "calendar", label: "Kalender", icon: CalendarDays },
            { key: "meeting", label: "Möte", icon: Presentation },
          ].map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key as AdminEventView)}
                className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/70 p-1">
          {[
            { key: "upcoming", label: "Framåt" },
            { key: "all", label: "Alla" },
            { key: "archive", label: "Arkiv" },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setTimeFilter(item.key as EventTimeFilter)}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors ${timeFilter === item.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <CreateEventDialog venueId={venueId} onCreated={() => qc.invalidateQueries({ queryKey: ["admin-events", venueId] })} categories={cats} />

      {view === "pipeline" && (
        <div className="space-y-3">
          {PIPELINE_STAGES.map((stage) => {
            const stageEvents = eventRows.filter((evt) => (evt.planning_status || (evt.is_public ? "published" : "booked")) === stage.key);
            if (stageEvents.length === 0 && !["inquiry", "tentative", "booked", "ready"].includes(stage.key)) return null;
            return (
              <div key={stage.key} className="glass-card rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${stage.tone}`} />
                    <p className="text-sm font-bold text-foreground">{stage.label}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{stageEvents.length}</span>
                </div>
                <div className="space-y-2">
                  {stageEvents.length > 0 ? stageEvents.map((evt) => renderEventMini(evt, true)) : (
                    <p className="text-xs text-muted-foreground py-3 text-center">Tomt</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "calendar" && (
        <div className="space-y-3">
          {Object.keys(monthGroups).length > 0 ? Object.entries(monthGroups).map(([month, rows]) => (
            <div key={month} className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 bg-secondary/70 border-b border-border flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{month}</p>
                <Badge variant="secondary">{rows.length} aktiviteter</Badge>
              </div>
              <div className="hidden sm:grid grid-cols-[6px_minmax(0,1.7fr)_92px_96px_minmax(0,1fr)_32px] px-0 py-2 text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <span />
                <span className="px-3">Event</span>
                <span className="px-3 border-l border-border">Datum</span>
                <span className="px-3 border-l border-border">Tid</span>
                <span className="px-3 border-l border-border">Resurs</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {rows
                  .sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || "")))
                  .map((evt) => renderEventMini(evt))}
              </div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground text-center py-8">Inga event ännu</p>
          )}
        </div>
      )}

      {view === "meeting" && (
        <div className="space-y-3">
          <div className="rounded-2xl p-5 bg-white text-neutral-950 border border-neutral-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">Partneröversikt</p>
                <h3 className="text-2xl font-black tracking-tight">Kommande aktiveringar</h3>
              </div>
              <Eye className="w-5 h-5 text-neutral-400" />
            </div>
            <p className="text-xs text-neutral-500 mt-2">Visar endast event markerade för partners eller publik vy. Interna anteckningar döljs.</p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest">Aktiveringar</p>
                <p className="text-xl font-black">{upcomingMeetingEvents.length}</p>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest">Publika</p>
                <p className="text-xl font-black">{upcomingMeetingEvents.filter((e) => e.is_public).length}</p>
              </div>
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest">Partners</p>
                <p className="text-xl font-black">{upcomingMeetingEvents.filter((e) => e.visibility === "partners").length}</p>
              </div>
            </div>
          </div>
          {upcomingMeetingEvents.length > 0 ? upcomingMeetingEvents.map((evt) => (
            <button
              key={evt.id}
              onClick={() => setSelectedEvent(evt)}
              className="w-full rounded-2xl bg-white text-neutral-950 border border-neutral-200 p-0 text-left overflow-hidden shadow-sm"
            >
              <div className="grid grid-cols-[7px_1fr]">
                <div className={`${(PIPELINE_STAGES.find((s) => s.key === (evt.planning_status || "booked")) || PIPELINE_STAGES[2]).tone}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-neutral-400">
                        {formatEventDate(evt)} · {formatEventTime(evt)}
                      </p>
                      <h4 className="text-lg font-black mt-1">{evt.display_name || evt.name}</h4>
                      <p className="text-sm text-neutral-500 mt-1">
                        {[evt.customer_name, evt.expected_participants ? `${evt.expected_participants} deltagare` : null, evt.event_courts?.length ? `${evt.event_courts.length} banor` : null].filter(Boolean).join(" · ") || "Planerad aktivitet"}
                      </p>
                    </div>
                    <Badge variant={evt.is_public ? "default" : "secondary"}>{evt.is_public ? "Publik" : "Partner"}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(evt.resources || []).slice(0, 5).map((resource) => (
                      <span key={resource} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600">
                        <LayoutGrid className="w-3 h-3" />
                        {resource}
                      </span>
                    ))}
                    {evt.staffing && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600">
                        <UserRoundCheck className="w-3 h-3" />
                        Personal satt
                      </span>
                    )}
                  </div>
                  {evt.partner_notes && <p className="text-sm text-neutral-700 mt-3 leading-relaxed">{evt.partner_notes}</p>}
                </div>
              </div>
            </button>
          )) : (
            <p className="text-sm text-muted-foreground text-center py-8">Inga partner/publika event att visa ännu</p>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminEvents;
