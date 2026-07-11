import { describe, expect, it } from "vitest";
import { canonicalAppOrigin, canonicalAppUrl, canonicalRedirectUrl } from "./canonicalOrigin";

const loc = (hostname: string, path = "/booking/invite/abc", search = "?x=1", hash = "#top") => ({
  origin: `https://${hostname}`,
  hostname,
  pathname: path,
  search,
  hash,
} as unknown as Location);

describe("canonical origin", () => {
  it("canonicalizes www production links to root production", () => {
    expect(canonicalAppOrigin(loc("www.playpickla.com"))).toBe("https://playpickla.com");
    expect(canonicalRedirectUrl(loc("www.playpickla.com"))).toBe("https://playpickla.com/booking/invite/abc?x=1#top");
  });

  it("keeps canonical production links canonical", () => {
    expect(canonicalAppUrl("/auth/callback?code=123", loc("playpickla.com"))).toBe("https://playpickla.com/auth/callback?code=123");
    expect(canonicalRedirectUrl(loc("playpickla.com"))).toBe("");
  });

  it("canonicalizes signup and reset callbacks without dropping returnTo", () => {
    const signupCallback = loc("www.playpickla.com", "/auth/callback", "?code=abc&returnTo=%2Fbooking%2Finvite%2Ftok", "");
    const resetCallback = loc("www.playpickla.com", "/auth/reset", "?code=abc&type=recovery", "");
    expect(canonicalRedirectUrl(signupCallback)).toBe(
      "https://playpickla.com/auth/callback?code=abc&returnTo=%2Fbooking%2Finvite%2Ftok",
    );
    expect(canonicalRedirectUrl(resetCallback)).toBe("https://playpickla.com/auth/reset?code=abc&type=recovery");
  });

  it("uses the same auth storage origin for root and www production hosts", () => {
    expect(canonicalAppOrigin(loc("playpickla.com"))).toBe(canonicalAppOrigin(loc("www.playpickla.com")));
  });

  it("keeps localhost for local auth and invite testing", () => {
    const local = {
      origin: "http://localhost:8080",
      hostname: "localhost",
      pathname: "/booking/invite/abc",
      search: "",
      hash: "",
    } as unknown as Location;
    expect(canonicalAppOrigin(local)).toBe("http://localhost:8080");
    expect(canonicalAppUrl("/auth/reset", local)).toBe("http://localhost:8080/auth/reset");
  });
});
