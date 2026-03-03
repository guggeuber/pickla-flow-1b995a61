import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { useState } from "react";
import { StoryViewer } from "./StoryViewer";
import picklaLogo from "@/assets/pickla-logo.svg";

interface Story {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
  venue_id: string | null;
}

export function StoriesCarousel() {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: stories } = useQuery({
    queryKey: ["community-stories"],
    staleTime: 30000,
    queryFn: async () => {
      const { data } = await supabase
        .from("community_stories" as any)
        .select("id, image_url, caption, created_at, expires_at, venue_id")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as unknown as Story[];
    },
  });

  if (!stories?.length) return null;

  return (
    <>
      <div className="w-full overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex gap-3 pb-1" style={{ minWidth: "min-content" }}>
          {stories.map((story, i) => (
            <motion.button
              key={story.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setViewerIndex(i)}
              className="shrink-0 rounded-2xl overflow-hidden relative active:scale-95 transition-transform"
              style={{
                width: 110,
                aspectRatio: "3/4",
                boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
              }}
            >
              <img
                src={story.image_url}
                alt={story.caption || "Story"}
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Gradient overlay */}
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(transparent 50%, rgba(0,0,0,0.5))",
                }}
              />
              {/* Logo badge */}
              <div className="absolute top-2 left-2">
                <img
                  src={picklaLogo}
                  alt=""
                  className="h-4 w-auto"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
              </div>
              {/* Caption */}
              {story.caption && (
                <p
                  className="absolute bottom-2 left-2 right-2 text-[10px] font-semibold text-white leading-tight line-clamp-2"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
                >
                  {story.caption}
                </p>
              )}
              {/* Ring border */}
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{ border: "2px solid rgba(232,108,36,0.5)" }}
              />
            </motion.button>
          ))}
        </div>
      </div>

      {viewerIndex !== null && (
        <StoryViewer
          stories={stories}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}
