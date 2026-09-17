import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeStartupTiming,
  markReliabilityMilestone,
  reliabilityMilestones,
  resetReliabilityTimingForTests,
  surfaceForPath,
} from "@/lib/reliabilityTiming";

describe("startup reliability timing", () => {
  beforeEach(() => {
    resetReliabilityTimingForTests();
    vi.restoreAllMocks();
  });

  it("keeps the first value for each T0-T11 milestone", () => {
    markReliabilityMilestone("main_js_evaluated", { sample: 1 });
    markReliabilityMilestone("main_js_evaluated", { sample: 2 });

    expect(reliabilityMilestones().main_js_evaluated.detail).toEqual({ sample: 1 });
  });

  it("records that version convergence was deferred instead of blocking actionable UI", () => {
    markReliabilityMilestone("first_actionable_ui", { surface: "desk" });
    completeStartupTiming("desk");

    expect(reliabilityMilestones().version_check_deferred_at_actionable).toBeDefined();
  });

  it.each([
    ["/today", "customer"],
    ["/desk", "desk"],
    ["/hub/admin", "admin"],
  ] as const)("maps %s to the %s startup surface", (path, surface) => {
    expect(surfaceForPath(path)).toBe(surface);
  });
});
