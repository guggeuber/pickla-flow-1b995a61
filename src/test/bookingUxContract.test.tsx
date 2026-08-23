import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { BookingConversationIndicator } from "@/components/bookings/BookingConversationIndicator";

const bookingPageSource = readFileSync("src/pages/BookingPage.tsx", "utf8");
const myPageSource = readFileSync("src/pages/MyPage.tsx", "utf8");
const topBarSource = readFileSync("src/components/PicklaTopBar.tsx", "utf8");
const upcomingSource = readFileSync("src/lib/customerUpcoming.ts", "utf8");

afterEach(cleanup);

describe("final booking UX contract", () => {
  it("does not render daypart controls in the primary booking card", () => {
    expect(bookingPageSource).not.toContain("Tid på dagen väljs automatiskt från vald tid");
    expect(bookingPageSource).not.toContain("Tid på dagen");
  });

  it("keeps the time sheet grouped and allows direct time selection", () => {
    expect(bookingPageSource).toContain("groupTimesByDaypart(filteredTimeSlots)");
    expect(bookingPageSource).toContain("groupedTimeSlots.map((group)");
    expect(bookingPageSource).toMatch(/onClick=\{\(\) => \{\s*setSelectedTime\(time\);\s*setShowTimeList\(false\);\s*\}\}/);
  });

  it("has no standalone Messages section and keeps previous bookings in the booking section", () => {
    expect(myPageSource).not.toContain(">Meddelanden</span>");
    expect(myPageSource).not.toContain("ThreadRow");
    expect(myPageSource).toContain("pastBookings.map");
    expect(myPageSource).toContain("const [showPast, setShowPast] = useState(false)");
    expect(myPageSource).toContain("pickla:my:previous-bookings:");
    expect(myPageSource).toContain('"Visa tidigare bokningar"');
  });

  it("renders a neutral indicator only when conversation data matches", () => {
    const { rerender } = render(<BookingConversationIndicator visible={true} />);
    expect(screen.getByLabelText("Konversation finns")).toBeInTheDocument();

    rerender(<BookingConversationIndicator visible={false} />);
    expect(screen.queryByLabelText("Konversation finns")).not.toBeInTheDocument();
    expect(myPageSource).toContain("visible={bookingHasConversation(b, conversationRooms)}");
  });

  it("keeps full ownership on My Page while the menu exposes only three normalized upcoming items", () => {
    expect(myPageSource).toContain("useMyBookings()");
    expect(myPageSource).toContain("buildBookingHistory(");
    expect(myPageSource).toContain("BookingStatusChip");
    expect(topBarSource).toContain("useCustomerUpcoming(slug");
    expect(topBarSource).toContain("upcoming.slice(0, 3)");
    expect(upcomingSource).toContain("buildBookingHistory");
    expect(upcomingSource).toContain('source: "session_registration"');
    expect(upcomingSource).toContain('source: "series_occurrence"');
    expect(topBarSource).not.toContain("pastBookings");
    expect(topBarSource).not.toContain("showPast");
    expect(topBarSource).toContain('["Min sida"');
  });
});
