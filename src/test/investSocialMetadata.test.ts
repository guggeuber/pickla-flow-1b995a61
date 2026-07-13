import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const customerHtml = readFileSync(resolve(root, "index.html"), "utf8");
const investorHtml = readFileSync(resolve(root, "invest.html"), "utf8");
const investorPageSource = readFileSync(resolve(root, "src/pages/InvestPage.tsx"), "utf8");
const vercelConfig = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  rewrites: Array<{ source: string; destination: string }>;
};

const SOCIAL_IMAGE_URL = "https://playpickla.com/og-invest-arena-v2.jpg";
const INVESTOR_TITLE = "Invest in Pickla | Building Places to Belong";
const INVESTOR_DESCRIPTION =
  "Pickla is building the operating system for social sports communities — combining real venues, belonging, commerce and live operations.";
const CUSTOMER_TITLE = "Pickla | Play, Meet and Belong";
const CUSTOMER_DESCRIPTION =
  "Discover pickleball, darts, events and community at Pickla. Book, play, meet new people and find your place.";
const socialImage = readFileSync(resolve(root, "public/og-invest-arena-v2.jpg"));

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

function metaContent(document: Document, selector: string) {
  return document.querySelector<HTMLMetaElement>(selector)?.content;
}

function jpegDimensions(image: Buffer) {
  expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  let offset = 2;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = image.readUInt16BE(offset);
    if (startOfFrameMarkers.has(marker)) {
      return { height: image.readUInt16BE(offset + 3), width: image.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }

  throw new Error("JPEG dimensions not found");
}

describe("investor social metadata", () => {
  it("renders investor title and description in the dedicated initial HTML", () => {
    const document = parseHtml(investorHtml);

    expect(document.title).toBe(INVESTOR_TITLE);
    expect(metaContent(document, 'meta[name="description"]')).toBe(INVESTOR_DESCRIPTION);
    expect(metaContent(document, 'meta[property="og:title"]')).toBe(INVESTOR_TITLE);
    expect(metaContent(document, 'meta[property="og:description"]')).toBe(INVESTOR_DESCRIPTION);
    expect(metaContent(document, 'meta[name="twitter:title"]')).toBe(INVESTOR_TITLE);
    expect(metaContent(document, 'meta[name="twitter:description"]')).toBe(INVESTOR_DESCRIPTION);
    expect(metaContent(document, 'meta[name="robots"]')).toBe("noindex, nofollow");
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe("https://playpickla.com/invest");
    expect(metaContent(document, 'meta[property="og:url"]')).toBe("https://playpickla.com/invest");
  });

  it("keeps customer metadata in the root and non-invest HTML entry", () => {
    const document = parseHtml(customerHtml);

    expect(document.title).toBe(CUSTOMER_TITLE);
    expect(metaContent(document, 'meta[name="description"]')).toBe(CUSTOMER_DESCRIPTION);
    expect(metaContent(document, 'meta[property="og:title"]')).toBe(CUSTOMER_TITLE);
    expect(metaContent(document, 'meta[property="og:description"]')).toBe(CUSTOMER_DESCRIPTION);
    expect(metaContent(document, 'meta[name="twitter:title"]')).toBe(CUSTOMER_TITLE);
    expect(metaContent(document, 'meta[name="twitter:description"]')).toBe(CUSTOMER_DESCRIPTION);
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe("https://playpickla.com/");
    expect(metaContent(document, 'meta[property="og:url"]')).toBe("https://playpickla.com/");
    expect(document.title).not.toBe(INVESTOR_TITLE);
  });

  it("keeps route metadata out of the React investor component", () => {
    expect(investorPageSource).not.toContain("document.title");
    expect(investorPageSource).not.toContain("querySelector('meta");
    expect(investorPageSource).not.toContain('createElement("meta")');
  });

  it("keeps the global social image and exact Open Graph dimensions", () => {
    const investorDocument = parseHtml(investorHtml);
    const customerDocument = parseHtml(customerHtml);

    expect(metaContent(investorDocument, 'meta[property="og:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(investorDocument, 'meta[name="twitter:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(investorDocument, 'meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent(investorDocument, 'meta[property="og:image:height"]')).toBe("630");
    expect(metaContent(customerDocument, 'meta[property="og:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(customerDocument, 'meta[name="twitter:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(customerDocument, 'meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent(customerDocument, 'meta[property="og:image:height"]')).toBe("630");
  });

  it("ships the public social asset as an exact 1200 by 630 JPEG", () => {
    expect(jpegDimensions(socialImage)).toEqual({ width: 1200, height: 630 });
  });

  it("routes only /invest to its HTML entry and preserves cache policy", () => {
    const investorRewriteIndex = vercelConfig.rewrites.findIndex((entry) => entry.source === "/invest");
    const activityRewriteIndex = vercelConfig.rewrites.findIndex((entry) => entry.source === "/p/:sessionId");
    const fallbackRewriteIndex = vercelConfig.rewrites.findIndex((entry) => entry.source === "/(.*)");
    const pageHeaders = vercelConfig.headers.find((entry) => entry.source === "/invest");
    const imageHeaders = vercelConfig.headers.find((entry) => entry.source === "/og-invest-arena-v2.jpg");

    expect(vercelConfig.rewrites[investorRewriteIndex]).toEqual({ source: "/invest", destination: "/invest.html" });
    expect(investorRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(investorRewriteIndex).toBeLessThan(fallbackRewriteIndex);
    expect(activityRewriteIndex).toBeGreaterThan(investorRewriteIndex);
    expect(activityRewriteIndex).toBeLessThan(fallbackRewriteIndex);
    expect(vercelConfig.rewrites[fallbackRewriteIndex]).toEqual({ source: "/(.*)", destination: "/index.html" });
    expect(pageHeaders?.headers).toContainEqual(expect.objectContaining({ key: "Cache-Control", value: expect.stringContaining("no-store") }));
    expect(imageHeaders?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});
