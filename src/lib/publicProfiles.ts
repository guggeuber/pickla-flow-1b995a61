import { supabase } from "@/integrations/supabase/client";

export type PublicProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export async function getPublicProfile(profileIdOrUserId: string) {
  const { data, error } = await (supabase as any).rpc("get_public_profile", { profile_id: profileIdOrUserId });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] as PublicProfile | undefined) || null : null;
}

export async function getPublicProfileMap(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      const profile = await getPublicProfile(id);
      return [id, profile] as const;
    }),
  );
  return new Map(entries);
}
