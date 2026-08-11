import { DateTime } from "luxon";

export interface CourtAvailabilityBlock {
  court_id: string;
  start: string;
  end: string;
}

export interface BookingAvailabilityResource {
  id: string;
  sport_type?: string | null;
}

export type FirstAvailableBookingOption = {
  startTime: string;
  endTime: string;
  resourceId: string;
};

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function addMinutesToTime(time: string, minutesToAdd: number): string {
  const totalMinutes = timeToMinutes(time) + minutesToAdd;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function closingBoundaryMinutes(openTime?: string | null, closeTime?: string | null): number {
  const openMinutes = openTime ? timeToMinutes(openTime) : 7 * 60;
  const closeMinutes = closeTime ? timeToMinutes(closeTime) : 22 * 60;

  return closeMinutes === 0 && openMinutes > 0 ? 24 * 60 : closeMinutes;
}

export function generateBookingTimeSlots(openTime?: string | null, closeTime?: string | null): string[] {
  const startHour = openTime ? parseInt(openTime.slice(0, 2), 10) : 7;
  const endHour = Math.floor(closingBoundaryMinutes(openTime, closeTime) / 60);
  const slots: string[] = [];

  for (let hour = startHour; hour < endHour; hour += 1) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
  }

  return slots;
}

export function bookingDurationFits(
  slot: string,
  durationMinutes: number,
  openTime?: string | null,
  closeTime?: string | null,
): boolean {
  if (!closeTime) return true;
  const slotMinutes = timeToMinutes(slot);
  const openMinutes = openTime ? timeToMinutes(openTime) : 7 * 60;
  return slotMinutes >= openMinutes && slotMinutes + durationMinutes <= closingBoundaryMinutes(openTime, closeTime);
}

export function courtIsAvailableForInterval(
  courtId: string,
  blocks: CourtAvailabilityBlock[],
  startMs: number,
  endMs: number,
): boolean {
  return !blocks.some((block) =>
    block.court_id === courtId &&
    new Date(block.start).getTime() < endMs &&
    new Date(block.end).getTime() > startMs
  );
}

export function findFirstAvailableBookingOption({
  date,
  resourceType,
  durationMinutes,
  timeSlots,
  resources,
  blocks,
  openTime,
  closeTime,
  zone = "Europe/Stockholm",
}: {
  date: string;
  resourceType: "pickleball" | "dart";
  durationMinutes: number;
  timeSlots: string[];
  resources: BookingAvailabilityResource[];
  blocks: CourtAvailabilityBlock[];
  openTime?: string | null;
  closeTime?: string | null;
  zone?: string;
}): FirstAvailableBookingOption | null {
  const matchingResources = resources.filter(
    (resource) => (resource.sport_type || "pickleball") === resourceType,
  );

  for (const startTime of timeSlots) {
    if (!bookingDurationFits(startTime, durationMinutes, openTime, closeTime)) continue;

    const start = DateTime.fromISO(`${date}T${startTime}:00`, { zone });
    if (!start.isValid) continue;
    const end = start.plus({ minutes: durationMinutes });
    const resource = matchingResources.find((candidate) =>
      courtIsAvailableForInterval(candidate.id, blocks, start.toMillis(), end.toMillis()),
    );
    if (resource) {
      return {
        startTime,
        endTime: addMinutesToTime(startTime, durationMinutes),
        resourceId: resource.id,
      };
    }
  }

  return null;
}
