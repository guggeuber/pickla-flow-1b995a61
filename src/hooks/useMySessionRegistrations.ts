import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export type MyActivitySessionSummary = {
  id: string;
  name: string | null;
  session_type: string | null;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_id: string | null;
  venues?: { name: string | null; slug: string | null } | null;
};

export type MySessionRegistration = {
  id: string;
  venue_id: string | null;
  activity_session_id: string;
  session_date: string;
  user_id: string;
  status: string | null;
  price_paid_sek: number | null;
  stripe_session_id: string | null;
  series_commitment_id?: string | null;
  created_at: string | null;
  activity_sessions: MyActivitySessionSummary | null;
};

export function useMySessionRegistrations(enabled = true) {
  const { user } = useAuth();
  return useQuery<MySessionRegistration[]>({
    queryKey: ["my-session-registrations", user?.id],
    enabled: enabled && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_registrations")
        .select("id, venue_id, activity_session_id, session_date, user_id, status, price_paid_sek, stripe_session_id, series_commitment_id, created_at, activity_sessions(id, name, session_type, session_date, start_time, end_time, venue_id, venues(name, slug))")
        .eq("user_id", user!.id)
        .neq("status", "cancelled")
        .order("session_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as MySessionRegistration[];
    },
  });
}
