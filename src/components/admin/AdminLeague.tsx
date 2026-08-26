import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { AlertTriangle, CalendarDays, Check, ImagePlus, Loader2, Pencil, RotateCcw, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  createLeagueSeason,
  fetchLeagueAdmin,
  generateLeagueFixtures,
  publishLeagueFixtures,
  publishLeagueOffer,
  previewLeagueResources,
  renameLeagueTeam,
  rescheduleLeagueNight,
  replaceLeaguePlayer,
  updateLeagueArtwork,
  type LeagueAdminMember,
  type LeagueAdminOrder,
  type LeagueAdminSeason,
  type LeagueAdminSeries,
  type LeagueAdminSession,
  type LeagueAdminTeam,
  type LeagueCourt,
  type LeagueResourcePlanInput,
  type LeagueResourcePreview,
} from "@/lib/league";
import { ApiRequestError } from "@/lib/api";
import { removeNamedEventImage, uploadNamedEventImage } from "@/lib/eventMedia";
import { changeLeagueNightDate, EMPTY_LEAGUE_NIGHT_DATES, resetLeagueNightDates, type LeagueNightDateState } from "@/lib/leagueAdminSchedule";
import { ax } from "@/components/admin/shell/axTheme";
import { AxChip } from "@/components/admin/shell/axPrimitives";

type Props = { venueId: string; leagueSeasonId?: string | null; onDone?: () => void };
const inputClass = "h-11 w-full rounded-xl border bg-transparent px-3 text-sm text-white outline-none";

function localUtc(value: string) {
  return DateTime.fromISO(value, { zone: "Europe/Stockholm" }).toUTC().toISO();
}

function activeSeries(season: LeagueAdminSeason): LeagueAdminSeries {
  return Array.isArray(season.activity_series) ? season.activity_series[0] : season.activity_series;
}

function customerName(member: LeagueAdminMember) {
  const customer = Array.isArray(member.customers) ? member.customers[0] : member.customers;
  return customer?.display_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Kund";
}

function resourcePlanKey(input: LeagueResourcePlanInput) {
  return JSON.stringify({ ...input, court_ids: [...input.court_ids].sort() });
}

function resourcePreviewQueryKey(venueId: string, planKey: string) {
  return ["admin-league-resource-preview", venueId, planKey] as const;
}

