import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronRight, Loader2, Share2, Users } from "lucide-react";
import { DateTime } from "luxon";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { useAuth } from "@/hooks/useAuth";
import { createCourseCart, fetchCourseDetail } from "@/lib/courses";
import { formatCommerceMoney } from "@/lib/commerce";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import { seriesBookingCta, seriesPricePresentation } from "@/lib/seriesCustomerPricing";
import { occurrenceCountLabel, seriesCustomerTitle, seriesPresentation } from "@/lib/seriesPresentation";
import { shareOrCopy } from "@/lib/share";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";

type ParticipantType = "self" | "adult" | "dependent";

function swedishDate(value: string) {
  return DateTime.fromISO(value, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("d MMMM");
}

function swedishOccurrenceDate(value: string) {
  const label = DateTime.fromISO(value, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("ccc d LLL").replaceAll(".", "");
  return label ? `${label.charAt(0).toLocaleUpperCase("sv")}${label.slice(1)}` : value;
}

export default function CourseSeriesPage() {
  const { seriesId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [participantType, setParticipantType] = useState<ParticipantType>("self");
  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [childName, setChildName] = useState("");
  const [childBirthYear, setChildBirthYear] = useState("");

  const query = useQuery({
    queryKey: ["course-detail", seriesId, user?.id || "guest"],
    queryFn: () => fetchCourseDetail(seriesId),
    enabled: Boolean(seriesId) && !authLoading,
  });
  const course = query.data;
  const presentation = seriesPresentation(course?.format?.presentation_type);
  const venueSlug = course?.venue?.slug || params.get("v") || "pickla-arena-sthlm";
  const sessions = (course?.sessions || [])
    .filter((session) => session.is_active && (!session.publish_status || session.publish_status === "published"))
    .sort((left, right) => left.session_date.localeCompare(right.session_date)
      || left.start_time.localeCompare(right.start_time)
      || left.series_occurrence_index - right.series_occurrence_index);
  const scheduleLabel = (() => {
    if (!sessions.length) return "Schema kommer";
    const first = sessions[0];
    const weekday = DateTime.fromISO(first.session_date).setLocale("sv").toFormat("cccc");
    return `${weekday}ar ${String(first.start_time).slice(0, 5)}–${String(first.end_time).slice(0, 5)}`;
  })();

  const buy = useMutation({
    mutationFn: async () => {
      if (!course) throw new Error("Sidan kunde inte öppnas.");
      if (participantType === "dependent" && !user) {
        preserveIntendedRoute(`/course/${seriesId}?v=${encodeURIComponent(venueSlug)}`);
        navigate(`/auth?redirect=${encodeURIComponent(`/course/${seriesId}`)}&v=${encodeURIComponent(venueSlug)}`);
        throw new Error("Logga in för att anmäla ett barn.");
      }
      const response = await createCourseCart({
        series_id: course.id,
        participant_type: participantType,
        guest_name: payerName || null,
        guest_email: payerEmail || null,
        participant_name: participantName || null,
        participant_email: participantEmail || null,
        dependent_first_name: childName || null,
        dependent_birth_year: childBirthYear || null,
      }, user ? undefined : { auth: "omit" });
      const reference = response.cart_token || response.order.id;
      if (!reference) throw new Error("Bokningen kunde inte skapas.");
      return reference;
    },
    onSuccess: (reference) => navigate(`/cart?token=${encodeURIComponent(reference)}&v=${encodeURIComponent(venueSlug)}`),
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading || authLoading) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#fff" /><div className="grid min-h-[100dvh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div></div>;
  if (!course || query.isError) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#fff" /><main className="mx-auto max-w-xl px-6 pt-32 text-center">Sidan kunde inte öppnas.</main></div>;

  const available = Number(course.capacity.available_count || 0);
  const price = seriesPricePresentation({ pricing: course.pricing, basePriceSek: course.product.base_price_sek });
  const socialEvent = presentation.type === "social_event";
  const supportsParticipantChoice = presentation.type === "course";
  const includesOpenPlay = course.included_access?.open_play_series_period.enabled === true;
  const selectedParticipantPricePending = supportsParticipantChoice && participantType !== "self";
  const title = seriesCustomerTitle({ seriesName: course.name, formatName: course.format?.name, presentationType: presentation.type });
  const bookingCta = socialEvent
    ? seriesBookingCta(price, presentation.bookingCta)
    : `${presentation.bookingCta} · ${formatCommerceMoney(price.finalPriceMinor)}`;
  const open = course.registration_state === "open" && available > 0 && !course.customer_has_commitment;
  const requiresGuestDetails = !user;
  const ready = open
    && (!requiresGuestDetails || (payerName.trim() && payerEmail.includes("@")))
    && (participantType !== "adult" || (participantName.trim() && participantEmail.includes("@")))
    && (participantType !== "dependent" || (user && childName.trim() && Number(childBirthYear) > 1900));
  const shareSeries = async () => {
    const path = `/course/${encodeURIComponent(course.id)}?v=${encodeURIComponent(venueSlug)}`;
    const url = canonicalAppUrl(path);
    const result = await shareOrCopy({ title, text: title, url, copyText: url });
    if (result === "copied") toast.success("Länk kopierad");
  };

  return (
    <div className="min-h-[100dvh] bg-white text-slate-950">
      <PicklaTopBar slug={venueSlug} background="#fff" />
      <main className="mx-auto w-full max-w-xl px-5 pb-40 pt-[calc(env(safe-area-inset-top,0px)+96px)]">
        {course.image_urls?.[0] ? <img src={course.image_urls[0]} alt={title} className={socialEvent ? "mb-5 block h-auto w-full rounded-[24px]" : "mb-6 block h-auto w-full rounded-[24px]"} data-testid="series-detail-image" /> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{presentation.label}</p>
          <button type="button" onClick={() => void shareSeries()} className="flex items-center gap-2 rounded-full border border-black/15 px-4 py-2 text-sm font-black" aria-label={`Dela ${title}`}><Share2 className="h-4 w-4" /> Dela</button>
        </div>
        <h1 className="mt-2 text-3xl font-black leading-tight">{title}</h1>
        {!socialEvent && (course.format?.description || course.description) ? <p className="mt-3 text-base leading-relaxed text-slate-600">{course.format?.description || course.description}</p> : null}

        {socialEvent && sessions.length === 1 ? (
          <section className="mt-4 grid gap-1.5 text-base font-bold">
            <p>{swedishDate(sessions[0].session_date)} · {String(sessions[0].start_time).slice(0, 5)}–{String(sessions[0].end_time).slice(0, 5)}</p>
            <p className="text-sm text-slate-600">{course.venue?.name} · {available} {available === 1 ? "plats" : "platser"} kvar</p>
          </section>
        ) : (
          <section className="mt-8 grid gap-4 border-y border-black/10 py-6">
            <div className="flex gap-3"><CalendarDays className="mt-0.5 h-5 w-5" /><div>{presentation.hideSingleOccurrenceCount && sessions.length === 1 ? <><p className="font-bold">{swedishDate(sessions[0].session_date)}</p><p className="mt-1 text-sm text-slate-500">{String(sessions[0].start_time).slice(0, 5)}–{String(sessions[0].end_time).slice(0, 5)}</p></> : <><p className="font-bold">{occurrenceCountLabel(sessions.length)} · {scheduleLabel}</p><p className="mt-1 text-sm text-slate-500">{swedishDate(course.start_date)}–{swedishDate(course.end_date)}</p></>}</div></div>
            <div className="flex gap-3"><Users className="mt-0.5 h-5 w-5" /><div><p className="font-bold">{available} {available === 1 ? "plats" : "platser"} kvar</p><p className="mt-1 text-sm text-slate-500">{course.venue?.name}</p></div></div>
            {presentation.showInstructor && course.format?.requires_instructor && presentation.instructorLabel ? <div className="flex gap-3"><Check className="mt-0.5 h-5 w-5" /><p className="font-bold">{presentation.instructorLabel}</p></div> : null}
          </section>
        )}

        <section className={socialEvent ? "mt-5 border-y border-black/10 py-4" : "mt-7"} data-testid="series-price-offer">
          {selectedParticipantPricePending ? <p className="text-sm font-semibold text-slate-600">Priset bekräftas för deltagaren i nästa steg.</p> : <><p className="text-sm font-black uppercase tracking-[0.08em] text-[#ed3f8f]">{price.primary}</p>{price.context ? <p className="mt-1 text-sm font-semibold text-slate-600">{price.context}</p> : null}</>}
        </section>

        {presentation.type === "course" && sessions.length ? <section className="mt-8" data-testid="course-occurrences">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Dina tillfällen</h2>
          <ol className="mt-4 grid gap-3">
            {sessions.map((session, index) => <li key={session.id} className="grid grid-cols-[2rem_1fr] items-center gap-3 border-b border-black/10 pb-3 last:border-b-0">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-950 text-xs font-black text-white">{index + 1}</span>
              <p className="text-sm font-bold">{swedishOccurrenceDate(session.session_date)} · {String(session.start_time).slice(0, 5)}–{String(session.end_time).slice(0, 5)}</p>
            </li>)}
          </ol>
        </section> : null}

        {presentation.type === "course" ? <section className="mt-8" data-testid="course-inclusions">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Detta ingår</h2>
          <div className="mt-4 grid gap-4">
            {includesOpenPlay ? <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-950">
              <Check className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-black">Fri Open Play under hela kursperioden</p><p className="mt-1 text-sm leading-relaxed text-emerald-900/80">Kom och spela så mycket du vill mellan kurstillfällena — alla vanliga Open Play ingår.</p></div>
            </div> : null}
            <ul className="grid gap-2 text-sm font-semibold text-slate-700">
              <li className="flex gap-2"><Check className="h-4 w-4 shrink-0" />{course.format?.requires_instructor ? `${sessions.length} coachledda tillfällen` : `${sessions.length} tillfällen`}</li>
              <li className="flex gap-2"><Check className="h-4 w-4 shrink-0" />Max {course.capacity.capacity} spelare{course.court_ids.length ? ` · ${course.court_ids.length} ${course.court_ids.length === 1 ? "bana" : "banor"}` : ""}</li>
              {course.format?.requires_instructor ? <li className="flex gap-2"><Check className="h-4 w-4 shrink-0" />Instruktör vid varje tillfälle</li> : null}
            </ul>
          </div>
        </section> : null}

        {course.format?.full_description ? <section className={socialEvent ? "mt-6" : "mt-8"}>
          <h2 className="text-lg font-black">{presentation.contentHeading}</h2>
          {socialEvent && (course.format?.description || course.description) ? <p className="mt-3 text-base leading-relaxed text-slate-700">{course.format?.description || course.description}</p> : null}
          <div className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">{course.format.full_description}</div>
        </section> : socialEvent && (course.format?.description || course.description) ? <section className="mt-6"><h2 className="text-lg font-black">{presentation.contentHeading}</h2><p className="mt-3 text-base leading-relaxed text-slate-700">{course.format?.description || course.description}</p></section> : null}

        {supportsParticipantChoice ? <section className="mt-8">
          <h2 className="text-lg font-black">Vem ska delta?</h2>
          <div className="mt-3 grid gap-2">
            {([
              ["self", "Jag själv"],
              ["adult", "En annan vuxen"],
              ["dependent", "Ett barn jag ansvarar för"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setParticipantType(value)} className={`flex h-14 items-center justify-between rounded-2xl border px-4 text-left font-bold ${participantType === value ? "border-slate-950" : "border-black/10"}`}>
                {label}<span className={`grid h-5 w-5 place-items-center rounded-full border ${participantType === value ? "border-slate-950 bg-slate-950 text-white" : "border-black/20"}`}>{participantType === value ? <Check className="h-3 w-3" /> : null}</span>
              </button>
            ))}
          </div>
          {requiresGuestDetails ? <div className="mt-4 grid gap-3"><input aria-label="Betalarens namn" value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Ditt namn" className="h-12 rounded-xl border border-black/15 px-3" /><input aria-label="Betalarens e-post" value={payerEmail} onChange={(event) => setPayerEmail(event.target.value)} placeholder="Din e-post" type="email" className="h-12 rounded-xl border border-black/15 px-3" /></div> : null}
          {participantType === "adult" ? <div className="mt-4 grid gap-3"><input aria-label="Deltagarens namn" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Deltagarens namn" className="h-12 rounded-xl border border-black/15 px-3" /><input aria-label="Deltagarens e-post" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} placeholder="Deltagarens e-post" type="email" className="h-12 rounded-xl border border-black/15 px-3" /></div> : null}
          {participantType === "dependent" ? user ? <div className="mt-4 grid gap-3"><input aria-label="Barnets förnamn" value={childName} onChange={(event) => setChildName(event.target.value)} placeholder="Barnets förnamn" className="h-12 rounded-xl border border-black/15 px-3" /><input aria-label="Barnets födelseår" value={childBirthYear} onChange={(event) => setChildBirthYear(event.target.value)} placeholder="Födelseår" inputMode="numeric" className="h-12 rounded-xl border border-black/15 px-3" /><p className="text-xs leading-relaxed text-slate-500">Uppgifterna visas bara för dig och behörig personal.</p></div> : <button type="button" onClick={() => buy.mutate()} className="mt-4 flex items-center gap-2 text-sm font-bold underline underline-offset-4">Logga in för att anmäla barn <ChevronRight className="h-4 w-4" /></button> : null}
        </section> : requiresGuestDetails ? <section className="mt-8 grid gap-3"><h2 className="text-lg font-black">Dina uppgifter</h2><input aria-label="Betalarens namn" value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Ditt namn" className="h-12 rounded-xl border border-black/15 px-3" /><input aria-label="Betalarens e-post" value={payerEmail} onChange={(event) => setPayerEmail(event.target.value)} placeholder="Din e-post" type="email" className="h-12 rounded-xl border border-black/15 px-3" /></section> : null}

        {presentation.type === "course" ? <section className="mt-8 border-t border-black/10 pt-6">
          <h2 className="font-black">Din plats gäller hela kursen</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">Du bokar hela kursen, inte separata tillfällen. Missade tillfällen återbetalas inte och ger ingen ersättningsplats.</p>
        </section> : null}
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          {course.customer_has_commitment ? <div className="flex items-center gap-3"><p className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 text-sm font-black text-emerald-800"><Check className="h-5 w-5" /> Du har en plats</p><button type="button" onClick={() => navigate(`/my?v=${encodeURIComponent(venueSlug)}`)} className="min-h-14 rounded-2xl border border-black/15 px-5 text-sm font-black">Visa</button></div> : <button type="button" onClick={() => buy.mutate()} disabled={!ready || buy.isPending} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:bg-slate-300 disabled:text-slate-500">
            {buy.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {course.registration_state !== "open" ? "Anmälan är stängd" : available <= 0 ? "Fullbokad" : selectedParticipantPricePending ? "Fortsätt" : bookingCta}
          </button>}
        </div>
      </footer>
    </div>
  );
}
