import { QUEEN_OF_SPADES } from '../engine/cards';
import { type HandRecord, tableTricksWon } from '../engine/scoring';
import type { GameStatus } from '../types';
import { sql } from './db';
import {
  type Occupant,
  type OccupantOf,
  type RemovedPlayer,
  type SeatedPlayer,
  getHandRecords,
  getPlayers,
  occupants,
  removedPlayers,
} from './games';

export type { RemovedPlayer };

/** Display names by seat for one finished hand: the people who played it, not who sits there now. */
export function handNames(gameId: string, record: HandRecord): string[] {
  const occupant = occupants(getPlayers(gameId), removedPlayers(gameId));
  return Array.from({ length: record.numPlayers }, (_, seat) => occupant(record, seat)?.displayName ?? '');
}

export interface PlayerStats {
  userId: number;
  name: string;
  isBot: boolean;
  hands: number;
  total: number;
  queens: number;
  jacks: number;
  cribs: number;
  /** Sum of point values of the cribs this player won. */
  cribValue: number;
  moons: number;
  suns: number;
  /** Hands finished at zero points or better. */
  clean: number;
  hearts: number;
  tricks: number;
  best: number | null;
  worst: number | null;
  /** Hands where this player had the lowest score (ties count). */
  handWins: number;
  queenPassed: number;
  queenReceived: number;
  /** Times someone else shot the moon or sun on you. */
  shotOn: number;
}

function emptyStats(p: Occupant): PlayerStats {
  return {
    userId: p.userId,
    name: p.displayName,
    isBot: p.isBot,
    hands: 0,
    total: 0,
    queens: 0,
    jacks: 0,
    cribs: 0,
    cribValue: 0,
    moons: 0,
    suns: 0,
    clean: 0,
    hearts: 0,
    tricks: 0,
    best: null,
    worst: null,
    handWins: 0,
    queenPassed: 0,
    queenReceived: 0,
    shotOn: 0,
  };
}

function accumulate(stats: Map<number, PlayerStats>, record: HandRecord, occupant: OccupantOf) {
  const n = record.numPlayers;
  const low = Math.min(...record.scores);
  const players = Array.from({ length: n }, (_, seat) => occupant(record, seat));
  // Tricks played out on their own once nothing could score aren't anyone's doing.
  const tricksWon = tableTricksWon(record);
  for (let seat = 0; seat < n; seat++) {
    const p = players[seat];
    if (!p) continue;
    let s = stats.get(p.userId);
    if (!s) stats.set(p.userId, (s = emptyStats(p)));
    const score = record.scores[seat];
    s.hands += 1;
    s.total += score;
    if (record.queen === seat) s.queens += 1;
    if (record.jack === seat) s.jacks += 1;
    if (record.cribWinner === seat) {
      s.cribs += 1;
      s.cribValue += record.cribPoints;
    }
    if (record.moon === seat) s.moons += 1;
    if (record.sun === seat) s.suns += 1;
    const shooter = record.sun ?? record.moon;
    if (shooter !== null && shooter !== seat) s.shotOn += 1;
    if (score <= 0) s.clean += 1;
    s.hearts += record.hearts[seat];
    s.tricks += tricksWon[seat];
    s.best = s.best === null ? score : Math.min(s.best, score);
    s.worst = s.worst === null ? score : Math.max(s.worst, score);
    if (score === low) s.handWins += 1;
  }
  if (record.passes) {
    record.passes.forEach((cards, from) => {
      if (!cards.includes(QUEEN_OF_SPADES)) return;
      const to = (from + record.passOffset) % n;
      const giver = players[from] && stats.get(players[from].userId);
      const taker = players[to] && stats.get(players[to].userId);
      if (giver) giver.queenPassed += 1;
      if (taker) taker.queenReceived += 1;
    });
  }
}

export interface ScoreSeries {
  userId: number;
  name: string;
  /** Running total after each hand (index 0 = after hand 1). */
  totals: number[];
}

export interface GameStats {
  /** Everyone seated, then anyone removed who finished a hand first. */
  players: PlayerStats[];
  /** By seat, whoever played it: a seat's total is the game's. */
  series: ScoreSeries[];
  hands: HandRecord[];
  seated: SeatedPlayer[];
  /** People the host removed mid-game, earliest first. */
  removed: RemovedPlayer[];
}

