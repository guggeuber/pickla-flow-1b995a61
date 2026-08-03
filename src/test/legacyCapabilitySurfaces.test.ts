import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminModuleHref, adminModuleIdFromPath } from "@/lib/adminModuleRoute";

const read = (path: string) => readFileSync(path, "utf8");

describe("unavailable legacy capability surfaces", () => {
  it("removes Stories writers, readers and admin navigation", () => {
    const runtimeSources = [
      read("src/pages/AdminPage.tsx"),
      read("src/pages/LinkHub.tsx"),
      read("src/components/admin/shell/AdminSettings.tsx"),
      read("src/components/admin/shell/AdminToday.tsx"),
      read("src/lib/adminModuleRoute.ts"),
    ].join("\n");

    expect(runtimeSources).not.toMatch(/AdminStories|community[_-]stories|onOpenSettings\("stories"\)/);
    expect(existsSync("src/components/admin/AdminStories.tsx")).toBe(false);
    expect(existsSync("src/components/community/StoriesCarousel.tsx")).toBe(false);
    expect(existsSync("src/components/community/StoryViewer.tsx")).toBe(false);
    expect(adminModuleIdFromPath("stories")).toBeNull();
    expect(adminModuleHref("stories")).toBe("/hub/admin");
  });

  it("removes only Forum Photo upload while preserving text and GIF posting", () => {
    const forum = read("src/components/community/ForumFeed.tsx");

    expect(forum).not.toContain('from("forum-images")');
    expect(forum).not.toContain('accept="image/*"');
    expect(forum).not.toMatch(/>\s*Photo\s*</);
    expect(forum).toContain("function GifPicker");
    expect(forum).toContain("handleGifSelect");
    expect(forum).toContain('placeholder="Add a comment..."');
    expect(forum).toContain('.from("forum_posts").insert');
    expect(forum).toContain('.from("post_comments").insert');
  });

  it("removes Event Products routes and query while preserving public fallbacks", () => {
    const app = read("src/App.tsx");
    const admin = read("src/pages/AdminPage.tsx");
    const settings = read("src/components/admin/shell/AdminSettings.tsx");
    const landing = read("src/components/EventLandingPage.tsx");

    expect(`${app}\n${admin}\n${settings}\n${landing}`).not.toMatch(/AdminEventProducts|event[_-]products|eventProducts/);
    expect(existsSync("src/components/admin/AdminEventProducts.tsx")).toBe(false);
    expect(existsSync("src/pages/AdminEventProductsPage.tsx")).toBe(false);
    expect(adminModuleIdFromPath("event-products")).toBeNull();
    expect(adminModuleHref("eventProducts")).toBe("/hub/admin");
    expect(landing).toContain('{ name: "Starter", price: "349"');
    expect(landing).toContain('{ name: "Social", price: "449"');
    expect(landing).toContain('{ name: "Premium", price: "599"');
    expect(landing).toContain("return PACKAGES_FALLBACK.map");
  });
});
