import { type Card, isCard, secureRng } from '../engine/cards';
import {
  type ActionResult,
  type GameState,
  aiStep,
  gamePass,
  gamePlay,
  leaders,
  newGame,
  redealHand,
  seatsToAct,
  turnKey,
} from '../engine/game';
import { type DealSpec, RuleError, legalPlays } from '../engine/hand';
import { PRESETS, type PresetId, parseCardList, presetSpec } from '../engine/presets';
import { type GameSettings, MAX_PLAYERS, MIN_PLAYERS, normalizeSettings, passCycle, passLabel } from '../engine/rules';
import type { HandRecord } from '../engine/scoring';
import { summarizeHand, tableViewFor } from '../engine/view';
import type { DevSettings, DevView, GameAction, GameListItem, GameMode, GameStatus, GameView } from '../types';
import { avatarSrc } from '../avatars';
import { GAME_NAME_MAX, clipToLength } from '../names';
import { now, sql, transaction } from './db';
import { onlineUsers, subscribers } from './hub';

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface GameRecord {
  id: string;
  name: string;
  ownerId: number;
  joinCode: string;
  status: GameStatus;
  mode: GameMode;
  settings: GameSettings;
  dev: DevSettings;
  state: GameState | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SeatedPlayer {
  seat: number;
  userId: number;
  username: string;
  displayName: string;
  isBot: boolean;
  /** The person's profile photo, if they have one. */
  avatarId: string | null;
}

/** A seated player's photo URL. The cats never have one. */
const playerAvatar = (p: SeatedPlayer) => (p.isBot ? null : avatarSrc(p.avatarId));

interface GameRow {
  id: string;
  name: string;
  owner_id: number;
  join_code: string;
  status: GameStatus;
  mode: string;
  settings: string;
  dev: string | null;
  state: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const DEFAULT_DEV: DevSettings = { botMode: 'auto', speed: 'normal' };

function normalizeDev(raw: Partial<Record<keyof DevSettings, unknown>> | null | undefined): DevSettings {
  return {
    botMode: raw?.botMode === 'manual' ? 'manual' : 'auto',
    speed: raw?.speed === 'fast' || raw?.speed === 'slow' ? raw.speed : 'normal',
  };
}

const toRecord = (r: GameRow): GameRecord => ({
  id: r.id,
  name: r.name,
  ownerId: r.owner_id,
  joinCode: r.join_code,
  status: r.status,
  mode: r.mode === 'playtest' ? 'playtest' : 'normal',
  settings: normalizeSettings(JSON.parse(r.settings)),
  dev: normalizeDev(r.dev ? JSON.parse(r.dev) : null),
  state: r.state ? (JSON.parse(r.state) as GameState) : null,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[secureRng(alphabet.length)];
  return out;
}
const newGameId = () => randomString('abcdefghijkmnpqrstuvwxyz23456789', 10);
const newJoinCode = () => randomString('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export function loadGame(id: string): GameRecord | null {
  const row = sql('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
  return row ? toRecord(row) : null;
}

export function getPlayers(gameId: string): SeatedPlayer[] {
  const rows = sql(
    `SELECT gp.seat, u.id AS user_id, u.username, u.display_name, u.is_bot, u.avatar_id
     FROM game_players gp JOIN users u ON u.id = gp.user_id
     WHERE gp.game_id = ? ORDER BY gp.seat`,
  ).all(gameId) as { seat: number; user_id: number; username: string; display_name: string; is_bot: number; avatar_id: string | null }[];
  return rows.map((r) => ({
    seat: r.seat,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    isBot: !!r.is_bot,
    avatarId: r.is_bot ? null : r.avatar_id,
  }));
}

/** Restart the move timer whenever the turn moves on (or when `force` is set). */
function touchClock(state: GameState | null, force = false) {
  if (!state) return;
  const key = turnKey(state);
  if (force || state.turnKey !== key || state.turnSince === undefined) {
    state.turnKey = key;
    state.turnSince = now();
  }
}

/** Seats played by the computer: the cats, plus anyone a cat is sitting in for. */
function autoSeat(game: GameRecord, players: SeatedPlayer[]): (seat: number) => boolean {
  return (seat) => !!players[seat]?.isBot || !!game.state?.autopilot?.[seat];
}

/** When the move timer runs out for the seats on turn (null if there's no timer running). */
function moveDeadline(game: GameRecord, players: SeatedPlayer[]): number | null {
  const state = game.state;
  if (!game.settings.moveTimer || game.status !== 'active' || !state?.hand || state.turnSince === undefined) return null;
  // At a playtest table with the computer players on manual, the owner drives every seat: no clock.
  if (game.mode === 'playtest' && game.dev.botMode === 'manual') return null;
  const auto = autoSeat(game, players);
  if (!seatsToAct(state).some((s) => !auto(s))) return null;
  return state.turnSince + game.settings.moveTimer * 1000;
}

function setAutopilot(game: GameRecord, seat: number, on: boolean) {
  const state = game.state;
  if (!state) return;
  const list = state.autopilot ?? Array.from({ length: state.numPlayers }, () => false);
  list[seat] = on;
  state.autopilot = list;
}

function saveGame(game: GameRecord) {
  touchClock(game.state);
  game.updatedAt = now();
  sql(
    `UPDATE games SET name = ?, status = ?, settings = ?, dev = ?, state = ?, version = version + 1,
       updated_at = ?, started_at = ?, finished_at = ? WHERE id = ?`,
  ).run(
    game.name,
    game.status,
    JSON.stringify(game.settings),
    JSON.stringify(game.dev),
    game.state ? JSON.stringify(game.state) : null,
    game.updatedAt,
    game.startedAt,
    game.finishedAt,
    game.id,
  );
  game.version += 1;
}

export function isMember(gameId: string, userId: number): boolean {
  return !!sql('SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?').get(gameId, userId);
}

/** Insert a game row with its owner in seat 0. Call inside a transaction. */
function insertGame(ownerId: number, name: string, settings: GameSettings, mode: GameMode): string {
  const id = newGameId();
  let code = newJoinCode();
  while (sql('SELECT 1 FROM games WHERE join_code = ?').get(code)) code = newJoinCode();
  const t = now();
  sql(
    'INSERT INTO games (id, name, owner_id, join_code, status, mode, settings, dev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, ownerId, code, 'lobby', mode, JSON.stringify(settings), JSON.stringify(DEFAULT_DEV), t, t);
  sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, 0, ?)').run(id, ownerId, t);
  return id;
}

export function createGame(ownerId: number, name: string, settings: GameSettings): string {
  return transaction(() => insertGame(ownerId, name, settings, 'normal'));
}

/** A solo sandbox: the owner plus computer players, dealt and started right away. */
export function createPlaytest(ownerId: number, name: string, settings: GameSettings, playerCount: number): string {
  const count = playerCount === 5 ? 5 : 4;
  return transaction(() => {
    const id = insertGame(ownerId, name, settings, 'playtest');
    availableCats([])
      .slice(0, count - 1)
      .forEach((botId, i) => sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)').run(id, botId, i + 1, now()));
    const game = loadGame(id)!;
    game.state = newGame(count);
    game.status = 'active';
    game.startedAt = now();
    saveGame(game);
    return id;
  });
}

export function findGameIdByCode(code: string): string | null {
  const row = sql('SELECT id FROM games WHERE join_code = ?').get(code.trim().toUpperCase()) as { id: string } | undefined;
  return row?.id ?? null;
}

export function joinGame(gameId: string, userId: number): void {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    if (isMember(gameId, userId)) return;
    if (game.mode === 'playtest') throw new GameError('Playtest tables are just for their owner and the computer players.');
    if (game.status !== 'lobby') throw new GameError('This game has already started, so new players can’t join.');
    const players = getPlayers(gameId);
    if (players.length >= MAX_PLAYERS) throw new GameError('This table is full (5 players max).');
    sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)').run(gameId, userId, players.length, now());
    saveGame(game);
  });
  publish(gameId);
}

/** Rewrite seats 0..n-1 in the given user order (two passes to dodge the unique constraint). */
function reseat(gameId: string, userIds: number[]) {
  sql('UPDATE game_players SET seat = -seat - 1 WHERE game_id = ?').run(gameId);
  userIds.forEach((uid, seat) => sql('UPDATE game_players SET seat = ? WHERE game_id = ? AND user_id = ?').run(seat, gameId, uid));
}

/** The computer players are the family cats. Each has its own account so their stats add up over the year. */
const CAT_NAMES = ['Rosie', 'Raul', 'Pippi', 'Dash', 'Carlito', 'Serena', 'Cali'];

function botUserIds(): number[] {
  const existing = sql('SELECT id FROM users WHERE is_bot = 1 ORDER BY id').all() as { id: number }[];
  if (existing.length >= CAT_NAMES.length) return existing.map((r) => r.id);
  CAT_NAMES.forEach((name, i) => {
    sql('INSERT OR IGNORE INTO users (username, display_name, password_hash, is_bot, created_at) VALUES (?, ?, NULL, 1, ?)').run(
      `bot-${i + 1}`,
      name,
      now(),
    );
  });
  return (sql('SELECT id FROM users WHERE is_bot = 1 ORDER BY id').all() as { id: number }[]).map((r) => r.id);
}

/** Cats not already at this table, in random order. */
function availableCats(players: SeatedPlayer[]): number[] {
  const ids = botUserIds().filter((id) => !players.some((p) => p.userId === id));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = secureRng(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Playtest undo history (in memory; a dev convenience that resets on restart)

interface Snapshot {
  state: string;
  status: GameStatus;
  finishedAt: number | null;
  by: 'you' | 'bot';
}

const g = globalThis as typeof globalThis & {
  __heartsUndo?: Map<string, Snapshot[]>;
  __heartsBotTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
const undoStacks: Map<string, Snapshot[]> = (g.__heartsUndo ??= new Map());

function snapshot(game: GameRecord, by: Snapshot['by']): Snapshot | null {
  if (game.mode !== 'playtest' || !game.state) return null;
  return { state: JSON.stringify(game.state), status: game.status, finishedAt: game.finishedAt, by };
}

function remember(gameId: string, snap: Snapshot | null) {
  if (!snap) return;
  const stack = undoStacks.get(gameId) ?? [];
  stack.push(snap);
  if (stack.length > 400) stack.splice(0, stack.length - 400);
  undoStacks.set(gameId, stack);
}

const canUndo = (gameId: string) => !!undoStacks.get(gameId)?.some((s) => s.by === 'you');

// ---------------------------------------------------------------------------
// Views

function devView(game: GameRecord): DevView {
  const hand = game.state?.hand ?? null;
  const n = game.state?.numPlayers ?? 4;
  return {
    ...game.dev,
    hands: hand?.hands ?? [],
    crib: hand?.crib ?? [],
    passes: hand?.passes ?? [],
    legal: hand ? hand.hands.map((_, seat) => legalPlays(hand, seat, game.settings)) : [],
    canUndo: canUndo(game.id),
    passOptions: passCycle(n).map((offset) => ({ offset, label: passLabel(offset, n) })),
  };
}

export function buildView(game: GameRecord, players: SeatedPlayer[], userId: number, online: Set<number>): GameView {
  const me = players.find((p) => p.userId === userId);
  const seat = me?.seat ?? null;
  const state = game.status === 'lobby' ? null : game.state;
  const scores = state?.scores ?? players.map(() => 0);
  const isOwner = game.ownerId === userId;
  const active = !!state && game.status === 'active';
  const deadline = active ? moveDeadline(game, players) : null;
  return {
    id: game.id,
    name: game.name,
    status: game.status,
    mode: game.mode,
    ownerId: game.ownerId,
    joinCode: game.joinCode,
    settings: game.settings,
    handsPlayed: state?.handsPlayed ?? 0,
    players: players.map((p) => ({
      seat: p.seat,
      userId: p.userId,
      name: p.displayName,
      username: p.username,
      isBot: p.isBot,
      score: scores[p.seat] ?? 0,
      online: p.isBot || online.has(p.userId),
      autopilot: active && !p.isBot && !!state?.autopilot?.[p.seat],
      avatar: playerAvatar(p),
    })),
    me: { userId, seat, isOwner },
    table: state && game.status === 'active' ? tableViewFor(state, seat, game.settings) : null,
    lastHand: state?.lastHand ? summarizeHand(state.lastHand) : null,
    toAct: state && game.status === 'active' ? seatsToAct(state) : [],
    leaders: state && state.handsPlayed > 0 ? leaders(state.scores) : [],
    endAfterHand: !!state?.endAfterHand && game.status === 'active',
    moveClock: deadline !== null ? { endsIn: Math.max(0, deadline - now()), seconds: game.settings.moveTimer! } : null,
    // Full information only ever goes to the owner of a solo playtest table.
    dev: game.mode === 'playtest' && isOwner && state ? devView(game) : null,
    version: game.version,
    updatedAt: game.updatedAt,
  };
}

export function getGameView(gameId: string, userId: number): GameView | null {
  const game = loadGame(gameId);
  if (!game || !isMember(gameId, userId)) return null;
  return buildView(game, getPlayers(gameId), userId, onlineUsers(gameId));
}

/** Push each connected player their own view of the game. Never throws: the change is already saved. */
export function publish(gameId: string) {
  try {
    const subs = subscribers(gameId);
    if (!subs.length) return;
    const game = loadGame(gameId);
    if (!game) {
      for (const s of subs) s.send('deleted', {});
      return;
    }
    const players = getPlayers(gameId);
    const online = onlineUsers(gameId);
    for (const s of subs) {
      try {
        if (!players.some((p) => p.userId === s.userId)) s.send('removed', {});
        else s.send('state', buildView(game, players, s.userId, online));
      } catch (err) {
        console.error('Failed to push update', err);
      }
    }
  } catch (err) {
    console.error('Failed to publish game update', err);
  }
}

/** Someone changed their photo or name: refresh every live table they're seated at. Never throws. */
export function publishPlayerChange(userId: number): void {
  try {
    const rows = sql('SELECT game_id FROM game_players WHERE user_id = ?').all(userId) as { game_id: string }[];
    for (const r of rows) publish(r.game_id);
  } catch (err) {
    console.error('Failed to publish player change', err);
  }
}

// ---------------------------------------------------------------------------
// Actions

function recordHand(gameId: string, record: HandRecord) {
  sql('INSERT INTO hands (game_id, number, record, completed_at) VALUES (?, ?, ?, ?)').run(
    gameId,
    record.number,
    JSON.stringify(record),
    now(),
  );
}

function applyResult(game: GameRecord, result: ActionResult | null) {
  if (!result) return;
  if (result.completedHand) recordHand(game.id, result.completedHand);
  if (result.gameOver) {
    game.status = 'finished';
    game.finishedAt = now();
  }
}

function parseCards(value: unknown): Card[] {
  if (!Array.isArray(value) || !value.every(isCard)) throw new GameError('Invalid cards.');
  return value;
}

/** Let the computer play for every seat until `done` says stop (or the game ends). */
function aiUntil(game: GameRecord, done: (state: GameState) => boolean) {
  for (let i = 0; i < 500 && game.state && game.status === 'active'; i++) {
    const result = aiStep(game.state, game.settings);
    if (!result) break;
    applyResult(game, result);
    if (done(game.state)) break;
  }
}

function devDeal(game: GameRecord, players: SeatedPlayer[], mySeat: number, action: Extract<GameAction, { type: 'dev:deal' }>) {
  const state = game.state!;
  const n = state.numPlayers;
  if (!PRESETS.some((p) => p.id === action.preset)) throw new GameError('Unknown scenario.');
  const seat = Number.isInteger(action.seat) && action.seat! >= 0 && action.seat! < players.length ? action.seat! : mySeat;

  let spec: DealSpec;
  if (action.preset === 'custom') {
    const parse = (text: unknown) => {
      const res = parseCardList(typeof text === 'string' ? text : '', n);
      if ('error' in res) throw new GameError(res.error);
      return res.cards;
    };
    spec = {
      hands: Array.from({ length: n }, (_, s) => parse(action.custom?.hands?.[s])),
      crib: parse(action.custom?.crib),
    };
  } else spec = presetSpec(action.preset as PresetId, n, seat);

  let passOffset: number | undefined;
  if (action.passOffset !== null && action.passOffset !== undefined) {
    passOffset = Number(action.passOffset);
    if (!passCycle(n).includes(passOffset)) throw new GameError('Unknown pass direction.');
  }
  redealHand(state, secureRng, { spec, passOffset });
}

export function performAction(gameId: string, userId: number, action: GameAction): void {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    const players = getPlayers(gameId);
    const me = players.find((p) => p.userId === userId);
    if (!me) throw new GameError('You are not in this game.', 403);
    const isOwner = game.ownerId === userId;
    const ownerOnly = () => {
      if (!isOwner) throw new GameError('Only the game’s owner can do that.', 403);
    };
    const lobbyOnly = () => {
      if (game.status !== 'lobby') throw new GameError('That can only be done before the game starts.');
    };
    const inProgress = () => {
      if (game.status !== 'active' || !game.state) throw new GameError('The game is not in progress.');
      return game.state;
    };
    const devOnly = () => {
      if (game.mode !== 'playtest' || !isOwner) throw new GameError('Playtest tools are only available at your own playtest table.', 403);
    };
    const before = snapshot(game, 'you');
    let undoable = false;

    switch (action?.type) {
      case 'pass':
      case 'play': {
        const state = inProgress();
        if (action.type === 'pass') gamePass(state, me.seat, parseCards(action.cards));
        else {
          if (!isCard(action.card)) throw new GameError('Invalid card.');
          applyResult(game, gamePlay(state, me.seat, action.card, game.settings));
        }
        // Making your own move takes your seat back from the computer.
        if (state.autopilot?.[me.seat]) setAutopilot(game, me.seat, false);
        undoable = true;
        break;
      }
      case 'resume': {
        const state = inProgress();
        if (!state.autopilot?.[me.seat]) break;
        setAutopilot(game, me.seat, false);
        // You're back: if the table is waiting on you, your clock starts fresh.
        if (seatsToAct(state).includes(me.seat)) touchClock(state, true);
        break;
      }
      case 'start': {
        ownerOnly();
        lobbyOnly();
        if (players.length < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
        game.state = newGame(players.length);
        game.status = 'active';
        game.startedAt = now();
        break;
      }
      case 'addBot': {
        ownerOnly();
        lobbyOnly();
        if (players.length >= MAX_PLAYERS) throw new GameError('The table is full.');
        const botId = availableCats(players)[0];
        if (botId === undefined) throw new GameError('All the cats are already at the table.');
        sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)').run(gameId, botId, players.length, now());
        break;
      }
      case 'removePlayer':
      case 'leave': {
        lobbyOnly();
        const target = action.type === 'leave' ? userId : Number(action.userId);
        if (action.type === 'removePlayer') ownerOnly();
        if (target === game.ownerId) throw new GameError('The owner can’t leave their own game (delete it instead).');
        sql('DELETE FROM game_players WHERE game_id = ? AND user_id = ?').run(gameId, target);
        reseat(
          gameId,
          players.filter((p) => p.userId !== target).map((p) => p.userId),
        );
        break;
      }
      case 'shuffleSeats': {
        ownerOnly();
        lobbyOnly();
        const ids = players.map((p) => p.userId);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = secureRng(i + 1);
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        reseat(gameId, ids);
        break;
      }

      // ----- Playtest tools
      case 'dev:act': {
        devOnly();
        const state = inProgress();
        const seat = Number(action.seat);
        if (!Number.isInteger(seat) || seat < 0 || seat >= players.length) throw new GameError('Unknown seat.');
        const move = action.move;
        if (move?.type === 'pass') gamePass(state, seat, parseCards(move.cards));
        else if (move?.type === 'play') {
          if (!isCard(move.card)) throw new GameError('Invalid card.');
          applyResult(game, gamePlay(state, seat, move.card, game.settings));
        } else throw new GameError('Unknown move.');
        undoable = true;
        break;
      }
      case 'dev:ai': {
        devOnly();
        const state = inProgress();
        const hand = state.hand!;
        if (action.scope === 'move') {
          // One seat if asked; otherwise prefer moves owed by computer players, then yours.
          const seat = Number.isInteger(action.seat) ? action.seat : null;
          const result =
            seat !== null
              ? aiStep(state, game.settings, (s) => s === seat)
              : (aiStep(state, game.settings, (s) => !!players[s]?.isBot) ?? aiStep(state, game.settings));
          if (!result) throw new GameError('Nothing to play right now.');
          applyResult(game, result);
        } else if (action.scope === 'trick') {
          const tricks = hand.tricks.length;
          aiUntil(game, (s) => s.hand !== hand || hand.tricks.length > tricks);
        } else if (action.scope === 'hand') {
          aiUntil(game, (s) => s.hand !== hand);
        } else throw new GameError('Unknown scope.');
        undoable = true;
        break;
      }
      case 'dev:bots': {
        devOnly();
        const wasManual = game.dev.botMode === 'manual';
        game.dev = normalizeDev({ ...game.dev, ...action });
        if (game.dev.botMode === 'manual') clearBotTimer(gameId);
        // Back on auto: start a fresh allowance rather than one that ran down while on manual.
        else if (wasManual) touchClock(game.state, true);
        break;
      }
      case 'dev:undo': {
        devOnly();
        const stack = undoStacks.get(gameId) ?? [];
        let target: Snapshot | undefined;
        while (stack.length) {
          const snap = stack.pop()!;
          if (snap.by === 'you') {
            target = snap;
            break;
          }
        }
        if (!target) throw new GameError('Nothing to undo.');
        clearBotTimer(gameId);
        game.state = JSON.parse(target.state) as GameState;
        game.status = target.status;
        game.finishedAt = target.finishedAt;
        sql('DELETE FROM hands WHERE game_id = ? AND number > ?').run(gameId, game.state.handsPlayed);
        touchClock(game.state, true);
        break;
      }
      case 'dev:deal': {
        devOnly();
        inProgress();
        devDeal(game, players, me.seat, action);
        touchClock(game.state, true);
        undoable = true;
        break;
      }
      default:
        throw new GameError('Unknown action.');
    }
    if (undoable) remember(gameId, before);
    saveGame(game);
  });
  publish(gameId);
  rescheduleBots(gameId);
}

/** Wrap engine rule violations as friendly 400s. */
export function toGameError(err: unknown): GameError {
  if (err instanceof GameError) return err;
  if (err instanceof RuleError) return new GameError(err.message);
  console.error(err);
  return new GameError('Something went wrong.', 500);
}

export function updateSettings(gameId: string, userId: number, name: string, input: Record<string, unknown>) {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    if (game.ownerId !== userId) throw new GameError('Only the game’s owner can change settings.', 403);
    if (game.status === 'finished') throw new GameError('This game is over.');
    if (name) game.name = clipToLength(name, GAME_NAME_MAX);
    const next = normalizeSettings({ ...game.settings, ...input });
    const timerChanged = next.moveTimer !== game.settings.moveTimer;
    // Once cards are dealt only the score limit, move timer and watches can change, except at a playtest table.
    game.settings =
      game.status === 'lobby' || game.mode === 'playtest'
        ? next
        : { ...game.settings, scoreLimit: next.scoreLimit, moveTimer: next.moveTimer, showWatches: next.showWatches };
    if (timerChanged && game.state) {
      // A new allowance starts now. With the timer off, the table goes back to waiting for everyone.
      touchClock(game.state, true);
      if (!game.settings.moveTimer) delete game.state.autopilot;
    }
    saveGame(game);
  });
  publish(gameId);
  rescheduleBots(gameId);
}

