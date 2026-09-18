import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("browser Edge/CORS release contract", () => {
  it("keeps shared API request headers compatible with every browser Edge function", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-edge-browser-contract.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output).toContain("Browser request headers and Edge CORS are compatible.");
    expect(output).toContain("x-pickla-request-id");
  });

  it("expands a shared CORS change to the complete browser deployment matrix", () => {
    const output = execFileSync(process.execPath, [
      "scripts/edge-release-plan.mjs",
      "--changed",
      "supabase/functions/_shared/cors.ts",
      "--json",
    ], { cwd: process.cwd(), encoding: "utf8" });
    const plan = JSON.parse(output);
    expect(plan.browser_functions_to_deploy).toContain("api-admin");
    expect(plan.browser_functions_to_deploy).toContain("api-auth");
    expect(plan.browser_functions_to_deploy).toContain("api-bookings");
    expect(plan.browser_functions_to_deploy).toContain("api-communications");
    expect(plan.browser_functions_to_deploy).toContain("api-event-public");
    expect(plan.browser_functions_to_deploy).toHaveLength(26);
  });

  it("fails a release verification when a required dependent deployment is omitted", () => {
    const result = spawnSync(process.execPath, [
      "scripts/edge-release-plan.mjs",
      "--changed",
      "supabase/functions/_shared/cors.ts",
      "--verify-deployed",
      "api-admin,api-auth",
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Incomplete Edge deployment matrix");
  });
});
