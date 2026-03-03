import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Image as ImageIcon, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface AdminStoriesProps {
  venueId: string | undefined;
}

export default function AdminStories({ venueId }: AdminStoriesProps) {
  const qc = useQueryClient();
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const { data: stories, isLoading } = useQuery({
    queryKey: ["admin-stories", venueId],
    enabled: !!venueId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_stories")
        .select("*")
        .eq("venue_id", venueId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const story = stories?.find((s) => s.id === id);
      if (story?.image_url) {
        const path = story.image_url.split("/community-stories/")[1];
        if (path) await supabase.storage.from("community-stories").remove([path]);
      }
      const { error } = await supabase.from("community_stories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-stories", venueId] });
      toast.success("Story raderad");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!selectedFile || !venueId) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Ej inloggad");

      const ext = selectedFile.name.split(".").pop();
      const fileName = `${venueId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("community-stories")
        .upload(fileName, selectedFile, { contentType: selectedFile.type });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("community-stories")
        .getPublicUrl(fileName);

      const { error: insertError } = await supabase.from("community_stories").insert({
        venue_id: venueId,
        image_url: publicUrl,
        caption: caption.trim() || null,
        created_by: user.id,
      });
      if (insertError) throw insertError;

      toast.success("Story publicerad! Försvinner automatiskt efter 24h.");
      setSelectedFile(null);
      setPreview(null);
      setCaption("");
      qc.invalidateQueries({ queryKey: ["admin-stories", venueId] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <div className="glass-card rounded-2xl p-4 space-y-4">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Ny Story</p>

        {preview ? (
          <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-muted">
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            <button
              onClick={() => { setSelectedFile(null); setPreview(null); }}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 w-full aspect-[3/4] rounded-xl border-2 border-dashed border-border cursor-pointer hover:border-primary/40 transition-colors bg-muted/30">
            <ImageIcon className="w-8 h-8 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Välj bild (3:4 rekommenderas)</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </label>
        )}

        <Input
          placeholder="Caption (valfritt)"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={120}
        />

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>Försvinner automatiskt efter 24 timmar</span>
        </div>

        <Button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="w-full"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          Publicera Story
        </Button>
      </div>

      {/* Existing stories */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
          Aktiva Stories ({stories?.filter((s) => !isExpired(s.expires_at)).length || 0})
        </p>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        <AnimatePresence>
          {stories?.map((story) => {
            const expired = isExpired(story.expires_at);
            return (
              <motion.div
                key={story.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`glass-card rounded-xl p-3 flex items-center gap-3 ${expired ? "opacity-50" : ""}`}
              >
                <div className="w-14 h-[74px] rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  <img src={story.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {story.caption || "Ingen caption"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(story.created_at), "d MMM HH:mm", { locale: sv })}
                  </p>
                  {expired ? (
                    <span className="text-[10px] text-destructive font-semibold">Utgången</span>
                  ) : (
                    <span className="text-[10px] text-court-free font-semibold">
                      Aktiv – försvinner {format(new Date(story.expires_at), "d MMM HH:mm", { locale: sv })}
                    </span>
                  )}
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => deleteMutation.mutate(story.id)}
                  disabled={deleteMutation.isPending}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </motion.button>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {!isLoading && (!stories || stories.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-6">Inga stories ännu</p>
        )}
      </div>
    </div>
  );
}
