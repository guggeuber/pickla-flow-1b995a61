import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appHtml = readFileSync(resolve(root, "index.html"), "utf8");
const vercelConfig = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  rewrites: Array<{ source: string; destination: string }>;
};

const SOCIAL_IMAGE_URL = "https://playpickla.com/og-invest-pickla-bag-v1.jpg";
const socialImage = readFileSync(resolve(root, "public/og-invest-pickla-bag-v1.jpg"));

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
  it("uses the Pickla bag photo with exact Open Graph dimensions", () => {
    const document = parseHtml(appHtml);

    expect(metaContent(document, 'meta[property="og:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(document, 'meta[name="twitter:image"]')).toBe(SOCIAL_IMAGE_URL);
    expect(metaContent(document, 'meta[property="og:image:width"]')).toBe("1200");
    expect(metaContent(document, 'meta[property="og:image:height"]')).toBe("630");
  });

  it("ships the public social asset as an exact 1200 by 630 JPEG", () => {
    expect(jpegDimensions(socialImage)).toEqual({ width: 1200, height: 630 });
  });

  it("serves the application HTML for /invest without a JavaScript-only metadata path", () => {
    expect(vercelConfig.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });

  it("sets explicit page and versioned-image cache policy", () => {
    const pageHeaders = vercelConfig.headers.find((entry) => entry.source === "/invest");
    const imageHeaders = vercelConfig.headers.find((entry) => entry.source === "/og-invest-pickla-bag-v1.jpg");

    expect(pageHeaders?.headers).toContainEqual(expect.objectContaining({ key: "Cache-Control", value: expect.stringContaining("no-store") }));
    expect(imageHeaders?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});