export type EndMode = 'after-hand' | 'cancel' | 'now';

/**
 * End the game. The normal way is `after-hand`: the hand in progress is finished first.
 * `now` is the emergency option that throws away the unfinished hand.
 *
 * `forHand` is the hand number the host was looking at. The next hand is dealt the moment the
 * last card falls, so a click can arrive one hand late. If the hand they meant to be the last is
 * already scored and the new one hasn't really started, the game simply ends there.
 */
export function endGame(gameId: string, userId: number, mode: EndMode, forHand?: number) {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    if (game.ownerId !== userId) throw new GameError('Only the game’s owner can end the game.', 403);
    if (game.status !== 'active' || !game.state) throw new GameError('The game is not in progress.');
    const state = game.state;
    const current = state.hand?.number;
    const stale = forHand !== undefined && Number.isInteger(forHand) && current !== undefined && forHand < current;
    const finish = () => {
      state.hand = null;
      state.over = true;
      game.status = 'finished';
      game.finishedAt = now();
    };
    if (mode === 'now') {
      if (stale) throw new GameError(`Hand ${forHand} is already over and hand ${current} has been dealt. Reload the page and try again.`);
      finish();
    } else if (mode === 'after-hand' && stale) {
      const fresh = !!state.hand && state.hand.tricks.length === 0 && (state.hand.current?.plays.length ?? 0) === 0;
      if (!fresh)
        throw new GameError(
          `Hand ${forHand} already finished and hand ${current} is under way. To stop with the scores so far, use “End now” below.`,
        );
      finish();
    } else {
      state.endAfterHand = mode === 'after-hand';
    }
    saveGame(game);
  });
  publish(gameId);
}

