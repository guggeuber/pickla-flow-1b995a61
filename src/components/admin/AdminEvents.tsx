import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, ChevronRight, Trash2, Tag, Copy, ExternalLink, Upload, X, FileText, Clock } from "lucide-react";
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
        isPublic: true,
        templateId: selectedTemplateId || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        entryFee: entryFee ? Number(entryFee) : undefined,
        entryFeeType,
        courtIds: selectedCourtIds.length > 0 ? selectedCourtIds : undefined,
      });
      toast.success("Event skapat!");
      setOpen(false);
      setName(""); setDisplayName(""); setStartDate(""); setStartTime(""); setEndTime("");
      setSelectedTemplateId(null); setNumberOfCourts("1"); setSelectedCourtIds([]);
      setEntryFee(""); setEntryFeeType("fixed");
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
  // New fields
  const [startTime, setStartTime] = useState(event.start_time || "");
  const [endTime, setEndTime] = useState(event.end_time || "");
  const [entryFee, setEntryFee] = useState(event.entry_fee != null ? String(event.entry_fee) : "");
  const [entryFeeType, setEntryFeeType] = useState(event.entry_fee_type || "fixed");
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
      await apiPatch("api-events", "update", {
        id: event.id,
        displayName: displayName.trim() || null,
        isPublic,
        showOnSticker,
        status,
        description: description.trim() || null,
        category,
        isDropIn: isDropIn,
        whatsappUrl: whatsappUrl.trim() || null,
        slug: slug.trim() || null,
        registrationFields: regFields,
        logoUrl: logoUrl.trim() || null,
        // New fields
        startTime: startTime || null,
        endTime: endTime || null,
        entryFee: entryFee ? Number(entryFee) : null,
        entryFeeType,
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
  const qc = useQueryClient();

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  if (selectedEvent) {
    return <EventDetail event={selectedEvent} venueId={venueId} onBack={() => setSelectedEvent(null)} categories={cats} />;
  }

  const statusColors: Record<string, string> = {
    upcoming: "hsl(var(--badge-vip))",
    active: "hsl(var(--court-free))",
    in_progress: "hsl(var(--primary))",
    completed: "hsl(var(--muted-foreground))",
  };

  return (
    <div className="space-y-3">
      <CreateEventDialog venueId={venueId} onCreated={() => qc.invalidateQueries({ queryKey: ["admin-events", venueId] })} categories={cats} />

      {events && events.length > 0 ? (
        events.map((evt) => (
          <button
            key={evt.id}
            onClick={() => setSelectedEvent(evt)}
            className="w-full glass-card rounded-2xl p-4 flex items-center gap-3 text-left transition-all hover:border-primary/20"
          >
            {evt.logo_url ? (
              <img src={evt.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex-shrink-0 bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                {(evt.display_name || evt.name || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-foreground truncate">{evt.display_name || evt.name}</p>
                {evt.show_on_sticker && <Tag className="w-3 h-3 text-primary flex-shrink-0" />}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: statusColors[evt.status || "upcoming"] || "gray" }}
                />
                <span className="text-[10px] text-muted-foreground capitalize">{evt.status || "upcoming"}</span>
                {evt.start_date && (
                  <span className="text-[10px] text-muted-foreground">
                    · {format(new Date(evt.start_date), "d MMM yyyy")}
                  </span>
                )}
                {evt.start_time && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {evt.start_time.slice(0, 5)}
                    {evt.end_time ? `–${evt.end_time.slice(0, 5)}` : ''}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          </button>
        ))
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">Inga event ännu</p>
      )}
    </div>
  );
};

export default AdminEvents;
