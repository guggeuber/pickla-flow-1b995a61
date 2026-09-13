import { ArrowRight, CheckCircle2, Clock3, Loader2, Ticket, TriangleAlert } from "lucide-react";
import { DateTime } from "luxon";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import picklaLogo from "@/assets/pickla-logo.svg";

type ActivityParticipantInviteResponse = {
  invitation: {
    id: string;
    status: "confirmed_paid" | "confirmed_included" | "payment_pending" | "payment_expired" | "action_required" | "cancelled";
    headline: string;
    has_place: boolean;
    reserved: boolean;
    can_retry: boolean;
    canonical_price_minor: number;
    currency: string;
    expires_at?: string | null;
    payment_url?: string | null;
  };
  activity: { id: string; name: string; session_date: string; start_time: string; end_time: string };
  venue: { name?: string | null; slug?: string | null };
};

function invitationDateLabel(data: ActivityParticipantInviteResponse) {
  const start = DateTime.fromISO(`${data.activity.session_date}T${data.activity.start_time}`, { zone: "Europe/Stockholm" });
  const end = DateTime.fromISO(`${data.activity.session_date}T${data.activity.end_time}`, { zone: "Europe/Stockholm" });
  if (!start.isValid || !end.isValid) return data.activity.session_date;
  return `${start.setLocale("sv").toFormat("cccc d MMMM")} · ${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
}

function priceLabel(minor: number) {
  return `${(Math.max(0, Number(minor || 0)) / 100).toLocaleString("sv-SE")} kr`;
}

export default function ActivityParticipantInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const query = useQuery<ActivityParticipantInviteResponse>({
    queryKey: ["activity-participant-invite", token],
    enabled: token.length >= 32,
    queryFn: () => apiGet("api-bookings", "activity-participant-invite", { token }, { auth: "omit" }),
    refetchInterval: (state) => state.state.data?.invitation.status === "payment_pending" ? 3_000 : false,
  });

  if (query.isLoading) {
    return <div className="grid min-h-[100dvh] place-items-center bg-[#f7f4ee]"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
  }

  if (query.isError || !query.data) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#f7f4ee] px-5 text-neutral-950">
        <section className="w-full max-w-md rounded-[30px] border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <TriangleAlert className="mx-auto h-8 w-8 text-amber-500" />
          <h1 className="mt-4 text-2xl font-black">Länken kunde inte läsas</h1>
          <p className="mt-2 text-sm text-neutral-500">Be personalen kontrollera eller skicka betalningslänken igen.</p>
          <Link to="/" className="mt-6 inline-flex rounded-full bg-neutral-950 px-5 py-3 text-sm font-black text-white">Till Pickla</Link>
        </section>
      </main>
    );
  }

  const { invitation, activity, venue } = query.data;
  const confirmed = invitation.has_place;
  const canPay = invitation.reserved && Boolean(invitation.payment_url);
  const statusCopy = confirmed
    ? "Din betalning eller behörighet är klar och platsen är bekräftad."
    : canPay
    ? "Platsen är tillfälligt reserverad. Den blir bekräftad först när betalningen är klar."
    : invitation.status === "payment_expired"
    ? "Betalningstiden har gått ut och ingen plats är längre reserverad. Be personalen försöka igen."
    : invitation.status === "cancelled"
    ? "Inbjudan är avbokad och ingen plats är reserverad."
    : "Ingen plats är bekräftad. Be personalen kontrollera betalningsförsöket.";

  return (
    <main className="min-h-[100dvh] bg-[#f7f4ee] px-5 py-6 text-neutral-950">
      <div className="mx-auto w-full max-w-md">
        <div className="flex justify-center"><img src={picklaLogo} alt="Pickla" className="h-8 w-auto" /></div>
        <section className="mt-8 rounded-[32px] border border-neutral-200 bg-white p-6 shadow-sm">
          <div className={`grid h-14 w-14 place-items-center rounded-2xl ${confirmed ? "bg-emerald-100 text-emerald-700" : canPay ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>
            {confirmed ? <CheckCircle2 className="h-7 w-7" /> : canPay ? <Clock3 className="h-7 w-7" /> : <Ticket className="h-7 w-7" />}
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">{invitation.headline}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{activity.name}</h1>
          <p className="mt-2 text-sm font-semibold text-neutral-500">{venue.name || "Pickla"}</p>
          <p className="mt-1 text-sm text-neutral-500">{invitationDateLabel(query.data)}</p>
          <div className="mt-6 rounded-2xl bg-[#f7f4ee] p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-bold text-neutral-600">Serverpris</span>
              <span className="text-lg font-black">{priceLabel(invitation.canonical_price_minor)}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">{statusCopy}</p>
          </div>
          {canPay ? (
            <a href={invitation.payment_url!} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-4 text-base font-black text-white">
              Betala och säkra platsen
              <ArrowRight className="h-5 w-5" />
            </a>
          ) : (
            <Link to="/" className="mt-5 inline-flex w-full items-center justify-center rounded-full border border-neutral-200 px-5 py-4 text-sm font-black">Till Pickla</Link>
          )}
        </section>
      </div>
    </main>
  );
}
