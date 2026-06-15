import { supabase } from "@/integrations/supabase/client";

export interface ActivitySessionOverride {
  id: string;
  activity_session_id: string;
  session_date: string;
  status: "active" | "hidden" | "cancelled";
  reason?: string | null;
}

export function occurrenceOverrideKey(activitySessionId: string, sessionDate: string) {
  return `${activitySessionId}:${sessionDate}`;
}

export async function fetchActivitySessionOverrides(
  venueId: string,
  activitySessionIds: string[],
  startDate: string,
  endDate: string,
) {
  const cleanIds = [...new Set(activitySessionIds.filter(Boolean))];
  const overrides = new Map<string, ActivitySessionOverride>();
  if (!venueId || !cleanIds.length || !startDate || !endDate) return overrides;

  const { data } = await (supabase as any)
    .from("activity_session_overrides")
    .select("id, activity_session_id, session_date, status, reason")
    .eq("venue_id", venueId)
    .in("activity_session_id", cleanIds)
    .gte("session_date", startDate)
    .lte("session_date", endDate);

  for (const row of (data || []) as ActivitySessionOverride[]) {
    overrides.set(occurrenceOverrideKey(row.activity_session_id, row.session_date), row);
  }
  return overrides;
}

export function isPublicActivityOverrideHidden(status?: string | null) {
  return status === "hidden" || status === "cancelled";
}