export function gameStats(gameId: string): GameStats {
  const seated = getPlayers(gameId);
  const removed = removedPlayers(gameId);
  const hands = getHandRecords(gameId);
  const occupant = occupants(seated, removed);
  const stats = new Map<number, PlayerStats>();
  for (const p of seated) stats.set(p.userId, emptyStats(p));
  const departed = removed.filter((r) => r.throughHand > 0 && !stats.has(r.userId));
  for (const r of departed) stats.set(r.userId, emptyStats({ userId: r.userId, displayName: r.displayName, isBot: false }));
  for (const h of hands) accumulate(stats, h, occupant);
  const series = seated.map((p) => {
    let running = 0;
    return { userId: p.userId, name: p.displayName, totals: hands.map((h) => (running += h.scores[p.seat] ?? 0)) };
  });
  const players = [...seated.map((p) => p.userId), ...departed.map((r) => r.userId)].map((id) => stats.get(id)!);
  return { players, series, hands, seated, removed };
}

export interface GameSummary {
  id: string;
  name: string;
  status: GameStatus;
  handsPlayed: number;
  playerCount: number;
  myScore: number;
  rank: number;
  won: boolean;
  updatedAt: number;
  /** The host took you out of this game. Its numbers are then only the hands you played. */
  removed: boolean;
  /** Hands credited to you in this game. */
  myHands: number;
}

export interface UserOverview {
  me: PlayerStats;
  everyone: PlayerStats[];
  games: GameSummary[];
  gamesFinished: number;
  gamesWon: number;
}

/** Lifetime stats for a user, plus everyone they've shared a table with. */
export function userOverview(userId: number, displayName: string): UserOverview {
  // The games you're seated at, and any you were removed from (rp is set only for those).
  const rows = sql(
    `SELECT g.id, g.name, g.status, g.state, g.updated_at, rp.through_hand, rp.removed_at FROM games g
     LEFT JOIN removed_players rp ON rp.game_id = g.id AND rp.user_id = ?
     WHERE g.id IN (SELECT game_id FROM game_players WHERE user_id = ? UNION SELECT game_id FROM removed_players WHERE user_id = ?)
       AND g.status != 'lobby' AND g.mode = 'normal'
     ORDER BY COALESCE(rp.removed_at, g.updated_at) DESC`,
  ).all(userId, userId, userId) as {
    id: string;
    name: string;
    status: GameStatus;
    state: string | null;
    updated_at: number;
    through_hand: number | null;
    removed_at: number | null;
  }[];

  const stats = new Map<number, PlayerStats>();
  const games: GameSummary[] = [];
  for (const row of rows) {
    const seated = getPlayers(row.id);
    const occupant = occupants(seated, removedPlayers(row.id));
    const mySeat = seated.find((p) => p.userId === userId)?.seat;
    // Removed: only the hands you were there for, as you shared them with the rest of the table.
    const through = mySeat === undefined ? (row.through_hand ?? 0) : Infinity;
    let myHands = 0;
    let myTotal = 0;
    for (const h of getHandRecords(row.id)) {
      if (h.number > through) continue;
      accumulate(stats, h, occupant);
      for (let seat = 0; seat < h.numPlayers; seat++) {
        if (occupant(h, seat)?.userId !== userId) continue;
        myHands += 1;
        myTotal += h.scores[seat];
      }
    }
    if (mySeat === undefined) {
      games.push({
        id: row.id,
        name: row.name,
        status: row.status,
        handsPlayed: through,
        playerCount: seated.length,
        myScore: myTotal,
        rank: 0,
        won: false,
        updatedAt: row.removed_at ?? row.updated_at,
        removed: true,
        myHands,
      });
      continue;
    }
    const scores: number[] = row.state ? JSON.parse(row.state).scores : [];
    const myScore = scores[mySeat] ?? 0;
    const handsPlayed: number = row.state ? JSON.parse(row.state).handsPlayed : 0;
    const rank = 1 + scores.filter((s) => s < myScore).length;
    games.push({
      id: row.id,
      name: row.name,
      status: row.status,
      handsPlayed,
      playerCount: seated.length,
      myScore,
      rank,
      won: row.status === 'finished' && handsPlayed > 0 && rank === 1,
      updatedAt: row.updated_at,
      removed: false,
      myHands,
    });
  }
  const me = stats.get(userId) ?? emptyStats({ userId, displayName, isBot: false });
  const everyone = [...stats.values()].sort((a, b) => b.hands - a.hands || a.name.localeCompare(b.name));
  // A game you were removed from isn't one you finished, or could win.
  const finished = games.filter((g) => !g.removed && g.status === 'finished' && g.handsPlayed > 0);
  return { me, everyone, games, gamesFinished: finished.length, gamesWon: finished.filter((g) => g.won).length };
}

export const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);
export const avg = (sum: number, count: number) => (count ? sum / count : 0);
