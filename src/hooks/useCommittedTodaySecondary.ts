import { useLayoutEffect, useState } from "react";

import type { TodaySecondaryResponse } from "@/lib/todaySecondary";

type CommittedTodaySecondary = {
  venueSlug: string;
  value: TodaySecondaryResponse;
};

/**
 * Commits the first successful public Today-secondary snapshot for one mounted
 * venue lifecycle. The layout effect captures the same snapshot that React just
 * rendered before the browser paints it. Background refetches and verified
 * enrichment may update facts in place, but cannot replace promotion identity.
 */
export function useCommittedTodaySecondary(
  venueSlug: string,
  value: TodaySecondaryResponse | undefined,
) {
  const [committed, setCommitted] = useState<CommittedTodaySecondary | null>(null);

  useLayoutEffect(() => {
    if (!value) return;
    setCommitted((current) => {
      if (current?.venueSlug === venueSlug) return current;
      return { venueSlug, value };
    });
  }, [value, venueSlug]);

  return committed?.venueSlug === venueSlug ? committed.value : value;
}
