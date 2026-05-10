import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, LayoutGrid, Loader2, UserRoundCheck } from "lucide-react";
import { format } from "date-fns";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

interface PublicPlanEvent {
  id: string;
  name: string;
  display_name: string | null;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_public: boolean | null;
  visibility: string | null;
  planning_status: string | null;
  customer_name: string | null;
  expected_participants: number | null;
  partner_notes: string | null;
  resources: string[] | null;
  staffing: string | null;
  number_of_courts: number | null;
}

function formatDate(date?: string | null) {
  return date ? format(new Date(date), "d MMM yyyy") : "Datum sätts";
}

function formatTime(event: PublicPlanEvent) {
  if (!event.start_time) return "Tid sätts";
  return `${event.start_time.slice(0, 5)}${event.end_time ? `-${event.end_time.slice(0, 5)}` : ""}`;
}

export default function EventPlanPublic() {
  const { venueId } = useParams<{ venueId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-event-plan", venueId, token],
    enabled: !!venueId && !!token,
    queryFn: async () => {
      const url = new URL(`${BASE_URL}/api-events/public-plan`);
      url.searchParams.set("venueId", venueId!);
      url.searchParams.set("token", token);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Länken är inte giltig");
      return res.json() as Promise<{ venue: { name: string; city?: string | null }; events: PublicPlanEvent[] }>;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/50" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white grid place-items-center px-5 text-center">
        <div>
          <p className="text-2xl font-black">Länken fungerar inte</p>
          <p className="text-sm text-white/50 mt-2">Be Pickla skicka en ny möteslänk.</p>
        </div>
      </div>
    );
  }

  const publicCount = data.events.filter((event) => event.is_public).length;
  const partnerCount = data.events.filter((event) => event.visibility === "partners").length;

  return (
    <div className="min-h-screen bg-[#f7f4ee] text-neutral-950">
      <main className="mx-auto max-w-4xl px-5 py-8">
        <header className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400 font-bold">Partneröversikt</p>
          <h1 className="text-4xl font-black tracking-tight mt-2">Kommande aktiveringar</h1>
          <p className="text-sm text-neutral-500 mt-2">
            {data.venue.name}{data.venue.city ? ` · ${data.venue.city}` : ""}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-5">
            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
              <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold">Aktiveringar</p>
              <p className="text-2xl font-black">{data.events.length}</p>
            </div>
            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
              <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold">Publika</p>
              <p className="text-2xl font-black">{publicCount}</p>
            </div>
            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
              <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-bold">Partner</p>
              <p className="text-2xl font-black">{partnerCount}</p>
            </div>
          </div>
        </header>

        <section className="mt-4 space-y-3">
          {data.events.length > 0 ? data.events.map((event) => (
            <article key={event.id} className="rounded-3xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
              <div className="grid grid-cols-[8px_1fr]">
                <div className={event.is_public ? "bg-emerald-500" : "bg-violet-500"} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-neutral-400 font-bold flex items-center gap-2">
                        <CalendarDays className="w-3.5 h-3.5" />
                        {formatDate(event.start_date)} · {formatTime(event)}
                      </p>
                      <h2 className="text-2xl font-black mt-2">{event.display_name || event.name}</h2>
                      <p className="text-sm text-neutral-500 mt-1">
                        {[event.customer_name, event.expected_participants ? `${event.expected_participants} deltagare` : null, event.number_of_courts ? `${event.number_of_courts} banor` : null].filter(Boolean).join(" · ") || "Planerad aktivitet"}
                      </p>
                    </div>
                    <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">
                      {event.is_public ? "Publik" : "Partner"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {(event.resources || []).slice(0, 6).map((resource) => (
                      <span key={resource} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600">
                        <LayoutGrid className="w-3 h-3" />
                        {resource}
                      </span>
                    ))}
                    {event.staffing && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600">
                        <UserRoundCheck className="w-3 h-3" />
                        Personal planerad
                      </span>
                    )}
                  </div>

                  {event.partner_notes && (
                    <p className="text-sm text-neutral-700 leading-relaxed mt-4">{event.partner_notes}</p>
                  )}
                </div>
              </div>
            </article>
          )) : (
            <div className="rounded-3xl bg-white border border-neutral-200 p-8 text-center">
              <p className="font-bold">Inga kommande aktiveringar ännu</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
