import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PWA_SURFACES,
  renderPwaSurfaceBootstrap,
  resolvePwaSurface,
  selectPwaSurface,
} from "@/lib/pwaSurface";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};

const root = process.cwd();
const manifestPaths = {
  customer: "public/manifest.webmanifest",
  desk: "public/manifest-desk.webmanifest",
  admin: "public/manifest-admin.webmanifest",
} as const;
const manifests = Object.fromEntries(
  Object.entries(manifestPaths).map(([key, file]) => [
    key,
    JSON.parse(readFileSync(resolve(root, file), "utf8")) as Manifest,
  ]),
) as Record<keyof typeof manifestPaths, Manifest>;

function pngDimensions(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("multi-surface PWA identities", () => {
  it("publishes three unique stable ids, names and start URLs", () => {
    expect(Object.values(manifests).map((manifest) => manifest.id)).toEqual(["/", "/desk", "/hub/admin"]);
    expect(new Set(Object.values(manifests).map((manifest) => manifest.id)).size).toBe(3);
    expect(Object.values(manifests).map((manifest) => manifest.name)).toEqual(["Pickla", "Pickla Desk", "Pickla Admin"]);
    expect(Object.values(manifests).map((manifest) => manifest.short_name)).toEqual(["Pickla", "Desk", "Admin"]);
    expect(Object.values(manifests).map((manifest) => manifest.start_url)).toEqual(["/", "/desk", "/hub/admin"]);
  });

  it("keeps all three scopes broad enough for shared auth, payment and deep-link routes", () => {
    expect(Object.values(manifests).map((manifest) => manifest.scope)).toEqual(["/", "/", "/"]);
    expect(Object.values(PWA_SURFACES).map((surface) => surface.scope)).toEqual(["/", "/", "/"]);
  });

  it("selects the correct manifest for customer, Desk and every Admin-owned route", () => {
    expect(resolvePwaSurface("/")).toBe("customer");
    expect(resolvePwaSurface("/today")).toBe("customer");
    expect(resolvePwaSurface("/p/session-id")).toBe("customer");
    expect(resolvePwaSurface("/desk")).toBe("desk");
    expect(resolvePwaSurface("/desk/booking/reference")).toBe("desk");
    expect(resolvePwaSurface("/hub/admin")).toBe("admin");
    expect(resolvePwaSurface("/hub/admin/corporate")).toBe("admin");
    expect(resolvePwaSurface("/hub/admin/schedule")).toBe("admin");
    expect(resolvePwaSurface("/admin/event-leads")).toBe("admin");
    expect(resolvePwaSurface("/ops")).toBe("admin");
  });

  it("retains the installed surface on shared standalone auth and payment routes", () => {
    expect(selectPwaSurface({ pathname: "/auth", standalone: true, storedSurface: "desk" })).toBe("desk");
    expect(selectPwaSurface({ pathname: "/auth/callback", standalone: true, storedSurface: "admin" })).toBe("admin");
    expect(selectPwaSurface({ pathname: "/booking/confirmed", standalone: true, storedSurface: "customer" })).toBe("customer");
    expect(selectPwaSurface({ pathname: "/desk", standalone: true, storedSurface: "customer" })).toBe("customer");
    expect(selectPwaSurface({ pathname: "/hub/admin", standalone: true, storedSurface: "desk" })).toBe("desk");
    expect(selectPwaSurface({ pathname: "/desk", standalone: true, storedSurface: null })).toBe("desk");
    expect(selectPwaSurface({ pathname: "/hub/admin", standalone: true, storedSurface: null })).toBe("admin");
    expect(selectPwaSurface({ pathname: "/auth", standalone: false, storedSurface: "desk" })).toBe("desk");
    expect(selectPwaSurface({ pathname: "/auth", standalone: false, storedSurface: null })).toBe("customer");
  });

  it("injects route-aware install metadata before the application and resyncs on SPA navigation", () => {
    const vite = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    const index = readFileSync(resolve(root, "index.html"), "utf8");
    const bootstrap = renderPwaSurfaceBootstrap();
    expect(vite).toContain("pickla-pwa-surface-bootstrap");
    expect(vite).toContain('injectTo: "head-prepend"');
    expect(vite).toContain("manifest: false");
    expect(app).toContain("syncPwaSurfaceMetadata(location.pathname)");
    expect(index).not.toContain('rel="manifest"');
    expect(bootstrap).toContain("pickla-manifest");
    expect(bootstrap).toContain("pickla-apple-touch-icon");
    expect(bootstrap).toContain("display-mode: standalone");
  });
});

describe("multi-surface PWA icon artifacts", () => {
  it("provides standard, maskable and Apple touch PNGs at valid dimensions", () => {
    for (const [surfaceId, manifest] of Object.entries(manifests)) {
      const standard192 = manifest.icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
      const standard512 = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
      const maskable = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "maskable");
      expect(standard192?.type).toBe("image/png");
      expect(standard512?.type).toBe("image/png");
      expect(maskable?.type).toBe("image/png");
      expect(pngDimensions(resolve(root, `public${standard192!.src}`))).toEqual({ width: 192, height: 192 });
      expect(pngDimensions(resolve(root, `public${standard512!.src}`))).toEqual({ width: 512, height: 512 });
      expect(pngDimensions(resolve(root, `public${maskable!.src}`))).toEqual({ width: 512, height: 512 });
      expect(pngDimensions(resolve(root, `public${PWA_SURFACES[surfaceId as keyof typeof PWA_SURFACES].appleTouchIconHref}`)))
        .toEqual({ width: 180, height: 180 });
    }
  });

  it("makes the three Home Screen icon families byte-distinct", () => {
    const hashes = Object.values(manifests).map((manifest) => {
      const icon = manifest.icons.find((candidate) => candidate.sizes === "192x192" && candidate.purpose === "any")!;
      return createHash("sha256").update(readFileSync(resolve(root, `public${icon.src}`))).digest("hex");
    });
    expect(new Set(hashes).size).toBe(3);
  });

  it("keeps the review-only contact sheet outside public deploy assets", () => {
    expect(existsSync(resolve(root, "docs/pwa/multi-surface-icon-contact-sheet.png"))).toBe(true);
    expect(existsSync(resolve(root, "public/multi-surface-icon-contact-sheet.png"))).toBe(false);
  });
});

