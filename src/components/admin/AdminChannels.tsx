import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Hash, Trash2, Users, Zap } from "lucide-react";
import { toast } from "sonner";

const CHANNEL_TYPES = [
  { value: "venue", label: "Venue", icon: Hash },
  { value: "sport", label: "Sport", icon: Zap },
  { value: "crew", label: "Crew", icon: Users },
] as const;

const SPORT_TYPES = ["pickleball", "darts", "padel"] as const;

const AdminChannels = ({ venueId }: { venueId: string }) => {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelType, setChannelType] = useState("venue");
  const [sportType, setSportType] = useState("");

  const { data: channels, isLoading } = useQuery({
    queryKey: ["admin-channels", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_channels")
        .select("*")
        .eq("venue_id", venueId)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const addChannel = useMutation({
    mutationFn: async (body: { name: string; description: string; channel_type: string; sport_type?: string }) => {
      const { data, error } = await supabase
        .from("chat_channels")
        .insert({
          venue_id: venueId,
          name: body.name,
          description: body.description || null,
          channel_type: body.channel_type,
          sport_type: body.sport_type || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-channels", venueId] });
      qc.invalidateQueries({ queryKey: ["chat-channels"] });
      toast.success("Channel created!");
      setName("");
      setDescription("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleChannel = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("chat_channels")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-channels", venueId] });
      qc.invalidateQueries({ queryKey: ["chat-channels"] });
    },
  });

  const deleteChannel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("chat_channels")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-channels", venueId] });
      qc.invalidateQueries({ queryKey: ["chat-channels"] });
      toast.success("Channel deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-8" />;

  const handleAdd = () => {
    if (!name.trim()) return;
    addChannel.mutate({
      name: name.trim(),
      description: description.trim(),
      channel_type: channelType,
      sport_type: channelType === "sport" ? sportType : undefined,
    });
  };

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">New Channel</p>
        <input
          placeholder="Channel name"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Description (optional)"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={channelType}
            onChange={(e) => setChannelType(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
          >
            {CHANNEL_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
          {channelType === "sport" && (
            <select
              value={sportType}
              onChange={(e) => setSportType(e.target.value)}
              className="rounded-xl px-3 py-2.5 text-sm outline-none capitalize"
              style={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            >
              <option value="">Select sport</option>
              {SPORT_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <button
          onClick={handleAdd}
          disabled={!name.trim() || addChannel.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
        >
          {addChannel.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create Channel
        </button>
      </div>

      {/* Channel list */}
      <div className="space-y-2">
        {(channels || []).map((ch: any) => {
          const TypeIcon = CHANNEL_TYPES.find(ct => ct.value === ch.channel_type)?.icon || Hash;
          return (
            <div
              key={ch.id}
              className="glass-card rounded-xl p-3 flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(var(--primary) / 0.1)" }}
              >
                <TypeIcon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">#{ch.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {ch.channel_type}{ch.sport_type ? ` · ${ch.sport_type}` : ""}
                </p>
              </div>
              <button
                onClick={() => toggleChannel.mutate({ id: ch.id, is_active: !ch.is_active })}
                className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                  ch.is_active ? "bg-court-free/20 text-court-free" : "bg-destructive/20 text-destructive"
                }`}
              >
                {ch.is_active ? "Active" : "Inactive"}
              </button>
              <button
                onClick={() => {
                  if (confirm("Delete this channel?")) deleteChannel.mutate(ch.id);
                }}
                className="w-7 h-7 rounded-full bg-destructive/10 flex items-center justify-center"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          );
        })}
      </div>

      {(!channels || channels.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-6">No channels yet</p>
      )}
    </div>
  );
};

export default AdminChannels;
