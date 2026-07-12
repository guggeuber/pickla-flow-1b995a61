import { PeopleRow } from "@/components/ui/PeopleRow";
import type { SessionPresentation } from "@/lib/sessionPresentation";

type SessionPeopleRowProps = {
  presentation: Pick<SessionPresentation, "people" | "committedCount" | "capacity" | "placesLeft">;
  variant?: "row" | "drawer";
  showInvitation?: boolean;
};

export function SessionPeopleRow({ presentation, variant = "row", showInvitation = false }: SessionPeopleRowProps) {
  const committedCount = Math.max(0, presentation.committedCount ?? 0);
  const capacity = presentation.capacity ?? null;
  const placesLeft =
    presentation.placesLeft ?? (capacity !== null ? Math.max(0, capacity - committedCount) : null);

  if (variant === "row") {
    return (
      <div className="space-y-1">
        <PeopleRow
          people={presentation.people}
          participantCount={committedCount}
          showInvitation={false}
          size="sm"
        />
        {capacity !== null ? (
          <div className="text-[12px] font-semibold text-black/45">
            {committedCount} av {capacity} spelare klara
            {placesLeft !== null ? ` · ${placesLeft} platser kvar` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PeopleRow
        people={presentation.people}
        participantCount={committedCount}
        showInvitation={showInvitation}
        size="md"
      />
      {capacity !== null ? (
        <div className="text-[14px] font-semibold text-foreground/55">
          {committedCount} av {capacity} spelare klara
          {placesLeft !== null ? ` · ${placesLeft} platser kvar` : ""}
        </div>
      ) : null}
    </div>
  );
}
