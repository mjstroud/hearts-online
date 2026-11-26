import { type Card, isCard, secureRng, suitOf } from '../engine/cards';
import {
  type ActionResult,
  type GameState,
  aiStep,
  continueGame,
  gamePass,
  gamePlay,
  leaders,
  newGame,
  redealHand,
  seatsToAct,
  turnKey,
} from '../engine/game';
import { type DealSpec, RuleError, type Trick, followPlays, isFinalTrick, legalPlays, queueSuit } from '../engine/hand';
import { PRESETS, type PresetId, parseCardList, presetSpec } from '../engine/presets';
import {
  DEFAULT_SETTINGS,
  type GameSettings,
  MAX_PLAYERS,
  MID_GAME_SETTINGS,
  MIN_PLAYERS,
  MOVE_TIMER_OPTIONS,
  normalizeSettings,
  passCycle,
  passLabel,
} from '../engine/rules';
import type { HandRecord } from '../engine/scoring';
import { summarizeHand, tableViewFor } from '../engine/view';
import type { DevSettings, DevView, GameAction, GameListItem, GameMode, GameStatus, GameView } from '../types';
import { avatarSrc } from '../avatars';
import { GAME_NAME_MAX, clipToLength } from '../names';
import { now, sql, transaction } from './db';
import { type Subscriber, onlineUsers, sendTo, subscribers } from './hub';

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

/**
 * The one rule for seats the server is about to play: the cats, anyone a cat is sitting in for,
 * and (with autoPlayLast) every seat in the final trick. Alerts, /games badges, the move timer and
 * the computer players all follow it. Only while someone is still at the table, so a table
 * everyone has walked away from pauses instead of playing itself forever, final trick included.
 * At a playtest table on manual the owner drives every seat, so the server plays none.
 */
function serverPlays(game: GameRecord, players: SeatedPlayer[]): (seat: number) => boolean {
  if (game.mode === 'playtest' && game.dev.botMode === 'manual') return () => false;
  const autopilot = game.state?.autopilot ?? [];
  const someoneHere = players.some((p) => !p.isBot && !autopilot[p.seat]);
  const hand = game.state?.hand;
  const lastTrick = someoneHere && game.settings.autoPlayLast && !!hand && isFinalTrick(hand);
  return (seat) => !!players[seat]?.isBot || (!!autopilot[seat] && someoneHere) || lastTrick;
}

/** People the move timer runs for: at the table themselves, and not about to be played for. */
function clocked(game: GameRecord, players: SeatedPlayer[]): (seat: number) => boolean {
  const plays = serverPlays(game, players);
  return (seat) => !!players[seat] && !players[seat].isBot && !game.state?.autopilot?.[seat] && !plays(seat);
}

