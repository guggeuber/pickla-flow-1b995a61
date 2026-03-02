import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ListOrdered, Play, CheckCircle2, Clock, Zap } from "lucide-react";
import { useActiveEvents, useEventMatches, useEventCourts, useAssignCourt } from "@/hooks/useEventOps";
import EventSelector from "./EventSelector";
import { toast } from "sonner";

type Filter = "all" | "scheduled" | "in_progress" | "completed";

const filterLabels: Record<Filter, string> = {
  all: "Alla",
  scheduled: "Väntande",
  in_progress: "Pågående",
  completed: "Klara",
};

const MatchQueue = () => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { data: events } = useActiveEvents();
  const { data: matches } = useEventMatches(selectedEventId ?? undefined);
  const { data: courts } = useEventCourts(selectedEventId ?? undefined);
  const assignCourt = useAssignCourt();

  useEffect(() => {
    if (events?.length && !selectedEventId) setSelectedEventId(events[0].id);
  }, [events, selectedEventId]);

  const filtered = matches?.filter((m) => filter === "all" || m.status === filter) ?? [];
  const freeCourts = courts?.filter(
    (c) => c.is_available && !matches?.some((m) => m.court_id === c.id && m.status === "in_progress")
  ) ?? [];

  // Group by round
  const rounds = [...new Set(filtered.map((m: any) => Number(m.round)))].sort((a: number, b: number) => a - b);

  const handleAutoAssign = () => {
    const pending = matches?.filter((m) => m.status === "scheduled" && !m.court_id) ?? [];
    const available = [...freeCourts];
    let assigned = 0;

    for (const match of pending) {
      if (available.length === 0) break;
      const court = available.shift()!;
      assignCourt.mutate({ matchId: match.id, courtId: court.id });
      assigned++;
    }

    if (assigned > 0) {
      toast.success(`${assigned} matcher tilldelade till banor`);
    } else {
      toast.info("Inga matcher att tilldela eller inga lediga banor");
    }
  };

  const statusIcon = (status: string | null) => {
    switch (status) {
      case "in_progress": return <Play className="w-3.5 h-3.5 text-court-active" />;
      case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
      default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  if (!events?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-4">
        <ListOrdered className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Inga aktiva event</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      {events && events.length > 1 && (
        <EventSelector events={events} selectedId={selectedEventId} onSelect={setSelectedEventId} />
      )}

      {/* Auto-assign */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleAutoAssign}
        className="w-full py-3 rounded-xl bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center gap-2 border border-primary/20"
        disabled={assignCourt.isPending}
      >
        <Zap className="w-4 h-4" />
        Auto-tilldela banor ({freeCourts.length} lediga)
      </motion.button>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(Object.keys(filterLabels) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {filterLabels[f]}
          </button>
        ))}
      </div>

      {/* Matches by round */}
      {rounds.map((round) => {
        const roundMatches = filtered.filter((m) => m.round === round);
        const completed = roundMatches.filter((m) => m.status === "completed").length;
        return (
          <div key={String(round)}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Round {String(round)}
              </h3>
              <span className="text-xs text-muted-foreground">
                {completed}/{roundMatches.length} klara
              </span>
            </div>
            <div className="space-y-2">
              {roundMatches.map((match) => (
                <motion.div
                  key={match.id}
                  className="glass-card rounded-xl p-3 flex items-center gap-3"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  {statusIcon(match.status)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {(match.team1 as any)?.name ?? "TBD"} vs {(match.team2 as any)?.name ?? "TBD"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Match #{match.match_number}
                      {match.court ? ` · Bana ${(match.court as any)?.court_number}` : ""}
                    </div>
                  </div>
                  {match.status === "completed" && (
                    <span className="text-sm font-bold tabular-nums">
                      {match.team1_score}-{match.team2_score}
                    </span>
                  )}
                  {match.status === "in_progress" && (
                    <span className="text-sm font-bold tabular-nums text-court-active">
                      {match.team1_score}-{match.team2_score}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Inga matcher att visa</p>
        </div>
      )}
    </div>
  );
};

export default MatchQueue;