export function deleteGame(gameId: string, userId: number) {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) return;
    if (game.ownerId !== userId) throw new GameError('Only the game’s owner can delete it.', 403);
    sql('DELETE FROM games WHERE id = ?').run(gameId);
  });
  clearBotTimer(gameId);
  undoStacks.delete(gameId);
  publish(gameId);
}

export function listGamesForUser(userId: number): GameListItem[] {
  const rows = sql(
    `SELECT g.* FROM games g JOIN game_players gp ON gp.game_id = g.id
     WHERE gp.user_id = ? ORDER BY g.updated_at DESC`,
  ).all(userId) as unknown as GameRow[];
  return rows.map((row) => {
    const game = toRecord(row);
    const players = getPlayers(game.id);
    const scores = game.state?.scores ?? [];
    const toAct = game.status === 'active' && game.state ? seatsToAct(game.state) : [];
    const mySeat = players.find((p) => p.userId === userId)?.seat;
    return {
      id: game.id,
      name: game.name,
      status: game.status,
      mode: game.mode,
      isOwner: game.ownerId === userId,
      joinCode: game.joinCode,
      handsPlayed: game.state?.handsPlayed ?? 0,
      players: players.map((p) => ({
        name: p.displayName,
        isBot: p.isBot,
        score: scores[p.seat] ?? 0,
        isMe: p.userId === userId,
        avatar: playerAvatar(p),
      })),
      yourTurn: mySeat !== undefined && toAct.includes(mySeat),
      waitingOn: toAct.map((s) => players[s]?.displayName).filter(Boolean),
      updatedAt: game.updatedAt,
    };
  });
}

