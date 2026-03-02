import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Timer, Trophy, Zap, ChevronRight, Clock } from "lucide-react";
import { useActiveEvents, useEventMatches, useEventCourts } from "@/hooks/useEventOps";
import CourtTile from "./CourtTile";
import ScoreInputModal from "./ScoreInputModal";
import EventSelector from "./EventSelector";

const LiveCourtControl = () => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const { data: events } = useActiveEvents();
  const { data: matches } = useEventMatches(selectedEventId ?? undefined);
  const { data: courts } = useEventCourts(selectedEventId ?? undefined);
  const [scoreModalMatch, setScoreModalMatch] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  // Auto-select first event
  useEffect(() => {
    if (events?.length && !selectedEventId) {
      setSelectedEventId(events[0].id);
    }
  }, [events, selectedEventId]);

  // Live clock
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const selectedEvent = events?.find((e) => e.id === selectedEventId);
  const activeMatches = matches?.filter((m) => m.status === "in_progress") ?? [];
  const pendingMatches = matches?.filter((m) => m.status === "scheduled") ?? [];
  const completedMatches = matches?.filter((m) => m.status === "completed") ?? [];
  const totalMatches = matches?.length ?? 0;
  const completedPct = totalMatches > 0 ? Math.round((completedMatches.length / totalMatches) * 100) : 0;

  // Get current round
  const currentRound = activeMatches.length > 0
    ? activeMatches[0].round
    : pendingMatches.length > 0
    ? pendingMatches[0].round
    : completedMatches.length > 0
    ? completedMatches[completedMatches.length - 1].round
    : 1;

  const maxRound = matches?.reduce((max, m) => Math.max(max, m.round), 0) ?? 1;

  // Map courts to their active matches
  const courtMatchMap = new Map<string, typeof activeMatches[0]>();
  activeMatches.forEach((m) => {
    if (m.court_id) courtMatchMap.set(m.court_id, m);
  });

  // Score-pending matches (completed but let's treat "completed" as done)
  const matchForModal = matches?.find((m) => m.id === scoreModalMatch);

  if (!events?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
          <Trophy className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-bold">Inga aktiva event</h2>
        <p className="text-sm text-muted-foreground">Skapa ett event i admin-panelen för att börja styra matcher härifrån.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Event selector */}
      {events && events.length > 1 && (
        <EventSelector
          events={events}
          selectedId={selectedEventId}
          onSelect={setSelectedEventId}
        />
      )}

      {/* Status bar */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold truncate">{selectedEvent?.display_name || selectedEvent?.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="status-chip bg-primary/20 text-primary">
                {selectedEvent?.format?.replace("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Round {currentRound}/{maxRound}</div>
            <div className="text-2xl font-black text-primary">{completedPct}%</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-sell"
            initial={{ width: 0 }}
            animate={{ width: `${completedPct}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{activeMatches.length} pågående</span>
          <span>{pendingMatches.length} kvar</span>
          <span>{completedMatches.length} klara</span>
        </div>
      </div>

      {/* Court Grid */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-primary" />
          Banor
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {courts?.map((court) => {
            const match = courtMatchMap.get(court.id);
            return (
              <CourtTile
                key={court.id}
                court={court}
                match={match}
                now={now}
                onTap={(matchId) => setScoreModalMatch(matchId)}
              />
            );
          })}
          {(!courts || courts.length === 0) && (
            <div className="col-span-2 glass-card rounded-2xl p-8 text-center">
              <p className="text-sm text-muted-foreground">Inga banor konfigurerade för detta event</p>
            </div>
          )}
        </div>
      </div>

      {/* Up Next Queue */}
      {pendingMatches.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-court-soon" />
            Nästa upp
          </h3>
          <div className="space-y-2">
            {pendingMatches.slice(0, 4).map((match) => (
              <motion.div
                key={match.id}
                className="glass-card rounded-xl p-3 flex items-center gap-3"
                whileTap={{ scale: 0.97 }}
                onClick={() => setScoreModalMatch(match.id)}
              >
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                  #{match.match_number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {(match.team1 as any)?.name ?? "TBD"} vs {(match.team2 as any)?.name ?? "TBD"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Round {match.round} · {match.court ? `Bana ${(match.court as any)?.court_number}` : "Ej tilldelad"}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Score Input Modal */}
      <AnimatePresence>
        {matchForModal && (
          <ScoreInputModal
            match={matchForModal}
            onClose={() => setScoreModalMatch(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LiveCourtControl;
