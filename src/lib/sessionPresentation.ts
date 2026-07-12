import { DateTime } from "luxon";

import type { PeopleRowPerson } from "@/components/ui/PeopleRow";
import { activityTimingLabel, activityTimingStatus } from "@/lib/activityTiming";

const STOCKHOLM_ZONE = "Europe/Stockholm";

export type SessionSource = "activity" | "open_booking";

export type SessionActionPresentation = {
  key: string;
  label: string;
  disabled?: boolean;
  loading?: boolean;
};

export type SessionPricingPresentation = {
  kind: "amount" | "included" | "status" | "pending";
  amountSek?: number | string | null;
  label?: string | null;
  contextLabel?: string | null;
};

export type SessionHostPresentation = {
  firstName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  count?: number | null;
};

export type SessionPresentation = {
  id: string;
  source: SessionSource;
  typeLabel: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timingStatus: ReturnType<typeof activityTimingStatus>;
  timingLabel: string;
  venueName?: string | null;
  resourceNames: string[];
  host?: SessionHostPresentation | null;
  people: PeopleRowPerson[];
  committedCount?: number | null;
  capacity?: number | null;
  placesLeft?: number | null;
  pace?: string | null;
  description?: string | null;
  pricing?: SessionPricingPresentation | null;
  entitlementLabel?: string | null;
  primaryAction?: SessionActionPresentation | null;
  secondaryActions?: SessionActionPresentation[];
  route?: string | null;
};

type ActivitySessionPresentationInput = {
  id: string;
  typeLabel: string;
  title: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  venueName?: string | null;
  resourceNames?: string[];
  host?: SessionHostPresentation | null;
  people?: PeopleRowPerson[];
  committedCount?: number | null;
  capacity?: number | null;
  placesLeft?: number | null;
  pace?: string | null;
  description?: string | null;
  pricing?: SessionPricingPresentation | null;
  entitlementLabel?: string | null;
  primaryAction?: SessionActionPresentation | null;
  secondaryActions?: SessionActionPresentation[];
  route?: string | null;
  now?: DateTime;
};

type OpenBookingPresentationInput = {
  id: string;
  bookerFirstName?: string | null;
  title?: string | null;
  startsAt: string;
  endsAt: string;
  venueName?: string | null;
  resourceNames?: string[];
  people?: PeopleRowPerson[];
  committedCount?: number | null;
  capacity?: number | null;
  placesLeft?: number | null;
  pace?: string | null;
  description?: string | null;
  pricing?: SessionPricingPresentation | null;
  entitlementLabel?: string | null;
  primaryAction?: SessionActionPresentation | null;
  secondaryActions?: SessionActionPresentation[];
  route?: string | null;
  now?: DateTime;
};

export function stockholmSessionIso(sessionDate: string, time: string) {
  return DateTime.fromISO(`${sessionDate}T${time}`, { zone: STOCKHOLM_ZONE }).toISO() ?? "";
}

function timePartsFromIso(startsAt: string, endsAt: string) {
  const start = DateTime.fromISO(startsAt, { zone: STOCKHOLM_ZONE });
  const end = DateTime.fromISO(endsAt, { zone: STOCKHOLM_ZONE });
  return {
    sessionDate: start.toISODate() ?? "",
    startTime: start.toFormat("HH:mm"),
    endTime: end.toFormat("HH:mm"),
  };
}

function timingFor(startsAt: string, endsAt: string, now?: DateTime) {
  const { sessionDate, startTime, endTime } = timePartsFromIso(startsAt, endsAt);
  return {
    timingStatus: activityTimingStatus({
      sessionDate,
      startTime,
      endTime,
      now: now ?? DateTime.now().setZone(STOCKHOLM_ZONE),
    }),
    timingLabel: activityTimingLabel({
      sessionDate,
      startTime,
      endTime,
      now: now ?? DateTime.now().setZone(STOCKHOLM_ZONE),
    }),
  };
}

export function activitySessionToPresentation(input: ActivitySessionPresentationInput): SessionPresentation {
  const startsAt = stockholmSessionIso(input.sessionDate, input.startTime);
  const endsAt = stockholmSessionIso(input.sessionDate, input.endTime);
  const timing = timingFor(startsAt, endsAt, input.now);

  return {
    id: input.id,
    source: "activity",
    typeLabel: input.typeLabel,
    title: input.title,
    startsAt,
    endsAt,
    ...timing,
    venueName: input.venueName ?? null,
    resourceNames: input.resourceNames ?? [],
    host: input.host ?? null,
    people: input.people ?? [],
    committedCount: input.committedCount ?? null,
    capacity: input.capacity ?? null,
    placesLeft: input.placesLeft ?? null,
    pace: input.pace ?? null,
    description: input.description ?? null,
    pricing: input.pricing ?? null,
    entitlementLabel: input.entitlementLabel ?? null,
    primaryAction: input.primaryAction ?? null,
    secondaryActions: input.secondaryActions ?? [],
    route: input.route ?? null,
  };
}

export function openBookingToPresentation(input: OpenBookingPresentationInput): SessionPresentation {
  const timing = timingFor(input.startsAt, input.endsAt, input.now);
  const hostFirstName = input.bookerFirstName?.trim();

  return {
    id: input.id,
    source: "open_booking",
    typeLabel: "PRIVAT BANA",
    title: input.title?.trim() || (hostFirstName ? `Häng på ${hostFirstName}` : "Häng på en bana"),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...timing,
    venueName: input.venueName ?? null,
    resourceNames: input.resourceNames ?? [],
    host: hostFirstName ? { firstName: hostFirstName, displayName: hostFirstName } : null,
    people: input.people ?? [],
    committedCount: input.committedCount ?? null,
    capacity: input.capacity ?? null,
    placesLeft: input.placesLeft ?? null,
    pace: input.pace ?? null,
    description: input.description ?? null,
    pricing: input.pricing ?? { kind: "status", label: "Din del av banan" },
    entitlementLabel: input.entitlementLabel ?? null,
    primaryAction: input.primaryAction ?? null,
    secondaryActions: input.secondaryActions ?? [],
    route: input.route ?? null,
  };
}
