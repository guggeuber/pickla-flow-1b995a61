import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionPeopleRow } from "@/components/session/SessionPeopleRow";
import { PEOPLE_ROW_NAMED_THRESHOLD, PeopleRow } from "@/components/ui/PeopleRow";

afterEach(cleanup);

describe("Session PeopleRow social context", () => {
  it("shows social context from the first registration", () => {
    expect(PEOPLE_ROW_NAMED_THRESHOLD).toBe(1);
  });

  it("renders a counts-only card with privacy-safe silhouettes", () => {
    render(
      <SessionPeopleRow
        presentation={{ people: [], committedCount: 2, capacity: 12, placesLeft: 10 }}
        variant="drawer"
        showInvitation={false}
      />,
    );
    expect(screen.getByText("2 kommer")).toBeInTheDocument();
    expect(screen.getByText(/2 av 12 anmälda/)).toBeInTheDocument();
  });

  it("uses the explicit zero-registration invitation without an empty avatar box", () => {
    render(
      <SessionPeopleRow
        presentation={{ people: [], committedCount: 0, capacity: 12, placesLeft: 12 }}
        variant="drawer"
        showInvitation
      />,
    );
    expect(screen.getByText("Bli första att anmäla dig")).toBeInTheDocument();
    expect(screen.queryByText(/0 av 12|12 platser kvar/)).not.toBeInTheDocument();
  });

  it("shows approved avatars but keeps the card label counts-based", () => {
    render(
      <PeopleRow
        participantCount={3}
        showInvitation={false}
        people={[
          { id: "one", display_name: "Ada Lovelace", avatar_url: "https://example.test/ada.jpg" },
          { id: "two", display_name: "Grace Hopper" },
          { id: "three", display_name: "Linus Torvalds" },
        ]}
      />,
    );
    expect(screen.getByText("3 kommer")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveAttribute("src", "https://example.test/ada.jpg");
  });

  it("uses privacy-safe generic participants when no approved profiles are available", () => {
    render(<PeopleRow participantCount={5} showInvitation={false} people={[]} />);
    expect(screen.getByText("5 kommer")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
