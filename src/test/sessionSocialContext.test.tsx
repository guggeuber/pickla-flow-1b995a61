import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { SessionSocialContextSection } from "@/components/session/SessionSocialContextSection";
import { SocialVisibilityControl } from "@/components/session/SocialVisibilityControl";

afterEach(cleanup);

const cartSource = readFileSync("src/pages/CommerceCartPage.tsx", "utf8");
const customerApiSource = readFileSync("supabase/functions/api-customers/index.ts", "utf8");
const myPageSource = readFileSync("src/pages/MyPage.tsx", "utf8");

const attendees = [
  {
    person_id: "person-anna",
    display_name: "Anna S.",
    avatar_url: "https://images.example.test/anna.jpg",
    is_host: true,
    is_first_visit: false,
    has_shared_session_history: true,
  },
  {
    person_id: "person-jonas",
    display_name: "Jonas K.",
    avatar_url: null,
    is_host: false,
    is_first_visit: true,
    has_shared_session_history: false,
  },
];

describe("Vilka kommer?", () => {
  it("renders only count and silhouette placeholders for anonymous visitors", () => {
    render(
      <MemoryRouter>
        <SessionSocialContextSection attendeeCount={12} attendees={attendees} accountState="anonymous" loginHref="/auth" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Vilka kommer?")).toBeInTheDocument();
    expect(screen.getByText("12 kommer")).toBeInTheDocument();
    expect(screen.getByText(/Logga in/)).toBeInTheDocument();
    expect(screen.queryByText("Anna S.")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders only the server-approved identities after verification", () => {
    render(
      <MemoryRouter>
        <SessionSocialContextSection attendeeCount={5} attendees={attendees} hiddenCount={3} firstVisitCount={1} sharedHistoryCount={1} accountState="verified" loginHref="/auth" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Anna S.")).toBeInTheDocument();
    expect(screen.getByText("Jonas K.")).toBeInTheDocument();
    expect(screen.getByText("Värd")).toBeInTheDocument();
    expect(screen.getByText("Ni har spelat ihop")).toBeInTheDocument();
    expect(screen.getByText("Första gången")).toBeInTheDocument();
    expect(screen.getByText("5 kommer · 1 ny · 1 du spelat med · +3")).toBeInTheDocument();
    expect(screen.queryByText(/Logga in/)).not.toBeInTheDocument();
  });

  it("never flashes identity while remote verification is pending", () => {
    render(
      <MemoryRouter>
        <SessionSocialContextSection attendeeCount={2} attendees={attendees} accountState="remote_validating" loginHref="/auth" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Kontrollerar ditt konto…")).toBeInTheDocument();
    expect(screen.queryByText("Anna S.")).not.toBeInTheDocument();
  });
});

describe("social visibility preference", () => {
  it("binds the Min sida toggle to the next canonical visibility state", () => {
    let nextValue: boolean | null = null;
    render(<SocialVisibilityControl visible onChange={(value) => { nextValue = value; }} />);
    const toggle = screen.getByRole("switch", { name: "Visa mig på pass jag deltar i" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(nextValue).toBe(false);
    expect(screen.getByText(/Andra som är anmälda till samma pass/)).toBeInTheDocument();
  });

  it("stores the non-blocking first-booking notice once in canonical Person metadata", () => {
    expect(cartSource).toContain("socialNoticeRecorded.current");
    expect(cartSource).toContain("updateSocialPreferences({ booking_notice_shown: true })");
    expect(cartSource).toContain("Andra anmälda ser ditt förnamn, efternamnsinitial och din profilbild. Du kan ändra detta i Min sida.");
    expect(customerApiSource).toContain("session_social_context_notice_shown_at");
    expect(customerApiSource).not.toContain("CREATE TABLE");
  });

  it("loads played-with history only on the opened attended Session and caps the UI at six names", () => {
    expect(myPageSource).toContain("enabled: historyEligible");
    expect(myPageSource).toContain("fetchPlayedWith(historySessionId!, historySessionDate!)");
    expect(myPageSource).toContain("playedWithQuery.data.slice(0, 6)");
  });
});
