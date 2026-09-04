import { apiGet, apiPatch } from "@/lib/api";

export type SessionSocialAttendee = {
  person_id: string;
  display_name: string;
  avatar_url: string | null;
  is_host: boolean;
  is_first_visit: boolean;
  has_shared_session_history: boolean;
};

export type SessionSocialContext = {
  session_id: string;
  session_date: string;
  attendee_count: number;
  hidden_count: number;
  first_visit_count: number;
  shared_history_count: number;
  attendees: SessionSocialAttendee[];
};

export type PlayedWithPerson = Pick<
  SessionSocialAttendee,
  "person_id" | "display_name" | "avatar_url" | "is_host"
>;

export type SocialPreferences = {
  social_visibility: "visible" | "hidden";
  booking_notice_shown: boolean;
  should_show_first_booking_info?: boolean;
};

export function fetchSessionSocialContext(sessionId: string, sessionDate: string) {
  return apiGet<SessionSocialContext>("api-event-public", "activity-social-context", {
    sessionId,
    date: sessionDate,
  });
}

export function fetchPlayedWith(sessionId: string, sessionDate: string) {
  return apiGet<PlayedWithPerson[]>("api-event-public", "played-with", {
    sessionId,
    date: sessionDate,
  });
}

export function fetchSocialPreferences() {
  return apiGet<SocialPreferences>("api-customers", "social-preferences");
}

export function updateSocialPreferences(input: {
  social_visibility?: "visible" | "hidden";
  booking_notice_shown?: true;
}) {
  return apiPatch<SocialPreferences>("api-customers", "social-preferences", input);
}