export function getHandRecords(gameId: string): HandRecord[] {
  return (sql('SELECT record FROM hands WHERE game_id = ? ORDER BY number').all(gameId) as { record: string }[]).map(
    (r) => JSON.parse(r.record) as HandRecord,
  );
}

/** One finished hand's record, or null if that hand hasn't finished (or never existed). */
export function getHandRecord(gameId: string, number: number): HandRecord | null {
  const row = sql('SELECT record FROM hands WHERE game_id = ? AND number = ?').get(gameId, number) as { record: string } | undefined;
  return row ? (JSON.parse(row.record) as HandRecord) : null;
}

// ---------------------------------------------------------------------------
// Computer players

const botTimers: Map<string, ReturnType<typeof setTimeout>> = (g.__heartsBotTimers ??= new Map());
const botFailures = new Map<string, number>();

function clearBotTimer(gameId: string) {
  const timer = botTimers.get(gameId);
  if (timer) clearTimeout(timer);
  botTimers.delete(gameId);
}

/** Pause before a bot moves: [normal move, right after a trick closes]. */
const BOT_DELAYS: Record<DevSettings['speed'], [number, number]> = {
  fast: [120, 450],
  normal: [900, 1700],
  slow: [2000, 3000],
};

/**
 * Seats the computer may move for right now. Cats always play. A cat sitting in for a person
 * only plays while at least one person is still at the table, so a table everyone has walked
 * away from pauses instead of playing itself forever.
 */
