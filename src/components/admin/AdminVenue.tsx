import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminVenue, useAdminMutation } from "@/hooks/useAdmin";
import { apiGet, apiPost } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATEGORIES = [
  { key: "open_play", defaultName: "Open Play" },
  { key: "social", defaultName: "Fredagsklubben" },
  { key: "training", defaultName: "Träning" },
  { key: "tournament", defaultName: "Turnering" },
];

interface CategoryConfig {
  id?: string;
  category_key: string;
  display_name: string;
  logo_url: string | null;
  whatsapp_url: string | null;
}

function EventCategoriesSection({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const { data: categories, isLoading } = useQuery<CategoryConfig[]>({
    queryKey: ["event-categories", venueId],
    queryFn: () => apiGet("api-admin", "event-categories", { venueId }),
  });

  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [localState, setLocalState] = useState<Record<string, { displayName: string; whatsappUrl: string; logoUrl: string }>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getState = (catKey: string) => {
    if (localState[catKey]) return localState[catKey];
    const existing = categories?.find((c) => c.category_key === catKey);
    const def = CATEGORIES.find((c) => c.key === catKey);
    return {
      displayName: existing?.display_name || def?.defaultName || catKey,
      whatsappUrl: existing?.whatsapp_url || "",
      logoUrl: existing?.logo_url || "",
    };
  };

  const updateLocal = (catKey: string, field: string, value: string) => {
    const current = getState(catKey);
    setLocalState((prev) => ({ ...prev, [catKey]: { ...current, [field]: value } }));
  };

  const handleUpload = async (catKey: string, file: File) => {
    setUploading(catKey);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `categories/${venueId}/${catKey}.${ext}`;
      const { error } = await supabase.storage.from("event-logos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("event-logos").getPublicUrl(path);
      const url = urlData.publicUrl + `?t=${Date.now()}`;
      updateLocal(catKey, "logoUrl", url);
      toast.success("Logga uppladdad!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleSave = async (catKey: string) => {
    const state = getState(catKey);
    setSaving(catKey);
    try {
      await apiPost("api-admin", "event-categories", {
        venueId,
        categoryKey: catKey,
        displayName: state.displayName,
        logoUrl: state.logoUrl || null,
        whatsappUrl: state.whatsappUrl || null,
      });
      toast.success("Sparat!");
      qc.invalidateQueries({ queryKey: ["event-categories", venueId] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto" />;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Event-kategorier</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Logga och WhatsApp-länk ärvs av alla event i kategorin</p>
      </div>
      {CATEGORIES.map((cat) => {
        const state = getState(cat.key);
        return (
          <div key={cat.key} className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              {state.logoUrl ? (
                <div className="relative">
                  <img src={state.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-border" />
                  <button
                    onClick={() => updateLocal(cat.key, "logoUrl", "")}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRefs.current[cat.key]?.click()}
                  disabled={uploading === cat.key}
                  className="w-12 h-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center hover:border-primary/40 transition-colors"
                >
                  {uploading === cat.key ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              )}
              <input
                ref={(el) => { fileRefs.current[cat.key] = el; }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(cat.key, file);
                  e.target.value = "";
                }}
              />
              <div className="flex-1 min-w-0">
                <Input
                  value={state.displayName}
                  onChange={(e) => updateLocal(cat.key, "displayName", e.target.value)}
                  className="text-sm font-bold h-8"
                  placeholder={cat.defaultName}
                />
                <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">{cat.key}</p>
              </div>
            </div>
            <div>
              <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">WhatsApp-länk</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={state.whatsappUrl}
                onChange={(e) => updateLocal(cat.key, "whatsappUrl", e.target.value)}
                placeholder="https://chat.whatsapp.com/..."
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() => handleSave(cat.key)}
              disabled={saving === cat.key}
            >
              {saving === cat.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Spara"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

const AdminVenue = ({ venueId }: { venueId: string }) => {
  const { data: venue, isLoading } = useAdminVenue(venueId);
  const { updateVenue } = useAdminMutation(venueId);
  const [form, setForm] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  if (venue && !initialized) {
    setForm({
      name: venue.name || "",
      slug: venue.slug || "",
      description: venue.description || "",
      address: venue.address || "",
      city: venue.city || "",
      phone: venue.phone || "",
      email: venue.email || "",
      website_url: venue.website_url || "",
    });
    setInitialized(true);
  }

  const handleSave = () => {
    updateVenue.mutate(form, {
      onSuccess: () => toast.success("Venue uppdaterad!"),
      onError: (e) => toast.error(e.message),
    });
  };

  const fields = [
    { key: "name", label: "Namn" },
    { key: "slug", label: "Slug (URL)" },
    { key: "description", label: "Beskrivning" },
    { key: "address", label: "Adress" },
    { key: "city", label: "Stad" },
    { key: "phone", label: "Telefon" },
    { key: "email", label: "E-post" },
    { key: "website_url", label: "Webbplats" },
  ];

  return (
    <div className="space-y-6">
      {/* Venue fields */}
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{f.label}</label>
            <input
              className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50"
              style={{ background: "hsl(var(--surface-1))", border: "1px solid hsl(var(--border))" }}
              value={form[f.key] || ""}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <button
          onClick={handleSave}
          disabled={updateVenue.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {updateVenue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Spara
        </button>
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Event categories */}
      <EventCategoriesSection venueId={venueId} />
    </div>
  );
};

export default AdminVenue;
