import { Link } from "react-router-dom";

import { PeopleRow } from "@/components/ui/PeopleRow";
import type { VerifiedAccountState } from "@/hooks/useVerifiedAccount";
import type { SessionSocialAttendee } from "@/lib/sessionSocialContext";

type SessionSocialContextSectionProps = {
  attendeeCount: number;
  attendees?: SessionSocialAttendee[];
  hiddenCount?: number;
  firstVisitCount?: number;
  sharedHistoryCount?: number;
  accountState: VerifiedAccountState;
  loginHref: string;
};

function attendeeTags(attendee: SessionSocialAttendee) {
  return [
    attendee.is_host ? "Värd" : null,
    attendee.is_first_visit ? "Första gången" : null,
    attendee.has_shared_session_history ? "Ni har spelat ihop" : null,
  ].filter(Boolean) as string[];
}

export function SessionSocialContextSection({
  attendeeCount,
  attendees = [],
  hiddenCount = 0,
  firstVisitCount = 0,
  sharedHistoryCount = 0,
  accountState,
  loginHref,
}: SessionSocialContextSectionProps) {
  const verified = accountState === "verified";
  const visibleAttendees = verified ? attendees : [];
  const hiddenOrOverflow = Math.max(hiddenCount, attendeeCount - visibleAttendees.length);
  const summary = [
    `${attendeeCount} kommer`,
    firstVisitCount > 0 ? `${firstVisitCount} ${firstVisitCount === 1 ? "ny" : "nya"}` : null,
    sharedHistoryCount > 0 ? `${sharedHistoryCount} du spelat med` : null,
    hiddenOrOverflow > 0 ? `+${hiddenOrOverflow}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="rounded-[22px] border border-black/10 bg-white px-4 py-4" data-testid="session-social-context">
      <h2 className="text-[16px] font-black text-slate-950" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        Vilka kommer?
      </h2>
      <div className="mt-3">
        {verified && attendeeCount > 0 ? (
          <p className="text-[13px] font-semibold text-slate-500" data-testid="session-social-summary">{summary}</p>
        ) : (
        <PeopleRow
          people={visibleAttendees}
          participantCount={attendeeCount}
          showInvitation
        />
        )}
      </div>

      {accountState === "anonymous" && attendeeCount > 0 ? (
        <p className="mt-3 text-[12px] font-semibold text-slate-500">
          <Link className="font-black text-slate-950 underline underline-offset-2" to={loginHref}>Logga in</Link>
          {" "}för att se vilka som kommer.
        </p>
      ) : null}

      {accountState === "remote_validating" && attendeeCount > 0 ? (
        <p className="mt-3 text-[12px] font-semibold text-slate-500">Kontrollerar ditt konto…</p>
      ) : null}

      {verified && visibleAttendees.length > 0 ? (
        <ul className="mt-4 grid gap-3">
          {visibleAttendees.map((attendee) => {
            const tags = attendeeTags(attendee);
            return (
              <li key={attendee.person_id} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-950 text-[11px] font-black text-white">
                  {attendee.avatar_url ? (
                    <img src={attendee.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : attendee.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-black text-slate-950">{attendee.display_name}</span>
                {tags.length ? <span className="flex flex-wrap justify-end gap-1">{tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">{tag}</span>)}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

    </section>
  );
}
