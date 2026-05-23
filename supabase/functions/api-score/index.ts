/* eslint-disable @typescript-eslint/no-explicit-any */
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

type MatchRow = Record<string, any>;
type TurnRow = Record<string, any>;

const INVALID_DART_TOTALS = new Set([179, 178, 176, 175, 173, 172, 169]);

function cleanName(value: unknown, fallback: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return (name || fallback).slice(0, 60);
}

function parseBestOf(value: unknown) {
  const best = Number(value || 1);
  return [1, 3, 5].includes(best) ? best : 1;
}

function requiredLegs(bestOfLegs: number) {
  return Math.floor(bestOfLegs / 2) + 1;
}

function validScore(score: number) {
  return Number.isInteger(score) && score >= 0 && score <= 180 && !INVALID_DART_TOTALS.has(score);
}

function switchPlayer(player: number) {
  return player === 1 ? 2 : 1;
}

function eventTitle(type: string, match: MatchRow, score?: number) {
  const player = match.current_player === 1 ? match.player1_name : match.player2_name;
  if (type === 'ONE_EIGHTY') return `${player} kastar 180`;
  if (type === 'HIGH_CHECKOUT') return `${player} checkout ${score}`;
  if (type === 'CHECKOUT') return `${player} tar legget`;
  if (type === 'LAST_LEG') return `${match.player1_name} vs ${match.player2_name} till avgörande leg`;
  if (type === 'MATCH_FINISHED') return `${player} vinner matchen`;
  if (type === 'PLAYER_ON_FINISH') return `${player} står på finish`;
  if (type === 'MATCH_STARTED') return `${match.player1_name} vs ${match.player2_name} startar`;
  if (type === 'UNDO') return `Undo på ${match.player1_name} vs ${match.player2_name}`;
  return `${match.player1_name} vs ${match.player2_name} uppdaterad`;
}

async function createScoreEvent(client: any, match: MatchRow, eventType: string, payload: Record<string, any> = {}, priority = 1) {
  await client.from('score_events').insert({
    score_session_id: match.score_session_id,
    match_id: match.id,
    venue_court_id: match.venue_court_id,
    event_type: eventType,
    title: eventTitle(eventType, match, payload.score),
    message: payload.message || null,
    priority,
    payload: {
      board: payload.board,
      score: payload.score,
      player: match.current_player === 1 ? match.player1_name : match.player2_name,
      player1: match.player1_name,
      player2: match.player2_name,
      player1_legs: match.player1_legs,
      player2_legs: match.player2_legs,
      ...payload,
    },
  });
}

function applyTurn(state: MatchRow, turn: TurnRow) {
  if (state.status === 'completed') return state;
  const player = Number(turn.player_number);
  const score = Number(turn.score);
  const before = player === 1 ? state.player1_remaining : state.player2_remaining;
  const after = before - score;
  const isBust = score > before || after === 1;
  const isCheckout = after === 0 && !isBust;

  if (!isBust) {
    if (player === 1) state.player1_remaining = after;
    else state.player2_remaining = after;
  }

  if (isCheckout) {
    if (player === 1) state.player1_legs += 1;
    else state.player2_legs += 1;

    if (state.player1_legs >= requiredLegs(state.best_of_legs) || state.player2_legs >= requiredLegs(state.best_of_legs)) {
      state.status = 'completed';
      state.winner_player_id = player === 1 ? state.player1_id : state.player2_id;
      state.winner_name = player === 1 ? state.player1_name : state.player2_name;
      state.completed_at = new Date().toISOString();
    } else {
      state.current_leg += 1;
      state.player1_remaining = 501;
      state.player2_remaining = 501;
      state.leg_starting_player = switchPlayer(state.leg_starting_player);
      state.current_player = state.leg_starting_player;
    }
  } else {
    state.current_player = switchPlayer(player);
  }

  state.last_score = score;
  state.last_event_type = isCheckout ? 'CHECKOUT' : isBust ? 'BUST' : 'MATCH_UPDATED';
  return state;
}

