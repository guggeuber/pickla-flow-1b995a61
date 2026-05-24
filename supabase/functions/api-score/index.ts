/* eslint-disable @typescript-eslint/no-explicit-any */
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getAuthenticatedClient, getServiceClient } from '../_shared/auth.ts';

type MatchRow = Record<string, any>;
type TurnRow = Record<string, any>;
type PlayerSlot = {
  number: number;
  id: string | null;
  auth_user_id?: string | null;
  name: string;
  legs: number;
  remaining: number;
};

const INVALID_DART_TOTALS = new Set([179, 178, 176, 175, 173, 172, 169]);
const GAME_TYPES = new Set(['301', '501', '701']);
const CHECKOUT_RULES = new Set(['single_out', 'double_out']);

function cleanName(value: unknown, fallback: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return (name || fallback).slice(0, 60);
}

function parseBestOf(value: unknown) {
  const best = Number(value || 1);
  return [1, 3, 5].includes(best) ? best : 1;
}

function parseGameType(value: unknown) {
  const game = String(value || '501');
  return GAME_TYPES.has(game) ? game : '501';
}

function targetScore(gameType: string) {
  return Number(parseGameType(gameType));
}

function parseCheckoutRule(value: unknown) {
  const rule = String(value || 'double_out');
  return CHECKOUT_RULES.has(rule) ? rule : 'double_out';
}

function requiredLegs(bestOfLegs: number) {
  return Math.floor(bestOfLegs / 2) + 1;
}

function validScore(score: number) {
  return Number.isInteger(score) && score >= 0 && score <= 180 && !INVALID_DART_TOTALS.has(score);
}

function nextPlayerNumber(current: number, playerCount: number) {
  return current >= playerCount ? 1 : current + 1;
}

function slotsFromMatch(match: MatchRow): PlayerSlot[] {
  const raw = Array.isArray(match.player_slots) ? match.player_slots : [];
  if (raw.length) {
    return raw.map((slot: any, index: number) => ({
      number: Number(slot.number || index + 1),
      id: slot.id || null,
      auth_user_id: slot.auth_user_id || null,
      name: cleanName(slot.name, `Spelare ${index + 1}`),
      legs: Number(slot.legs || 0),
      remaining: Number(slot.remaining ?? match.target_score ?? targetScore(match.game_type)),
    }));
  }
  return [
    {
      number: 1,
      id: match.player1_id || null,
      auth_user_id: null,
      name: cleanName(match.player1_name, 'Spelare 1'),
      legs: Number(match.player1_legs || 0),
      remaining: Number(match.player1_remaining ?? match.target_score ?? targetScore(match.game_type)),
    },
    {
      number: 2,
      id: match.player2_id || null,
      auth_user_id: null,
      name: cleanName(match.player2_name, 'Spelare 2'),
      legs: Number(match.player2_legs || 0),
      remaining: Number(match.player2_remaining ?? match.target_score ?? targetScore(match.game_type)),
    },
  ];
}

function mirrorFromSlots(state: MatchRow, slots: PlayerSlot[]) {
  const first = slots[0];
  const second = slots[1] || slots[0];
  state.player_slots = slots;
  state.player1_id = first?.id || state.player1_id || null;
  state.player2_id = second?.id || state.player2_id || null;
  state.player1_name = first?.name || state.player1_name || 'Spelare 1';
  state.player2_name = second?.name || state.player2_name || 'Spelare 2';
  state.player1_legs = first?.legs || 0;
  state.player2_legs = second?.legs || 0;
  state.player1_remaining = first?.remaining ?? state.target_score ?? targetScore(state.game_type);
  state.player2_remaining = second?.remaining ?? state.target_score ?? targetScore(state.game_type);
  return state;
}

function parsePicklaUserId(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'pickla_user' && parsed.uid) return String(parsed.uid);
  } catch {
    // Fall back to raw UUID below.
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

async function resolvePlayerProfile(client: any, userId: string) {
  const { data: profile, error } = await client
    .from('player_profiles')
    .select('auth_user_id, display_name, avatar_url, phone')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile) {
    return {
      user_id: profile.auth_user_id,
      display_name: cleanName(profile.display_name, 'Pickla spelare'),
      avatar_url: profile.avatar_url || null,
      phone: profile.phone || null,
    };
  }
  const authUser = await client.auth.admin.getUserById(userId);
  if (authUser.error || !authUser.data?.user) return null;
  const emailName = authUser.data.user.email?.split('@')[0] || 'Pickla spelare';
  return {
    user_id: authUser.data.user.id,
    display_name: cleanName(authUser.data.user.user_metadata?.display_name || emailName, 'Pickla spelare'),
    avatar_url: authUser.data.user.user_metadata?.avatar_url || null,
    phone: authUser.data.user.phone || null,
  };
}

