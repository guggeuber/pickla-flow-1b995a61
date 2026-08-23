import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Founder preview and checkout selected-week contract", () => {
  it("keys and requests the balance by venue and selected play date", () => {
    const booking = read("src/pages/BookingPage.tsx");
    expect(booking).toContain('["booking-member-passes", user?.id, data?.venue?.id, dateStr]');
    expect(booking).toContain('{ venueId: data!.venue.id, date: dateStr }');
    expect(booking).toContain("memberPasses?.court_hours?.play_date === dateStr");
    expect(booking).toContain("user && founderPreviewReady && hasContactDetails");
  });

  it("lets the server derive the canonical Stockholm week from play date", () => {
    const passes = read("supabase/functions/api-day-passes/index.ts");
    expect(passes).toContain("DateTime.fromISO(requestedPlayDate, { zone: 'Europe/Stockholm' })");
    expect(passes).toContain("const weekStart = playDate.startOf('week').toISODate()!");
    expect(passes).toContain("const weekEnd = playDate.endOf('week').toISODate()!");
    expect(passes).toContain("getActiveMembershipWithBenefits(adminClient, userId, requestedVenueId)");
    expect(passes).toContain("play_date: playDate.toISODate()");
  });

  it("matches the existing checkout week authority for the same selected date", () => {
    const bookingPage = read("src/pages/BookingPage.tsx");
    const checkout = read("supabase/functions/api-bookings/index.ts");
    expect(bookingPage).toContain("date:           dateStr");
    expect(checkout).toContain("const quotaDate = meta.date");
    expect(checkout).toContain("DateTime.fromISO(meta.date, { zone: 'Europe/Stockholm' })");
    expect(checkout).toContain("const weekStart = quotaDate.startOf('week').toISODate()!");
    expect(checkout).toContain("const includedHours = Math.min(Math.max(Number(weekLimit.value) - Number(usedHours), 0), bookingHours)");
    expect(bookingPage).toContain('entitlement.entitlement_type === "court_discount_pct"');
    expect(bookingPage).toContain("membership?.membership_tiers?.discount_percent");
    expect(checkout).toContain("const courtDiscount = hasEnt('court_discount_pct')");
    expect(checkout).toContain("const tierDefaultDiscount = Number(tier?.discount_percent || 0)");
  });
});

describe("owned Series customer identity", () => {
  it("projects Format name and reuses the same social-event title helper on Home and My Page", () => {
    const coursesApi = read("supabase/functions/api-courses/index.ts");
    const home = read("src/pages/TodayPage.tsx");
    const myPage = read("src/pages/MyPage.tsx");
    expect(coursesApi).toContain("select('id, name, presentation_type')");
    expect(coursesApi).toContain("format_name: formatById.get(series.format_id)?.name || null");
    expect(home).toContain("seriesCustomerTitle({");
    expect(home).toContain("formatName: item.series.format_name");
    expect(myPage).toContain("seriesCustomerTitle({");
    expect(myPage).toContain("formatName: course.series.format_name");
    expect(myPage).toContain("{course.access.label} · {course.access.detail}");
  });

  it("limits owned-Series Home interruption to the established today/tomorrow horizon", () => {
    const coursesApi = read("supabase/functions/api-courses/index.ts");
    expect(coursesApi).toContain("const homeHorizonEnd = homeNow.plus({ days: 1 }).endOf('day')");
    expect(coursesApi).toContain("ends > homeNow && starts <= homeHorizonEnd");
    expect(coursesApi).toContain("if (projected.customer_has_commitment) continue");
  });

  it("uses one customer-upcoming read projection without merging ownership truth", () => {
    const topBar = read("src/components/PicklaTopBar.tsx");
    const upcoming = read("src/lib/customerUpcoming.ts");
    expect(topBar).toContain("useCustomerUpcoming(slug");
    expect(topBar).toContain("upcoming.slice(0, 3)");
    expect(upcoming).toContain("buildBookingHistory");
    expect(upcoming).toContain('registration.series_commitment_id || registration.activity_sessions?.session_type === "course"');
    expect(upcoming).toContain("item.commitment?.status === \"active\" && item.next_session");
  });
});
