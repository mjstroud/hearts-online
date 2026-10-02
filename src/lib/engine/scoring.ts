import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, isHeart, penaltyPoints } from './cards';
import { type HandState, type TrickPlay, cardsWon, tricksWon } from './hand';
import { type GameSettings, JACK_VALUE, MOON_VALUE, SUN_VALUE } from './rules';

/** Permanent log of a finished hand. Everything the stats pages need comes from these. */
export interface HandRecord {
  number: number;
  numPlayers: number;
  passOffset: number;
  dealt: Card[][];
  /** Cards each seat passed (null on keep hands). */
  passes: Card[][] | null;
  crib: Card[];
  cribWinner: number;
  tricks: { leader: number; plays: TrickPlay[]; winner: number }[];
  /** Heart + Queen points each seat physically took. */
  penalty: number[];
  hearts: number[];
  tricksWon: number[];
  queen: number;
  jack: number;
  /** Whether the Jack of Diamonds counted when this hand was scored. */
  jackScored: boolean;
  /** Point value of the crib for whoever won it (hearts, queen, and jack if scored). */
  cribPoints: number;
  moon: number | null;
  sun: number | null;
  /** Final score for each seat this hand, after moon/sun adjustments. */
  scores: number[];
}

export function scoreHand(state: HandState, settings: GameSettings): HandRecord {
  if (state.phase !== 'done' || state.cribWinner === null) throw new Error('Hand is not finished');
  const n = state.numPlayers;
  const seats = Array.from({ length: n }, (_, s) => s);
  const won = seats.map((s) => cardsWon(state, s));
  const penalty = won.map((cards) => penaltyPoints(cards));
  const hearts = won.map((cards) => cards.filter(isHeart).length);
  const tricks = seats.map((s) => tricksWon(state, s));
  const queen = seats.find((s) => won[s].includes(QUEEN_OF_SPADES))!;
  const jack = seats.find((s) => won[s].includes(JACK_OF_DIAMONDS))!;
  const jackPts = seats.map((s) => (settings.jackOfDiamonds && s === jack ? JACK_VALUE : 0));

  const totalTricks = state.tricks.length;
  const sun = settings.shootTheSun ? (seats.find((s) => tricks[s] === totalTricks) ?? null) : null;
  const moon = sun === null && settings.shootTheMoon ? (seats.find((s) => penalty[s] === 26) ?? null) : null;

  let scores: number[];
  if (sun !== null) scores = seats.map((s) => (s === sun ? 0 : SUN_VALUE) + jackPts[s]);
  else if (moon !== null) scores = seats.map((s) => (s === moon ? 0 : MOON_VALUE) + jackPts[s]);
  else scores = seats.map((s) => penalty[s] + jackPts[s]);

  const cribPoints =
    penaltyPoints(state.crib) + (settings.jackOfDiamonds && state.crib.includes(JACK_OF_DIAMONDS) ? JACK_VALUE : 0);

  return {
    number: state.number,
    numPlayers: n,
    passOffset: state.passOffset,
    dealt: state.dealt,
    passes: state.passOffset === 0 ? null : (state.passes as Card[][]),
    crib: state.crib,
    cribWinner: state.cribWinner,
    tricks: state.tricks.map((t) => ({ leader: t.leader, plays: t.plays, winner: t.winner! })),
    penalty,
    hearts,
    tricksWon: tricks,
    queen,
    jack,
    jackScored: settings.jackOfDiamonds,
    cribPoints,
    moon,
    sun,
    scores,
  };
}