/** When the move timer runs out for the seats on turn (null if there's no timer running). */
function moveDeadline(game: GameRecord, players: SeatedPlayer[]): number | null {
  const state = game.state;
  if (!game.settings.moveTimer || game.status !== 'active' || !state?.hand || state.turnSince === undefined) return null;
  // At a playtest table with the computer players on manual, the owner drives every seat: no clock.
  if (game.mode === 'playtest' && game.dev.botMode === 'manual') return null;
  if (!seatsToAct(state).some(clocked(game, players))) return null;
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

/** The host took this person out of the game after it started (a cat has their seat). */
export function wasRemoved(gameId: string, userId: number): boolean {
  return !!sql('SELECT 1 FROM removed_players WHERE game_id = ? AND user_id = ?').get(gameId, userId);
}

/** Whoever played one seat of one hand. */
export type Occupant = Pick<SeatedPlayer, 'userId' | 'displayName' | 'isBot'>;
export type OccupantOf = (record: HandRecord, seat: number) => Occupant | undefined;

/** Someone the host took out mid-game. The hands up to `throughHand` are theirs. */
export interface RemovedPlayer {
  seat: number;
  userId: number;
  displayName: string;
  throughHand: number;
}

export function removedPlayers(gameId: string): RemovedPlayer[] {
  const rows = sql(
    `SELECT rp.seat, rp.user_id, u.display_name, rp.through_hand FROM removed_players rp
     JOIN users u ON u.id = rp.user_id WHERE rp.game_id = ? ORDER BY rp.through_hand, rp.removed_at`,
  ).all(gameId) as { seat: number; user_id: number; display_name: string; through_hand: number }[];
  return rows.map((r) => ({ seat: r.seat, userId: r.user_id, displayName: r.display_name, throughHand: r.through_hand }));
}

/**
 * Who played each seat of a hand. Records name their players; older ones (from before seats could
 * change hands) fall back to whoever was removed from that seat after the hand, else whoever
 * sits there now.
 */
export function occupants(seated: SeatedPlayer[], removed: RemovedPlayer[]): OccupantOf {
  const known = new Map<number, Occupant>();
  for (const r of removed) known.set(r.userId, { userId: r.userId, displayName: r.displayName, isBot: false });
  for (const p of seated) known.set(p.userId, p);
  const lookUp = (userId: number): Occupant | undefined => {
    if (!known.has(userId)) {
      const row = sql('SELECT display_name, is_bot FROM users WHERE id = ?').get(userId) as
        | { display_name: string; is_bot: number }
        | undefined;
      if (row) known.set(userId, { userId, displayName: row.display_name, isBot: !!row.is_bot });
    }
    return known.get(userId);
  };
  return (record, seat) => {
    const id = record.players?.[seat];
    if (id !== undefined) return lookUp(id);
    // Earliest first, so a seat that changed hands twice goes to whoever had it at the time.
    const before = removed.find((r) => r.seat === seat && r.throughHand >= record.number);
    return before ? known.get(before.userId) : seated[seat];
  };
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
  __heartsPremoves?: Map<string, Map<number, Premove>>;
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

// ---------------------------------------------------------------------------
// Pre-moves: a card someone queued to play the moment their turn arrives.
// In memory and apart from the saved state, so nothing the rest of the table receives (the version,
// the clock, the computer players' timing) changes when someone queues. A restart forgets them,
// which just means "not queued".

interface Premove {
  hand: number;
  /** 1-based trick number. */
  trick: number;
  card: Card;
}

/** Game id → user id → their queued card. */
const premoves: Map<string, Map<number, Premove>> = (g.__heartsPremoves ??= new Map());

function dropPremove(gameId: string, userId: number) {
  const queued = premoves.get(gameId);
  queued?.delete(userId);
  if (queued?.size === 0) premoves.delete(gameId);
}

/** Someone's queued card, if it's still for the trick in progress and theirs to play. */
function premoveFor(game: GameRecord, seat: number | null, userId: number): Card | null {
  const entry = premoves.get(game.id)?.get(userId);
  const hand = game.status === 'active' ? game.state?.hand : null;
  if (!entry || seat === null || !hand?.current || hand.phase !== 'playing') return null;
  if (entry.hand !== hand.number || entry.trick !== hand.tricks.length + 1) return null;
  if (hand.turn === seat || hand.current.plays.some((p) => p.seat === seat) || !hand.hands[seat]?.includes(entry.card)) return null;
  return entry.card;
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

/**
 * Names by seat for the hand just finished, when someone who played it has since been removed: the
 * result screen then names them, not the cat in their seat now. Undefined the rest of the time,
 * which keeps the live update small.
 */
function lastHandNames(game: GameRecord, players: SeatedPlayer[]): string[] | undefined {
  const last = game.status === 'lobby' ? null : game.state?.lastHand;
  if (!last) return undefined;
  const removed = removedPlayers(game.id);
  if (!removed.some((r) => r.throughHand >= last.number)) return undefined;
  // The stored record says who sat where.
  const record = getHandRecord(game.id, last.number) ?? last;
  const occupant = occupants(players, removed);
  return Array.from({ length: last.numPlayers }, (_, seat) => occupant(record, seat)?.displayName ?? '');
}

export function buildView(
  game: GameRecord,
  players: SeatedPlayer[],
  userId: number,
  online: Set<number>,
  rematch = rematchFor(game),
  lastNames = lastHandNames(game, players),
): GameView {
  const me = players.find((p) => p.userId === userId);
  const seat = me?.seat ?? null;
  const state = game.status === 'lobby' ? null : game.state;
  const scores = state?.scores ?? players.map(() => 0);
  const isOwner = game.ownerId === userId;
  const active = !!state && game.status === 'active';
  const deadline = active ? moveDeadline(game, players) : null;
  const yourTurn = active && seat !== null && seatsToAct(state).includes(seat) && !serverPlays(game, players)(seat);
  const lastHand = state?.lastHand ? summarizeHand(state.lastHand) : null;
  if (lastHand && lastNames) lastHand.names = lastNames;
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
    lastHand,
    toAct: state && game.status === 'active' ? seatsToAct(state) : [],
    leaders: state && state.handsPlayed > 0 ? leaders(state.scores) : [],
    endAfterHand: !!state?.endAfterHand && game.status === 'active',
    moveClock: deadline !== null ? { endsIn: Math.max(0, deadline - now()), seconds: game.settings.moveTimer! } : null,
    // Full information only ever goes to the owner of a solo playtest table.
    dev: game.mode === 'playtest' && isOwner && state ? devView(game) : null,
    version: game.version,
    updatedAt: game.updatedAt,
    // Someone taken out of the rematch's waiting room no longer gets a link to it.
    rematchId: rematch?.seated.has(userId) ? rematch.id : null,
    yourTurn,
    // Only ever your own: nobody else may learn that you queued a card.
    premove: active ? premoveFor(game, seat, userId) : null,
  };
}

export function getGameView(gameId: string, userId: number): GameView | null {
  const game = loadGame(gameId);
  if (!game || !isMember(gameId, userId)) return null;
  return buildView(game, getPlayers(gameId), userId, onlineUsers(gameId));
}

/** Push each connected player their own view of the game. Never throws: the change is already saved. */
export function publish(gameId: string) {
  // Streams with nothing more to hear once told: someone no longer at the table, or a deleted game.
  const goodbye: Subscriber[] = [];
  try {
    const subs = subscribers(gameId);
    if (!subs.length) return;
    const game = loadGame(gameId);
    if (!game) {
      for (const s of subs) {
        goodbye.push(s);
        s.send('deleted', {});
      }
      return;
    }
    const players = getPlayers(gameId);
    const online = onlineUsers(gameId);
    // Worked out once for everyone, not once per player.
    const rematch = rematchFor(game);
    const lastNames = lastHandNames(game, players);
    for (const s of subs) {
      try {
        if (!players.some((p) => p.userId === s.userId)) {
          goodbye.push(s);
          s.send('removed', {});
        } else s.send('state', buildView(game, players, s.userId, online, rematch, lastNames));
      } catch (err) {
        console.error('Failed to push update', err);
      }
    }
  } catch (err) {
    console.error('Failed to publish game update', err);
  } finally {
    // After everyone has been sent this update, so a hang-up can't interrupt it.
    for (const s of goodbye) {
      try {
        s.close?.();
      } catch (err) {
        console.error('Failed to close a live stream', err);
      }
    }
  }
}

/** Push just this person's open tabs a fresh view: a queued card is nobody else's business. Never throws. */
function publishTo(gameId: string, userId: number) {
  try {
    if (!subscribers(gameId).some((s) => s.userId === userId)) return;
    const game = loadGame(gameId);
    const players = getPlayers(gameId);
    if (!game || !players.some((p) => p.userId === userId)) return;
    sendTo(gameId, userId, 'state', buildView(game, players, userId, onlineUsers(gameId)));
  } catch (err) {
    console.error('Failed to push update', err);
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
// Rematches

/**
 * A finished game's rematch, and who is seated at it. Null if there isn't one, or if it was deleted:
 * deleting a game removes its seats, and the host can never leave.
 */
function rematchFor(game: GameRecord): { id: string; seated: Set<number> } | null {
  // No query for waiting rooms or games in progress, the season game included.
  const id = game.status === 'finished' ? game.state?.rematchId : undefined;
  if (!id) return null;
  const rows = sql('SELECT user_id FROM game_players WHERE game_id = ?').all(id) as { user_id: number }[];
  return rows.length ? { id, seated: new Set(rows.map((r) => r.user_id)) } : null;
}

/**
 * Someone left a waiting room, or a game was deleted. If it was a rematch, refresh the end screen of
 * the game it came from, so nobody keeps a link to a rematch they can't open. Never throws.
 */
function publishRematchSource(rematchId: string) {
  try {
    const row = sql("SELECT id FROM games WHERE status = 'finished' AND json_extract(state, '$.rematchId') = ?").get(rematchId) as
      | { id: string }
      | undefined;
    if (row) publish(row.id);
  } catch (err) {
    console.error('Failed to refresh the game a rematch came from', err);
  }
}

/** "Sunday", then "Sunday rematch", then "Sunday rematch 2". Plain ASCII: deleting a game means typing its name. */
export function rematchName(name: string): string {
  const m = /^(.*\S) rematch(?: (\d+))?$/iu.exec(name);
  const suffix = m ? ` rematch ${Number(m[2] ?? 1) + 1}` : ' rematch';
  // A long name is cut short so the suffix always fits.
  return clipToLength(m ? m[1] : name, GAME_NAME_MAX - suffix.length).trimEnd() + suffix;
}

/** The rematch's game row and seats. Runs inside rematchGame's transaction, so it can't call createGame (they don't nest). */
function insertRematch(game: GameRecord, players: SeatedPlayer[]): string {
  // The limit the game first finished with, from before any "Keep playing". Check the length rather
  // than using `??`: when the first limit was "no limit", `from` is null.
  const extensions = game.state?.extensions;
  const scoreLimit = extensions?.length ? extensions[0].from : game.settings.scoreLimit;
  const id = insertGame(game.ownerId, rematchName(game.name), { ...game.settings, scoreLimit }, game.mode);
  const t = now();
  players
    .filter((p) => p.userId !== game.ownerId)
    .forEach((p, i) => sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)').run(id, p.userId, i + 1, t));
  // Everyone back in the same seats, even if the host wasn't in seat 0.
  reseat(id, players.map((p) => p.userId));
  if (game.mode === 'playtest') {
    // A playtest has no waiting room, so it's dealt straight away, as createPlaytest does.
    const rematch = loadGame(id)!;
    rematch.dev = game.dev;
    rematch.state = newGame(players.length);
    rematch.status = 'active';
    rematch.startedAt = now();
    saveGame(rematch);
  }
  return id;
}

/**
 * Host of a finished game: a waiting room with the same players, seats and settings, scores back to
 * zero. Returns its id. A second click, or a second device, gets the same rematch while it exists.
 */
export function rematchGame(gameId: string, userId: number): string {
  const { id, made } = transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    const players = getPlayers(gameId);
    if (!players.some((p) => p.userId === userId)) throw new GameError('You are not in this game.', 403);
    if (game.ownerId !== userId) throw new GameError('Only the game’s owner can do that.', 403);
    const state = game.state;
    if (game.status !== 'finished' || !state) throw new GameError('Only a finished game can have a rematch.');
    const existing = rematchFor(game);
    if (existing) return { id: existing.id, made: null };
    const id = insertRematch(game, players);
    state.rematchId = id;
    // Only the link changes: updated_at and finished_at stay put, so the old game keeps its place on /games and /stats.
    sql('UPDATE games SET state = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(state), gameId);
    return { id, made: game.mode };
  });
  if (made) {
    publish(gameId);
    if (made === 'playtest') scheduleBots(id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Actions

/** A finished hand, with who sat where: a seat can change hands, and the hands played stay theirs. */
function recordHand(gameId: string, record: HandRecord, players: SeatedPlayer[]) {
  const ids: number[] = [];
  for (const p of players) ids[p.seat] = p.userId;
  sql('INSERT INTO hands (game_id, number, record, completed_at) VALUES (?, ?, ?, ?)').run(
    gameId,
    record.number,
    JSON.stringify({ ...record, players: ids }),
    now(),
  );
}

/** Record a finished hand and end the game if it's over. */
function settle(game: GameRecord, result: ActionResult, players: SeatedPlayer[]) {
  if (result.completedHand) {
    recordHand(game.id, result.completedHand, players);
    // Every queued card was for the hand that just ended.
    premoves.delete(game.id);
  }
  if (result.gameOver) {
    game.status = 'finished';
    game.finishedAt = now();
  }
}

/** Settle a move, then play any queued cards it brought round. Every way a card is played comes through here. */
function applyResult(game: GameRecord, result: ActionResult | null, players: SeatedPlayer[]) {
  if (!result) return;
  settle(game, result, players);
  playQueued(game, players);
}

/**
 * The moment a seat's turn arrives, its queued card goes down, in the same update as the move
 * that brought the turn round (and the next seat's too, if that one is queued as well). Never
 * throws: the move that got here stands either way.
 */
function playQueued(game: GameRecord, players: SeatedPlayer[]) {
  const state = game.state;
  const hand = state?.hand;
  const queued = premoves.get(game.id);
  if (!state || !hand || !queued) return;
  try {
    while (game.status === 'active' && state.hand === hand && hand.phase === 'playing' && hand.turn !== null) {
      const seat = hand.turn;
      const player = players[seat];
      if (!player || player.isBot) break;
      const entry = queued.get(player.userId);
      if (!entry) break;
      queued.delete(player.userId);
      if (entry.hand !== hand.number || entry.trick !== hand.tricks.length + 1 || state.autopilot?.[seat]) break;
      if (!legalPlays(hand, seat, game.settings).includes(entry.card)) break;
      remember(game.id, snapshot(game, 'you'));
      settle(game, gamePlay(state, seat, entry.card, game.settings), players);
    }
  } catch (err) {
    console.error(`Failed to play a queued card in game ${game.id}`, err);
  }
  if (queued.size === 0 && premoves.get(game.id) === queued) premoves.delete(game.id);
}

/**
 * Queue a card, or cancel with `card: null`. Changes nothing anyone else can see. Returns true
 * when the seat's turn arrived while the request was on its way: the card is then played as usual.
 */
function queueCard(game: GameRecord, me: SeatedPlayer, action: Extract<GameAction, { type: 'premove' }>): boolean {
  if (action.card === null) {
    dropPremove(game.id, me.userId);
    return false;
  }
  const { card, hand: handNumber, trick } = action;
  if (!isCard(card) || !Number.isInteger(handNumber) || !Number.isInteger(trick)) throw new GameError('Invalid request.');
  const state = game.state;
  const active = game.status === 'active' && !!state;
  if (active && state.autopilot?.[me.seat]) throw new GameError('Tap “I’m back” first.');
  const hand = active ? state.hand : null;
  const current = hand?.phase === 'playing' ? hand.current : null;
  // The trick on screen is over, or this seat has played in it: a harmless race, nothing to queue.
  if (!hand || !current || handNumber !== hand.number || trick !== hand.tricks.length + 1 || current.plays.some((p) => p.seat === me.seat)) {
    dropPremove(game.id, me.userId);
    return false;
  }
  const firstTrick = hand.tricks.length === 0;
  if (hand.turn === me.seat) {
    // Its turn arrived on the way. As a follower that's simply a play; a lead was never queueable.
    if (!current.plays.length) throw new GameError('It’s your lead: play a card.');
    dropPremove(game.id, me.userId);
    return true;
  }
  const suit = queueSuit(current, firstTrick, me.seat, hand.turn);
  if (!suit) throw new GameError('You can queue a card once the lead card is down.');
  const held = hand.hands[me.seat];
  if (!held.includes(card)) throw new GameError('That card is not in your hand.');
  if (!followPlays(held, suit, firstTrick, game.settings).includes(card)) {
    // The same wording as an illegal play.
    throw new GameError(held.some((c) => suitOf(c) === suit) ? 'You must follow suit.' : 'No points can be played on the first trick.');
  }
  let queued = premoves.get(game.id);
  if (!queued) premoves.set(game.id, (queued = new Map()));
  queued.set(me.userId, { hand: handNumber, trick, card });
  return false;
}

/**
 * A tap on a card the server already played for this seat (the final trick, a queued card, or a
 * hand that ended on its own). True only if the card isn't a legal play right now.
 */
function lateTap(game: GameRecord, seat: number, card: Card): boolean {
  const state = game.state;
  if (!state) return false;
  const hand = state.hand;
  if (game.status === 'active' && hand && legalPlays(hand, seat, game.settings).includes(card)) return false;
  const mine = (tricks: readonly Trick[]) => tricks.some((t) => t.plays.some((p) => p.seat === seat && p.card === card));
  if (hand && (mine(hand.tricks) || (hand.current && mine([hand.current])))) return true;
  // The record keeps every trick, the ones played out on their own included.
  return !!state.lastHand && mine(state.lastHand.tricks);
}

/** Take a seat back from the computer. If the table is waiting on you, your clock starts fresh. */
function resume(game: GameRecord, seat: number) {
  const state = game.state!;
  setAutopilot(game, seat, false);
  if (seatsToAct(state).includes(seat)) touchClock(state, true);
}

/**
 * Mid-game, a cat takes the seat for good: it plays out the hand in progress, and the hands
 * already finished stay with the person (the hand records name who sat where). The seat's row is
 * moved to the cat rather than deleted, so every seat keeps its number.
 */
function removeMidGame(game: GameRecord, players: SeatedPlayer[], targetId: number) {
  const state = game.state!;
  const target = players.find((p) => p.userId === targetId);
  if (!target) throw new GameError('That player isn’t at this table.');
  if (target.isBot) throw new GameError('A cat is already playing that seat.');
  const cat = availableCats(players)[0];
  if (cat === undefined) throw new GameError('All the cats are already at the table.');
  const t = now();
  sql('UPDATE game_players SET user_id = ?, joined_at = ? WHERE game_id = ? AND seat = ?').run(cat, t, game.id, target.seat);
  sql('INSERT OR REPLACE INTO removed_players (game_id, user_id, seat, through_hand, removed_at) VALUES (?, ?, ?, ?, ?)').run(
    game.id,
    target.userId,
    target.seat,
    state.handsPlayed,
    t,
  );
  if (state.autopilot?.[target.seat]) setAutopilot(game, target.seat, false);
  dropPremove(game.id, target.userId);
}

function parseCards(value: unknown): Card[] {
  if (!Array.isArray(value) || !value.every(isCard)) throw new GameError('Invalid cards.');
  return value;
}

/** Let the computer play for every seat until `done` says stop (or the game ends). */
function aiUntil(game: GameRecord, players: SeatedPlayer[], done: (state: GameState) => boolean) {
  for (let i = 0; i < 500 && game.state && game.status === 'active'; i++) {
    const result = aiStep(game.state, game.settings);
    if (!result) break;
    applyResult(game, result, players);
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

/**
 * A settings change sent as JSON, checked strictly. normalizeSettings quietly turns anything odd
 * into the default, which would switch an option off (or the limit away) on a typo.
 */
function validSettings(input: unknown): input is Partial<GameSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return Object.entries(input).every(([key, value]) => {
    if (key === 'scoreLimit') return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000);
    if (key === 'moveTimer') return value === null || MOVE_TIMER_OPTIONS.includes(value as number);
    // Every other setting is a switch.
    return Object.hasOwn(DEFAULT_SETTINGS, key) && typeof DEFAULT_SETTINGS[key as keyof GameSettings] === 'boolean' && typeof value === 'boolean';
  });
}

export function performAction(gameId: string, userId: number, action: GameAction): void {
  // A rematch writes a new game as well, so it runs in its own transaction, away from the play path.
  if (action?.type === 'rematch') return void rematchGame(gameId, userId);
  // The JSON twin of the settings page.
  if (action?.type === 'settings') {
    const { settings, name } = action;
    if (!validSettings(settings) || (name !== undefined && typeof name !== 'string')) throw new GameError('Invalid request.');
    return void updateSettings(gameId, userId, (name ?? '').trim(), settings);
  }
  // False when nothing anyone else can see has changed: a late tap, or a card queued or cancelled.
  // Then there's no save, no update for the table and no change to the computer players' timing.
  let changed = true;
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
    let remembered = false;
    // Called once the move has gone through, and before any queued card it sets off remembers its
    // own step: undo then takes the queued card back first.
    const undoable = () => {
      if (!remembered) remember(gameId, before);
      remembered = true;
    };

    switch (action?.type) {
      case 'pass': {
        const state = inProgress();
        gamePass(state, me.seat, parseCards(action.cards));
        // Making your own move takes your seat back from the computer.
        if (state.autopilot?.[me.seat]) setAutopilot(game, me.seat, false);
        undoable();
        break;
      }
      case 'play': {
        if (!isCard(action.card)) throw new GameError('Invalid card.');
        // Checked before the game's status, as the hand (or the game) may have ended on that card.
        if (lateTap(game, me.seat, action.card)) {
          // It's down already, so the tap just succeeds. If a cat was sitting in, it means "I'm back".
          if (game.status !== 'active' || !game.state?.autopilot?.[me.seat]) {
            changed = false;
            return;
          }
          resume(game, me.seat);
          break;
        }
        const state = inProgress();
        const result = gamePlay(state, me.seat, action.card, game.settings);
        undoable();
        applyResult(game, result, players);
        if (state.autopilot?.[me.seat]) setAutopilot(game, me.seat, false);
        break;
      }
      case 'premove': {
        if (!queueCard(game, me, action)) {
          changed = false;
          return;
        }
        // The turn came round while the card was on its way: it's played like any other.
        const result = gamePlay(game.state!, me.seat, action.card!, game.settings);
        undoable();
        applyResult(game, result, players);
        break;
      }
      case 'resume': {
        const state = inProgress();
        if (!state.autopilot?.[me.seat]) break;
        resume(game, me.seat);
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
        const target = action.type === 'leave' ? userId : Number(action.userId);
        if (action.type === 'removePlayer' && game.status !== 'lobby') {
          ownerOnly();
          if (target === game.ownerId) throw new GameError('The owner can’t leave their own game (delete it instead).');
          if (game.status !== 'active' || !game.state) throw new GameError('This game is over. Tap Keep playing first to remove someone.');
          removeMidGame(game, players, target);
          break;
        }
        lobbyOnly();
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
      case 'extend': {
        // "Keep playing": the same game deals on, with the totals, hand numbers and pass rotation carried over.
        ownerOnly();
        if (game.status === 'active') throw new GameError('This game is already back in play.');
        const state = game.state;
        if (game.status !== 'finished' || !state) throw new GameError('Only a finished game can be continued.');
        const shown = action.handsPlayed;
        if (shown !== undefined && !Number.isInteger(shown)) throw new GameError('Invalid request.');
        if (shown !== undefined && shown !== state.handsPlayed) throw new GameError('This game has moved on. Reload and try again.', 409);
        if (rematchFor(game)) throw new GameError('This game already has a rematch. Delete the rematch to keep playing this one.', 409);
        // Hearts ends on the highest total, so a limit at or below it would end the game again at once.
        // Checked here, not with normalizeSettings, which quietly turns anything odd into "no limit".
        const top = Math.max(...state.scores);
        const limit = action.scoreLimit === undefined ? game.settings.scoreLimit : action.scoreLimit;
        if (limit !== null && !(Number.isInteger(limit) && limit >= Math.max(1, top + 1) && limit <= 1_000_000)) {
          throw new GameError(`Pick a limit above ${top}, or no limit.`);
        }
        state.extensions = [...(state.extensions ?? []), { afterHand: state.handsPlayed, from: game.settings.scoreLimit, to: limit, at: now() }];
        game.settings = { ...game.settings, scoreLimit: limit };
        continueGame(state);
        // Everyone is back in their own seat. With a move timer, anyone away goes back on autopilot after one allowance.
        delete state.autopilot;
        // A link still here points at a rematch that has been deleted.
        delete state.rematchId;
        premoves.delete(gameId);
        touchClock(state, true);
        game.status = 'active';
        game.finishedAt = null;
        undoable();
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
          const result = gamePlay(state, seat, move.card, game.settings);
          undoable();
          applyResult(game, result, players);
        } else throw new GameError('Unknown move.');
        undoable();
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
          undoable();
          applyResult(game, result, players);
        } else if (action.scope === 'trick') {
          const tricks = hand.tricks.length;
          undoable();
          aiUntil(game, players, (s) => s.hand !== hand || hand.tricks.length > tricks);
        } else if (action.scope === 'hand') {
          undoable();
          aiUntil(game, players, (s) => s.hand !== hand);
        } else throw new GameError('Unknown scope.');
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
        premoves.delete(gameId);
        const current = game.state;
        game.state = JSON.parse(target.state) as GameState;
        // Settings aren't in the snapshots: undoing past a "Keep playing" puts the old limit back.
        const dropped = current?.extensions?.[game.state.extensions?.length ?? 0];
        if (dropped) game.settings = { ...game.settings, scoreLimit: dropped.from };
        // A rematch isn't undone, so its link stays (and a second one can't be made).
        if (current?.rematchId) game.state.rematchId = current.rematchId;
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
        premoves.delete(gameId);
        touchClock(game.state, true);
        undoable();
        break;
      }
      default:
        throw new GameError('Unknown action.');
    }
    saveGame(game);
  });
  if (!changed) {
    // Your other tabs show what you queued; nobody else hears a thing.
    if (action.type === 'premove') publishTo(gameId, userId);
    return;
  }
  publish(gameId);
  if (action.type === 'leave' || action.type === 'removePlayer') publishRematchSource(gameId);
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
    // Once cards are dealt the house rules stay put, except at a playtest table.
    if (game.status === 'lobby' || game.mode === 'playtest') game.settings = next;
    else game.settings = { ...game.settings, ...Object.fromEntries(MID_GAME_SETTINGS.map((key) => [key, next[key]])) };
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
      premoves.delete(gameId);
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
  premoves.delete(gameId);
  publish(gameId);
  publishRematchSource(gameId);
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
    // Only the people the table is really waiting on: not seats the server is about to play.
    const plays = serverPlays(game, players);
    const toAct = game.status === 'active' && game.state ? seatsToAct(game.state).filter((s) => !players[s]?.isBot && !plays(s)) : [];
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
    if (seatsToAct(game.state).some(serverPlays(game, players))) {
      // Linger a bit longer right after a trick closes so people can see it (the final trick waits the same).
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
 * computer owes right now: all its passes, or one card. In the final trick it's every card the
 * server plays, in one save and one update, and the browser staggers them. Returns true if
 * anything changed.
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
      const timedOut = clocked(game, players);
      for (const seat of seatsToAct(state)) if (timedOut(seat)) setAutopilot(game, seat, true);
      changed = true;
    }

    const hand = state.hand;
    const finalTrick = !!hand && isFinalTrick(hand);
    const before = snapshot(game, 'bot');
    let result = aiStep(state, game.settings, serverPlays(game, players));
    // Below any queued card that fires in applyResult, so undo takes that back first.
    if (result) remember(gameId, before);
    while (result) {
      applyResult(game, result, players);
      changed = true;
      if (!finalTrick || game.status !== 'active' || state.hand !== hand) break;
      result = aiStep(state, game.settings, serverPlays(game, players));
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
