import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("src/main.tsx", "utf8");

describe("production frontend bootstrap", () => {
  it("keeps the initial application and observability code in the entry module", () => {
    expect(mainSource).toContain('import App from "./App.tsx"');
    expect(mainSource).toContain("installClientObservability();");
    expect(mainSource).not.toContain('import("./App.tsx")');
    expect(mainSource).not.toContain('import("./lib/clientObservability.ts")');
  });

  it("does not start a redundant service-worker update after registration", () => {
    expect(mainSource).not.toContain("onRegisteredSW");
    expect(mainSource).not.toMatch(/registration\?\.update\(\)/);
  });
});