function botMayMove(game: GameRecord, players: SeatedPlayer[]): (seat: number) => boolean {
  const autopilot = game.state?.autopilot ?? [];
  const someoneHere = players.some((p) => !p.isBot && !autopilot[p.seat]);
  return (seat) => !!players[seat]?.isBot || (!!autopilot[seat] && someoneHere);
}

/** Cancel any pending computer move or move-timer check, then plan the next one. */
function rescheduleBots(gameId: string) {
  clearBotTimer(gameId);
  scheduleBots(gameId);
}

export function scheduleBots(gameId: string, retryDelay?: number) {
  try {
    if (botTimers.has(gameId)) return;
    const game = loadGame(gameId);
    if (!game || game.status !== 'active' || !game.state?.hand) return;
    if (game.mode === 'playtest' && game.dev.botMode === 'manual') return;
    const players = getPlayers(gameId);
    let delay: number;
    if (seatsToAct(game.state).some(botMayMove(game, players))) {
      // Linger a bit longer right after a trick closes so people can see it.
      const hand = game.state.hand;
      const [moveDelay, trickDelay] = BOT_DELAYS[game.mode === 'playtest' ? game.dev.speed : 'normal'];
      delay = retryDelay ?? (hand.phase === 'playing' && hand.current?.plays.length === 0 && hand.tricks.length > 0 ? trickDelay : moveDelay);
    } else {
      // Waiting on people: wake up when the move timer runs out (if there is one).
      const deadline = moveDeadline(game, players);
      if (deadline === null) return;
      delay = retryDelay ?? Math.max(0, deadline - now()) + 50;
    }
    botTimers.set(
      gameId,
      setTimeout(() => {
        botTimers.delete(gameId);
        runBots(gameId);
      }, delay),
    );
  } catch (err) {
    console.error('Failed to schedule computer player', err);
  }
}

