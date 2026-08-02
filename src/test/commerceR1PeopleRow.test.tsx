import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionPeopleRow } from "@/components/session/SessionPeopleRow";
import { PEOPLE_ROW_NAMED_THRESHOLD, PeopleRow } from "@/components/ui/PeopleRow";

afterEach(cleanup);

describe("Commerce R1 PeopleRow threshold", () => {
  it("uses the canonical threshold of three", () => {
    expect(PEOPLE_ROW_NAMED_THRESHOLD).toBe(3);
  });

  it("renders no row and no wrapper gap below threshold in purchase mode", () => {
    const { container } = render(
      <SessionPeopleRow
        presentation={{ people: [], committedCount: 2, capacity: 12, placesLeft: 10 }}
        variant="drawer"
        showInvitation={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("invites without quantifying an empty or below-threshold group", () => {
    render(
      <SessionPeopleRow
        presentation={{ people: [], committedCount: 0, capacity: 12, placesLeft: 12 }}
        variant="drawer"
        showInvitation
      />,
    );
    expect(screen.getByText("Plats för fler — ta gärna med en vän")).toBeInTheDocument();
    expect(screen.queryByText(/0 av 12|12 platser kvar/)).not.toBeInTheDocument();
  });

  it("shows names and avatars at threshold", () => {
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
    expect(screen.getByText("Ada, Grace och 1 till är med")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveAttribute("src", "https://example.test/ada.jpg");
  });

  it("uses privacy-safe generic participants above threshold when no public profiles are available", () => {
    render(<PeopleRow participantCount={5} showInvitation={false} people={[]} />);
    expect(screen.getByText("5 spelare är med")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
