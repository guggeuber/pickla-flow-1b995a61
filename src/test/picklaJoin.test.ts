import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PICKLA_JOIN_CANONICAL,
  PICKLA_JOIN_DESCRIPTION,
  PICKLA_JOIN_TITLE,
  renderJoinPage,
} from "../../public-web/renderJoinPage";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("Pickla Mail /join Public Web acquisition page", () => {
  const html = renderJoinPage({ logo: "/public-web/pickla-logo.svg" });
  const document = new DOMParser().parseFromString(html, "text/html");

  it("renders useful static editorial HTML with canonical SEO metadata", () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(document.title).toBe(PICKLA_JOIN_TITLE);
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(PICKLA_JOIN_DESCRIPTION);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(PICKLA_JOIN_CANONICAL);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index,follow");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toContain("STAY INTHE PICKLALOOP.");
    expect(html).not.toContain("Pickla Paper");
  });

  it("uses the canonical double-opt-in capture with unchecked consent", () => {
    const email = document.querySelector<HTMLInputElement>('input[name="email"]');
    const consent = document.querySelector<HTMLInputElement>('input[name="consent"]');
    expect(email?.type).toBe("email");
    expect(email?.required).toBe(true);
    expect(consent?.required).toBe(true);
    expect(consent?.checked).toBe(false);
    expect(consent?.parentElement?.textContent).toContain("Yes, send me Pickla news & community.");
    expect(html).toContain('fetch("/mail/subscribe"');
    expect(html).toContain('source:"public_web_root"');
    expect(html).toContain('audience:"adult_or_parent_guardian"');
    expect(html).toContain("Check your inbox to confirm.");
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it("stays outside Customer/PWA/provider/tracking runtime", () => {
    expect(html).not.toContain('id="root"');
    expect(html).not.toContain("AuthProvider");
    expect(html).not.toContain("manifest.webmanifest");
    expect(html).not.toContain("registerSW");
    expect(html).not.toContain("api.resend.com");
    expect(html).not.toContain("RESEND_API_KEY");
    expect(html).not.toMatch(/<(?:script|img)\b[^>]*(?:src|href)="https?:\/\//i);
    expect(html).not.toMatch(/(?:googletagmanager|analytics|pixel|segment|hotjar)/i);
  });

  it("has explicit mobile and desktop-safe responsive/accessibility contracts", () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("@media(max-width:900px)");
    expect(html).toContain("@media(max-width:420px)");
    expect(html).toContain("min-width:320px");
    expect(document.querySelector('a[href="#join"]')?.textContent).toBe("Skip to signup");
    expect(document.querySelector('label[for="pickla-join-email"]')).not.toBeNull();
    expect(document.querySelector('img[alt="Pickla"][width][height]')).not.toBeNull();
  });

  it("is routed and cached as Public Web before the preserved SPA fallback", () => {
    expect(vercel.headers).toContainEqual(expect.objectContaining({ source: "/join" }));
    expect(vercel.redirects).toContainEqual({ source: "/join/", destination: "/join", permanent: true });
    const joinIndex = vercel.rewrites.findIndex((entry: { source: string }) => entry.source === "/join");
    const fallbackIndex = vercel.rewrites.findIndex((entry: { source: string; destination: string }) => entry.source === "/(.*)" && entry.destination === "/index.html");
    expect(joinIndex).toBeGreaterThanOrEqual(0);
    expect(joinIndex).toBeLessThan(fallbackIndex);
    expect(vercel.rewrites[joinIndex]).toEqual({ source: "/join", destination: "/join/index.html" });
  });
});
