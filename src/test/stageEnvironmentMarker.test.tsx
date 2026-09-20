import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  StageEnvironmentMarker,
} from "@/components/StageEnvironmentMarker";
import { shouldShowStageEnvironmentMarker } from "@/lib/stageEnvironment";

describe("stage environment marker", () => {
  it.each(["/desk", "/desk/booking/123", "/hub/admin", "/hub/admin/catalog", "/ops"])(
    "marks the stage operations surface %s",
    (pathname) => {
      expect(shouldShowStageEnvironmentMarker("stage", pathname)).toBe(true);
    },
  );

  it("does not mark production or public customer routes", () => {
    expect(shouldShowStageEnvironmentMarker("production", "/desk")).toBe(false);
    expect(shouldShowStageEnvironmentMarker(undefined, "/hub/admin")).toBe(false);
    expect(shouldShowStageEnvironmentMarker("stage", "/shop")).toBe(false);
  });

  it("renders a visible STAGE badge only for stage operations", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/desk"]}>
        <StageEnvironmentMarker environment="stage" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("generic", { name: "Stage environment" })).toHaveTextContent("STAGE");

    rerender(
      <MemoryRouter initialEntries={["/desk"]}>
        <StageEnvironmentMarker environment="production" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Stage environment")).not.toBeInTheDocument();
  });
});