function leagueNightLabel(date: string) {
  const formatted = DateTime.fromISO(date, { zone: "Europe/Stockholm" }).setLocale("sv").toFormat("ccc d LLL");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function conflictTime(startsAt: string, endsAt: string) {
  const starts = DateTime.fromISO(startsAt).setZone("Europe/Stockholm");
  const ends = DateTime.fromISO(endsAt).setZone("Europe/Stockholm");
  return `${starts.toFormat("HH:mm")}–${ends.toFormat("HH:mm")}`;
}

function CreateLeague({ venueId, onDone }: { venueId: string; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-leagues", venueId], queryFn: () => fetchLeagueAdmin(venueId) });
  const [name, setName] = useState("Pickla Seriespel · Season 01");
  const [description, setDescription] = useState("Fem torsdagar. Två matcher per lag och kväll. Tabell, resultat och riktigt torsdagshäng.");
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [dateState, setDateState] = useState<LeagueNightDateState>({ dates: [...EMPTY_LEAGUE_NIGHT_DATES], overriddenIndexes: [] });
  const dates = dateState.dates;
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [basePrice, setBasePrice] = useState("1995");
  const [vatRate, setVatRate] = useState("");
  const [earlyBird, setEarlyBird] = useState(false);
  const [earlyBirdPrice, setEarlyBirdPrice] = useState("");
  const [earlyBirdSlots, setEarlyBirdSlots] = useState("");
  const [registrationOpens, setRegistrationOpens] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [fixtureDeadline, setFixtureDeadline] = useState("");
  const [publish, setPublish] = useState(false);
  const setNightDate = (index: number, value: string) => setDateState((current) => changeLeagueNightDate(current, index, value));
  const thursdayValid = dates.every((date) => date && DateTime.fromISO(date, { zone: "Europe/Stockholm" }).weekday === 4)
    && new Set(dates).size === 5
    && dates.every((date, index) => index === 0 || date > dates[index - 1]);
  const resourcePlan = useMemo<LeagueResourcePlanInput | null>(() => thursdayValid && courtIds.length === 3 ? {
    venue_id: venueId,
    night_dates: dates,
    start_time: "18:00",
    end_time: "20:00",
    court_ids: courtIds,
  } : null, [courtIds, dates, thursdayValid, venueId]);
  const currentResourcePlanKey = resourcePlan ? resourcePlanKey(resourcePlan) : "";
  const [debouncedResourcePlan, setDebouncedResourcePlan] = useState<{ key: string; input: LeagueResourcePlanInput } | null>(null);
  useEffect(() => {
    if (!resourcePlan) {
      setDebouncedResourcePlan(null);
      return;
    }
    const key = resourcePlanKey(resourcePlan);
    const timer = window.setTimeout(() => setDebouncedResourcePlan({ key, input: resourcePlan }), 250);
    return () => window.clearTimeout(timer);
  }, [currentResourcePlanKey, resourcePlan]);
  const previewMatchesCurrentPlan = Boolean(
    resourcePlan && debouncedResourcePlan && debouncedResourcePlan.key === currentResourcePlanKey,
  );
  const resourcePreview = useQuery({
    queryKey: resourcePreviewQueryKey(venueId, debouncedResourcePlan?.key || "not-ready"),
    queryFn: ({ signal }) => previewLeagueResources(debouncedResourcePlan!.input, signal),
    enabled: previewMatchesCurrentPlan,
    retry: false,
    staleTime: 0,
  });
  const currentPreview = previewMatchesCurrentPlan ? resourcePreview.data : undefined;
  const preflightStatus = !resourcePlan ? "not-ready"
    : !previewMatchesCurrentPlan || resourcePreview.isFetching || (!resourcePreview.data && !resourcePreview.isError) ? "checking"
    : resourcePreview.isError ? "error"
    : currentPreview?.has_conflicts ? "conflict" : "clear";
  const create = useMutation({
    mutationFn: async (_variables: { resourcePlanKey: string }) => {
      const response = await createLeagueSeason({
        venue_id: venueId,
        name,
        description,
        image_urls: [],
        night_dates: dates,
        start_time: "18:00",
        end_time: "20:00",
        court_ids: courtIds,
        registration_opens_at: localUtc(registrationOpens),
        registration_deadline: localUtc(registrationDeadline),
        fixture_publication_deadline: localUtc(fixtureDeadline),
        base_price_minor: Math.round(Number(basePrice) * 100),
        vat_rate: Number(vatRate),
        early_bird_price_minor: earlyBird ? Math.round(Number(earlyBirdPrice) * 100) : null,
        early_bird_slots: earlyBird ? Number(earlyBirdSlots) : null,
        publish,
      });
      if (!artworkFile) return { response, artworkWarning: null };
      let uploadedUrl: string | null = null;
      try {
        uploadedUrl = await uploadNamedEventImage({ owner: "activity-series", ownerId: response.season.activity_series_id, slot: 1, file: artworkFile });
        await updateLeagueArtwork(response.season.id, [uploadedUrl]);
        return { response, artworkWarning: null };
      } catch (error) {
        if (uploadedUrl) await Promise.allSettled([removeNamedEventImage(uploadedUrl)]);
        return { response, artworkWarning: error instanceof Error ? error.message : "Bilden kunde inte laddas upp." };
      }
    },
    onSuccess: async ({ artworkWarning }) => {
      if (artworkWarning) toast.warning(`Seriespelet skapades utan bild: ${artworkWarning}`);
      else toast.success(publish ? "Seriespelet är publicerat" : "Seriespelet är skapat som utkast");
      await queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
      onDone?.();
    },
    onError: (error: Error, variables) => {
      const structured = error instanceof ApiRequestError ? error.data : undefined;
      const conflictPreview = structured?.code === "managed_series_resource_conflict"
        ? structured.preview as LeagueResourcePreview | null | undefined
        : null;
      if (variables.resourcePlanKey === currentResourcePlanKey && structured?.code === "managed_series_resource_conflict") {
        if (conflictPreview) {
          queryClient.setQueryData(resourcePreviewQueryKey(venueId, variables.resourcePlanKey), conflictPreview);
        } else {
          void queryClient.invalidateQueries({ queryKey: resourcePreviewQueryKey(venueId, variables.resourcePlanKey) });
        }
      }
      toast.error(error.message);
    },
  });
  const ready = name.trim() && thursdayValid && courtIds.length === 3 && Number(basePrice) > 0
    && vatRate !== "" && Number(vatRate) >= 0 && registrationOpens && registrationDeadline && fixtureDeadline
    && (!earlyBird || (Number(earlyBirdPrice) > 0 && Number(earlyBirdSlots) > 0));
  const createEnabled = Boolean(ready && preflightStatus === "clear" && !create.isPending && currentResourcePlanKey);
  return <div className="space-y-5">
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Innehåll</p><div className="mt-3 grid gap-3"><input aria-label="Titel" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} style={{ borderColor: ax("border") }} /><textarea aria-label="Beskrivning" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="rounded-xl border bg-transparent p-3 text-sm text-white" style={{ borderColor: ax("border") }} /><div><p className="text-xs font-bold text-white">Omgångsbild · 16:9</p><p className="mt-0.5 text-[10px]" style={{ color: ax("muted") }}>JPG, PNG eller WebP · max 5 MB</p><label className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold text-white" style={{ borderColor: ax("border") }}><ImagePlus className="h-4 w-4" />{artworkFile ? "Byt vald bild" : "Välj bild"}<input aria-label="Ladda upp League-bild" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setArtworkFile(event.target.files?.[0] || null)} /></label>{artworkFile ? <p className="mt-2 text-xs" style={{ color: ax("electricSoft") }}>{artworkFile.name}</p> : null}</div></div></section>
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("electricSoft") }}>Säsong · låst V1</p><div className="mt-3 grid gap-3"><label className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>Första League-kvällen<input aria-label="Första League-kvällen" type="date" value={dates[0]} onChange={(event) => setNightDate(0, event.target.value)} className={inputClass} style={{ borderColor: ax("border") }} /></label>{dates[0] ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">{dates.slice(1).map((date, offset) => { const index = offset + 1; return <label key={index} className="grid gap-1 text-[10px] font-bold" style={{ color: ax("muted") }}>Kväll {index + 1}<input aria-label={`Kväll ${index + 1}`} type="date" value={date} onChange={(event) => setNightDate(index, event.target.value)} className={inputClass} style={{ borderColor: dateState.overriddenIndexes.includes(index) ? ax("sun") : ax("border") }} /></label>; })}</div> : null}{dateState.overriddenIndexes.length ? <button type="button" onClick={() => setDateState((current) => resetLeagueNightDates(current))} className="inline-flex h-9 w-fit items-center gap-2 rounded-xl border px-3 text-xs font-bold" style={{ borderColor: ax("sun"), color: ax("sun") }}><RotateCcw className="h-3.5 w-3.5" />Återställ till fem torsdagar</button> : null}{dates.some(Boolean) && !thursdayValid ? <p className="text-xs font-bold" style={{ color: ax("danger") }}>Välj fem unika torsdagar i stigande ordning.</p> : null}<p className="text-[10px]" style={{ color: ax("muted") }}>Första kvällen föreslår fem torsdagar med en vecka mellan. Varje konkret kväll kan därefter justeras; manuella ändringar skrivs inte över.</p><div className="grid grid-cols-2 gap-2 text-xs font-bold text-white"><div className="rounded-xl p-3" style={{ background: ax("surface") }}>18:00–20:00</div><div className="rounded-xl p-3" style={{ background: ax("surface") }}>18:00 + 19:00 · 50 min</div><div className="rounded-xl p-3" style={{ background: ax("surface") }}>6 lag · 2 spelare</div><div className="rounded-xl p-3" style={{ background: ax("surface") }}>2 matcher/lag/kväll</div></div></div></section>
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("lime") }}>Banor · exakt tre</p><div className="mt-3 grid grid-cols-2 gap-2">{(data?.courts || []).map((court: LeagueCourt) => { const selected = courtIds.includes(court.id); return <button key={court.id} type="button" onClick={() => setCourtIds((current) => selected ? current.filter((id) => id !== court.id) : current.length < 3 ? [...current, court.id] : current)} className="flex h-11 items-center justify-between rounded-xl px-3 text-xs font-bold" style={{ background: selected ? ax("lime", 0.12) : ax("surface"), border: `1px solid ${selected ? ax("lime") : ax("borderSoft")}`, color: "white" }}>{court.name}{selected ? <Check className="h-4 w-4" /> : null}</button>; })}</div><p className="mt-3 text-xs" style={{ color: ax("muted") }}>Alla fem kvällar reserverar de valda banorna 18:00–20:00 i samma Calendar/resource-system.</p></section>
    <section data-testid="league-resource-preflight" className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${preflightStatus === "conflict" || preflightStatus === "error" ? ax("danger", 0.55) : ax("borderSoft")}` }}>
      <div className="flex items-center justify-between gap-3"><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: preflightStatus === "clear" ? ax("lime") : preflightStatus === "conflict" ? ax("danger") : ax("electricSoft") }}>Banplan · fem kvällar</p>{preflightStatus === "not-ready" ? <p className="mt-1 text-xs" style={{ color: ax("muted") }}>Välj fem torsdagar och exakt tre banor för att kontrollera planen.</p> : null}{preflightStatus === "checking" ? <p className="mt-1 inline-flex items-center gap-2 text-xs font-bold" style={{ color: ax("electricSoft") }}><Loader2 className="h-3.5 w-3.5 animate-spin" />Kontrollerar banorna…</p> : null}{preflightStatus === "clear" ? <p className="mt-1 inline-flex items-center gap-2 text-xs font-black" style={{ color: ax("lime") }}><Check className="h-4 w-4" />Alla fem League-kvällar är fria</p> : null}{preflightStatus === "conflict" ? <div className="mt-1"><p className="text-sm font-black" style={{ color: ax("danger") }}>Banor behöver ändras</p><p className="text-xs" style={{ color: ax("muted") }}>Ändra datum eller banor. Kontrollen körs om automatiskt.</p></div> : null}{preflightStatus === "error" ? <div className="mt-1"><p className="text-sm font-black text-white">Banorna kunde inte kontrolleras</p><p className="text-xs" style={{ color: ax("muted") }}>Ingen ledighet har bekräftats. Försök igen innan Seriespelet skapas.</p></div> : null}</div>{preflightStatus === "error" ? <button type="button" onClick={() => void resourcePreview.refetch()} className="h-9 shrink-0 rounded-xl border px-3 text-xs font-black" style={{ borderColor: ax("electric"), color: ax("electricSoft") }}>Försök igen</button> : null}</div>
      {resourcePlan && !currentPreview && preflightStatus === "checking" ? <ol className="mt-3 grid gap-1.5">{dates.map((date) => <li key={date} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: ax("surface") }}><span className="font-bold text-white">{leagueNightLabel(date)}</span><Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ax("muted") }} /></li>)}</ol> : null}
      {currentPreview ? <ol className="mt-3 grid gap-2">{currentPreview.nights.map((night) => { const conflicts = night.courts.flatMap((court) => court.conflicts.map((conflict) => ({ courtName: court.court_name, ...conflict }))); return <li key={night.date} className="rounded-xl p-3" style={{ background: ax("surface"), border: `1px solid ${night.status === "conflict" ? ax("danger", 0.45) : ax("borderSoft")}` }}><div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-white">{leagueNightLabel(night.date)}</span>{night.status === "clear" ? <span aria-label={`${night.date} ledig`} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide" style={{ color: ax("lime") }}><Check className="h-3.5 w-3.5" />Ledig</span> : <span aria-label={`${night.date} konflikt`} className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide" style={{ color: ax("danger") }}><AlertTriangle className="h-3.5 w-3.5" />Konflikt</span>}</div>{conflicts.length ? <div className="mt-2 grid gap-2">{conflicts.map((conflict, index) => <div key={`${night.date}:${conflict.courtName}:${conflict.starts_at}:${index}`} className="text-xs"><p className="font-black" style={{ color: ax("danger") }}>{conflict.courtName} · upptagen {conflictTime(conflict.starts_at, conflict.ends_at)}</p><p className="mt-0.5 text-white">{conflict.owner_name || conflict.owner_label}{conflict.owner_name && conflict.owner_name !== conflict.owner_label ? <span style={{ color: ax("muted") }}> · {conflict.owner_label}</span> : null}</p></div>)}</div> : null}</li>; })}</ol> : null}
    </section>
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("sun") }}>Pris · lagplats</p><div className="mt-3 grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>Teampris · SEK<input value={basePrice} onChange={(event) => setBasePrice(event.target.value)} inputMode="numeric" className={inputClass} style={{ borderColor: ax("border") }} /></label><label className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>Moms · konfigurerad %<input value={vatRate} onChange={(event) => setVatRate(event.target.value)} inputMode="decimal" className={inputClass} style={{ borderColor: ax("border") }} /></label></div><label className="mt-4 flex items-center gap-2 text-sm font-bold text-white"><input type="checkbox" checked={earlyBird} onChange={(event) => setEarlyBird(event.target.checked)} /> Early Bird på teamnivå</label>{earlyBird ? <div className="mt-3 grid grid-cols-2 gap-3"><label className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>Teampris · SEK<input value={earlyBirdPrice} onChange={(event) => setEarlyBirdPrice(event.target.value)} inputMode="numeric" className={inputClass} style={{ borderColor: ax("border") }} /></label><label className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>Första N lag<input value={earlyBirdSlots} onChange={(event) => setEarlyBirdSlots(event.target.value)} inputMode="numeric" className={inputClass} style={{ borderColor: ax("border") }} /></label></div> : null}<p className="mt-3 text-xs" style={{ color: ax("muted") }}>Medlemspris och House Comp används inte för League V1.</p></section>
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Anmälan</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{[["Öppnar", registrationOpens, setRegistrationOpens], ["Deadline", registrationDeadline, setRegistrationDeadline], ["Schema senast", fixtureDeadline, setFixtureDeadline]].map(([label, value, setter]) => <label key={String(label)} className="grid gap-1 text-xs font-bold" style={{ color: ax("muted") }}>{String(label)}<input type="datetime-local" value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)} className={inputClass} style={{ borderColor: ax("border") }} /></label>)}</div><div className="mt-4 flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: ax("sun", 0.1), color: ax("sun") }}><AlertTriangle className="h-4 w-4 shrink-0" />Om sex lag inte är registrerade vid deadline ska personal ställa in säsongen och återbetala hela lagavgiften. Ingen automatisk formatändring.</div></section>
    <label className="flex items-center gap-3 rounded-2xl p-4 text-sm font-bold text-white" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /> Publicera och öppna försäljning direkt när fem sessions har skapats konfliktfritt</label>
    <button type="button" onClick={() => currentResourcePlanKey && create.mutate({ resourcePlanKey: currentResourcePlanKey })} disabled={!createEnabled} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Skapa Seriespel</button>
  </div>;
}

function TeamRow({ team, members, order, venueId, competitionStarted }: { team: LeagueAdminTeam; members: LeagueAdminMember[]; order?: LeagueAdminOrder; venueId: string; competitionStarted: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [teamName, setTeamName] = useState(team.team_name);
  const [playerName, setPlayerName] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [replacementReason, setReplacementReason] = useState("");
  const [replacementAdult, setReplacementAdult] = useState(false);
  const captain = members.find((member) => member.role === "captain");
  const player = members.find((member) => member.role === "player");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
  const rename = useMutation({ mutationFn: () => renameLeagueTeam({ team_entry_id: team.id, team_name: teamName, reason: "Moderering i League admin", request_id: crypto.randomUUID() }), onSuccess: async () => { setEditing(false); await refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const playerCustomer = Array.isArray(player?.customers) ? player?.customers[0] : player?.customers;
  const replace = useMutation({ mutationFn: () => replaceLeaguePlayer({ team_entry_id: team.id, player_name: playerName, player_email: playerEmail, reason: competitionStarted ? replacementReason : "", age_confirmed: replacementAdult, request_id: crypto.randomUUID() }), onSuccess: async () => { setPlayerName(""); setPlayerEmail(""); setReplacementReason(""); setReplacementAdult(false); await refresh(); toast.success("Spelare 2 är ersatt"); }, onError: (error: Error) => toast.error(error.message) });
  const replacementReady = Boolean(playerName && playerEmail && replacementAdult && (!competitionStarted || replacementReason.trim().length >= 10));
  return <article className="rounded-xl p-3" style={{ background: ax("surface"), border: `1px solid ${ax("borderSoft")}` }}><div className="flex items-start justify-between gap-3"><div className="min-w-0">{editing ? <div className="flex gap-2"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={40} className={inputClass} style={{ borderColor: ax("border") }} /><button type="button" onClick={() => rename.mutate()} className="rounded-lg px-3" style={{ background: ax("electric"), color: ax("ink") }}><Save className="h-4 w-4" /></button></div> : <h4 className="font-black text-white">{team.team_name}</h4>}<p className="mt-1 text-xs" style={{ color: ax("muted") }}>{captain ? customerName(captain) : "—"} · {player ? customerName(player) : "—"}</p><p className="mt-1 text-[10px]" style={{ color: ax("muted") }}>{playerCustomer?.primary_email || ""}</p></div><div className="flex items-center gap-2"><AxChip tone={order?.status === "paid" ? "lime" : order?.status === "attention" ? "sun" : "neutral"}>{order?.status === "paid" ? "BETALD" : String(order?.status || team.status).toUpperCase()}</AxChip><button type="button" onClick={() => setEditing((value) => !value)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: ax("surfaceHi"), color: "white" }}><Pencil className="h-3.5 w-3.5" /></button></div></div><details className="mt-3"><summary className="cursor-pointer text-[11px] font-bold" style={{ color: ax("electricSoft") }}>Korrigera spelare 2</summary><div className="mt-2 grid gap-2"><div className="grid gap-2 sm:grid-cols-2"><input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Nytt namn" className={inputClass} style={{ borderColor: ax("border") }} /><input value={playerEmail} onChange={(event) => setPlayerEmail(event.target.value)} placeholder="Ny e-post" className={inputClass} style={{ borderColor: ax("border") }} /></div>{competitionStarted ? <textarea value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} placeholder="Orsak krävs efter första slutförda match" rows={2} className="rounded-xl border bg-transparent p-3 text-sm text-white" style={{ borderColor: ax("border") }} /> : <p className="text-[10px]" style={{ color: ax("muted") }}>Före första slutförda match räcker standardproveniens.</p>}<label className="flex items-center gap-2 text-xs font-bold text-white"><input type="checkbox" checked={replacementAdult} onChange={(event) => setReplacementAdult(event.target.checked)} /> Jag bekräftar att den nya spelaren är 18+.</label><button type="button" onClick={() => replace.mutate()} disabled={!replacementReady || replace.isPending} className="h-10 rounded-xl px-4 text-xs font-black disabled:opacity-40" style={{ background: ax("sun"), color: ax("ink") }}>Ersätt spelare 2</button></div></details></article>;
}

function useLeagueAdminAction(venueId: string, seasonId: string, fn: (id: string) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fn(seasonId),
    onSuccess: async () => {
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function NightRescheduleRow({ venueId, session }: { venueId: string; session: LeagueAdminSession }) {
  const queryClient = useQueryClient();
  const [newDate, setNewDate] = useState(session.session_date || "");
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => rescheduleLeagueNight({
      league_night_session_id: session.id,
      new_date: newDate,
      reason,
      request_id: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      toast.success("League-kvällen och alla sex fixtures är ombokade");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const isThursday = DateTime.fromISO(newDate).weekday === 4;
  return <div className="grid gap-2 rounded-lg p-2 sm:grid-cols-[5rem_1fr_1fr_auto]" style={{ background: ax("surface") }}><p className="self-center text-xs font-black text-white">Kväll {session.series_occurrence_index}</p><input aria-label={`Nytt datum kväll ${session.series_occurrence_index}`} type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className={inputClass} style={{ borderColor: ax("border") }} /><input aria-label={`Orsak kväll ${session.series_occurrence_index}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Orsak krävs" className={inputClass} style={{ borderColor: ax("border") }} /><button type="button" onClick={() => mutation.mutate()} disabled={!reason.trim() || !isThursday || newDate === session.session_date || mutation.isPending} className="rounded-xl px-3 text-[10px] font-black disabled:opacity-40" style={{ background: ax("sun"), color: ax("ink") }}>Boka om</button></div>;
}

