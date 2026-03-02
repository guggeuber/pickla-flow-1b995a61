import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fetch active events for the venue
export function useActiveEvents(venueId?: string) {
  return useQuery({
    queryKey: ["active-events", venueId],
    queryFn: async () => {
      let query = supabase
        .from("events")
        .select("*")
        .in("status", ["active", "in_progress", "upcoming"])
        .order("start_date", { ascending: false });

      if (venueId) {
        query = query.eq("venue_id", venueId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

// Fetch matches for an event
export function useEventMatches(eventId?: string) {
  return useQuery({
    queryKey: ["event-matches", eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("matches")
        .select(`
          *,
          team1:teams!matches_team1_id_fkey(id, name, color),
          team2:teams!matches_team2_id_fkey(id, name, color),
          court:courts!matches_court_id_fkey(id, name, court_number)
        `)
        .eq("event_id", eventId)
        .order("round", { ascending: true })
        .order("match_number", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!eventId,
  });
}

// Fetch courts for an event
export function useEventCourts(eventId?: string) {
  return useQuery({
    queryKey: ["event-courts", eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("courts")
        .select("*")
        .eq("event_id", eventId)
        .order("court_number", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!eventId,
  });
}

// Fetch players for an event
export function useEventPlayers(eventId?: string) {
  return useQuery({
    queryKey: ["event-players", eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("players")
        .select(`*, team:teams(id, name, color)`)
        .eq("event_id", eventId)
        .order("name", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!eventId,
  });
}

// Fetch checkins for event + date
export function useEventCheckins(eventId?: string, sessionDate?: string) {
  return useQuery({
    queryKey: ["event-checkins", eventId, sessionDate],
    queryFn: async () => {
      if (!eventId || !sessionDate) return [];
      const { data, error } = await supabase
        .from("event_checkins")
        .select("*")
        .eq("event_id", eventId)
        .eq("session_date", sessionDate);

      if (error) throw error;
      return data;
    },
    enabled: !!eventId && !!sessionDate,
  });
}

// Update match score
export function useUpdateMatchScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      team1Score,
      team2Score,
      status,
    }: {
      matchId: string;
      team1Score: number;
      team2Score: number;
      status: "scheduled" | "in_progress" | "completed";
    }) => {
      const { error } = await supabase
        .from("matches")
        .update({
          team1_score: team1Score,
          team2_score: team2Score,
          status,
          ...(status === "in_progress" ? { started_at: new Date().toISOString() } : {}),
        })
        .eq("id", matchId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-matches"] });
    },
  });
}

// Assign match to court
export function useAssignCourt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, courtId }: { matchId: string; courtId: string }) => {
      const { error } = await supabase
        .from("matches")
        .update({ court_id: courtId, status: "in_progress" as const, started_at: new Date().toISOString() })
        .eq("id", matchId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-matches"] });
    },
  });
}

// Toggle player check-in
export function useToggleCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventId,
      playerId,
      sessionDate,
      checkedIn,
    }: {
      eventId: string;
      playerId: string;
      sessionDate: string;
      checkedIn: boolean;
    }) => {
      if (checkedIn) {
        const { error } = await supabase.from("event_checkins").upsert(
          {
            event_id: eventId,
            player_id: playerId,
            session_date: sessionDate,
            checked_in: true,
            checked_in_at: new Date().toISOString(),
          },
          { onConflict: "event_id,player_id,session_date" }
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("event_checkins")
          .update({ checked_in: false, checked_in_at: null })
          .eq("event_id", eventId)
          .eq("player_id", playerId)
          .eq("session_date", sessionDate);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-checkins"] });
    },
  });
}
