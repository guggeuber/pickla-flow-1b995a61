import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Loader2, Plus, ChevronRight, Trash2, Tag, Copy, ExternalLink } from "lucide-react";
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

interface EventRow {
  id: string;
  name: string;
  display_name: string | null;
  event_type: string;
  format: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  is_public: boolean | null;
  show_on_sticker: boolean;
  number_of_courts: number | null;
  description?: string | null;
  category?: string;
  is_drop_in?: boolean;
  registration_fields?: string[];
  whatsapp_url?: string | null;
  slug?: string | null;
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

/* ── Create Event Dialog ── */
function CreateEventDialog({ venueId, onCreated }: { venueId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [eventType, setEventType] = useState("tournament");
  const [eventFormat, setEventFormat] = useState("round_robin");
  const [category, setCategory] = useState("tournament");
  const [startDate, setStartDate] = useState("");
  const [isPending, setIsPending] = useState(false);

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
        isPublic: true,
      });
      toast.success("Event skapat!");
      setOpen(false);
      setName("");
      setDisplayName("");
      setStartDate("");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skapa event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Namn (internt) *</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Fredagsklubben Mars" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Visningsnamn (sticker-text)</Label>
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
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Startdatum</Label>
            <Input className="mt-1" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
function EventDetail({ event, venueId, onBack }: { event: EventRow; venueId: string; onBack: () => void }) {
  const qc = useQueryClient();
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
  const [saving, setSaving] = useState(false);

  const toggleRegField = (field: string) => {
    setRegFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const eventUrl = slug
    ? `${window.location.origin}/e/${slug}`
    : `${window.location.origin}/event/${event.id}`;

  const copyLink = () => {
    navigator.clipboard.writeText(eventUrl);
    toast.success("Länk kopierad!");
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
              <SelectItem value="tournament">Turnering</SelectItem>
              <SelectItem value="open_play">Open Play</SelectItem>
              <SelectItem value="training">Träning</SelectItem>
              <SelectItem value="social">Social / Klubb</SelectItem>
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
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const qc = useQueryClient();

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  if (selectedEvent) {
    return <EventDetail event={selectedEvent} venueId={venueId} onBack={() => setSelectedEvent(null)} />;
  }

  const statusColors: Record<string, string> = {
    upcoming: "hsl(var(--badge-vip))",
    active: "hsl(var(--court-free))",
    in_progress: "hsl(var(--primary))",
    completed: "hsl(var(--muted-foreground))",
  };

  return (
    <div className="space-y-3">
      <CreateEventDialog venueId={venueId} onCreated={() => qc.invalidateQueries({ queryKey: ["admin-events", venueId] })} />

      {events && events.length > 0 ? (
        events.map((evt) => (
          <button
            key={evt.id}
            onClick={() => setSelectedEvent(evt)}
            className="w-full glass-card rounded-2xl p-4 flex items-center gap-3 text-left transition-all hover:border-primary/20"
          >
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