function LeagueArtworkEditor({ venueId, seasonId, series }: { venueId: string; seasonId: string; series: LeagueAdminSeries }) {
  const queryClient = useQueryClient();
  const [imageUrl, setImageUrl] = useState(series.image_urls?.[0] || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setImageUrl(series.image_urls?.[0] || ""), [series.image_urls]);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadNamedEventImage({ owner: "activity-series", ownerId: series.id, slot: 1, file });
      await updateLeagueArtwork(seasonId, [url]);
      setImageUrl(url);
      await queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
      toast.success("Seriespelsbilden är sparad");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bilden kunde inte laddas upp.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!imageUrl) return;
    setBusy(true);
    try {
      await updateLeagueArtwork(seasonId, []);
      await Promise.allSettled([removeNamedEventImage(imageUrl)]);
      setImageUrl("");
      await queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] });
      toast.success("Seriespelsbilden är borttagen");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bilden kunde inte tas bort.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="mt-4 rounded-xl p-3" style={{ background: ax("surface") }} data-testid="league-artwork-editor">
    <div className="flex items-start gap-3">
      {imageUrl ? <img src={imageUrl} alt="Seriespelsbild" className="aspect-video w-28 shrink-0 rounded-lg object-cover" /> : <div className="grid aspect-video w-28 shrink-0 place-items-center rounded-lg border border-dashed" style={{ borderColor: ax("border"), color: ax("muted") }}><ImagePlus className="h-5 w-5" /></div>}
      <div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">Omgångsbild · 16:9</p><p className="mt-1 text-[10px]" style={{ color: ax("muted") }}>Samma Series-bilduppladdning som Catalog.</p><div className="mt-2 flex flex-wrap gap-2"><label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-bold text-white" style={{ borderColor: ax("border") }}><ImagePlus className="h-3.5 w-3.5" />{busy ? "Laddar..." : imageUrl ? "Byt bild" : "Ladda upp bild"}<input aria-label="Byt League-bild" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} /></label>{imageUrl ? <button type="button" onClick={() => void remove()} disabled={busy} aria-label="Ta bort League-bild" className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40" style={{ borderColor: ax("border"), color: ax("danger") }}><Trash2 className="h-3.5 w-3.5" /></button> : null}</div></div>
    </div>
  </div>;
}