async function recomputeMatch(client: any, match: MatchRow) {
  const { data: turns, error } = await client
    .from('score_turns')
    .select('*')
    .eq('match_id', match.id)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const state: MatchRow = {
    ...match,
    status: 'in_progress',
    current_leg: 1,
    player1_legs: 0,
    player2_legs: 0,
    player1_remaining: 501,
    player2_remaining: 501,
    current_player: match.starting_player || 1,
    leg_starting_player: match.starting_player || 1,
    winner_player_id: null,
    winner_name: null,
    completed_at: null,
    last_score: null,
    last_event_type: null,
  };

  for (const turn of turns || []) applyTurn(state, turn);

  const updates = {
    status: state.status,
    current_leg: state.current_leg,
    player1_legs: state.player1_legs,
    player2_legs: state.player2_legs,
    player1_remaining: state.player1_remaining,
    player2_remaining: state.player2_remaining,
    current_player: state.current_player,
    leg_starting_player: state.leg_starting_player,
    winner_player_id: state.winner_player_id,
    winner_name: state.winner_name,
    completed_at: state.completed_at,
    last_score: state.last_score,
    last_event_type: state.last_event_type,
  };

  const { data, error: updateErr } = await client
    .from('score_matches')
    .update(updates)
    .eq('id', match.id)
    .select('*')
    .single();
  if (updateErr) throw new Error(updateErr.message);
  return data;
}

