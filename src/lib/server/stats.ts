import { QUEEN_OF_SPADES } from '../engine/cards';
import type { HandRecord } from '../engine/scoring';
import type { GameStatus } from '../types';
import { sql } from './db';
import { type SeatedPlayer, getHandRecords, getPlayers } from './games';

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

function emptyStats(p: Pick<SeatedPlayer, 'userId' | 'displayName' | 'isBot'>): PlayerStats {
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

function accumulate(stats: Map<number, PlayerStats>, record: HandRecord, players: SeatedPlayer[]) {
  const n = record.numPlayers;
  const low = Math.min(...record.scores);
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
    s.tricks += record.tricksWon[seat];
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
  players: PlayerStats[];
  series: ScoreSeries[];
  hands: HandRecord[];
  seated: SeatedPlayer[];
}

export function gameStats(gameId: string): GameStats {
  const seated = getPlayers(gameId);
  const hands = getHandRecords(gameId);
  const stats = new Map<number, PlayerStats>();
  for (const p of seated) stats.set(p.userId, emptyStats(p));
  for (const h of hands) accumulate(stats, h, seated);
  const series = seated.map((p) => {
    let running = 0;
    return { userId: p.userId, name: p.displayName, totals: hands.map((h) => (running += h.scores[p.seat] ?? 0)) };
  });
  return { players: seated.map((p) => stats.get(p.userId)!), series, hands, seated };
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
  const rows = sql(
    `SELECT g.id, g.name, g.status, g.state, g.updated_at FROM games g
     JOIN game_players gp ON gp.game_id = g.id
     WHERE gp.user_id = ? AND g.status != 'lobby' ORDER BY g.updated_at DESC`,
  ).all(userId) as { id: string; name: string; status: GameStatus; state: string | null; updated_at: number }[];

  const stats = new Map<number, PlayerStats>();
  const games: GameSummary[] = [];
  for (const row of rows) {
    const seated = getPlayers(row.id);
    for (const h of getHandRecords(row.id)) accumulate(stats, h, seated);
    const scores: number[] = row.state ? JSON.parse(row.state).scores : [];
    const mySeat = seated.find((p) => p.userId === userId)!.seat;
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
    });
  }
  const me = stats.get(userId) ?? emptyStats({ userId, displayName, isBot: false });
  const everyone = [...stats.values()].sort((a, b) => b.hands - a.hands || a.name.localeCompare(b.name));
  const finished = games.filter((g) => g.status === 'finished' && g.handsPlayed > 0);
  return { me, everyone, games, gamesFinished: finished.length, gamesWon: finished.filter((g) => g.won).length };
}

export const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);
export const avg = (sum: number, count: number) => (count ? sum / count : 0);