function ExistingLeague({ venueId, season, onDone }: { venueId: string; season: LeagueAdminSeason; onDone?: () => void }) {
  const series = activeSeries(season);
  const teamById = new Map((season.teams || []).map((team) => [team.id, team]));
  const publishOffer = useLeagueAdminAction(venueId, season.id, publishLeagueOffer, "Försäljningen är öppen");
  const generate = useLeagueAdminAction(venueId, season.id, generateLeagueFixtures, "Spelschemat är genererat för granskning");
  const publishFixtures = useLeagueAdminAction(venueId, season.id, publishLeagueFixtures, "Spelschemat är publicerat");
  const activeTeams = (season.teams || []).filter((team) => team.status === "active");
  const underfilled = new Date(series.registration_closes_at).getTime() < Date.now() && activeTeams.length < 6;
  const finalFixtureIds = new Set((season.results || []).filter((result) => result.state === "final").map((result) => result.fixture_id));
  return <div className="space-y-5"><section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><div className="flex items-start justify-between"><div><p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: ax("magenta") }}>Seriespel · Season 01</p><h3 className="mt-1 text-xl font-black text-white">{series.name}</h3><p className="mt-2 text-xs" style={{ color: ax("muted") }}>{DateTime.fromISO(series.start_date).setLocale("sv").toFormat("d LLL")}–{DateTime.fromISO(series.end_date).setLocale("sv").toFormat("d LLL")} · 18:00–20:00</p></div><AxChip tone={series.status === "active" ? "lime" : "sun"}>{series.status === "active" ? "PUBLICERAD" : "UTKAST"}</AxChip></div><LeagueArtworkEditor venueId={venueId} seasonId={season.id} series={series} /><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl p-3" style={{ background: ax("surface") }}><p className="text-2xl font-black text-white">{activeTeams.length}/6</p><p className="text-[10px]" style={{ color: ax("muted") }}>lag</p></div><div className="rounded-xl p-3" style={{ background: ax("surface") }}><p className="text-2xl font-black text-white">{season.sessions?.length || 0}/5</p><p className="text-[10px]" style={{ color: ax("muted") }}>League-kvällar</p></div><div className="rounded-xl p-3" style={{ background: ax("surface") }}><p className="text-2xl font-black text-white">{season.fixtures?.length || 0}/30</p><p className="text-[10px]" style={{ color: ax("muted") }}>fixtures</p></div></div>{underfilled ? <div className="mt-4 flex gap-2 rounded-xl p-3 text-xs font-bold" style={{ background: ax("danger", 0.12), color: ax("danger") }}><AlertTriangle className="h-4 w-4 shrink-0" />Deadline har passerat med {activeTeams.length}/6 lag. Besluta om inställning och full återbetalning. Ändra inte formatet.</div> : null}{series.status !== "active" ? <button type="button" onClick={() => publishOffer.mutate()} disabled={publishOffer.isPending} className="mt-4 h-11 w-full rounded-xl font-black" style={{ background: ax("lime"), color: ax("ink") }}>Publicera och öppna försäljning</button> : null}<details className="mt-4"><summary className="cursor-pointer text-[11px] font-bold" style={{ color: ax("sun") }}>Boka om en hel League-kväll</summary><div className="mt-2 grid gap-2">{(season.sessions || []).map((session) => <NightRescheduleRow key={session.id} venueId={venueId} session={session} />)}</div><p className="mt-2 text-[10px]" style={{ color: ax("muted") }}>Endast torsdagar. Resurskonflikter kontrolleras. Ombokning blockeras när resultat eller historisk närvaro finns.</p></details></section>
    <section><div className="mb-2 flex items-center gap-2"><Users className="h-4 w-4" style={{ color: ax("electricSoft") }} /><p className="text-sm font-black text-white">Lag · {activeTeams.length}/6</p></div><div className="grid gap-2">{(season.teams || []).map((team) => { const teamFixtureIds = new Set((season.fixtures || []).filter((fixture) => fixture.team_a_entry_id === team.id || fixture.team_b_entry_id === team.id).map((fixture) => fixture.id)); const competitionStarted = [...finalFixtureIds].some((fixtureId) => fixtureId && teamFixtureIds.has(fixtureId)); return <TeamRow key={team.id} venueId={venueId} team={team} members={(season.members || []).filter((member) => member.team_entry_id === team.id)} order={(season.orders || []).find((order) => order.id === team.commerce_order_id)} competitionStarted={competitionStarted} />; })}{!season.teams?.length ? <p className="rounded-xl p-4 text-center text-xs" style={{ background: ax("surfaceHi"), color: ax("muted") }}>Inga lag anmälda ännu.</p> : null}</div></section>
    <section className="rounded-2xl p-4" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" style={{ color: ax("lime") }} /><p className="text-sm font-black text-white">Spelschema</p></div>{season.fixtures?.length ? <div className="mt-4 grid gap-4">{[1,2,3,4,5].map((round) => <div key={round}><p className="text-xs font-black" style={{ color: ax("muted") }}>Torsdag {round}</p><div className="mt-2 grid gap-1">{(season.fixtures || []).filter((fixture) => fixture.round_number === round).map((fixture) => <div key={fixture.id} className="grid grid-cols-[3.5rem_1fr] gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: ax("surface") }}><span className="font-black" style={{ color: ax("electricSoft") }}>{DateTime.fromISO(fixture.scheduled_start_at).setZone("Europe/Stockholm").toFormat("HH:mm")}</span><span className="font-bold text-white">{teamById.get(fixture.team_a_entry_id)?.team_name} – {teamById.get(fixture.team_b_entry_id)?.team_name}</span></div>)}</div></div>)}</div> : <p className="mt-3 text-xs" style={{ color: ax("muted") }}>När exakt sex betalda lag finns kan det deterministiska K6-schemat genereras.</p>}<div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => generate.mutate()} disabled={activeTeams.length !== 6 || Boolean(season.fixtures_published_at) || generate.isPending} className="h-11 rounded-xl text-xs font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>{season.fixtures?.length ? "Regenerera före publicering" : "Generera spelschema"}</button><button type="button" onClick={() => publishFixtures.mutate()} disabled={season.fixtures?.length !== 30 || Boolean(season.fixtures_published_at) || !season.validation?.valid || publishFixtures.isPending} className="h-11 rounded-xl text-xs font-black disabled:opacity-40" style={{ background: ax("lime"), color: ax("ink") }}>{season.fixtures_published_at ? "Publicerat" : "Publicera spelschema"}</button></div>{season.validation && season.fixtures?.length ? <p className="mt-2 text-[10px] font-bold" style={{ color: season.validation.valid ? ax("lime") : ax("danger") }}>{season.validation.valid ? "30 fixtures validerade: 10/lag, 2/par, 6/kväll, 3/block, inga returmöten samma kväll." : "Schemat klarar inte full validering och kan inte publiceras."}</p> : null}</section>
    <button type="button" onClick={onDone} className="h-11 w-full rounded-xl text-sm font-black" style={{ background: ax("surfaceHi"), color: "white" }}>Tillbaka till Catalog</button>
  </div>;
}

export default function AdminLeague({ venueId, leagueSeasonId, onDone }: Props) {
  const query = useQuery({ queryKey: ["admin-leagues", venueId], queryFn: () => fetchLeagueAdmin(venueId) });
  if (query.isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: ax("muted") }} /></div>;
  const season = leagueSeasonId ? query.data?.seasons.find((item) => item.id === leagueSeasonId || item.activity_series_id === leagueSeasonId) : null;
  return season ? <ExistingLeague venueId={venueId} season={season} onDone={onDone} /> : <CreateLeague venueId={venueId} onDone={onDone} />;
}
