import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

// Fetch active events for the venue
export function useActiveEvents(venueId?: string) {
  return useQuery({
    queryKey: ["active-events", venueId],
    queryFn: async () => {
      // Events are public reads — we still go via API for consistency
      // but the api-matches endpoint doesn't cover events listing yet,
      // so we use the Supabase client for this one read
      const { supabase } = await import("@/integrations/supabase/client");
      let query = supabase
        .from("events")
        .select("*")
        .in("status", ["active", "in_progress", "upcoming"])
        .order("start_date", { ascending: false });
      if (venueId) query = query.eq("venue_id", venueId);
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
    enabled: !!eventId,
    queryFn: () => apiGet("api-matches", "event", { eventId: eventId! }),
  });
}

// Fetch courts for an event
export function useEventCourts(eventId?: string) {
  return useQuery({
    queryKey: ["event-courts", eventId],
    enabled: !!eventId,
    queryFn: () => apiGet("api-matches", "courts", { eventId: eventId! }),
  });
}

// Fetch players for an event
export function useEventPlayers(eventId?: string) {
  return useQuery({
    queryKey: ["event-players", eventId],
    enabled: !!eventId,
    queryFn: () => apiGet("api-checkins", "players", { eventId: eventId! }),
  });
}

// Fetch checkins for event + date
export function useEventCheckins(eventId?: string, sessionDate?: string) {
  return useQuery({
    queryKey: ["event-checkins", eventId, sessionDate],
    enabled: !!eventId && !!sessionDate,
    queryFn: () => apiGet("api-checkins", "event", { eventId: eventId!, date: sessionDate! }),
  });
}

// Update match score
export function useUpdateMatchScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { matchId: string; team1Score: number; team2Score: number; status: string }) =>
      apiPost("api-matches", "update-score", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-matches"] }),
  });
}

// Assign match to court
export function useAssignCourt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { matchId: string; courtId: string }) =>
      apiPost("api-matches", "assign-court", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-matches"] }),
  });
}

// Toggle player check-in
export function useToggleCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventId: string; playerId: string; sessionDate: string; checkedIn: boolean }) =>
      apiPost("api-checkins", "toggle", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-checkins"] }),
  });
}
