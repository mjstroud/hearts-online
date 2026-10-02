import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, penaltyPoints } from './cards';
import type { GameState } from './game';
import { type HandPhase, type Trick, legalPlays } from './hand';
import { type GameSettings, PASS_COUNT, passLabel } from './rules';
import type { HandRecord } from './scoring';

/**
 * What one seat is allowed to see. Built on the server, so other players'
 * cards (and the crib, unless you won it) never reach your browser.
 */
export interface TableView {
  handNumber: number;
  phase: HandPhase;
  passOffset: number;
  passLabel: string;
  passCount: number;
  mySeat: number | null;
  myHand: Card[];
  legal: Card[];
  myPass: Card[] | null;
  received: Card[];
  passTarget: number | null;
  passSource: number | null;
  passed: boolean[];
  handSizes: number[];
  cribSize: number;
  cribWinner: number | null;
  /** Crib contents, only for the seat that won it. */
  myCrib: Card[] | null;
  current: Trick | null;
  /** The most recently completed trick. */
  lastTrick: Trick | null;
  turn: number | null;
  heartsBroken: boolean;
  trickNumber: number;
  totalTricks: number;
  tricksWon: number[];
  /** Points visible from face-up tricks (crib points are only added for its winner's own view). */
  pointsTaken: number[];
  queenTakenBy: number | null;
  jackTakenBy: number | null;
}

/** Public end-of-hand summary (no deal details). */
export interface HandSummary {
  number: number;
  passOffset: number;
  passLabel: string;
  scores: number[];
  penalty: number[];
  hearts: number[];
  tricksWon: number[];
  queen: number;
  jack: number;
  jackScored: boolean;
  crib: Card[];
  cribWinner: number;
  cribPoints: number;
  moon: number | null;
  sun: number | null;
  finalTrick: Trick | null;
}

export function summarizeHand(r: HandRecord): HandSummary {
  const last = r.tricks.at(-1);
  return {
    number: r.number,
    passOffset: r.passOffset,
    passLabel: passLabel(r.passOffset, r.numPlayers),
    scores: r.scores,
    penalty: r.penalty,
    hearts: r.hearts,
    tricksWon: r.tricksWon,
    queen: r.queen,
    jack: r.jack,
    jackScored: r.jackScored,
    crib: r.crib,
    cribWinner: r.cribWinner,
    cribPoints: r.cribPoints,
    moon: r.moon,
    sun: r.sun,
    finalTrick: last ? { leader: last.leader, plays: last.plays, winner: last.winner } : null,
  };
}

export function tableViewFor(game: GameState, seat: number | null, settings: GameSettings): TableView | null {
  const h = game.hand;
  if (!h) return null;
  const n = h.numPlayers;
  const isSeat = seat !== null && seat >= 0 && seat < n;
  const mine = isSeat ? seat : null;

  const tricksWon = Array.from({ length: n }, () => 0);
  const pointsTaken = Array.from({ length: n }, () => 0);
  let queenTakenBy: number | null = null;
  let jackTakenBy: number | null = null;
  for (const t of h.tricks) {
    const w = t.winner!;
    const cards = t.plays.map((p) => p.card);
    tricksWon[w] += 1;
    pointsTaken[w] += penaltyPoints(cards);
    if (cards.includes(QUEEN_OF_SPADES)) queenTakenBy = w;
    if (cards.includes(JACK_OF_DIAMONDS)) jackTakenBy = w;
  }
  const ownCrib = mine !== null && h.cribWinner === mine;
  if (ownCrib) {
    pointsTaken[mine] += penaltyPoints(h.crib);
    if (h.crib.includes(QUEEN_OF_SPADES)) queenTakenBy = mine;
    if (h.crib.includes(JACK_OF_DIAMONDS)) jackTakenBy = mine;
  }
  if (settings.jackOfDiamonds && jackTakenBy !== null) pointsTaken[jackTakenBy] -= 10;

  const totalTricks = h.dealt[0].length;
  const lastTrick = h.tricks.at(-1) ?? (game.lastHand ? summarizeHand(game.lastHand).finalTrick : null);

  return {
    handNumber: h.number,
    phase: h.phase,
    passOffset: h.passOffset,
    passLabel: passLabel(h.passOffset, n),
    passCount: PASS_COUNT,
    mySeat: mine,
    myHand: mine !== null ? h.hands[mine] : [],
    legal: mine !== null ? legalPlays(h, mine, settings) : [],
    myPass: mine !== null ? h.passes[mine] : null,
    received: mine !== null && h.phase !== 'passing' ? h.received[mine] : [],
    passTarget: mine !== null && h.passOffset !== 0 ? (mine + h.passOffset) % n : null,
    passSource: mine !== null && h.passOffset !== 0 ? (mine - h.passOffset + n) % n : null,
    passed: h.passes.map(Boolean),
    handSizes: h.hands.map((c) => c.length),
    cribSize: h.crib.length,
    cribWinner: h.cribWinner,
    myCrib: ownCrib ? h.crib : null,
    current: h.current,
    lastTrick,
    turn: h.turn,
    heartsBroken: h.heartsBroken,
    trickNumber: Math.min(h.tricks.length + 1, totalTricks),
    totalTricks,
    tricksWon,
    pointsTaken,
    queenTakenBy,
    jackTakenBy,
  };
}
