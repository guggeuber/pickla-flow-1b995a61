import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, Loader2, Share2, ShieldCheck, Trophy, Users } from "lucide-react";
import { DateTime } from "luxon";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PicklaTopBar } from "@/components/PicklaTopBar";
import { ResponsiveSupabaseImage } from "@/components/ResponsiveSupabaseImage";
import { useAuth } from "@/hooks/useAuth";
import { canonicalAppUrl } from "@/lib/canonicalOrigin";
import { formatCommerceMoney } from "@/lib/commerce";
import { preserveIntendedRoute } from "@/lib/entryResolver";
import { fetchLeaguePublic, registerLeagueTeam, type LeagueFixture, type LeagueFixtureResult } from "@/lib/league";
import { usesTraditionalLeagueV1Scoring } from "@/lib/leagueRules";
import { DETAIL_ARTWORK_SIZES } from "@/lib/responsiveSupabaseImage";
import { shareOrCopy } from "@/lib/share";
import { useVerifiedAccount } from "@/hooks/useVerifiedAccount";
import { resolveCustomerVenueContext } from "@/lib/customerVenue";

const svDate = (value: string) => DateTime.fromISO(value, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("cccc d LLLL");
const shortTime = (value: string) => DateTime.fromISO(value, { zone: "utc" }).setZone("Europe/Stockholm").toFormat("HH:mm");

function fixtureResult(fixture: LeagueFixture) {
  const result = fixture.league_fixture_results;
  return (Array.isArray(result) ? result[0] : result) as LeagueFixtureResult | null | undefined;
}

export default function LeaguePage() {
  const { seriesId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const verifiedAccount = useVerifiedAccount();
  const [teamName, setTeamName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const requestIds = useRef({ registration: crypto.randomUUID(), line: crypto.randomUUID() });
  const publicQuery = useQuery({
    queryKey: ["league-public", seriesId, "anonymous"],
    queryFn: () => fetchLeaguePublic(seriesId, { auth: "omit" }),
    enabled: Boolean(seriesId),
    staleTime: 30_000,
  });
  const personalizedQuery = useQuery({
    queryKey: ["league-public", seriesId, verifiedAccount.verifiedUserId],
    queryFn: () => fetchLeaguePublic(seriesId),
    enabled: Boolean(seriesId) && verifiedAccount.isVerified,
  });
  const personalizedLeague = verifiedAccount.isVerified ? personalizedQuery.data : undefined;
  const league = personalizedLeague || publicQuery.data;
  const publicOnlyAccount = verifiedAccount.state === "anonymous" || verifiedAccount.state === "terminal_failure";
  const personalizationReady = publicOnlyAccount || Boolean(personalizedLeague);
  const personalizationFailed = verifiedAccount.state === "validation_error"
    || (verifiedAccount.isVerified && personalizedQuery.isError);
  const venue = league ? (Array.isArray(league.series.venues) ? league.series.venues[0] : league.series.venues) : null;
  const requestedVenue = params.get("v");
  const resolvedVenue = resolveCustomerVenueContext(requestedVenue).slug;
  const venueSlug = requestedVenue ? resolvedVenue : venue?.slug || resolvedVenue;
  const teamById = useMemo(() => new Map((league?.teams || []).map((team) => [team.id, team])), [league?.teams]);
  const courtById = useMemo(() => new Map((league?.courts || []).map((court) => [court.id, court])), [league?.courts]);
  const now = Date.now();
  const upcoming = (league?.fixtures || []).filter((fixture) => new Date(fixture.scheduled_end_at).getTime() >= now && fixture.status === "scheduled");
  const nextNightFixtures = upcoming.length
    ? upcoming.filter((fixture) => fixture.league_night_session_id === upcoming[0].league_night_session_id)
    : [];
  const latest = (league?.fixtures || []).filter((fixture) => fixtureResult(fixture)?.state === "final").slice(-6).reverse();
  const registrationOpen = Boolean(league)
    && personalizationReady
    && new Date(league!.series.registration_opens_at).getTime() <= now
    && new Date(league!.series.registration_closes_at).getTime() > now
    && Number(league!.capacity.available_count || 0) > 0
    && !league!.customer_team_id;

  const register = useMutation({
    mutationFn: async () => {
      if (!league) throw new Error("Seriespelet kunde inte öppnas.");
      if (!personalizationReady) throw new Error("Kontot verifieras fortfarande.");
      if (!verifiedAccount.isVerified || !user) {
        const intended = `/seriespel/${seriesId}?v=${encodeURIComponent(venueSlug)}`;
        preserveIntendedRoute(intended);
        navigate(`/auth?redirect=${encodeURIComponent(`/seriespel/${seriesId}`)}&v=${encodeURIComponent(venueSlug)}`);
        throw new Error("Logga in som lagkapten för att anmäla laget.");
      }
      return registerLeagueTeam({
        series_id: seriesId,
        team_name: teamName,
        player_name: playerName,
        player_email: playerEmail,
        age_confirmed: ageConfirmed,
        registration_request_id: requestIds.current.registration,
        source_line_id: requestIds.current.line,
        quoted_price_minor: league.current_price_minor,
      });
    },
    onSuccess: (response) => {
      if (response.pricing.quote_changed === true) toast.info(`Priset uppdaterades. Lagplatsen reserverades för ${formatCommerceMoney(Number(response.pricing.final_price_minor || 0))}.`);
      navigate(`/cart?token=${encodeURIComponent(response.cart_token)}&v=${encodeURIComponent(venueSlug)}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const share = async () => {
    if (!league) return;
    const url = canonicalAppUrl(`/seriespel/${league.series.id}?v=${encodeURIComponent(venueSlug)}`);
    const result = await shareOrCopy({ title: league.series.name, text: "Anmäl ett lag till Pickla Seriespel", url, copyText: url });
    if (result === "copied") toast.success("Länk kopierad");
  };

  if (publicQuery.isLoading) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#fff" /><div className="grid min-h-[100dvh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div></div>;
  if (!league || publicQuery.isError) return <div className="min-h-[100dvh] bg-white"><PicklaTopBar slug={venueSlug} background="#fff" /><main className="mx-auto max-w-xl px-6 pt-32 text-center">Seriespelet kunde inte öppnas.</main></div>;

  const firstNight = league.sessions[0]?.session_date;
  const full = Number(league.capacity.available_count || 0) <= 0;
  const ready = teamName.trim().length >= 3 && playerName.trim().length >= 2 && playerEmail.includes("@") && ageConfirmed;
  const traditionalSideout = usesTraditionalLeagueV1Scoring(league.season.scoring_code);
  return (
    <div className="min-h-[100dvh] bg-white text-slate-950">
      <PicklaTopBar slug={venueSlug} background="#fff" />
      <main className="mx-auto w-full max-w-2xl px-5 pb-40 pt-[calc(env(safe-area-inset-top,0px)+96px)]">
        {league.series.image_urls?.[0] ? <ResponsiveSupabaseImage src={league.series.image_urls[0]} alt={league.series.name} sizes={DETAIL_ARTWORK_SIZES} width={1280} height={720} priority className="mb-6 block h-auto w-full rounded-[24px]" /> : null}
        <div className="flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.18em] text-[#ed3f8f]">Seriespel</p><button type="button" onClick={() => void share()} className="flex items-center gap-2 rounded-full border border-black/15 px-4 py-2 text-sm font-black"><Share2 className="h-4 w-4" /> Dela</button></div>
        <h1 className="mt-2 text-3xl font-black leading-tight">{league.series.name}</h1>
        {league.series.description ? <p className="mt-3 leading-relaxed text-slate-600">{league.series.description}</p> : null}

        <section className="mt-7 grid grid-cols-2 gap-3 rounded-3xl bg-slate-950 p-5 text-white sm:grid-cols-4">
          <div><p className="text-2xl font-black">6</p><p className="text-xs font-bold text-white/60">lag</p></div>
          <div><p className="text-2xl font-black">5</p><p className="text-xs font-bold text-white/60">torsdagar</p></div>
          <div><p className="text-2xl font-black">2</p><p className="text-xs font-bold text-white/60">matcher/kväll</p></div>
          <div><p className="text-2xl font-black">10</p><p className="text-xs font-bold text-white/60">matcher/lag</p></div>
        </section>
        <section className="mt-3 flex items-center justify-between rounded-2xl bg-[#fff2f7] px-5 py-4">
          <div><p className="text-xs font-black uppercase tracking-wide text-[#b41663]">Lagpris · båda spelarna</p>{league.pricing_reason === "early_bird" ? <p className="mt-1 text-xs font-bold text-slate-500">Early Bird · första {league.product.early_bird_slots} lag</p> : league.pricing_reason === "membership_tier_pricing" ? <p className="mt-1 text-xs font-bold text-slate-500">Medlemspris{league.membership_tier_name ? ` · ${league.membership_tier_name}` : ""}</p> : null}</div>
          <div className="text-right"><p className="text-xl font-black">{formatCommerceMoney(league.current_price_minor)}</p>{league.pricing_reason !== "league_team_base_price" ? <p className="text-xs text-slate-400 line-through">{formatCommerceMoney(league.product.base_price_sek * 100)}</p> : null}</div>
        </section>

        <section className="mt-6 grid gap-3 border-y border-black/10 py-5 text-sm font-bold">
          <p className="flex items-center gap-3"><CalendarDays className="h-5 w-5" /> Torsdagar · 18:00–20:00{firstNight ? ` · start ${svDate(firstNight)}` : ""}</p>
          <p className="flex items-center gap-3"><Users className="h-5 w-5" /> 2 spelare per lag · 18+</p>
          <p className="flex items-center gap-3"><Trophy className="h-5 w-5" /> Alla möter alla två gånger</p>
          <div className="grid grid-cols-5 gap-1.5 pt-1">{league.sessions.map((session, index) => <div key={session.id} className="rounded-xl bg-slate-50 px-1 py-2 text-center"><p className="text-[10px] text-slate-400">#{index + 1}</p><p className="mt-0.5 text-xs font-black">{DateTime.fromISO(session.session_date).toFormat("d/M")}</p></div>)}</div>
        </section>

        <section className="mt-7">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Anmälda lag</p><h2 className="mt-1 text-xl font-black">{league.capacity.active_teams} av 6 lag</h2></div><p className="text-sm font-bold text-slate-500">{league.capacity.available_count} kvar</p></div>
          <ol className="mt-4 grid gap-2">
            {Array.from({ length: 6 }, (_, index) => <li key={index} className="flex h-12 items-center gap-3 rounded-2xl border border-black/10 px-4"><span className="w-5 text-xs font-black text-slate-400">{index + 1}</span><span className={`font-bold ${league.teams[index] ? "" : "text-slate-300"}`}>{league.teams[index]?.team_name || "—"}</span></li>)}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">Endast lagnamn visas publikt. Spelarnas namn och e-post visas inte här.</p>
        </section>

        {league.season.fixtures_published_at ? <>
          <section className="mt-10"><h2 className="text-xl font-black">Tabell</h2><div className="mt-4 overflow-x-auto rounded-2xl border border-black/10"><table className="w-full min-w-[520px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">#</th><th className="p-3">Lag</th><th className="p-3 text-center">M</th><th className="p-3 text-center">V</th><th className="p-3 text-center">F</th><th className="p-3 text-center">Game +/-</th><th className="p-3 text-center">Poäng</th></tr></thead><tbody>{league.standings.map((row) => <tr key={row.team_entry_id} className="border-t border-black/10"><td className="p-3 font-black">{row.position}</td><td className="p-3 font-bold">{row.team_name}</td><td className="p-3 text-center">{row.matches_played}</td><td className="p-3 text-center">{row.wins}</td><td className="p-3 text-center">{row.losses}</td><td className="p-3 text-center">{row.set_difference > 0 ? "+" : ""}{row.set_difference}</td><td className="p-3 text-center font-black">{row.league_points}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-slate-500">Särskiljning: tabellpoäng, inbördes möten vid exakt två lika lag, poängskillnad, gjorda poäng. Delad placering kan förekomma.</p></section>
          {nextNightFixtures.length ? <section className="mt-9"><h2 className="text-xl font-black">Nästa omgång</h2><p className="mt-1 text-sm font-bold text-slate-500">{svDate(nextNightFixtures[0].scheduled_start_at)}</p><div className="mt-4 grid gap-2">{nextNightFixtures.map((fixture) => <div key={fixture.id} className="grid grid-cols-[4rem_1fr] gap-3 rounded-2xl border border-black/10 p-4"><div><p className="font-black">{shortTime(fixture.scheduled_start_at)}</p><p className="mt-1 text-xs text-slate-500">{courtById.get(fixture.venue_court_id)?.name}</p></div><p className="font-bold">{teamById.get(fixture.team_a_entry_id)?.team_name} <span className="text-slate-400">–</span> {teamById.get(fixture.team_b_entry_id)?.team_name}</p></div>)}</div></section> : null}
          {latest.length ? <section className="mt-9"><h2 className="text-xl font-black">Senaste resultat</h2><div className="mt-4 grid gap-2">{latest.map((fixture) => { const result = fixtureResult(fixture)!; return <div key={fixture.id} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4"><p className="font-bold">{teamById.get(fixture.team_a_entry_id)?.team_name} – {teamById.get(fixture.team_b_entry_id)?.team_name}</p><p className="shrink-0 font-black">{result.outcome_type === "walkover" ? "WO" : result.sets.map((set) => `${set.team_a}–${set.team_b}`).join(" · ")}</p></div>; })}</div></section> : null}
        </> : <section className="mt-8 rounded-3xl bg-[#fff2f7] p-5"><p className="font-black">Spelschemat publiceras senast {DateTime.fromISO(league.season.fixture_publication_deadline).setLocale("sv").toFormat("d LLLL")}.</p><p className="mt-2 text-sm leading-relaxed text-slate-600">Exakta motståndare, 18:00/19:00-ordning och bana publiceras här före seriestart.</p></section>}

        <details className="group mt-8 rounded-2xl border border-black/10 p-5"><summary className="flex cursor-pointer list-none items-center justify-between font-black">Så funkar seriespelet <ChevronDown className="h-5 w-5 transition group-open:rotate-180" /></summary><div className="mt-4 grid gap-3 text-sm leading-relaxed text-slate-600"><p>6 lag med exakt 2 registrerade spelare, båda 18+. Fem torsdagar 18:00–20:00. Varje lag spelar två matcher per kväll och tio matcher totalt.</p>{traditionalSideout ? <p>Tre game spelas alltid. Traditionell side-out-scoring: endast servande lag kan ta poäng. Först till 11, vinn med två, tak 13. Varje vunnet game ger en tabellpoäng.</p> : <p>Tre game spelas alltid. Rallypoäng används: varje boll ger poäng. Först till 11, vinn med två, tak 13. Varje vunnet game ger en tabellpoäng.</p>}<p>Matchfönstret är 50 minuter. När tiden är slut spelas pågående boll klart. Ett ofärdigt resultat påverkar inte tabellen förrän personal har slutfört det.</p><p>Systemet hanterar inga avbytare i Season 01. Rosterändringar hanteras av personal. Om sex lag inte är anmälda vid deadline ställer Pickla in och återbetalar hela lagavgiften. Kontakta Pickla om hela laget behöver avbokas; avbokning och eventuell återbetalning hanteras av personal enligt villkoren. Efter schemapublicering eller seriestart krävs manuell bedömning.</p></div></details>

        {personalizationReady && !league.customer_team_id && registrationOpen ? <section className="mt-9 rounded-3xl border border-black/10 p-5"><h2 className="text-xl font-black">Anmäl laget</h2><div className="mt-5 grid gap-4"><label className="grid gap-1.5 text-sm font-bold">Lagnamn<input value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={40} placeholder="Dink Floyd" className="h-12 rounded-xl border border-black/15 px-3 font-normal" /></label><p className="-mt-2 text-xs text-slate-500">3–40 tecken. Lagnamnet visas publikt.</p><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Lagkapten</p><p className="mt-1 font-bold">Du betalar hela lagavgiften och är lagets första spelare.</p></div><label className="grid gap-1.5 text-sm font-bold">Spelare 2 · namn<input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Anna Andersson" className="h-12 rounded-xl border border-black/15 px-3 font-normal" /></label><label className="grid gap-1.5 text-sm font-bold">Spelare 2 · e-post<input value={playerEmail} onChange={(event) => setPlayerEmail(event.target.value)} type="email" placeholder="anna@example.com" className="h-12 rounded-xl border border-black/15 px-3 font-normal" /></label><p className="-mt-2 text-xs text-slate-500">Spelare 2 behöver inget konto före köpet. E-post kopplas till samma kundprofil när personen skapar eller använder sitt konto.</p><label className="flex items-start gap-3 rounded-2xl border border-black/10 p-4 text-sm font-bold"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5" /> Jag bekräftar att båda spelarna är 18+.</label></div></section> : null}
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3"><div className="mx-auto max-w-2xl">{personalizationFailed ? <button type="button" onClick={() => verifiedAccount.state === "validation_error" ? void verifiedAccount.retry() : void personalizedQuery.refetch()} className="h-14 w-full rounded-2xl border border-red-200 bg-red-50 text-sm font-black text-red-700">Försök hämta din lagstatus igen</button> : !personalizationReady ? <div className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 text-sm font-black text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Din lagstatus hämtas…</div> : league.customer_team_id ? <button type="button" onClick={() => navigate(`/my?v=${encodeURIComponent(venueSlug)}`)} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-50 font-black text-emerald-800"><Check className="h-5 w-5" /> Ditt lag är anmält · Visa</button> : <button type="button" onClick={() => register.mutate()} disabled={register.isPending || !registrationOpen || (Boolean(user) && !ready)} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-black text-white disabled:bg-slate-300 disabled:text-slate-500">{register.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : verifiedAccount.isVerified ? <ShieldCheck className="h-5 w-5" /> : null}{!registrationOpen ? full ? "Fullbokat" : "Anmälan är stängd" : `${league.pricing_reason === "early_bird" ? "Anmäl laget · Early Bird" : league.pricing_reason === "membership_tier_pricing" ? "Anmäl laget · Medlemspris" : "Anmäl laget"} ${formatCommerceMoney(league.current_price_minor)}`}</button>}</div></footer>
    </div>
  );
}
