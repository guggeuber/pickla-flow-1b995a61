import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { fetchMyCourses } from "@/lib/courses";

export function useMyCourses(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-courses", user?.id],
    queryFn: fetchMyCourses,
    enabled: enabled && Boolean(user),
  });
}
