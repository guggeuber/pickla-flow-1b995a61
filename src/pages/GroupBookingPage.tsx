import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import picklaLogo from "@/assets/pickla-logo.svg";
import weekendVibes from "@/assets/pickla-weekend-vibes.jpg";

const FONT_GROTESK = "'Space Grotesk', sans-serif";
const FONT_MONO = "'Space Mono', monospace";

const GROUP_TYPES = [
  { value: "company", label: "Företag" },
  { value: "team", label: "Team" },
  { value: "bachelorette", label: "Möhippa" },
  { value: "private", label: "Privat" },
];

const TIME_OPTIONS = [
  { value: "morning", label: "Morgon" },
  { value: "lunch", label: "Lunch" },
  { value: "afternoon", label: "Eftermiddag" },
  { value: "evening", label: "Kväll" },
];

const ACTIVITY_OPTIONS = ["Pickleball", "Dart", "Pingis", "Turnering", "Instruktör", "Mat & dryck"];
const RESOURCE_OPTIONS = ["Hela hallen", "Lounge", "Restaurang", "Bar", "Scen"];
const DEFAULT_GROUP_TITLE = "Berätta ungefär vad ni vill göra, så bygger vi ett upplägg med aktivitet, mat, yta och personal.";
const DEFAULT_GROUP_INTRO = "Det här är en förfrågan, inte en bindande bokning. Vi återkommer med tider, pris och förslag.";
const DEFAULT_GROUP_NOTES = [
  "Ni behöver inte veta exakt bana, schema eller format nu.",
  "Vi kan kombinera spel, turnering, mat, dryck, lounge och instruktör.",
  "Förfrågan hamnar hos vårt team som återkommer med ett konkret upplägg.",
].join("\n");

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function GroupBookingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = searchParams.get("v") || "pickla-arena-sthlm";
  const today = DateTime.now().setZone("Europe/Stockholm").toISODate() || "";

  const [eventType, setEventType] = useState("company");
  const [participants, setParticipants] = useState(12);
  const [preferredDate, setPreferredDate] = useState(today);
  const [preferredTime, setPreferredTime] = useState("afternoon");
  const [activities, setActivities] = useState<string[]>(["Pickleball"]);
  const [resources, setResources] = useState<string[]>([]);
  const [name, setName] = useState(searchParams.get("name") || "");
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [notes, setNotes] = useState("");
  const [sentEventId, setSentEventId] = useState<string | null>(null);

  const { data: venueData } = useQuery({
    queryKey: ["group-booking-venue", slug],
    queryFn: () => apiGet("api-bookings", "public-venue", { slug }),
    staleTime: 60_000,
  });

  const venue = venueData?.venue;
  const venueName = venue?.name?.replace("Pickla Arena ", "Pickla ") || "Pickla Solna";
  const heroImage = venue?.group_booking_image_url || venue?.cover_image_url || weekendVibes;
  const groupTitle = venue?.group_booking_title || DEFAULT_GROUP_TITLE;
  const groupIntro = venue?.group_booking_intro || DEFAULT_GROUP_INTRO;
  const groupNotes = String(venue?.group_booking_notes || DEFAULT_GROUP_NOTES)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const canSubmit = name.trim().length > 1 && phone.trim().length > 4 && email.trim().length > 4 && participants > 0 && preferredDate;
  const selectedTypeLabel = useMemo(
    () => GROUP_TYPES.find((type) => type.value === eventType)?.label || "Grupp",
    [eventType],
  );
  const quickDates = useMemo(() => {
    const base = DateTime.now().setZone("Europe/Stockholm").startOf("day").plus({ days: 7 });
    return Array.from({ length: 6 }, (_, index) => {
      const date = base.plus({ days: index });
      return {
        value: date.toISODate() || "",
        label: date.setLocale("sv").toFormat("EEE"),
        day: date.toFormat("d/M"),
      };
    });
  }, []);
  const selectedDateLabel = preferredDate
    ? DateTime.fromISO(preferredDate).setLocale("sv").toFormat("d MMM yyyy")
    : "Datum flexibelt";

  const inquiryMutation = useMutation({
    mutationFn: () => apiPost("api-event-public", "group-inquiry", {
      slug,
      eventType,
      participants,
      preferredDate,
      preferredTime,
      activities,
      resources,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      notes: notes.trim(),
    }),
    onSuccess: (result) => {
      setSentEventId(result.event_id);
      toast.success("Förfrågan skickad!");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || inquiryMutation.isPending) return;
    inquiryMutation.mutate();
  };

  if (sentEventId) {
    return (
      <div className="min-h-[100dvh] bg-[#f7f4ee] pb-20 text-[#111]">
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
          <img src={picklaLogo} alt="Pickla" className="mb-7 h-8 w-auto" />
          <CheckCircle2 className="h-14 w-14 text-[#32ef87]" />
          <h1 className="mt-5 text-[34px] font-bold leading-none" style={{ fontFamily: FONT_GROTESK }}>
            Förfrågan skickad
          </h1>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            Vi har lagt den i event-pipelinen och återkommer med upplägg, tider och offert.
          </p>
          <button
            onClick={() => navigate(`/?v=${slug}`)}
            className="mt-8 w-full rounded-full bg-neutral-950 py-4 text-[13px] font-bold text-white active:scale-[0.98]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            Tillbaka till idag
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f7f4ee] pb-16 text-[#111]">
      <PicklaTopBar slug={slug} venueName={venueName} background="#f7f4ee" />
      <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-7 px-6 pt-[calc(env(safe-area-inset-top,0px)+118px)]">
        <section className="overflow-hidden rounded-[28px] bg-neutral-950 text-white">
          <div className="relative h-56">
            <img src={heroImage} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            <div className="absolute bottom-5 left-5 right-5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/60" style={{ fontFamily: FONT_MONO }}>
                gruppbokning
              </p>
              <h1 className="mt-2 text-[42px] leading-[0.92] tracking-[-0.04em]" style={{ fontFamily: FONT_MONO }}>
                Planera ditt event
              </h1>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            skapa något tillsammans
          </p>
          <p className="mt-3 text-[18px] font-bold leading-snug" style={{ fontFamily: FONT_GROTESK }}>
            {groupTitle}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            {groupIntro}
          </p>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Vad vill ni göra?
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {GROUP_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setEventType(type.value)}
                className="rounded-2xl px-4 py-4 text-left text-[15px] font-bold transition-transform active:scale-[0.98]"
                style={{
                  background: eventType === type.value ? "#111" : "#f7f4ee",
                  color: eventType === type.value ? "#fff" : "#111",
                  fontFamily: FONT_GROTESK,
                }}
              >
                {type.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <label className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
              Antal personer
            </label>
            <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={() => setParticipants(Math.max(1, participants - 1))} className="h-12 w-12 rounded-full bg-[#f7f4ee] text-2xl">-</button>
              <input
                value={participants}
                onChange={(event) => setParticipants(Number(event.target.value || 1))}
                type="number"
                min={1}
                max={500}
                className="h-14 min-w-0 flex-1 rounded-2xl border border-neutral-200 bg-white px-4 text-center text-3xl outline-none"
                style={{ fontFamily: FONT_MONO }}
              />
              <button type="button" onClick={() => setParticipants(Math.min(500, participants + 1))} className="h-12 w-12 rounded-full bg-[#f7f4ee] text-2xl">+</button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            När passar det?
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {quickDates.map((date) => {
              const active = preferredDate === date.value;
              return (
                <button
                  key={date.value}
                  type="button"
                  onClick={() => setPreferredDate(date.value)}
                  className="rounded-2xl px-3 py-3 text-left transition-transform active:scale-[0.98]"
                  style={{ background: active ? "#111" : "#f7f4ee", color: active ? "#fff" : "#111" }}
                >
                  <p className="text-[9px] uppercase tracking-wide opacity-60" style={{ fontFamily: FONT_MONO }}>{date.label}</p>
                  <p className="mt-1 text-[20px] leading-none" style={{ fontFamily: FONT_MONO }}>{date.day}</p>
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex h-14 items-center justify-between rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 py-3">
            <span className="text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>Annat datum</span>
            <input
              value={preferredDate}
              onChange={(event) => setPreferredDate(event.target.value)}
              min={today}
              type="date"
              className="max-w-[145px] bg-transparent text-right text-[13px] outline-none"
              style={{ fontFamily: FONT_MONO }}
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {TIME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreferredTime(option.value)}
                className="rounded-2xl px-4 py-4 text-left text-[13px] font-bold transition-transform active:scale-[0.98]"
                style={{
                  background: preferredTime === option.value ? "#32ef87" : "#f7f4ee",
                  color: "#111",
                  fontFamily: FONT_MONO,
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Bra att veta
          </p>
          <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-neutral-600" style={{ fontFamily: FONT_MONO }}>
            {groupNotes.map((note) => (
              <p key={note}>• {note}</p>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Aktiviteter
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ACTIVITY_OPTIONS.map((activity) => {
              const active = activities.includes(activity);
              return (
                <button
                  key={activity}
                  type="button"
                  onClick={() => setActivities((current) => toggleValue(current, activity))}
                  className="rounded-full px-4 py-3 text-[12px] font-bold transition-transform active:scale-[0.98]"
                  style={{ background: active ? "#111" : "#f7f4ee", color: active ? "#fff" : "#111", fontFamily: FONT_MONO }}
                >
                  {activity}
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Resurser
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {RESOURCE_OPTIONS.map((resource) => {
              const active = resources.includes(resource);
              return (
                <button
                  key={resource}
                  type="button"
                  onClick={() => setResources((current) => toggleValue(current, resource))}
                  className="rounded-full px-4 py-3 text-[12px] font-bold transition-transform active:scale-[0.98]"
                  style={{ background: active ? "#32ef87" : "#f7f4ee", color: "#111", fontFamily: FONT_MONO }}
                >
                  {resource}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Kontakt
          </p>
          <div className="mt-4 space-y-3">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Namn / företag" className="h-14 w-full rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 outline-none" style={{ fontFamily: FONT_GROTESK }} />
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefon" inputMode="tel" className="h-14 w-full rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 outline-none" style={{ fontFamily: FONT_GROTESK }} />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" inputMode="email" required className="h-14 w-full rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 outline-none" style={{ fontFamily: FONT_GROTESK }} />
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Övrigt, ungefärlig idé eller specialönskemål" rows={4} className="w-full resize-none rounded-2xl border border-neutral-200 bg-[#f7f4ee] px-4 py-4 outline-none" style={{ fontFamily: FONT_GROTESK }} />
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Summering
          </p>
          <p className="mt-3 text-[18px] font-bold" style={{ fontFamily: FONT_GROTESK }}>
            {selectedTypeLabel} · {participants} pers
          </p>
          <p className="mt-1 text-[12px] text-neutral-500" style={{ fontFamily: FONT_MONO }}>
            {selectedDateLabel} · {TIME_OPTIONS.find((option) => option.value === preferredTime)?.label}
          </p>
          <button
            type="submit"
            disabled={!canSubmit || inquiryMutation.isPending}
            className="mt-5 flex h-14 w-full items-center justify-center rounded-full bg-neutral-950 text-[16px] font-bold text-white disabled:opacity-35 active:scale-[0.98]"
            style={{ fontFamily: FONT_GROTESK }}
          >
            {inquiryMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Skicka förfrågan"}
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-400" style={{ fontFamily: FONT_MONO }}>
            Vi använder dina kontaktuppgifter för att återkomma om förfrågan. Läs mer i vår{" "}
            <Link to="/privacy" className="underline underline-offset-2">
              integritetspolicy
            </Link>
            .
          </p>
        </section>
      </form>
    </div>
  );
}
