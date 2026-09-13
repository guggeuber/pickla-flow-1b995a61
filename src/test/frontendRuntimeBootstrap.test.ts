import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("src/main.tsx", "utf8");
const htmlSource = readFileSync("index.html", "utf8");

describe("production frontend bootstrap", () => {
  it("keeps the initial application and observability code in the entry module", () => {
    expect(mainSource).toContain('import App from "./App.tsx"');
    expect(mainSource).toContain("installClientObservability();");
    expect(mainSource).not.toContain('import("./App.tsx")');
    expect(mainSource).not.toContain('import("./lib/clientObservability.ts")');
  });

  it("hands service-worker registration to the bounded coordinator without a blind reload", () => {
    expect(mainSource).toContain("onRegisteredSW");
    expect(mainSource).toContain("setFrontendVersionRegistration(registration)");
    expect(mainSource).toContain("updateServiceWorker?.(false)");
    expect(mainSource).not.toContain("updateServiceWorker?.(true)");
    expect(mainSource).not.toContain("window.location.reload()");
  });

  it("keeps browser translation from mutating React-owned transaction DOM", () => {
    expect(htmlSource).toContain('<meta name="google" content="notranslate" />');
    expect(htmlSource).toContain('<div id="root" class="notranslate" translate="no"></div>');
  });
});
