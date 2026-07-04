import type { CSSProperties, ReactNode } from "react";

export const PEOPLE_ROW_NAMED_THRESHOLD = 3;
export const SCARCITY_REMAINING_RATIO = 0.2;

export type PeopleRowPerson = {
  id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

type PeopleRowProps = {
  people?: PeopleRowPerson[] | null;
  participantCount?: number | null;
  className?: string;
  style?: CSSProperties;
};

type ScarcityBadgeProps = {
  remaining?: number | null;
  capacity?: number | null;
  className?: string;
  style?: CSSProperties;
};

function firstName(name?: string | null) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function initialsFor(person: PeopleRowPerson, index: number) {
  const name = String(person.display_name || "").trim();
  if (!name) return `P${index + 1}`;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function namesLine(names: string[], count: number) {
  if (names.length >= 2) {
    const visible = names.slice(0, 2);
    const remaining = Math.max(0, count - visible.length);
    return remaining > 0 ? `${visible.join(", ")} och ${remaining} till är med` : `${visible.join(" och ")} är med`;
  }
  if (names.length === 1) {
    const remaining = Math.max(0, count - 1);
    return remaining > 0 ? `${names[0]} och ${remaining} till är med` : `${names[0]} är med`;
  }
  // TODO(presence-consent): named visibility pending presence settings.
  return `${count} är med`;
}

function AvatarStack({ people, count }: { people: PeopleRowPerson[]; count: number }) {
  const visible = people.slice(0, 3);
  const fallbackCount = Math.min(3, count);
  const avatarPeople = visible.length > 0
    ? visible
    : Array.from({ length: fallbackCount }, (_, index) => ({ id: `fallback-${index}` }));
  const extra = Math.max(0, count - avatarPeople.length);

  return (
    <div className="flex shrink-0 -space-x-2">
      {avatarPeople.map((person, index) => {
        const label = person.display_name || "Pickla";
        return (
          <span
            key={person.id || `${label}:${index}`}
            className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border-2 border-white bg-neutral-950 text-[10px] font-black text-white"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {person.avatar_url ? (
              <img src={person.avatar_url} alt={label} className="h-full w-full object-cover" />
            ) : (
              initialsFor(person, index)
            )}
          </span>
        );
      })}
      {extra > 0 ? (
        <span
          className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-white text-[10px] font-black text-neutral-950"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

export function PeopleRow({ people = [], participantCount, className = "", style }: PeopleRowProps) {
  if (participantCount == null) return null;
  const count = Math.max(0, Number(participantCount || 0));
  if (count < PEOPLE_ROW_NAMED_THRESHOLD) {
    return (
      <p className={`text-[13px] font-semibold text-neutral-500 ${className}`} style={style}>
        Bli först — ta med en vän
      </p>
    );
  }

  const visiblePeople = (people || []).filter(Boolean);
  const names = visiblePeople.map((person) => firstName(person.display_name)).filter(Boolean);

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`} style={style}>
      <AvatarStack people={visiblePeople} count={count} />
      <p className="min-w-0 truncate text-[13px] font-semibold text-neutral-500">
        {namesLine(names, count)}
      </p>
    </div>
  );
}

export function ScarcityBadge({ remaining, capacity, className = "", style }: ScarcityBadgeProps) {
  if (remaining == null || capacity == null || capacity <= 0) return null;
  const safeRemaining = Math.max(0, Number(remaining));
  const safeCapacity = Math.max(0, Number(capacity));
  if (safeCapacity <= 0 || safeRemaining / safeCapacity > SCARCITY_REMAINING_RATIO) return null;

  const label: ReactNode = safeRemaining <= 0 ? "Fullt" : `${safeRemaining} platser kvar`;

  return (
    <span
      className={`inline-flex w-fit rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700 ${className}`}
      style={{ fontFamily: "'Space Grotesk', sans-serif", ...style }}
    >
      {label}
    </span>
  );
}
