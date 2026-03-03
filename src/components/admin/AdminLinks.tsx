import { useState, useRef, useCallback } from "react";
import { useAdminLinks, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, Link2, Image, Pencil, X, Check, Trash2, GripVertical, MapPin } from "lucide-react";
import { toast } from "sonner";

const iconOptions = ["message-circle", "instagram", "bot", "calendar", "ticket", "gamepad2", "link", "map-pin"];
const colorOptions = ["primary", "success", "sell", "court-vip"];

const inputStyle = {
  background: "hsl(var(--surface-2))",
  border: "1px solid hsl(var(--border))",
};

const InputField = ({ placeholder, value, onChange, icon }: { placeholder: string; value: string; onChange: (v: string) => void; icon?: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    {icon}
    <input
      placeholder={placeholder}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
      style={inputStyle}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

function LinkForm({
  initial,
  onSave,
  onCancel,
  isPending,
  submitLabel,
  submitIcon,
}: {
  initial: { title: string; url: string; description: string; icon: string; color: string; memberCount: string; imageUrl: string };
  onSave: (data: typeof initial) => void;
  onCancel?: () => void;
  isPending: boolean;
  submitLabel: string;
  submitIcon: React.ReactNode;
}) {
  const [title, setTitle] = useState(initial.title);
  const [url, setUrl] = useState(initial.url);
  const [description, setDescription] = useState(initial.description);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState(initial.color);
  const [memberCount, setMemberCount] = useState(initial.memberCount);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);

  const isInstagram = /instagram\.com\/(p|reel)\//.test(url);
  const isGoogleMaps = /google\.(com|se)\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(url);

  return (
    <div className="space-y-2.5">
      <InputField placeholder="Titel" value={title} onChange={setTitle} />
      <InputField placeholder="URL (Instagram, Google Maps, etc.)" value={url} onChange={setUrl} />
      {isInstagram && (
        <p className="text-[10px] font-semibold px-1" style={{ color: "#E1306C" }}>📸 Visas som inbäddad Instagram-post</p>
      )}
      {isGoogleMaps && (
        <p className="text-[10px] font-semibold px-1 flex items-center gap-1" style={{ color: "#4285F4" }}>
          <MapPin className="w-3 h-3" /> Visas som Google Maps-plats
        </p>
      )}
      <InputField placeholder="Beskrivning" value={description} onChange={setDescription} />
      <InputField placeholder="Bild-URL" value={imageUrl} onChange={setImageUrl} icon={<Image className="w-4 h-4 text-muted-foreground shrink-0" />} />
      {imageUrl && (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          <img src={imageUrl} alt="Preview" className="w-full h-28 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-xl px-2 py-2.5 text-xs outline-none" style={{ ...inputStyle, color: "hsl(var(--foreground))" }}>
          {iconOptions.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)} className="rounded-xl px-2 py-2.5 text-xs outline-none" style={{ ...inputStyle, color: "hsl(var(--foreground))" }}>
          {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Antal" className="rounded-xl px-2 py-2.5 text-xs outline-none" style={inputStyle} value={memberCount} onChange={(e) => setMemberCount(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSave({ title, url, description, icon, color, memberCount, imageUrl })}
          disabled={isPending || !title || !url}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : submitIcon}
          {submitLabel}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="px-4 rounded-xl py-2.5 text-sm font-medium" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

const AdminLinks = ({ venueId }: { venueId: string }) => {
  const { data: links, isLoading } = useAdminLinks(venueId);
  const { addLink, updateLink, deleteLink, reorderLinks } = useAdminMutation(venueId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const sortedLinks = [...(links || [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const handleAdd = (data: any) => {
    addLink.mutate({
      title: data.title, url: data.url, description: data.description || undefined,
      icon: data.icon, color: data.color,
      member_count: data.memberCount || undefined,
      image_url: data.imageUrl || undefined,
      sort_order: (links?.length || 0) + 1,
    }, {
      onSuccess: () => toast.success("Länk tillagd!"),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleUpdate = (link: any, data: any) => {
    updateLink.mutate({
      linkId: link.id,
      title: data.title,
      url: data.url,
      description: data.description || null,
      icon: data.icon,
      color: data.color,
      member_count: data.memberCount || null,
      image_url: data.imageUrl || null,
    }, {
      onSuccess: () => { toast.success("Länk uppdaterad!"); setEditingId(null); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleDelete = (linkId: string) => {
    deleteLink.mutate(linkId, {
      onSuccess: () => { toast.success("Länk borttagen!"); setConfirmDeleteId(null); },
      onError: (e) => toast.error(e.message),
    });
  };

  const toggleActive = (link: any) => {
    updateLink.mutate({ linkId: link.id, is_active: !link.is_active }, {
      onSuccess: () => toast.success(link.is_active ? "Dold" : "Synlig"),
    });
  };

  // Touch drag handlers
  const handleDragStart = (index: number) => {
    dragItemRef.current = index;
    setDragIndex(index);
  };

  const handleDragEnter = (index: number) => {
    setOverIndex(index);
  };

  const handleDragEnd = () => {
    if (dragItemRef.current !== null && overIndex !== null && dragItemRef.current !== overIndex) {
      const reordered = [...sortedLinks];
      const [moved] = reordered.splice(dragItemRef.current, 1);
      reordered.splice(overIndex, 0, moved);
      const orderedIds = reordered.map((l: any) => l.id);
      reorderLinks.mutate(orderedIds, {
        onSuccess: () => toast.success("Ordning sparad!"),
        onError: (e) => toast.error(e.message),
      });
    }
    setDragIndex(null);
    setOverIndex(null);
    dragItemRef.current = null;
  };

  return (
    <div className="space-y-4">
      {/* Add new link */}
      <div className="glass-card rounded-2xl p-4">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Ny länk</p>
        <LinkForm
          initial={{ title: "", url: "", description: "", icon: "link", color: "primary", memberCount: "", imageUrl: "" }}
          onSave={handleAdd}
          isPending={addLink.isPending}
          submitLabel="Lägg till"
          submitIcon={<Plus className="w-4 h-4" />}
        />
      </div>

      {/* Existing links */}
      <div className="space-y-2">
        {sortedLinks.map((link: any, index: number) => (
          <div
            key={link.id}
            className={`glass-card rounded-2xl overflow-hidden transition-all ${
              dragIndex === index ? "opacity-50 scale-95" : ""
            } ${overIndex === index && dragIndex !== index ? "ring-2 ring-primary" : ""}`}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={handleDragEnd}
          >
            {/* Summary row */}
            <div className="p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <div
                className="cursor-grab active:cursor-grabbing touch-none p-1"
                onTouchStart={() => handleDragStart(index)}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground/40" />
              </div>
              {link.image_url ? (
                <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0">
                  <img src={link.image_url} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{link.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{link.url}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditingId(editingId === link.id ? null : link.id)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  {editingId === link.id ? <X className="w-3.5 h-3.5 text-muted-foreground" /> : <Pencil className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => toggleActive(link)}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold ${link.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}
                >
                  {link.is_active ? "Synlig" : "Dold"}
                </button>
              </div>
            </div>

            {/* Edit panel */}
            {editingId === link.id && (
              <div className="px-3 sm:px-4 pb-4 pt-1 border-t space-y-3" style={{ borderColor: "hsl(var(--border))" }}>
                <LinkForm
                  initial={{
                    title: link.title || "",
                    url: link.url || "",
                    description: link.description || "",
                    icon: link.icon || "link",
                    color: link.color || "primary",
                    memberCount: link.member_count || "",
                    imageUrl: link.image_url || "",
                  }}
                  onSave={(data) => handleUpdate(link, data)}
                  onCancel={() => setEditingId(null)}
                  isPending={updateLink.isPending}
                  submitLabel="Spara"
                  submitIcon={<Check className="w-4 h-4" />}
                />
                {/* Delete */}
                <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                  {confirmDeleteId === link.id ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-destructive flex-1">Säker? Kan inte ångras.</p>
                      <button
                        onClick={() => handleDelete(link.id)}
                        disabled={deleteLink.isPending}
                        className="text-xs px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground font-semibold disabled:opacity-50"
                      >
                        {deleteLink.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Radera"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                      >
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(link.id)}
                      className="flex items-center gap-1.5 text-xs text-destructive/70 hover:text-destructive font-medium transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Ta bort länk permanent
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {sortedLinks.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga länkar ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminLinks;
