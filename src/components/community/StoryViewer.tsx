import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import picklaLogo from "@/assets/pickla-logo.svg";

interface Story {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
}

interface StoryViewerProps {
  stories: Story[];
  initialIndex: number;
  onClose: () => void;
}

export function StoryViewer({ stories, initialIndex, onClose }: StoryViewerProps) {
  const [current, setCurrent] = useState(initialIndex);

  const goNext = useCallback(() => {
    if (current < stories.length - 1) setCurrent((c) => c + 1);
    else onClose();
  }, [current, stories.length, onClose]);

  const goPrev = useCallback(() => {
    if (current > 0) setCurrent((c) => c - 1);
  }, [current]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose, goNext, goPrev]);

  // Auto-advance every 5s
  useEffect(() => {
    const timer = setTimeout(goNext, 5000);
    return () => clearTimeout(timer);
  }, [current, goNext]);

  const story = stories[current];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.95)" }}
        onClick={onClose}
      >
        {/* Progress bars */}
        <div className="absolute top-4 left-4 right-4 flex gap-1 z-10">
          {stories.map((_, i) => (
            <div
              key={i}
              className="flex-1 h-0.5 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.3)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: "#fff" }}
                initial={{ width: i < current ? "100%" : "0%" }}
                animate={{
                  width: i < current ? "100%" : i === current ? "100%" : "0%",
                }}
                transition={
                  i === current
                    ? { duration: 5, ease: "linear" }
                    : { duration: 0 }
                }
              />
            </div>
          ))}
        </div>

        {/* Close */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-10 right-4 z-10 p-2 rounded-full active:scale-90 transition-transform"
          style={{ background: "rgba(255,255,255,0.15)" }}
        >
          <X className="w-5 h-5 text-white" />
        </button>

        {/* Logo */}
        <div className="absolute top-10 left-4 z-10">
          <img
            src={picklaLogo}
            alt="Pickla"
            className="h-5 w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>

        {/* Image */}
        <motion.img
          key={story.id}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          src={story.image_url}
          alt={story.caption || ""}
          className="max-h-[80vh] max-w-[90vw] object-contain rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Caption */}
        {story.caption && (
          <div
            className="absolute bottom-8 left-4 right-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="text-white text-sm font-semibold"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
            >
              {story.caption}
            </p>
          </div>
        )}

        {/* Nav areas */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1/3"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-1/3"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
