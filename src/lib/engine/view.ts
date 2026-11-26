import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, isHeart, isPenaltyCard, penaltyPoints } from './cards';
import type { GameState } from './game';
import { type HandPhase, type Trick, legalPlays } from './hand';
import { type GameSettings, PASS_COUNT, passLabel } from './rules';
import { type HandRecord, tableTricks, tableTricksWon } from './scoring';

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
  // Public table facts. These come from face-up cards only (never the crib), so every seat,
  // the crib winner included, gets the same values and they're safe to drive table-wide moments.
  /** The first point card played this hand (a heart or the Q♠): who played it, and on which trick (1-based). */
  heartsBrokenBy: { seat: number; card: Card; trick: number } | null;
  /** The seat that has won every trick so far, once enough tricks are done to matter (4 of 12, 3 of 9). */
  sunWatch: number | null;
  /** The seat that has taken every point card played so far, with at least 7 hearts. Not a sure thing: the crib may hold a heart. */
  moonWatch: number | null;
  /** The seat that has won every trick so far, from the first one on, and how many. It lights the Sun glow (see watch.ts). */
  sunRun: { seat: number; tricks: number } | null;
  /** The seat that has taken every point card played so far, once that includes a heart: its hearts, and whether the Q♠ is among them. It lights the Moon glow. */
  moonRun: { seat: number; hearts: number; queen: boolean } | null;
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
  /** The last trick the table saw played (before any the server played out on its own). */
  finalTrick: Trick | null;
  /** The first trick the server played out because nothing left could score, or null. */
  autoFrom: number | null;
  /**
   * Display names by seat for this hand, filled in by the server only when they differ from who
   * sits there now (someone who played it was removed since).
   */
  names?: string[];
}

export function summarizeHand(r: HandRecord): HandSummary {
  const last = tableTricks(r).at(-1);
  return {
    number: r.number,
    passOffset: r.passOffset,
    passLabel: passLabel(r.passOffset, r.numPlayers),
    scores: r.scores,
    penalty: r.penalty,
    hearts: r.hearts,
    // Tricks played out on their own aren't anyone's doing, so they don't count.
    tricksWon: tableTricksWon(r),
    queen: r.queen,
    jack: r.jack,
    jackScored: r.jackScored,
    crib: r.crib,
    cribWinner: r.cribWinner,
    cribPoints: r.cribPoints,
    moon: r.moon,
    sun: r.sun,
    finalTrick: last ? { leader: last.leader, plays: last.plays, winner: last.winner } : null,
    autoFrom: r.autoFrom ?? null,
  };
}

/** Hearts a seat must have taken, with nobody else taking any point card, before a Moon watch starts. */
export const MOON_WATCH_HEARTS = 7;

/** Tricks one seat must win from the start before a Sun watch starts: 4 of 12, 3 of 9. */
export const sunWatchFrom = (totalTricks: number) => Math.ceil(totalTricks / 3);

type PublicFacts = Pick<TableView, 'heartsBrokenBy' | 'sunWatch' | 'moonWatch' | 'sunRun' | 'moonRun'>;

/**
 * The table facts everyone may see. It's handed the face-up cards only (finished tricks and the
 * trick in progress), never the hand, so the crib can't leak into them.
 */
export function publicFacts(tricks: readonly Trick[], current: Trick | null, totalTricks: number, settings: GameSettings): PublicFacts {
  let heartsBrokenBy: PublicFacts['heartsBrokenBy'] = null;
  const faceUp = current ? [...tricks, current] : tricks;
  for (let i = 0; i < faceUp.length && !heartsBrokenBy; i++) {
    const play = faceUp[i].plays.find((p) => isPenaltyCard(p.card));
    if (play) heartsBrokenBy = { seat: play.seat, card: play.card, trick: i + 1 };
  }

  // Watches count finished tricks only: the trick on the felt hasn't been won yet.
  const leader = tricks[0]?.winner ?? null;
  const sweeping = leader !== null && tricks.length >= sunWatchFrom(totalTricks) && tricks.every((t) => t.winner === leader);

  // Every trick with a point card in it went to the same seat.
  const takers = tricks.filter((t) => t.plays.some((p) => isPenaltyCard(p.card))).map((t) => t.winner);
  const hearts = tricks.reduce((n, t) => n + t.plays.filter((p) => isHeart(p.card)).length, 0);
  const oneTaker = takers.length > 0 && takers.every((w) => w === takers[0]);
  const hoarder = oneTaker && hearts >= MOON_WATCH_HEARTS ? takers[0] : null;

  // The runs behind the glows: the same facts from the first trick and the first heart on.
  const sun = settings.showWatches && settings.shootTheSun;
  const moon = settings.showWatches && settings.shootTheMoon;
  const unbroken = leader !== null && tricks.every((t) => t.winner === leader);
  const queen = tricks.some((t) => t.plays.some((p) => p.card === QUEEN_OF_SPADES));

  return {
    heartsBrokenBy,
    sunWatch: sun && sweeping ? leader : null,
    moonWatch: moon ? hoarder : null,
    sunRun: sun && unbroken ? { seat: leader, tricks: tricks.length } : null,
    moonRun: moon && oneTaker && hearts > 0 ? { seat: takers[0], hearts, queen } : null,
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
    ...publicFacts(h.tricks, h.current, totalTricks, settings),
  };
}
