import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export const ACCESS_SNAPSHOT_QUERY_KEY = "access-snapshot";

function activeMembershipId(membership: any) {
  return membership?.id || membership?.membership_id || "";
}

function membershipTierId(membership: any) {
  return membership?.tier_id || membership?.membership_tiers?.id || "";
}

function membershipTierName(membership: any) {
  return membership?.membership_tiers?.name || membership?.tier_name || "";
}

export function useAccessSnapshot({
  venueId,
  sessionDate,
}: {
  venueId?: string | null;
  sessionDate?: string | null;
}) {
  const { user } = useAuth();

  const snapshotQuery = useQuery({
    queryKey: [ACCESS_SNAPSHOT_QUERY_KEY, user?.id || "anon", venueId || "no-venue", sessionDate || "no-date"],
    enabled: !!user?.id && !!venueId,
    staleTime: 15000,
    queryFn: async () => {
      const [membership, dayAccessResult] = await Promise.all([
        apiGet<any>("api-memberships", "user", { userId: user!.id, venueId }),
        sessionDate
          ? supabase
              .from("access_entitlements")
              .select("id, source_id, entitlement_type, valid_date, updated_at")
              .eq("user_id", user!.id)
              .eq("venue_id", venueId)
              .eq("entitlement_type", "day_access")
              .eq("status", "active")
              .eq("valid_date", sessionDate)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (dayAccessResult.error) throw dayAccessResult.error;

      const dayAccess = dayAccessResult.data;
      const tierName = membershipTierName(membership);
      const entitlements = [
        ...(membership?.tier_entitlements || []),
        ...(membership?.membership_tiers?.membership_entitlements || []),
      ];
      const version = [
        user!.id,
        venueId,
        sessionDate || "any-date",
        activeMembershipId(membership) || "no-membership",
        membershipTierId(membership) || "no-tier",
        membership?.status || "unknown-status",
        dayAccess?.id || "no-day-access",
      ].join(":");

      return {
        userId: user!.id,
        venueId,
        sessionDate: sessionDate || null,
        membership,
        membershipId: activeMembershipId(membership) || null,
        membershipTierId: membershipTierId(membership) || null,
        membershipTierName: tierName || null,
        membershipStatus: membership?.status || null,
        hasActiveMembership: Boolean(activeMembershipId(membership) || membershipTierId(membership)),
        isFounder: /founder/i.test(tierName),
        hasDayAccess: Boolean(dayAccess?.id),
        dayAccess,
        entitlements,
        version,
      };
    },
  });

  return useMemo(() => {
    if (!user?.id) {
      return {
        userId: null,
        isAuthenticated: false,
        isLoading: false,
        isFetching: false,
        version: "anonymous",
        data: null,
      };
    }

    return {
      userId: user.id,
      isAuthenticated: true,
      isLoading: snapshotQuery.isLoading,
      isFetching: snapshotQuery.isFetching,
      version: snapshotQuery.data?.version || "snapshot-loading",
      data: snapshotQuery.data || null,
    };
  }, [snapshotQuery.data, snapshotQuery.isFetching, snapshotQuery.isLoading, user?.id]);
}