function currentSlot(match: MatchRow) {
  const slots = slotsFromMatch(match);
  return slots.find((slot) => slot.number === Number(match.current_player)) || slots[0];
}

function playerIdForNumber(match: MatchRow, playerNumber: number) {
  const slot = slotsFromMatch(match).find((item) => item.number === playerNumber);
  if (slot?.id) return slot.id;
  if (playerNumber === 1) return match.player1_id || null;
  if (playerNumber === 2) return match.player2_id || null;
  return null;
}

async function assertDeviceOwnsMatch(client: any, match: MatchRow, deviceToken?: string) {
  if (!deviceToken) return;
  const device = await getDevice(client, deviceToken);
  if (!device) throw new Error('Paddan hittades inte');
  if (match.display_device_id && match.display_device_id !== device.id) throw new Error('Fel padda för matchen');
  if (match.venue_court_id && device.venue_court_id && match.venue_court_id !== device.venue_court_id) {
    throw new Error('Fel tavla för matchen');
  }
}

function eventTitle(type: string, match: MatchRow, score?: number) {
  const player = currentSlot(match)?.name || match.player1_name;
  if (type === 'ONE_EIGHTY') return `${player} kastar 180`;
  if (type === 'HIGH_CHECKOUT') return `${player} checkout ${score}`;
  if (type === 'CHECKOUT') return `${player} tar legget`;
  if (type === 'LAST_LEG') return `${match.player1_name} vs ${match.player2_name} till avgörande leg`;
  if (type === 'MATCH_FINISHED') return `${player} vinner matchen`;
  if (type === 'PLAYER_ON_FINISH') return `${player} står på finish`;
  if (type === 'MATCH_STARTED') return `${match.player1_name} vs ${match.player2_name} startar`;
  if (type === 'MATCH_ENDED') return `${match.player1_name} vs ${match.player2_name} avslutad`;
  if (type === 'UNDO') return `Undo på ${match.player1_name} vs ${match.player2_name}`;
  return `${match.player1_name} vs ${match.player2_name} uppdaterad`;
}

async function createScoreEvent(client: any, match: MatchRow, eventType: string, payload: Record<string, any> = {}, priority = 1) {
  const active = currentSlot(match);
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
      player: active?.name || match.player1_name,
      player1: match.player1_name,
      player2: match.player2_name,
      players: slotsFromMatch(match).map((slot) => slot.name),
      player1_legs: match.player1_legs,
      player2_legs: match.player2_legs,
      ...payload,
    },
  });
}

function applyTurn(state: MatchRow, turn: TurnRow) {
  if (state.status === 'completed') return state;
  const target = Number(state.target_score || targetScore(state.game_type));
  const slots = slotsFromMatch(state);
  const player = Number(turn.player_number);
  const score = Number(turn.score);
  const slot = slots.find((s) => s.number === player) || slots[0];
  const before = slot.remaining;
  const after = before - score;
  const checkoutRule = parseCheckoutRule(state.checkout_rule);
  const isBust = score > before || (checkoutRule === 'double_out' && after === 1);
  const isCheckout = after === 0 && !isBust;

  if (!isBust) {
    slot.remaining = after;
  }

  if (isCheckout) {
    slot.legs += 1;

    if (slot.legs >= requiredLegs(state.best_of_legs)) {
      state.status = 'completed';
      state.winner_player_id = slot.id;
      state.winner_name = slot.name;
      state.completed_at = new Date().toISOString();
    } else {
      state.current_leg += 1;
      slots.forEach((s) => {
        s.remaining = target;
      });
      state.leg_starting_player = nextPlayerNumber(state.leg_starting_player, slots.length);
      state.current_player = state.leg_starting_player;
    }
  } else {
    state.current_player = nextPlayerNumber(player, slots.length);
  }

  state.last_score = score;
  state.last_event_type = isCheckout ? 'CHECKOUT' : isBust ? 'BUST' : 'MATCH_UPDATED';
  return mirrorFromSlots(state, slots);
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
    player1_remaining: match.target_score || targetScore(match.game_type),
    player2_remaining: match.target_score || targetScore(match.game_type),
    current_player: match.starting_player || 1,
    leg_starting_player: match.starting_player || 1,
    target_score: match.target_score || targetScore(match.game_type),
    checkout_rule: match.checkout_rule || 'double_out',
    player_slots: slotsFromMatch(match).map((slot) => ({
      ...slot,
      legs: 0,
      remaining: match.target_score || targetScore(match.game_type),
    })),
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
    player_slots: state.player_slots,
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

  await assertDeviceOwnsMatch(client, match, deviceToken);

  return match;
}