async function getDevice(client: any, token: string) {
  const { data, error } = await client
    .from('display_devices')
    .select('*, venue_courts(id, name, court_number, sport_type, venue_id), venues(id, name, slug)')
    .eq('device_token', token)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function assertDeviceCanScore(client: any, matchId: string, deviceToken?: string) {
  const { data: match, error } = await client
    .from('score_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!match) throw new Error('Matchen hittades inte');
  if (match.status === 'completed') throw new Error('Matchen är redan avslutad');

  if (deviceToken) {
    const device = await getDevice(client, deviceToken);
    if (!device) throw new Error('Paddan hittades inte');
    if (match.display_device_id && match.display_device_id !== device.id) throw new Error('Fel padda för matchen');
    if (match.venue_court_id && device.venue_court_id && match.venue_court_id !== device.venue_court_id) {
      throw new Error('Fel tavla för matchen');
    }
  }

  return match;
}

async function liveState(client: any, scoreSessionId: string) {
  const { data: session, error: sessionErr } = await client
    .from('score_sessions')
    .select('*, events(id, name, display_name), venues(id, name, slug)')
    .eq('id', scoreSessionId)
    .maybeSingle();
  if (sessionErr) throw new Error(sessionErr.message);
  if (!session) throw new Error('Score session hittades inte');

  const { data: matches, error: matchErr } = await client
    .from('score_matches')
    .select('*, venue_courts(id, name, court_number, sport_type)')
    .eq('score_session_id', scoreSessionId)
    .order('status')
    .order('updated_at', { ascending: false });
  if (matchErr) throw new Error(matchErr.message);

  const { data: events, error: eventErr } = await client
    .from('score_events')
    .select('*, venue_courts(id, name, court_number, sport_type)')
    .eq('score_session_id', scoreSessionId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (eventErr) throw new Error(eventErr.message);

  return { session, matches: matches || [], events: events || [] };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop() || '';
  const admin = getServiceClient();

  try {
    if (req.method === 'GET' && path === 'device-state') {
      const token = url.searchParams.get('device');
      if (!token) return errorResponse('Missing device token');
      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);

      const { data: courts } = await admin
        .from('venue_courts')
        .select('id, name, court_number, sport_type')
        .eq('venue_id', device.venue_id)
        .eq('sport_type', 'dart')
        .eq('is_available', true)
        .order('court_number');

      const { data: activeMatch } = await admin
        .from('score_matches')
        .select('*')
        .eq('display_device_id', device.id)
        .eq('status', 'in_progress')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return jsonResponse({ device, venue: device.venues, resource: device.venue_courts, courts: courts || [], activeMatch }, 200, 3);
    }

    if (req.method === 'GET' && path === 'live-state') {
      const scoreSessionId = url.searchParams.get('scoreSessionId');
      if (!scoreSessionId) return errorResponse('Missing scoreSessionId');
      return jsonResponse(await liveState(admin, scoreSessionId), 200, 2);
    }

    if (req.method === 'GET' && path === 'match') {
      const matchId = url.searchParams.get('matchId');
      if (!matchId) return errorResponse('Missing matchId');
      const { data: match, error } = await admin
        .from('score_matches')
        .select('*, score_sessions(id, name, status), venue_courts(id, name, court_number, sport_type)')
        .eq('id', matchId)
        .maybeSingle();
      if (error) return errorResponse(error.message);
      if (!match) return errorResponse('Matchen hittades inte', 404);
      const { data: turns } = await admin
        .from('score_turns')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false })
        .limit(20);
      return jsonResponse({ match, turns: turns || [] }, 200, 2);
    }

    if (req.method === 'POST' && path === 'walk-in') {
      const body = await req.json();
      const token = String(body.device_token || body.device || '');
      if (!token) return errorResponse('Missing device token');

      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);
      const defaultCourtId = device.venue_court_id;
      const courtIds = Array.isArray(body.court_ids) && body.court_ids.length
        ? body.court_ids.map(String)
        : defaultCourtId ? [defaultCourtId] : [];
      if (!courtIds.length) return errorResponse('Ingen darttavla vald');

      const { data: courts, error: courtsErr } = await admin
        .from('venue_courts')
        .select('id, name, court_number, sport_type, venue_id')
        .in('id', courtIds)
        .eq('venue_id', device.venue_id)
        .eq('sport_type', 'dart');
      if (courtsErr) return errorResponse(courtsErr.message);
      if ((courts || []).length !== courtIds.length) return errorResponse('En vald tavla hittades inte');

      const { data: session, error: sessionErr } = await admin
        .from('score_sessions')
        .insert({
          venue_id: device.venue_id,
          session_type: 'walk_in',
          sport_type: 'dart',
          name: body.name ? String(body.name).slice(0, 80) : 'Walk-in darts',
          status: 'live',
          game_type: '501',
          best_of_legs: parseBestOf(body.best_of_legs),
          created_from_device_id: device.id,
          started_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (sessionErr) return errorResponse(sessionErr.message);

      const matchInputs = Array.isArray(body.matches) ? body.matches : [];
      const createdMatches = [];
      const { data: devicesForCourts } = await admin
        .from('display_devices')
        .select('id, venue_court_id')
        .eq('venue_id', device.venue_id)
        .eq('is_active', true)
        .in('venue_court_id', courtIds);

      for (let index = 0; index < courtIds.length; index++) {
        const court = (courts || []).find((c: any) => c.id === courtIds[index]);
        const input = matchInputs.find((m: any) => m.court_id === courtIds[index]) || {};
        const p1Name = cleanName(input.player1_name || body.player1_name, 'Spelare 1');
        const p2Name = cleanName(input.player2_name || body.player2_name, 'Spelare 2');
        const courtDevice = (devicesForCourts || []).find((d: any) => d.venue_court_id === courtIds[index]);

        const { data: p1, error: p1Err } = await admin
          .from('score_players')
          .insert({ score_session_id: session.id, display_name: p1Name, seed: index * 2 + 1 })
          .select('id')
          .single();
        if (p1Err) return errorResponse(p1Err.message);

        const { data: p2, error: p2Err } = await admin
          .from('score_players')
          .insert({ score_session_id: session.id, display_name: p2Name, seed: index * 2 + 2 })
          .select('id')
          .single();
        if (p2Err) return errorResponse(p2Err.message);

        const { data: match, error: matchErr } = await admin
          .from('score_matches')
          .insert({
            score_session_id: session.id,
            venue_id: device.venue_id,
            venue_court_id: courtIds[index],
            display_device_id: courtDevice?.id || (courtIds[index] === defaultCourtId ? device.id : null),
            match_type: 'walk_in',
            status: 'in_progress',
            match_number: index + 1,
            player1_id: p1.id,
            player2_id: p2.id,
            player1_name: p1Name,
            player2_name: p2Name,
            game_type: '501',
            best_of_legs: parseBestOf(body.best_of_legs),
            started_at: new Date().toISOString(),
            metadata: { source: 'device_walk_in', started_from_device_token: token },
          })
          .select('*, venue_courts(id, name, court_number, sport_type)')
          .single();
        if (matchErr) return errorResponse(matchErr.message);
        await createScoreEvent(admin, { ...match, current_player: 1 }, 'MATCH_STARTED', { board: court?.court_number }, 2);
        createdMatches.push(match);
      }

      return jsonResponse({ session, matches: createdMatches, match: createdMatches[0] }, 201);
    }

    if (req.method === 'POST' && path === 'score') {
      const body = await req.json();
      const matchId = String(body.match_id || '');
      const score = Number(body.score);
      const dartsUsed = Number(body.darts_used || 3);
      if (!matchId) return errorResponse('Missing match_id');
      if (!validScore(score)) return errorResponse('Ogiltig score');
      if (![1, 2, 3].includes(dartsUsed)) return errorResponse('Ogiltigt antal pilar');

      const match = await assertDeviceCanScore(admin, matchId, body.device_token);
      const player = match.current_player;
      const before = player === 1 ? match.player1_remaining : match.player2_remaining;
      const after = before - score;
      const isBust = score > before || after === 1;
      const isCheckout = after === 0 && !isBust;

      const { data: turn, error: turnErr } = await admin
        .from('score_turns')
        .insert({
          score_session_id: match.score_session_id,
          match_id: match.id,
          venue_court_id: match.venue_court_id,
          leg_number: match.current_leg,
          player_number: player,
          player_id: player === 1 ? match.player1_id : match.player2_id,
          score,
          remaining_before: before,
          remaining_after: isBust ? before : Math.max(after, 0),
          is_bust: isBust,
          is_checkout: isCheckout,
          darts_used: dartsUsed,
        })
        .select('*')
        .single();
      if (turnErr) return errorResponse(turnErr.message);

      const state = applyTurn({ ...match }, turn);
      const { data: updated, error: updateErr } = await admin
        .from('score_matches')
        .update({
          status: state.status,
          current_leg: state.current_leg,
          player1_legs: state.player1_legs,
          player2_legs: state.player2_legs,
          player1_remaining: state.player1_remaining,
          player2_remaining: state.player2_remaining,
          current_player: state.current_player,
          leg_starting_player: state.leg_starting_player,
          winner_player_id: state.winner_player_id,
          winner_name: state.winner_name,
          completed_at: state.completed_at,
          last_score: score,
          last_event_type: state.last_event_type,
        })
        .eq('id', match.id)
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (updateErr) return errorResponse(updateErr.message);

      const board = updated.venue_courts?.court_number;
      if (score === 180 && !isBust) await createScoreEvent(admin, match, 'ONE_EIGHTY', { score, board }, 5);
      if (isCheckout && score >= 100) await createScoreEvent(admin, match, 'HIGH_CHECKOUT', { score, board }, 5);
      else if (isCheckout) await createScoreEvent(admin, match, 'CHECKOUT', { score, board }, 4);
      if (!isBust && !isCheckout && after <= 170) await createScoreEvent(admin, match, 'PLAYER_ON_FINISH', { score, board, remaining: after }, 3);
      const need = requiredLegs(match.best_of_legs);
      if (updated.status !== 'completed' && updated.player1_legs === need - 1 && updated.player2_legs === need - 1) {
        await createScoreEvent(admin, updated, 'LAST_LEG', { board }, 4);
      }
      if (updated.status === 'completed') await createScoreEvent(admin, updated, 'MATCH_FINISHED', { score, board }, 6);
      else await createScoreEvent(admin, updated, isBust ? 'BUST' : 'MATCH_UPDATED', { score, board }, isBust ? 2 : 1);

      return jsonResponse({ match: updated, turn });
    }

    if (req.method === 'POST' && path === 'undo') {
      const body = await req.json();
      const matchId = String(body.match_id || '');
      if (!matchId) return errorResponse('Missing match_id');
      const match = await assertDeviceCanScore(admin, matchId, body.device_token);

      const { data: lastTurn, error: turnErr } = await admin
        .from('score_turns')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (turnErr) return errorResponse(turnErr.message);
      if (!lastTurn) return errorResponse('Inget att ångra');

      const { error: deleteErr } = await admin.from('score_turns').delete().eq('id', lastTurn.id);
      if (deleteErr) return errorResponse(deleteErr.message);
      const updated = await recomputeMatch(admin, match);
      await createScoreEvent(admin, updated, 'UNDO', { score: lastTurn.score }, 2);
      return jsonResponse({ match: updated });
    }

    if (req.method === 'POST' && path === 'event-session') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);
      const body = await req.json();
      const eventId = String(body.event_id || '');
      const venueId = String(body.venue_id || '');
      if (!venueId) return errorResponse('Missing venue_id');

      const { data: session, error: sessionErr } = await client
        .from('score_sessions')
        .insert({
          venue_id: venueId,
          event_id: eventId || null,
          session_type: 'event',
          sport_type: 'dart',
          name: cleanName(body.name, 'Darttävling'),
          status: 'draft',
          game_type: '501',
          best_of_legs: parseBestOf(body.best_of_legs || 3),
          created_by: userId,
        })
        .select('*')
        .single();
      if (sessionErr) return errorResponse(sessionErr.message);
      return jsonResponse({ session }, 201);
    }

    return errorResponse('Not found', 404);
  } catch (e) {
    return errorResponse((e as Error).message, 500);
  }
});