describe("one shared update and security engine", () => {
  it("uses one root service worker and one build/version coordinator for all identities", () => {
    const vite = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
    const worker = readFileSync(resolve(root, "src/sw.ts"), "utf8");
    const legacyRecovery = readFileSync(resolve(root, "src/lib/legacyClientRecovery.ts"), "utf8");
    expect((main.match(/registerSW\(/g) || [])).toHaveLength(1);
    expect(vite).toContain('filename: "sw.ts"');
    expect(vite).toContain('fileName: "version.json"');
    expect(legacyRecovery).toContain("PICKLA_VERSION_ACTIVATED");
    expect(worker).toContain("PICKLA_GET_BUILD");
    expect(worker).toContain("recoverLegacyClients");
  });

  it("never adds protected API or navigation response caching", () => {
    const worker = readFileSync(resolve(root, "src/sw.ts"), "utf8");
    expect(worker).toContain("request.mode === 'navigate'");
    expect(worker).toContain("url.pathname.startsWith('/functions/v1/')");
    expect(worker.match(/new NetworkOnly\(\)/g) || []).toHaveLength(2);
    expect(worker).not.toContain("NetworkFirst");
    expect(worker).not.toContain("CacheFirst");
  });

  it("keeps all manifests public-only and freshness-safe", () => {
    const serialized = JSON.stringify(manifests).toLowerCase();
    for (const forbidden of ["user_id", "venue_id", "email", "token", "secret", "credential", "supabase"]) {
      expect(serialized).not.toContain(forbidden);
    }
    const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    const headers = new Map(vercel.headers.map((entry: { source: string; headers: Array<{ key: string; value: string }> }) => [
      entry.source,
      entry.headers.find((header) => header.key === "Cache-Control")?.value,
    ]));
    expect(headers.get("/manifest.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/manifest-desk.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/manifest-admin.webmanifest")).toContain("must-revalidate");
    expect(headers.get("/sw.js")).toContain("no-store");
    expect(headers.get("/version.json")).toContain("no-store");
    expect(headers.get("/assets/(.*)")).toContain("immutable");
  });

  it("keeps startup and deep links on existing authenticated routes", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('<Route path="/" element={<TodayPage />} />');
    expect(app).toContain('<Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />');
    expect(app).toContain('<Route path="/desk/booking/:bookingId" element={<ProtectedRoute><Index /></ProtectedRoute>} />');
    expect(app).toContain('<Route path="/hub/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />');
    expect(app).toContain('<Route path="/hub/admin/:modulePath" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />');
    expect(app).toContain('<Route path="/p/:sessionId" element={<ProgramSessionPage />} />');
    expect(app).toContain('preserveIntendedRoute(window.location.pathname + window.location.search)');
    expect(app).toContain('<Navigate to="/auth" replace />');
  });

  it("protects unsaved non-form controls on Desk and Admin before version convergence", () => {
    const coordinator = readFileSync(resolve(root, "src/lib/frontendVersionCoordinator.ts"), "utf8");
    expect(coordinator).toContain('window.location.pathname === "/desk"');
    expect(coordinator).toContain('window.location.pathname === "/hub/admin"');
    expect(coordinator).toContain('target.matches("input, textarea, select, [contenteditable=\'true\']")');
    expect(coordinator).toContain('coordinator.beginCriticalSection("unsaved_form")');
  });
});
