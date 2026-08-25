import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { AlertTriangle, Check, ChevronDown, Loader2, Trophy, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import {
  fetchLeagueOperations,
  postponeLeagueFixture,
  rescheduleLeagueFixture,
  saveLeagueResult,
  type LeagueAdminMember,
  type LeagueFixture,
  type LeagueFixtureResult,
  type LeagueOperationsProjection,
} from "@/lib/league";
import { isValidLeagueV1SetScore } from "@/lib/leagueRules";
import { ax } from "@/components/admin/shell/axTheme";
import { AxSectionLabel } from "@/components/admin/shell/axPrimitives";

function relatedResult(fixture: LeagueFixture): LeagueFixtureResult | null {
  const value = fixture.league_fixture_results;
  return (Array.isArray(value) ? value[0] : value) || null;
}

function FixtureCard({ fixture, data, venueId, date }: { fixture: LeagueFixture; data: LeagueOperationsProjection; venueId: string; date: string }) {
  const queryClient = useQueryClient();
  const result = relatedResult(fixture);
  const teamA = data.teams.find((team) => team.id === fixture.team_a_entry_id);
  const teamB = data.teams.find((team) => team.id === fixture.team_b_entry_id);
  const court = data.courts.find((item) => item.id === fixture.venue_court_id);
  const savedScores = result?.outcome_type === "played" && result.sets?.length
    ? result.sets.flatMap((set) => [String(set.team_a), String(set.team_b)])
    : [];
  const initialScores = [...savedScores, ...Array(Math.max(6 - savedScores.length, 0)).fill("")].slice(0, 6);
  const [scores, setScores] = useState(initialScores);
  const [expanded, setExpanded] = useState(!result || result.state !== "final");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("18:00");
  const [rescheduleCourtId, setRescheduleCourtId] = useState(fixture.venue_court_id);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (result?.outcome_type === "played") {
      const next = result.sets.flatMap((set) => [String(set.team_a), String(set.team_b)]);
      setScores([...next, ...Array(Math.max(6 - next.length, 0)).fill("")].slice(0, 6));
    }
  }, [result]);
  const refresh = async () => {
    requestId.current = crypto.randomUUID();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["league-operations", venueId, date] }),
      queryClient.invalidateQueries({ queryKey: ["admin-leagues", venueId] }),
    ]);
  };
  const save = useMutation({
    mutationFn: (walkoverWinner?: string) => saveLeagueResult({
      fixture_id: fixture.id,
      state: "final",
      outcome_type: walkoverWinner ? "walkover" : "played",
      sets: walkoverWinner ? [] : [0, 1, 2].map((index) => ({ team_a: Number(scores[index * 2]), team_b: Number(scores[index * 2 + 1]) })),
      walkover_winner_team_id: walkoverWinner || null,
      expected_version: result?.version || 0,
      request_id: requestId.current,
    }),
    onSuccess: async () => { toast.success(result ? "Resultatet är korrigerat" : "Resultatet är sparat"); setExpanded(false); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const completedSets = [0, 1, 2].flatMap((index) => {
    const teamA = scores[index * 2];
    const teamB = scores[index * 2 + 1];
    return teamA !== "" && teamB !== "" && isValidLeagueV1SetScore(Number(teamA), Number(teamB))
      ? [{ team_a: Number(teamA), team_b: Number(teamB) }]
      : [];
  });
  const saveIncomplete = useMutation({
    mutationFn: () => saveLeagueResult({
      fixture_id: fixture.id,
      state: "incomplete",
      outcome_type: "played",
      sets: completedSets,
      walkover_winner_team_id: null,
      expected_version: result?.version || 0,
      request_id: requestId.current,
    }),
    onSuccess: async () => { toast.success("Matchen är sparad som ofärdig"); setExpanded(false); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const postpone = useMutation({ mutationFn: () => postponeLeagueFixture(fixture.id, "Manuellt uppskjuten i Operations"), onSuccess: async () => { toast.success("Matchen är markerad som uppskjuten"); await refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const reschedule = useMutation({
    mutationFn: () => rescheduleLeagueFixture({
      fixture_id: fixture.id,
      scheduled_start_at: DateTime.fromISO(`${rescheduleDate}T${rescheduleTime}`, { zone: "Europe/Stockholm" }).toUTC().toISO(),
      venue_court_id: rescheduleCourtId,
      reason: rescheduleReason,
      request_id: crypto.randomUUID(),
    }),
    onSuccess: async () => { toast.success("Ny matchtid är reserverad i Calendar"); await refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const complete = [0, 1, 2].every((index) => isValidLeagueV1SetScore(Number(scores[index * 2]), Number(scores[index * 2 + 1])));
  const members = (teamId: string) => data.members.filter((member) => member.team_entry_id === teamId);
  const checked = (member: LeagueAdminMember) => data.checkins.some((checkin) => checkin.customer_id === member.customer_id)
    || data.registrations.some((registration) => registration.league_team_member_id === member.id && registration.status === "checked_in");
  const name = (member: LeagueAdminMember) => { const customer = Array.isArray(member.customers) ? member.customers[0] : member.customers; return customer?.display_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Spelare"; };
  return <article className="overflow-hidden rounded-xl" style={{ background: ax("surfaceHi"), border: `1px solid ${ax("borderSoft")}` }}><button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-start gap-3 p-3 text-left"><div className="w-14 shrink-0"><p className="font-mono text-xs font-black" style={{ color: ax("electricSoft") }}>{DateTime.fromISO(fixture.scheduled_start_at).setZone("Europe/Stockholm").toFormat("HH:mm")}</p><p className="mt-1 text-[10px]" style={{ color: ax("muted") }}>{court?.name || "Bana"}</p></div><div className="min-w-0 flex-1"><p className="font-bold text-white">{teamA?.team_name} <span style={{ color: ax("muted") }}>vs</span> {teamB?.team_name}</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">{[...members(fixture.team_a_entry_id), ...members(fixture.team_b_entry_id)].map((member) => <p key={member.id} className="flex items-center gap-1 text-[10px]" style={{ color: checked(member) ? ax("lime") : ax("muted") }}>{checked(member) ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}{name(member)}</p>)}</div></div><div className="flex shrink-0 items-center gap-2">{result?.state === "final" ? <span className="rounded-md px-2 py-1 text-[10px] font-black" style={{ background: ax("lime", 0.12), color: ax("lime") }}>{result.outcome_type === "walkover" ? "WO" : result.sets.map((set) => `${set.team_a}–${set.team_b}`).join(" · ")}</span> : result?.state === "incomplete" ? <span className="text-[10px] font-black" style={{ color: ax("sun") }}>OFÄRDIG</span> : fixture.status === "postponed" ? <span className="text-[10px] font-black" style={{ color: ax("sun") }}>UPPSKJUTEN</span> : null}<ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} style={{ color: ax("muted") }} /></div></button>{expanded ? <div className="border-t p-3" style={{ borderColor: ax("borderSoft") }}><div className="grid grid-cols-[3rem_1fr_1fr] gap-2 text-center"><span /> <span className="truncate text-[10px] font-bold text-white">{teamA?.team_name}</span><span className="truncate text-[10px] font-bold text-white">{teamB?.team_name}</span>{[0,1,2].map((index) => <div className="contents" key={index}><span className="self-center text-[10px] font-black" style={{ color: ax("muted") }}>SET {index + 1}</span><input aria-label={`Set ${index + 1} ${teamA?.team_name}`} value={scores[index * 2]} onChange={(event) => setScores((current) => current.map((value, scoreIndex) => scoreIndex === index * 2 ? event.target.value : value))} inputMode="numeric" className="h-10 rounded-lg border bg-transparent text-center font-black text-white" style={{ borderColor: ax("border") }} /><input aria-label={`Set ${index + 1} ${teamB?.team_name}`} value={scores[index * 2 + 1]} onChange={(event) => setScores((current) => current.map((value, scoreIndex) => scoreIndex === index * 2 + 1 ? event.target.value : value))} inputMode="numeric" className="h-10 rounded-lg border bg-transparent text-center font-black text-white" style={{ borderColor: ax("border") }} /></div>)}</div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => saveIncomplete.mutate()} disabled={completedSets.length >= 3 || saveIncomplete.isPending} className="h-11 rounded-xl text-xs font-black disabled:opacity-40" style={{ background: ax("sun", 0.16), color: ax("sun") }}>Spara ofärdig</button><button type="button" onClick={() => save.mutate(undefined)} disabled={!complete || save.isPending} className="flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-40" style={{ background: ax("lime"), color: ax("ink") }}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{result ? "Spara korrigering" : "Spara resultat"}</button></div><details className="mt-2"><summary className="cursor-pointer text-center text-[10px] font-bold" style={{ color: ax("muted") }}>Walkover eller uppskjuten match</summary><div className="mt-2 grid grid-cols-3 gap-2"><button type="button" onClick={() => save.mutate(fixture.team_a_entry_id)} className="rounded-lg p-2 text-[10px] font-black" style={{ background: ax("surface"), color: "white" }}>WO {teamA?.team_name}</button><button type="button" onClick={() => save.mutate(fixture.team_b_entry_id)} className="rounded-lg p-2 text-[10px] font-black" style={{ background: ax("surface"), color: "white" }}>WO {teamB?.team_name}</button><button type="button" onClick={() => postpone.mutate()} className="rounded-lg p-2 text-[10px] font-black" style={{ background: ax("sun", 0.15), color: ax("sun") }}>Skjut upp</button></div>{fixture.status === "postponed" ? <div className="mt-3 grid gap-2 rounded-xl p-3" style={{ background: ax("surface") }}><p className="text-[10px] font-black text-white">Ny konfliktkontrollerad tid</p><div className="grid grid-cols-2 gap-2"><input aria-label="Nytt datum" type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} className="h-10 rounded-lg border bg-transparent px-2 text-xs text-white" style={{ borderColor: ax("border") }} /><input aria-label="Ny tid" type="time" value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)} className="h-10 rounded-lg border bg-transparent px-2 text-xs text-white" style={{ borderColor: ax("border") }} /></div><select aria-label="Ny bana" value={rescheduleCourtId} onChange={(event) => setRescheduleCourtId(event.target.value)} className="h-10 rounded-lg border bg-transparent px-2 text-xs text-white" style={{ borderColor: ax("border") }}>{data.courts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="Orsak till ombokning" value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} placeholder="Orsak (krävs)" className="h-10 rounded-lg border bg-transparent px-2 text-xs text-white" style={{ borderColor: ax("border") }} /><button type="button" onClick={() => reschedule.mutate()} disabled={!rescheduleDate || !rescheduleCourtId || !rescheduleReason.trim() || reschedule.isPending} className="h-10 rounded-lg text-[10px] font-black disabled:opacity-40" style={{ background: ax("electric"), color: ax("ink") }}>Reservera ny tid</button></div> : null}</details><p className="mt-3 text-[10px] leading-relaxed" style={{ color: ax("muted") }}>Tre fulla set krävs för final. Som ofärdig sparas endast färdigspelade set och matchen påverkar inte tabellen. Walkover ger 3–0 League-poäng utan syntetiska set.</p></div> : null}</article>;
}

export function LeagueOperationsPanel({ venueId }: { venueId: string }) {
  const date = DateTime.now().setZone("Europe/Stockholm").toISODate()!;
  const query = useQuery({ queryKey: ["league-operations", venueId, date], queryFn: () => fetchLeagueOperations(venueId, date), refetchInterval: 30_000 });
  const data = query.data;
  const blocks = useMemo(() => [1, 2].map((block) => ({ block, fixtures: (data?.fixtures || []).filter((fixture) => fixture.block_number === block) })), [data?.fixtures]);
  if (query.isLoading) return <section><AxSectionLabel icon={Trophy} accent={ax("magenta")}>Seriespel · idag</AxSectionLabel><div className="mt-2 flex justify-center rounded-xl p-5" style={{ background: ax("surfaceHi") }}><Loader2 className="h-4 w-4 animate-spin" style={{ color: ax("muted") }} /></div></section>;
  if (!data?.nights?.length) return null;
  return <section className="space-y-2" data-testid="league-operations"><AxSectionLabel icon={Trophy} accent={ax("magenta")}>Seriespel · ikväll</AxSectionLabel><div className="rounded-xl p-3 text-xs" style={{ background: ax("magenta", 0.08), border: `1px solid ${ax("magenta", 0.25)}`, color: ax("muted") }}><p className="font-black text-white">{data.nights[0].name}</p><p className="mt-1">Närvaro är människor via befintlig check-in. Matchresultat är lagdata och sparas separat.</p></div>{blocks.map(({ block, fixtures }) => <div key={block} className="space-y-2"><p className="px-1 font-mono text-[10px] font-black" style={{ color: ax("magenta") }}>{block === 1 ? "18:00" : "19:00"}</p>{fixtures.map((fixture) => <FixtureCard key={fixture.id} fixture={fixture} data={data} venueId={venueId} date={date} />)}</div>)}{data.fixtures.some((fixture) => fixture.status === "postponed") ? <p className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: ax("sun", 0.1), color: ax("sun") }}><AlertTriangle className="h-4 w-4 shrink-0" />Uppskjutna matcher påverkar inte tabellen. Ny tid/bana hanteras manuellt och konfliktkontrollerat.</p> : null}</section>;
}
