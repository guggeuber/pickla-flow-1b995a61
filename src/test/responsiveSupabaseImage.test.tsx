import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResponsiveSupabaseImage } from "@/components/ResponsiveSupabaseImage";
import {
  CARD_ARTWORK_SIZES,
  CARD_ARTWORK_WIDTHS,
  supabaseImageSrcSet,
  supabaseImageTransformUrl,
} from "@/lib/responsiveSupabaseImage";
import { inheritedEventImages } from "@/lib/eventMedia";

const parkerSource = "https://ptnvhbniiiapzbyofctg.supabase.co/storage/v1/object/public/event-logos/activity-formats/e3bd0986-142f-46d7-abdc-b3294d1d70cf/1.png?v=1787088687516";

describe("responsive Supabase artwork", () => {
  it("builds deterministic width-only WebP contain transforms and preserves source version identity", () => {
    const transformed = supabaseImageTransformUrl(parkerSource, 768);
    expect(transformed).not.toBeNull();

    const url = new URL(transformed!);
    expect(url.pathname).toBe("/storage/v1/render/image/public/event-logos/activity-formats/e3bd0986-142f-46d7-abdc-b3294d1d70cf/1.png");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      width: "768",
      resize: "contain",
      quality: "80",
      format: "webp",
      v: "1787088687516",
    });

    const replacement = supabaseImageTransformUrl(parkerSource.replace("1787088687516", "1787089999999"), 768);
    expect(replacement).not.toBe(transformed);
    expect(new URL(replacement!).searchParams.get("v")).toBe("1787089999999");
  });

  it("generates the canonical 640, 768 and 1200 width srcset", () => {
    expect(supabaseImageSrcSet(parkerSource)?.map((candidate) => candidate.width)).toEqual([640, 768, 1200]);
    render(<ResponsiveSupabaseImage src={parkerSource} alt="Parker Brunch" sizes={CARD_ARTWORK_SIZES} width={1280} height={720} />);
    const image = screen.getByRole("img", { name: "Parker Brunch" });
    expect(image.getAttribute("srcset")).toContain("width=640");
    expect(image.getAttribute("srcset")).toContain(" 640w");
    expect(image.getAttribute("srcset")).toContain("width=768");
    expect(image.getAttribute("srcset")).toContain(" 768w");
    expect(image.getAttribute("srcset")).toContain("width=1200");
    expect(image.getAttribute("srcset")).toContain(" 1200w");
    expect(image).toHaveAttribute("sizes", CARD_ARTWORK_SIZES);
  });

  it("caps card artwork at 768 while retaining the shared detail candidate", () => {
    render(<ResponsiveSupabaseImage src={parkerSource} alt="Home artwork" sizes={CARD_ARTWORK_SIZES} widths={CARD_ARTWORK_WIDTHS} width={1280} height={720} />);
    const image = screen.getByRole("img", { name: "Home artwork" });
    expect(image.getAttribute("srcset")).toContain(" 640w");
    expect(image.getAttribute("srcset")).toContain(" 768w");
    expect(image.getAttribute("srcset")).not.toContain(" 1200w");
  });

  it("falls back to an unsupported original URL without transformation hints", () => {
    const original = "https://images.example.test/catalog/parker.png?v=7";
    render(<ResponsiveSupabaseImage src={original} alt="External artwork" sizes={CARD_ARTWORK_SIZES} width={1280} height={720} />);
    const image = screen.getByRole("img", { name: "External artwork" });
    expect(image).toHaveAttribute("src", original);
    expect(image).not.toHaveAttribute("srcset");
    expect(image).not.toHaveAttribute("sizes");
  });

  it("retries the canonical original when a supported transform cannot load", () => {
    const onError = vi.fn();
    render(<ResponsiveSupabaseImage src={parkerSource} alt="Resilient artwork" sizes={CARD_ARTWORK_SIZES} width={1280} height={720} onError={onError} />);
    const image = screen.getByRole("img", { name: "Resilient artwork" });
    expect(image.getAttribute("src")).toContain("/storage/v1/render/image/public/");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", parkerSource);
    expect(image).not.toHaveAttribute("srcset");
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(image);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("uses eager high priority only when requested and lazy loading otherwise", () => {
    const { rerender } = render(<ResponsiveSupabaseImage src={parkerSource} alt="Priority artwork" sizes={CARD_ARTWORK_SIZES} width={1280} height={720} priority />);
    let image = screen.getByRole("img", { name: "Priority artwork" });
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
    expect(image).toHaveAttribute("width", "1280");
    expect(image).toHaveAttribute("height", "720");

    rerender(<ResponsiveSupabaseImage src={parkerSource} alt="Lazy artwork" sizes={CARD_ARTWORK_SIZES} width={1280} height={720} />);
    image = screen.getByRole("img", { name: "Lazy artwork" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("fetchpriority", "auto");
  });

  it("keeps Series override, Format fallback and no-image inheritance unchanged", () => {
    const seriesImage = `${parkerSource}&owner=series`;
    const formatImage = `${parkerSource}&owner=format`;
    expect(inheritedEventImages({ image_urls: [seriesImage], activity_formats: { image_urls: [formatImage] } })).toEqual([seriesImage]);
    expect(inheritedEventImages({ image_urls: [], activity_formats: { image_urls: [formatImage] } })).toEqual([formatImage]);
    expect(inheritedEventImages({ image_urls: [], activity_formats: { image_urls: [] } })).toEqual([]);
  });
});
