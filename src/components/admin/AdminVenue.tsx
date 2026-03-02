import { useState } from "react";
import { useAdminVenue, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

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
  );
};

export default AdminVenue;
