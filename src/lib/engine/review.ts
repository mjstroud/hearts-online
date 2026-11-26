import { type Card, JACK_OF_DIAMONDS, penaltyPoints } from './cards';
import { JACK_VALUE, passLabel } from './rules';
import type { HandRecord } from './scoring';

/** One finished trick, as the table saw it. */
export interface ReviewTrick {
  /** 1-based. */
  number: number;
  leader: number;
  /** In play order. */
  plays: { seat: number; card: Card }[];
  winner: number;
  /** Hearts, 13 for the Q♠, and −10 for the J♦ when it counted. */
  points: number;
}

/** Everything the post-hand trick review shows. Built from the stored record, with no deal or pass details. */
export interface HandReview {
  number: number;
  numPlayers: number;
  passLabel: string;
  tricks: ReviewTrick[];
  crib: Card[];
  cribWinner: number;
  cribPoints: number;
  scores: number[];
  moon: number | null;
  sun: number | null;
}

export function reviewHand(record: HandRecord): HandReview {
  return {
    number: record.number,
    numPlayers: record.numPlayers,
    passLabel: passLabel(record.passOffset, record.numPlayers),
    tricks: record.tricks.map((t, i) => {
      const cards = t.plays.map((p) => p.card);
      const jack = record.jackScored && cards.includes(JACK_OF_DIAMONDS) ? JACK_VALUE : 0;
      return {
        number: i + 1,
        leader: t.leader,
        plays: t.plays.map((p) => ({ seat: p.seat, card: p.card })),
        winner: t.winner,
        points: penaltyPoints(cards) + jack,
      };
    }),
    crib: record.crib,
    cribWinner: record.cribWinner,
    cribPoints: record.cribPoints,
    scores: record.scores,
    moon: record.moon,
    sun: record.sun,
  };
}
