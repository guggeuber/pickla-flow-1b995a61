import { useState } from "react";
import { useAdminLinks, useAdminMutation } from "@/hooks/useAdmin";
import { Loader2, Plus, Link2, GripVertical, Image } from "lucide-react";
import { toast } from "sonner";

const iconOptions = ["message-circle", "instagram", "bot", "calendar", "ticket", "gamepad2", "link"];
const colorOptions = ["primary", "success", "sell", "court-vip"];

const AdminLinks = ({ venueId }: { venueId: string }) => {
  const { data: links, isLoading } = useAdminLinks(venueId);
  const { addLink, updateLink } = useAdminMutation(venueId);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("link");
  const [color, setColor] = useState("primary");
  const [memberCount, setMemberCount] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!title || !url) return;
    addLink.mutate({
      title, url, description: description || undefined,
      icon, color,
      member_count: memberCount || undefined,
      image_url: imageUrl || undefined,
      sort_order: (links?.length || 0) + 1,
    }, {
      onSuccess: () => { toast.success("Länk tillagd!"); setTitle(""); setUrl(""); setDescription(""); setMemberCount(""); setImageUrl(""); },
      onError: (e) => toast.error(e.message),
    });
  };

  const toggleActive = (link: any) => {
    updateLink.mutate({ linkId: link.id, is_active: !link.is_active }, {
      onSuccess: () => toast.success(link.is_active ? "Dold" : "Synlig"),
    });
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny länk</p>
        <input placeholder="Titel" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="URL" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={url} onChange={(e) => setUrl(e.target.value)} />
        <input placeholder="Beskrivning" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-muted-foreground shrink-0" />
          <input placeholder="Bild-URL (t.ex. Instagram-bild)" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </div>
        {imageUrl && (
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
            <img src={imageUrl} alt="Preview" className="w-full h-32 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            {iconOptions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={color} onChange={(e) => setColor(e.target.value)} className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Antal" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }} value={memberCount} onChange={(e) => setMemberCount(e.target.value)} />
        </div>
        <button onClick={handleAdd} disabled={addLink.isPending} className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50">
          {addLink.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Lägg till
        </button>
      </div>

      <div className="space-y-1.5">
        {(links || []).map((link: any) => (
          <div key={link.id} className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <GripVertical className="w-4 h-4 text-muted-foreground/40" />
            {link.image_url ? (
              <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0">
                <img src={link.image_url} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Link2 className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{link.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{link.url}</p>
            </div>
            {link.member_count && (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{link.member_count}</span>
            )}
            <button onClick={() => toggleActive(link)} className={`text-[10px] px-2 py-1 rounded-full font-semibold ${link.is_active ? "bg-badge-paid/15 text-badge-paid" : "bg-destructive/15 text-destructive"}`}>
              {link.is_active ? "Synlig" : "Dold"}
            </button>
          </div>
        ))}
        {(!links || links.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-6">Inga länkar ännu</p>
        )}
      </div>
    </div>
  );
};

export default AdminLinks;