function runBots(gameId: string) {
  let changed: boolean;
  try {
    changed = botTurn(gameId);
    botFailures.delete(gameId);
  } catch (err) {
    // Don't let one bad move stall the table forever: retry with backoff (up to 5 minutes).
    const failures = (botFailures.get(gameId) ?? 0) + 1;
    botFailures.set(gameId, failures);
    const retry = Math.min(5 * 60_000, 2000 * 2 ** failures);
    console.error(`Computer player move failed in game ${gameId} (attempt ${failures}); retrying in ${retry / 1000}s`, err);
    scheduleBots(gameId, retry);
    return;
  }
  if (changed) publish(gameId);
  scheduleBots(gameId);
}

/**
 * Hand anyone whose move timer ran out to a computer player, then make whatever moves the
 * computer owes right now (all its passes, or one card). Returns true if anything changed.
 */
function botTurn(gameId: string): boolean {
  return transaction(() => {
    const game = loadGame(gameId);
    if (!game || game.status !== 'active' || !game.state?.hand) return false;
    if (game.mode === 'playtest' && game.dev.botMode === 'manual') return false;
    const players = getPlayers(gameId);
    const state = game.state;
    let changed = false;

    const deadline = moveDeadline(game, players);
    if (deadline !== null && now() >= deadline) {
      const auto = autoSeat(game, players);
      for (const seat of seatsToAct(state)) if (!auto(seat)) setAutopilot(game, seat, true);
      changed = true;
    }

    const before = snapshot(game, 'bot');
    const result = aiStep(state, game.settings, botMayMove(game, players));
    if (result) {
      applyResult(game, result);
      remember(gameId, before);
      changed = true;
    }
    if (changed) saveGame(game);
    return changed;
  });
}

/**
 * On boot, resume any games that were waiting on a computer player. Timed games get a fresh
 * clock, so nobody is put on autopilot because the server was down for a deploy.
 */
export function resumeBots() {
  const rows = sql("SELECT id FROM games WHERE status = 'active'").all() as { id: string }[];
  for (const r of rows) {
    try {
      transaction(() => {
        const game = loadGame(r.id);
        if (!game?.settings.moveTimer || !game.state) return;
        touchClock(game.state, true);
        // Only the clock changes: leave updated_at alone so the games list doesn't show every
        // timed game as "just now" after a deploy.
        sql('UPDATE games SET state = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(game.state), game.id);
      });
    } catch (err) {
      console.error(`Failed to restart the move timer for game ${r.id}`, err);
    }
    scheduleBots(r.id);
  }
}
