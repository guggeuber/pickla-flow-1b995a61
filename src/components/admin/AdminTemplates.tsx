import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, ChevronRight, Trash2, Upload, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TemplateRow {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  event_type: string;
  format: string;
  category: string;
  entry_fee: number;
  currency: string;
  vat_rate: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  scoring_type: string | null;
  points_to_win: number | null;
  best_of: number | null;
  win_by_two: boolean;
  match_duration_default: number | null;
  competition_type: string | null;
  is_drop_in: boolean;
  is_public: boolean;
  is_active: boolean;
  whatsapp_url: string | null;
  registration_fields: string[];
}

function useTemplates() {
  return useQuery<TemplateRow[]>({
    queryKey: ["event-templates"],
    queryFn: () => apiGet("api-event-templates", "list"),
  });
}

/* ── Create Template Dialog ── */
function CreateTemplateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [eventType, setEventType] = useState("tournament");
  const [eventFormat, setEventFormat] = useState("round_robin");
  const [entryFee, setEntryFee] = useState("0");
  const [isPending, setIsPending] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsPending(true);
    try {
      await apiPost("api-event-templates", "create", {
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        eventType,
        format: eventFormat,
        entryFee: Number(entryFee) || 0,
      });
      toast.success("Mall skapad!");
      setOpen(false);
      setName("");
      setDisplayName("");
      setEntryFee("0");
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
          <span className="text-sm font-semibold text-primary">Skapa ny mall</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny event-mall</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Mall-namn *</Label>
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Fredagsklubben" />
          </div>
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
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Deltagaravgift (SEK)</Label>
            <Input className="mt-1" type="number" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0" />
          </div>
          <Button onClick={handleCreate} disabled={!name.trim() || isPending} className="w-full">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Skapa mall"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Template Detail Editor ── */
function TemplateDetail({ template, onBack }: { template: TemplateRow; onBack: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(template.name);
  const [displayName, setDisplayName] = useState(template.display_name || "");
  const [description, setDescription] = useState(template.description || "");
  const [entryFee, setEntryFee] = useState(String(template.entry_fee || 0));
  const [vatRate, setVatRate] = useState(String(template.vat_rate || 6));
  const [logoUrl, setLogoUrl] = useState(template.logo_url || "");
  const [primaryColor, setPrimaryColor] = useState(template.primary_color || "");
  const [whatsappUrl, setWhatsappUrl] = useState(template.whatsapp_url || "");
  const [isDropIn, setIsDropIn] = useState(template.is_drop_in);
  const [isActive, setIsActive] = useState(template.is_active);
  const [pointsToWin, setPointsToWin] = useState(String(template.points_to_win || ""));
  const [bestOf, setBestOf] = useState(String(template.best_of || ""));
  const [matchDuration, setMatchDuration] = useState(String(template.match_duration_default || ""));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `templates/${template.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage.from("event-logos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("event-logos").getPublicUrl(path);
      setLogoUrl(urlData.publicUrl + `?t=${Date.now()}`);
      toast.success("Logga uppladdad!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch("api-event-templates", "update", {
        id: template.id,
        name: name.trim(),
        displayName: displayName.trim() || null,
        description: description.trim() || null,
        entryFee: Number(entryFee) || 0,
        vatRate: Number(vatRate) || 6,
        logoUrl: logoUrl.trim() || null,
        primaryColor: primaryColor.trim() || null,
        whatsappUrl: whatsappUrl.trim() || null,
        isDropIn,
        isActive,
        pointsToWin: pointsToWin ? Number(pointsToWin) : null,
        bestOf: bestOf ? Number(bestOf) : null,
        matchDurationDefault: matchDuration ? Number(matchDuration) : null,
      });
      toast.success("Mall sparad!");
      qc.invalidateQueries({ queryKey: ["event-templates"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Ta bort mallen permanent?")) return;
    try {
      await apiDelete("api-event-templates", `delete?id=${template.id}`);
      toast.success("Mall borttagen");
      qc.invalidateQueries({ queryKey: ["event-templates"] });
      onBack();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-primary font-semibold hover:underline">← Tillbaka</button>

      {/* Logo */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Mall-logga</Label>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
        {logoUrl ? (
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover border border-border" />
            <div className="flex gap-1 ml-auto">
              <Button size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setLogoUrl("")}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            Ladda upp logga
          </Button>
        )}
      </div>

      <div className="glass-card rounded-2xl p-4 space-y-4">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Namn *</Label>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Visningsnamn</Label>
          <Input className="mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="fredagsklubben 🎉" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Beskrivning</Label>
          <Textarea className="mt-1 min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Typ</Label>
            <p className="text-sm font-semibold mt-1 capitalize">{template.event_type.replace(/_/g, " ")}</p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Format</Label>
            <p className="text-sm font-semibold mt-1 capitalize">{template.format.replace(/_/g, " ")}</p>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prissättning (franchise)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Deltagaravgift (SEK)</Label>
            <Input className="mt-1" type="number" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Moms (%)</Label>
            <Input className="mt-1" type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
          </div>
        </div>
        {Number(entryFee) > 0 && (
          <p className="text-[10px] text-muted-foreground">
            varav moms {Math.round(Number(entryFee) * Number(vatRate) / (100 + Number(vatRate)))} kr
          </p>
        )}
      </div>

      {/* Scoring */}
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Scoring-inställningar</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Poäng att vinna</Label>
            <Input className="mt-1" type="number" value={pointsToWin} onChange={(e) => setPointsToWin(e.target.value)} placeholder="–" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Best of</Label>
            <Input className="mt-1" type="number" value={bestOf} onChange={(e) => setBestOf(e.target.value)} placeholder="–" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min/match</Label>
            <Input className="mt-1" type="number" value={matchDuration} onChange={(e) => setMatchDuration(e.target.value)} placeholder="–" />
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Branding</p>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Primärfärg</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#E86C24" className="flex-1" />
            {primaryColor && <div className="w-8 h-8 rounded-lg border border-border" style={{ background: primaryColor }} />}
          </div>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">WhatsApp-grupp</Label>
          <Input className="mt-1" value={whatsappUrl} onChange={(e) => setWhatsappUrl(e.target.value)} placeholder="https://chat.whatsapp.com/..." />
        </div>
      </div>

      {/* Toggles */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Drop-in</p>
            <p className="text-[10px] text-muted-foreground">Ingen föranmälan krävs</p>
          </div>
          <Switch checked={isDropIn} onCheckedChange={setIsDropIn} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Aktiv mall</p>
            <p className="text-[10px] text-muted-foreground">Venues kan skapa event från mallen</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>

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

/* ── Main ── */
const AdminTemplates = () => {
  const { data: templates, isLoading } = useTemplates();
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  const qc = useQueryClient();

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  if (selected) {
    return <TemplateDetail template={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground px-1">
        Mallar definierar pris, logga, format och scoring. Venues skapar event-instanser från dessa mallar.
      </p>
      <CreateTemplateDialog onCreated={() => qc.invalidateQueries({ queryKey: ["event-templates"] })} />
      {templates && templates.length > 0 ? (
        templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t)}
            className="w-full glass-card rounded-2xl p-4 flex items-center gap-3 text-left transition-all hover:border-primary/20"
          >
            {t.logo_url ? (
              <img src={t.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex-shrink-0 bg-muted flex items-center justify-center">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{t.display_name || t.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground capitalize">{t.format.replace(/_/g, " ")}</span>
                {t.entry_fee > 0 && (
                  <span className="text-[10px] font-semibold text-primary">{t.entry_fee} {t.currency}</span>
                )}
                {!t.is_active && (
                  <span className="text-[10px] text-destructive font-semibold">Inaktiv</span>
                )}
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
          </button>
        ))
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">Inga mallar ännu</p>
      )}
    </div>
  );
};

export default AdminTemplates;
