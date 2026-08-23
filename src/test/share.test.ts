import { afterEach, describe, expect, it, vi } from "vitest";

import { shareOrCopy } from "@/lib/share";

const originalShare = navigator.share;
const originalCanShare = navigator.canShare;
const originalClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, "share", { configurable: true, value: originalShare });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: originalCanShare });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
});

describe("canonical customer sharing", () => {
  it("uses Web Share when the browser supports the canonical public URL", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    expect(await shareOrCopy({ title: "Parker Brunch", url: "https://playpickla.com/course/parker" })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Parker Brunch", text: undefined, url: "https://playpickla.com/course/parker" });
  });

  it("copies the canonical public URL when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    expect(await shareOrCopy({ title: "Parker Brunch", url: "https://playpickla.com/course/parker", copyText: "https://playpickla.com/course/parker" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://playpickla.com/course/parker");
  });
});
