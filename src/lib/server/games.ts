import { chooseBotPass, chooseBotPlay } from '../engine/bot';
import { type Card, isCard, secureRng } from '../engine/cards';
import { type ActionResult, type GameState, gamePass, gamePlay, leaders, newGame, seatsToAct } from '../engine/game';
import { RuleError } from '../engine/hand';
import { type GameSettings, MAX_PLAYERS, MIN_PLAYERS, normalizeSettings } from '../engine/rules';
import type { HandRecord } from '../engine/scoring';
import { summarizeHand, tableViewFor } from '../engine/view';
import type { GameAction, GameListItem, GameStatus, GameView } from '../types';
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
  settings: GameSettings;
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
}

interface GameRow {
  id: string;
  name: string;
  owner_id: number;
  join_code: string;
  status: GameStatus;
  settings: string;
  state: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const toRecord = (r: GameRow): GameRecord => ({
  id: r.id,
  name: r.name,
  ownerId: r.owner_id,
  joinCode: r.join_code,
  status: r.status,
  settings: normalizeSettings(JSON.parse(r.settings)),
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
    `SELECT gp.seat, u.id AS user_id, u.username, u.display_name, u.is_bot
     FROM game_players gp JOIN users u ON u.id = gp.user_id
     WHERE gp.game_id = ? ORDER BY gp.seat`,
  ).all(gameId) as { seat: number; user_id: number; username: string; display_name: string; is_bot: number }[];
  return rows.map((r) => ({ seat: r.seat, userId: r.user_id, username: r.username, displayName: r.display_name, isBot: !!r.is_bot }));
}

function saveGame(game: GameRecord) {
  game.updatedAt = now();
  sql(
    `UPDATE games SET name = ?, status = ?, settings = ?, state = ?, version = version + 1,
       updated_at = ?, started_at = ?, finished_at = ? WHERE id = ?`,
  ).run(
    game.name,
    game.status,
    JSON.stringify(game.settings),
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

export function createGame(ownerId: number, name: string, settings: GameSettings): string {
  return transaction(() => {
    const id = newGameId();
    let code = newJoinCode();
    while (sql('SELECT 1 FROM games WHERE join_code = ?').get(code)) code = newJoinCode();
    const t = now();
    sql(
      'INSERT INTO games (id, name, owner_id, join_code, status, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, name, ownerId, code, 'lobby', JSON.stringify(settings), t, t);
    sql('INSERT INTO game_players (game_id, user_id, seat, joined_at) VALUES (?, ?, 0, ?)').run(id, ownerId, t);
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

const BOT_NAMES = ['Robo Rosie', 'Captain Clubs', 'Duchess Diamond', 'Sir Spade', 'Hal of Hearts'];

function botUserIds(): number[] {
  const existing = sql('SELECT id FROM users WHERE is_bot = 1 ORDER BY id').all() as { id: number }[];
  if (existing.length >= BOT_NAMES.length) return existing.map((r) => r.id);
  BOT_NAMES.forEach((name, i) => {
    sql('INSERT OR IGNORE INTO users (username, display_name, password_hash, is_bot, created_at) VALUES (?, ?, NULL, 1, ?)').run(
      `bot-${i + 1}`,
      name,
      now(),
    );
  });
  return (sql('SELECT id FROM users WHERE is_bot = 1 ORDER BY id').all() as { id: number }[]).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Views

export function buildView(game: GameRecord, players: SeatedPlayer[], userId: number, online: Set<number>): GameView {
  const me = players.find((p) => p.userId === userId);
  const seat = me?.seat ?? null;
  const state = game.status === 'lobby' ? null : game.state;
  const scores = state?.scores ?? players.map(() => 0);
  return {
    id: game.id,
    name: game.name,
    status: game.status,
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
    })),
    me: { userId, seat, isOwner: game.ownerId === userId },
    table: state && game.status === 'active' ? tableViewFor(state, seat, game.settings) : null,
    lastHand: state?.lastHand ? summarizeHand(state.lastHand) : null,
    toAct: state && game.status === 'active' ? seatsToAct(state) : [],
    leaders: state && state.handsPlayed > 0 ? leaders(state.scores) : [],
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

function applyResult(game: GameRecord, result: ActionResult) {
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

    switch (action?.type) {
      case 'pass':
      case 'play': {
        if (game.status !== 'active' || !game.state) throw new GameError('The game is not in progress.');
        if (action.type === 'pass') gamePass(game.state, me.seat, parseCards(action.cards));
        else {
          if (!isCard(action.card)) throw new GameError('Invalid card.');
          applyResult(game, gamePlay(game.state, me.seat, action.card, game.settings));
        }
        break;
      }
      case 'start': {
        ownerOnly();
        lobbyOnly();
        if (players.length < MIN_PLAYERS) throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
        game.state = newGame(players.length, game.settings);
        game.status = 'active';
        game.startedAt = now();
        break;
      }
      case 'addBot': {
        ownerOnly();
        lobbyOnly();
        if (players.length >= MAX_PLAYERS) throw new GameError('The table is full.');
        const botId = botUserIds().find((id) => !players.some((p) => p.userId === id));
        if (botId === undefined) throw new GameError('No more computer players available.');
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
      default:
        throw new GameError('Unknown action.');
    }
    saveGame(game);
  });
  publish(gameId);
  scheduleBots(gameId);
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
    if (name) game.name = name.slice(0, 60);
    const next = normalizeSettings({ ...game.settings, ...input });
    // Once cards are dealt only the score limit can change; the rules stay fixed for fairness.
    game.settings = game.status === 'lobby' ? next : { ...game.settings, scoreLimit: next.scoreLimit };
    saveGame(game);
  });
  publish(gameId);
}

export function endGame(gameId: string, userId: number) {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game) throw new GameError('That game no longer exists.', 404);
    if (game.ownerId !== userId) throw new GameError('Only the game’s owner can end the game.', 403);
    if (game.status !== 'active' || !game.state) throw new GameError('The game is not in progress.');
    // The hand in progress is discarded; totals stand as of the last completed hand.
    game.state.hand = null;
    game.state.over = true;
    game.status = 'finished';
    game.finishedAt = now();
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
      isOwner: game.ownerId === userId,
      joinCode: game.joinCode,
      handsPlayed: game.state?.handsPlayed ?? 0,
      players: players.map((p) => ({ name: p.displayName, isBot: p.isBot, score: scores[p.seat] ?? 0, isMe: p.userId === userId })),
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

// ---------------------------------------------------------------------------
// Computer players

const g = globalThis as typeof globalThis & { __heartsBotTimers?: Map<string, ReturnType<typeof setTimeout>> };
const botTimers: Map<string, ReturnType<typeof setTimeout>> = (g.__heartsBotTimers ??= new Map());

const botFailures = new Map<string, number>();

export function scheduleBots(gameId: string, retryDelay?: number) {
  try {
    if (botTimers.has(gameId)) return;
    const game = loadGame(gameId);
    if (!game || game.status !== 'active' || !game.state?.hand) return;
    const players = getPlayers(gameId);
    if (!seatsToAct(game.state).some((s) => players[s]?.isBot)) return;
    // Linger a bit longer right after a trick closes so people can see it.
    const hand = game.state.hand;
    const delay =
      retryDelay ?? (hand.phase === 'playing' && hand.current?.plays.length === 0 && hand.tricks.length > 0 ? 1700 : 900);
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
  try {
    botTurn(gameId);
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
  publish(gameId);
  scheduleBots(gameId);
}

/** Make whatever moves computer players owe right now (all bot passes, or one bot card). */
function botTurn(gameId: string) {
  transaction(() => {
    const game = loadGame(gameId);
    if (!game || game.status !== 'active' || !game.state?.hand) return;
    const players = getPlayers(gameId);
    const hand = game.state.hand;
    if (hand.phase === 'passing') {
      for (const seat of seatsToAct(game.state)) {
        if (players[seat]?.isBot) gamePass(game.state, seat, chooseBotPass(hand.hands[seat]));
      }
    } else if (hand.turn !== null && players[hand.turn]?.isBot) {
      const card = chooseBotPlay(hand, hand.turn, game.settings);
      applyResult(game, gamePlay(game.state, hand.turn, card, game.settings));
    } else return;
    saveGame(game);
  });
}

/** On boot, resume any games that were waiting on a computer player. */
export function resumeBots() {
  const rows = sql("SELECT id FROM games WHERE status = 'active'").all() as { id: string }[];
  for (const r of rows) scheduleBots(r.id);
}
