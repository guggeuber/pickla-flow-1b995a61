export const SERIES_PRESENTATION_TYPES = ["course", "social_event", "clinic", "tournament"] as const;

export type SeriesPresentationType = (typeof SERIES_PRESENTATION_TYPES)[number];

export type SeriesPresentation = {
  type: SeriesPresentationType;
  label: "KURS" | "EVENT" | "CLINIC" | "TURNERING";
  bookingCta: "Boka kurs" | "Boka plats";
  registrationEyebrow: string;
  contentHeading: string;
  instructorLabel: string | null;
  showInstructor: boolean;
  hideSingleOccurrenceCount: boolean;
  imageProminence: "standard" | "prominent";
  listedInCourses: boolean;
};

const PRESENTATIONS: Record<SeriesPresentationType, SeriesPresentation> = {
  course: {
    type: "course",
    label: "KURS",
    bookingCta: "Boka kurs",
    registrationEyebrow: "Anmälan öppen",
    contentHeading: "Om kursen",
    instructorLabel: "Instruktör vid varje tillfälle",
    showInstructor: true,
    hideSingleOccurrenceCount: false,
    imageProminence: "standard",
    listedInCourses: true,
  },
  social_event: {
    type: "social_event",
    label: "EVENT",
    bookingCta: "Boka plats",
    registrationEyebrow: "Event · anmälan öppen",
    contentHeading: "Om eventet",
    instructorLabel: null,
    showInstructor: false,
    hideSingleOccurrenceCount: true,
    imageProminence: "prominent",
    listedInCourses: false,
  },
  clinic: {
    type: "clinic",
    label: "CLINIC",
    bookingCta: "Boka plats",
    registrationEyebrow: "Clinic · anmälan öppen",
    contentHeading: "Om clinicen",
    instructorLabel: "Coach vid varje tillfälle",
    showInstructor: true,
    hideSingleOccurrenceCount: false,
    imageProminence: "standard",
    listedInCourses: false,
  },
  tournament: {
    type: "tournament",
    label: "TURNERING",
    bookingCta: "Boka plats",
    registrationEyebrow: "Turnering · anmälan öppen",
    contentHeading: "Om turneringen",
    instructorLabel: null,
    showInstructor: false,
    hideSingleOccurrenceCount: false,
    imageProminence: "prominent",
    listedInCourses: false,
  },
};

export function normalizeSeriesPresentationType(value: unknown): SeriesPresentationType {
  return SERIES_PRESENTATION_TYPES.includes(value as SeriesPresentationType)
    ? value as SeriesPresentationType
    : "course";
}

export function seriesPresentation(value: unknown): SeriesPresentation {
  return PRESENTATIONS[normalizeSeriesPresentationType(value)];
}

export function occurrenceCountLabel(count: number) {
  return `${count} ${count === 1 ? "tillfälle" : "tillfällen"}`;
}

export function occurrenceProgressLabel(current: number, total: number) {
  return `Tillfälle ${current} av ${total}`;
}