async function liveState(client: any, scoreSessionId: string) {
  let resolvedSessionId = scoreSessionId;
  const { data: initialSession, error: sessionErr } = await client
    .from('score_sessions')
    .select('*, events(id, name, display_name), venues(id, name, slug)')
    .eq('id', resolvedSessionId)
    .maybeSingle();
  let session = initialSession;
  if (sessionErr) throw new Error(sessionErr.message);
  if (!session) {
    const { data: matchById, error: matchLookupErr } = await client
      .from('score_matches')
      .select('score_session_id')
      .eq('id', scoreSessionId)
      .maybeSingle();
    if (matchLookupErr) throw new Error(matchLookupErr.message);
    if (matchById?.score_session_id) {
      resolvedSessionId = matchById.score_session_id;
      const retry = await client
        .from('score_sessions')
        .select('*, events(id, name, display_name), venues(id, name, slug)')
        .eq('id', resolvedSessionId)
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      session = retry.data;
    }
  }
  if (!session) throw new Error('Score session hittades inte');

  const { data: matches, error: matchErr } = await client
    .from('score_matches')
    .select('*, venue_courts(id, name, court_number, sport_type)')
    .eq('score_session_id', resolvedSessionId)
    .order('status')
    .order('updated_at', { ascending: false });
  if (matchErr) throw new Error(matchErr.message);

  const { data: events, error: eventErr } = await client
    .from('score_events')
    .select('*, venue_courts(id, name, court_number, sport_type)')
    .eq('score_session_id', resolvedSessionId)
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
      return jsonResponse(await liveState(admin, scoreSessionId));
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
        .limit(500);
      return jsonResponse({ match, turns: turns || [] });
    }

    if (req.method === 'GET' && path === 'event-session') {
      const { client, error } = await getAuthenticatedClient(req);
      if (error || !client) return errorResponse(error || 'Unauthorized', 401);
      const eventId = url.searchParams.get('eventId');
      const venueId = url.searchParams.get('venueId');
      if (!eventId && !venueId) return errorResponse('Missing eventId or venueId');
      let query = client
        .from('score_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      if (eventId) query = query.eq('event_id', eventId);
      if (venueId) query = query.eq('venue_id', venueId);
      const { data, error: sessionErr } = await query.maybeSingle();
      if (sessionErr) return errorResponse(sessionErr.message);
      return jsonResponse({ session: data || null }, 200, 5);
    }

    if (req.method === 'GET' && path === 'join-state') {
      const token = url.searchParams.get('device') || '';
      const setupId = url.searchParams.get('setupId') || '';
      if (!token) return errorResponse('Missing device token');
      if (!setupId) return errorResponse('Missing setupId');
      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);
      const { data: links, error: linkErr } = await admin
        .from('score_player_links')
        .select('slot_number, auth_user_id, display_name, avatar_url, updated_at')
        .eq('display_device_id', device.id)
        .eq('setup_id', setupId)
        .gt('expires_at', new Date().toISOString())
        .order('slot_number');
      if (linkErr) return errorResponse(linkErr.message);
      return jsonResponse({ players: links || [] }, 200, 2);
    }

    if (req.method === 'GET' && path === 'my-stats') {
      const { client, userId, error } = await getAuthenticatedClient(req);
      if (error || !client || !userId) return errorResponse(error || 'Unauthorized', 401);

      const { data: players, error: playerErr } = await client
        .from('score_players')
        .select('id, display_name, created_at')
        .eq('auth_user_id', userId);
      if (playerErr) return errorResponse(playerErr.message);
      const playerIds = (players || []).map((player: any) => player.id);
      if (!playerIds.length) {
        return jsonResponse({
          matches_played: 0,
          wins: 0,
          turns: 0,
          darts: 0,
          scored: 0,
          average: 0,
          high_score: 0,
          one_eighties: 0,
          checkouts: 0,
          high_checkout: 0,
          recent_matches: [],
        }, 200, 20);
      }

      const { data: turns, error: turnErr } = await client
        .from('score_turns')
        .select('id, match_id, player_id, score, is_bust, is_checkout, darts_used, created_at')
        .in('player_id', playerIds)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (turnErr) return errorResponse(turnErr.message);

      const turnRows = turns || [];
      const playedMatchIds = Array.from(new Set(turnRows.map((turn: any) => turn.match_id).filter(Boolean)));
      const { data: wonMatches, error: winsErr } = await client
        .from('score_matches')
        .select('id, winner_player_id')
        .in('winner_player_id', playerIds)
        .eq('status', 'completed');
      if (winsErr) return errorResponse(winsErr.message);
      const matchIds = Array.from(new Set([...playedMatchIds, ...((wonMatches || []).map((match: any) => match.id))]));
      const { data: matches, error: matchErr } = matchIds.length
        ? await client
          .from('score_matches')
          .select('id, status, winner_player_id, winner_name, game_type, target_score, checkout_rule, best_of_legs, player1_id, player2_id, player1_name, player2_name, player1_legs, player2_legs, player_slots, completed_at, started_at, venue_courts(name, court_number)')
          .in('id', matchIds)
          .order('started_at', { ascending: false })
          .limit(50)
        : { data: [], error: null };
      if (matchErr) return errorResponse(matchErr.message);

      const scoredTurns = turnRows.map((turn: any) => turn.is_bust ? 0 : Number(turn.score || 0));
      const scored = scoredTurns.reduce((sum: number, score: number) => sum + score, 0);
      const darts = turnRows.reduce((sum: number, turn: any) => sum + Number(turn.darts_used || 3), 0);
      const checkouts = turnRows.filter((turn: any) => turn.is_checkout);
      const highCheckout = checkouts.reduce((high: number, turn: any) => Math.max(high, Number(turn.score || 0)), 0);
      const wins = (matches || []).filter((match: any) => playerIds.includes(match.winner_player_id)).length;

      return jsonResponse({
        matches_played: matchIds.length,
        wins,
        turns: turnRows.length,
        darts,
        scored,
        average: turnRows.length ? scored / turnRows.length : 0,
        high_score: scoredTurns.reduce((high: number, score: number) => Math.max(high, score), 0),
        one_eighties: scoredTurns.filter((score: number) => score === 180).length,
        checkouts: checkouts.length,
        high_checkout: highCheckout,
        recent_matches: (matches || []).slice(0, 10).map((match: any) => {
          const slots = Array.isArray(match.player_slots) ? match.player_slots : [];
          const linkedSlot = slots.find((slot: any) => playerIds.includes(slot.id));
          const playerName = linkedSlot?.name ||
            (playerIds.includes(match.player1_id) ? match.player1_name : playerIds.includes(match.player2_id) ? match.player2_name : null);
          const opponentNames = slots.length
            ? slots.filter((slot: any) => slot.id !== linkedSlot?.id).map((slot: any) => slot.name).filter(Boolean)
            : [match.player1_name, match.player2_name].filter((name: string) => name && name !== playerName);
          return {
            id: match.id,
            status: match.status,
            game_type: match.game_type,
            target_score: match.target_score,
            checkout_rule: match.checkout_rule,
            best_of_legs: match.best_of_legs,
            started_at: match.started_at,
            completed_at: match.completed_at,
            winner_player_id: match.winner_player_id,
            winner_name: match.winner_name,
            player_name: playerName,
            opponent_names: opponentNames,
            player1_name: match.player1_name,
            player2_name: match.player2_name,
            player1_legs: match.player1_legs,
            player2_legs: match.player2_legs,
            won: playerIds.includes(match.winner_player_id),
            court: match.venue_courts || null,
          };
        }),
      }, 200, 20);
    }

    if (req.method === 'POST' && path === 'walk-in') {
      const body = await req.json();
      const token = String(body.device_token || body.device || '');
      if (!token) return errorResponse('Missing device token');

      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);
      const defaultCourtId = device.venue_court_id;
      const requestedCourtIds = Array.isArray(body.court_ids) && body.court_ids.length
        ? body.court_ids.map(String)
        : defaultCourtId ? [defaultCourtId] : [];
      const courtIds = body.allow_multi_board === true ? requestedCourtIds : defaultCourtId ? [defaultCourtId] : requestedCourtIds.slice(0, 1);
      if (!courtIds.length) return errorResponse('Ingen darttavla vald');
      const gameType = parseGameType(body.game_type);
      const target = targetScore(gameType);
      const checkoutRule = parseCheckoutRule(body.checkout_rule);
      const inputNames = Array.isArray(body.player_names)
        ? body.player_names.map((name: unknown, index: number) => cleanName(name, `Spelare ${index + 1}`)).filter(Boolean).slice(0, 4)
        : [];
      const inputUsers = Array.isArray(body.player_users) ? body.player_users.map((id: unknown) => id ? String(id) : null).slice(0, 4) : [];
      const defaultNames = inputNames.length >= 2 ? inputNames : [
        cleanName(body.player1_name, 'Spelare 1'),
        cleanName(body.player2_name, 'Spelare 2'),
      ];

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
          game_type: gameType,
          best_of_legs: parseBestOf(body.best_of_legs),
          settings: {
            checkout_rule: checkoutRule,
            in_rule: 'straight_in',
            player_count: defaultNames.length,
          },
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
        const matchNames = Array.isArray(input.player_names)
          ? input.player_names.map((name: unknown, playerIndex: number) => cleanName(name, `Spelare ${playerIndex + 1}`)).filter(Boolean).slice(0, 4)
          : defaultNames;
        const matchUsers = Array.isArray(input.player_users) ? input.player_users.map((id: unknown) => id ? String(id) : null).slice(0, 4) : inputUsers;
        const normalizedNames = matchNames.length >= 2 ? matchNames : ['Spelare 1', 'Spelare 2'];
        const courtDevice = (devicesForCourts || []).find((d: any) => d.venue_court_id === courtIds[index]);

        const playerSlots = [];
        for (let playerIndex = 0; playerIndex < normalizedNames.length; playerIndex++) {
          const { data: playerRow, error: playerErr } = await admin
            .from('score_players')
            .insert({
              score_session_id: session.id,
              auth_user_id: matchUsers[playerIndex] || null,
              display_name: normalizedNames[playerIndex],
              seed: index * 8 + playerIndex + 1,
            })
            .select('id')
            .single();
          if (playerErr) return errorResponse(playerErr.message);
          playerSlots.push({
            number: playerIndex + 1,
            id: playerRow.id,
            auth_user_id: matchUsers[playerIndex] || null,
            name: normalizedNames[playerIndex],
            legs: 0,
            remaining: target,
          });
        }

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
            player1_id: playerSlots[0]?.id,
            player2_id: playerSlots[1]?.id,
            player1_name: playerSlots[0]?.name || 'Spelare 1',
            player2_name: playerSlots[1]?.name || 'Spelare 2',
            game_type: gameType,
            target_score: target,
            checkout_rule: checkoutRule,
            in_rule: 'straight_in',
            best_of_legs: parseBestOf(body.best_of_legs),
            player1_remaining: target,
            player2_remaining: target,
            player_slots: playerSlots,
            started_at: new Date().toISOString(),
            metadata: {
              source: 'device_walk_in',
              started_from_device_token: token,
              player_count: playerSlots.length,
              checkout_rule: checkoutRule,
            },
          })
          .select('*, venue_courts(id, name, court_number, sport_type)')
          .single();
        if (matchErr) return errorResponse(matchErr.message);
        await createScoreEvent(admin, { ...match, current_player: 1 }, 'MATCH_STARTED', { board: court?.court_number }, 2);
        createdMatches.push(match);
      }

      return jsonResponse({ session, matches: createdMatches, match: createdMatches[0] }, 201);
    }

    if (req.method === 'POST' && path === 'join-player') {
      const { userId, error } = await getAuthenticatedClient(req);
      if (error || !userId) return errorResponse(error || 'Unauthorized', 401);
      const body = await req.json();
      const token = String(body.device_token || body.device || '');
      const setupId = String(body.setup_id || '').trim();
      const slotNumber = Number(body.slot_number);
      if (!token) return errorResponse('Missing device token');
      if (!setupId) return errorResponse('Missing setup_id');
      if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > 7) return errorResponse('Ogiltig spelarslot');

      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);
      const player = await resolvePlayerProfile(admin, userId);
      if (!player?.user_id) return errorResponse('Användaren hittades inte', 404);

      const { data: link, error: linkErr } = await admin
        .from('score_player_links')
        .upsert({
          setup_id: setupId,
          display_device_id: device.id,
          venue_id: device.venue_id,
          slot_number: slotNumber,
          auth_user_id: player.user_id,
          display_name: player.display_name,
          avatar_url: player.avatar_url || null,
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'setup_id,display_device_id,slot_number' })
        .select('slot_number, auth_user_id, display_name, avatar_url, updated_at')
        .single();
      if (linkErr) return errorResponse(linkErr.message);
      return jsonResponse({ player: link }, 200, 2);
    }

    if (req.method === 'POST' && path === 'resolve-player') {
      const body = await req.json();
      const token = String(body.device_token || body.device || '');
      if (!token) return errorResponse('Missing device token');
      const device = await getDevice(admin, token);
      if (!device) return errorResponse('Paddan hittades inte', 404);
      const userId = parsePicklaUserId(body.qr_payload || body.user_id || body.uid);
      if (!userId) return errorResponse('Ogiltig QR-kod');
      const player = await resolvePlayerProfile(admin, userId);
      if (!player?.user_id) return errorResponse('Användaren hittades inte', 404);
      return jsonResponse({ player }, 200, 5);
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
      const activeSlot = currentSlot(match);
      const before = activeSlot?.remaining ?? match.player1_remaining;
      const after = before - score;
      const checkoutRule = parseCheckoutRule(match.checkout_rule);
      const isBust = score > before || (checkoutRule === 'double_out' && after === 1);
      const isCheckout = after === 0 && !isBust;

      const { data: turn, error: turnErr } = await admin
        .from('score_turns')
        .insert({
          score_session_id: match.score_session_id,
          match_id: match.id,
          venue_court_id: match.venue_court_id,
          leg_number: match.current_leg,
          player_number: player,
          player_id: playerIdForNumber(match, player),
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
          player_slots: state.player_slots,
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
      const slots = slotsFromMatch(updated);
      const lastLegReady = slots.length === 2
        ? slots.every((slot) => slot.legs === need - 1)
        : slots.filter((slot) => slot.legs === need - 1).length >= 2;
      if (updated.status !== 'completed' && lastLegReady) {
        await createScoreEvent(admin, updated, 'LAST_LEG', { board }, 4);
      }
      if (updated.status === 'completed') await createScoreEvent(admin, updated, 'MATCH_FINISHED', { score, board }, 6);
      else await createScoreEvent(admin, updated, isBust ? 'BUST' : 'MATCH_UPDATED', { score, board }, isBust ? 2 : 1);

      return jsonResponse({ match: updated, turn });
    }

    if (req.method === 'POST' && path === 'end-match') {
      const body = await req.json();
      const matchId = String(body.match_id || '');
      if (!matchId) return errorResponse('Missing match_id');
      const match = await assertDeviceCanScore(admin, matchId, body.device_token);
      const { data: updated, error: updateErr } = await admin
        .from('score_matches')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          last_event_type: 'MATCH_ENDED',
        })
        .eq('id', match.id)
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (updateErr) return errorResponse(updateErr.message);
      await createScoreEvent(admin, updated, 'MATCH_ENDED', { board: updated.venue_courts?.court_number }, 2);
      return jsonResponse({ match: updated });
    }

    if (req.method === 'POST' && path === 'rematch') {
      const body = await req.json();
      const matchId = String(body.match_id || '');
      if (!matchId) return errorResponse('Missing match_id');

      const { data: match, error: matchErr } = await admin
        .from('score_matches')
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .eq('id', matchId)
        .maybeSingle();
      if (matchErr) return errorResponse(matchErr.message);
      if (!match) return errorResponse('Matchen hittades inte', 404);
      await assertDeviceOwnsMatch(admin, match, body.device_token);
      if (!['completed', 'cancelled'].includes(match.status)) return errorResponse('Avsluta matchen först');

      const target = Number(match.target_score || targetScore(match.game_type));
      const oldSlots = slotsFromMatch(match);
      const newStartingPlayer = nextPlayerNumber(Number(match.starting_player || 1), oldSlots.length);
      const newSlots = oldSlots.map((slot) => ({
        ...slot,
        legs: 0,
        remaining: target,
      }));

      const { data: latestMatch } = await admin
        .from('score_matches')
        .select('match_number')
        .eq('score_session_id', match.score_session_id)
        .order('match_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: rematch, error: rematchErr } = await admin
        .from('score_matches')
        .insert({
          score_session_id: match.score_session_id,
          venue_id: match.venue_id,
          event_id: match.event_id || null,
          venue_court_id: match.venue_court_id,
          display_device_id: match.display_device_id,
          match_type: match.match_type || 'walk_in',
          status: 'in_progress',
          round_label: match.round_label || null,
          match_number: Number(latestMatch?.match_number || match.match_number || 0) + 1,
          player1_id: newSlots[0]?.id || null,
          player2_id: newSlots[1]?.id || null,
          player1_name: newSlots[0]?.name || match.player1_name,
          player2_name: newSlots[1]?.name || match.player2_name,
          game_type: match.game_type || '501',
          best_of_legs: match.best_of_legs || 1,
          target_score: target,
          checkout_rule: match.checkout_rule || 'double_out',
          in_rule: match.in_rule || 'straight_in',
          current_leg: 1,
          player1_legs: 0,
          player2_legs: 0,
          player1_remaining: target,
          player2_remaining: target,
          current_player: newStartingPlayer,
          starting_player: newStartingPlayer,
          leg_starting_player: newStartingPlayer,
          player_slots: newSlots,
          started_at: new Date().toISOString(),
          metadata: {
            ...(match.metadata || {}),
            rematch_of: match.id,
          },
        })
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (rematchErr) return errorResponse(rematchErr.message);

      await createScoreEvent(admin, rematch, 'MATCH_STARTED', { board: rematch.venue_courts?.court_number }, 2);
      return jsonResponse({ match: rematch }, 201);
    }

    if (req.method === 'POST' && path === 'correct-last-turn') {
      const body = await req.json();
      const matchId = String(body.match_id || '');
      const score = Number(body.score);
      const dartsUsed = Number(body.darts_used || 3);
      if (!matchId) return errorResponse('Missing match_id');
      if (!validScore(score)) return errorResponse('Ogiltig score');
      if (![1, 2, 3].includes(dartsUsed)) return errorResponse('Ogiltigt antal pilar');

      const { data: match, error: matchErr } = await admin
        .from('score_matches')
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .eq('id', matchId)
        .maybeSingle();
      if (matchErr) return errorResponse(matchErr.message);
      if (!match) return errorResponse('Matchen hittades inte', 404);
      await assertDeviceOwnsMatch(admin, match, body.device_token);

      const { data: lastTurn, error: lastTurnErr } = await admin
        .from('score_turns')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTurnErr) return errorResponse(lastTurnErr.message);
      if (!lastTurn) return errorResponse('Inget att ändra');

      const { error: deleteErr } = await admin.from('score_turns').delete().eq('id', lastTurn.id);
      if (deleteErr) return errorResponse(deleteErr.message);

      const baseMatch = await recomputeMatch(admin, match);
      if (baseMatch.status === 'completed') return errorResponse('Matchen är redan avslutad');

      const player = baseMatch.current_player;
      const activeSlot = currentSlot(baseMatch);
      const before = activeSlot?.remaining ?? baseMatch.player1_remaining;
      const after = before - score;
      const checkoutRule = parseCheckoutRule(baseMatch.checkout_rule);
      const isBust = score > before || (checkoutRule === 'double_out' && after === 1);
      const isCheckout = after === 0 && !isBust;

      const { data: turn, error: turnErr } = await admin
        .from('score_turns')
        .insert({
          score_session_id: baseMatch.score_session_id,
          match_id: baseMatch.id,
          venue_court_id: baseMatch.venue_court_id,
          leg_number: baseMatch.current_leg,
          player_number: player,
          player_id: playerIdForNumber(baseMatch, player),
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

      const state = applyTurn({ ...baseMatch }, turn);
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
          player_slots: state.player_slots,
          winner_player_id: state.winner_player_id,
          winner_name: state.winner_name,
          completed_at: state.completed_at,
          last_score: score,
          last_event_type: state.last_event_type,
        })
        .eq('id', baseMatch.id)
        .select('*, venue_courts(id, name, court_number, sport_type)')
        .single();
      if (updateErr) return errorResponse(updateErr.message);

      const board = updated.venue_courts?.court_number;
      await createScoreEvent(admin, updated, 'CORRECTION', { score, board, removed_score: lastTurn.score }, 3);
      if (updated.status === 'completed') await createScoreEvent(admin, updated, 'MATCH_FINISHED', { score, board }, 6);

      return jsonResponse({ match: updated, turn, removed_turn_id: lastTurn.id });
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
