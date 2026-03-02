import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { UserCheck, UserX, Search } from "lucide-react";
import { useActiveEvents, useEventPlayers, useEventCheckins, useToggleCheckin } from "@/hooks/useEventOps";
import EventSelector from "./EventSelector";

const today = new Date().toISOString().split("T")[0];

const PlayerCheckin = () => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: events } = useActiveEvents();
  const { data: players } = useEventPlayers(selectedEventId ?? undefined);
  const { data: checkins } = useEventCheckins(selectedEventId ?? undefined, today);
  const toggleCheckin = useToggleCheckin();

  useEffect(() => {
    if (events?.length && !selectedEventId) setSelectedEventId(events[0].id);
  }, [events, selectedEventId]);

  const checkinMap = new Map(checkins?.map((c) => [c.player_id, c.checked_in]) ?? []);

  const filtered = players?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const checkedInCount = filtered.filter((p) => checkinMap.get(p.id)).length;
  const totalCount = filtered.length;

  const handleToggle = (playerId: string) => {
    if (!selectedEventId) return;
    const current = checkinMap.get(playerId) ?? false;
    toggleCheckin.mutate({
      eventId: selectedEventId,
      playerId,
      sessionDate: today,
      checkedIn: !current,
    });
  };

  if (!events?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-4">
        <UserCheck className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Inga aktiva event</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      {events && events.length > 1 && (
        <EventSelector events={events} selectedId={selectedEventId} onSelect={setSelectedEventId} />
      )}

      {/* Stats bar */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Incheckning</span>
          <span className="text-2xl font-black">
            <span className="text-success">{checkedInCount}</span>
            <span className="text-muted-foreground text-base">/{totalCount}</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-success"
            initial={{ width: 0 }}
            animate={{ width: `${totalCount > 0 ? (checkedInCount / totalCount) * 100 : 0}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Sök spelare..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Player list */}
      <div className="space-y-1.5">
        {filtered.map((player, i) => {
          const isCheckedIn = checkinMap.get(player.id) ?? false;
          return (
            <motion.button
              key={player.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => handleToggle(player.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.97] ${
                isCheckedIn
                  ? "bg-success/10 border border-success/20"
                  : "glass-card"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  isCheckedIn ? "bg-success/20" : "bg-secondary"
                }`}
              >
                {isCheckedIn ? (
                  <UserCheck className="w-4 h-4 text-success" />
                ) : (
                  <UserX className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-semibold truncate">{player.name}</div>
                {(player.team as any)?.name && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: (player.team as any)?.color || "hsl(var(--muted))" }}
                    />
                    <span className="text-xs text-muted-foreground">{(player.team as any)?.name}</span>
                  </div>
                )}
              </div>
              <span
                className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                  isCheckedIn
                    ? "bg-success/20 text-success"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {isCheckedIn ? "Incheckad" : "Ej anlänt"}
              </span>
            </motion.button>
          );
        })}
      </div>

      {filtered.length === 0 && players && players.length > 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">Inga spelare matchar "{search}"</p>
        </div>
      )}

      {(!players || players.length === 0) && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Inga spelare registrerade för detta event</p>
        </div>
      )}
    </div>
  );
};

export default PlayerCheckin;
