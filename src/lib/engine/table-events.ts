/**
 * What the whole table just watched happen, for the cats' chatter (Phase 4a). Worked out on the
 * server from a count-only mark taken before a change and the state after it, using face-up cards
 * only: the finished tricks, the trick on the felt and, at the end of a hand, what the result shows
 * everyone. Never the hands, the crib, the passes, the deal, legal plays or queued cards (ground
 * rule 7), so nothing a cat does can give away a hidden card.
 */
import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, isPenaltyCard } from './cards';
import type { GameState } from './game';
import type { Trick, TrickPlay } from './hand';
import type { GameSettings } from './rules';
import { tableTricks } from './scoring';

export type TableEvent =
  | { kind: 'trick' | 'queen' | 'jack' | 'sun' | 'moon'; seat: number; handEnd: boolean }
  | { kind: 'hearts'; seat: number; card: Card; handEnd: boolean };

/**
 * Counts from before a change, never references: the hand's objects are changed in place, so
 * anything kept from them would already show the change.
 */
export interface FaceUpMark {
  /** The hand in progress, or null between games. */
  hand: number | null;
  /** Its finished tricks. */
  done: number;
  /** Whether a point card had been played in it. */
  broken: boolean;
  /** The last finished hand's number, 0 before the first. */
  lastHand: number;
}

export function faceUpMark(state: GameState | null): FaceUpMark {
  const hand = state?.hand ?? null;
  return {
    hand: hand?.number ?? null,
    done: hand?.tricks.length ?? 0,
    broken: !!hand?.heartsBroken,
    lastHand: state?.lastHand?.number ?? 0,
  };
}

/**
 * The first point card played face up (a heart or the Q♠), which is what breaks hearts: the same
 * rule as publicFacts' heartsBrokenBy in view.ts.
 */
function firstPointCard(tricks: readonly Pick<Trick, 'plays'>[]): TrickPlay | null {
  for (const t of tricks) {
    const play = t.plays.find((p) => isPenaltyCard(p.card));
    if (play) return play;
  }
  return null;
}

/** Each finished trick's winner, and the Q♠ or J♦ (when it counts) going with it. */
function trickEvents(tricks: readonly Trick[], jackScores: boolean, handEnd: boolean): TableEvent[] {
  const out: TableEvent[] = [];
  for (const t of tricks) {
    if (t.winner === null) continue;
    const cards = t.plays.map((p) => p.card);
    out.push({ kind: 'trick', seat: t.winner, handEnd });
    if (cards.includes(QUEEN_OF_SPADES)) out.push({ kind: 'queen', seat: t.winner, handEnd });
    if (jackScores && cards.includes(JACK_OF_DIAMONDS)) out.push({ kind: 'jack', seat: t.winner, handEnd });
  }
  return out;
}

function eventsSince(mark: FaceUpMark, state: GameState | null, settings: GameSettings): TableEvent[] {
  if (!state) return [];
  const record = state.lastHand;
  // The marked hand just ended. Look at its record, never state.hand: the next hand is dealt in the
  // same call (or none, if the game ended), so state.hand is already something else.
  if (record && record.number > mark.lastHand && mark.hand === record.number) {
    // Without the tricks the server played out once nothing could score: the table never saw them.
    const tricks = tableTricks(record);
    const out = trickEvents(tricks.slice(mark.done), !!record.jackScored, true);
    const broke = mark.broken ? null : firstPointCard(tricks);
    if (broke) out.push({ kind: 'hearts', seat: broke.seat, card: broke.card, handEnd: true });
    // The result tells everyone about a Sun or Moon, so it's public by now.
    if (typeof record.sun === 'number') out.push({ kind: 'sun', seat: record.sun, handEnd: true });
    if (typeof record.moon === 'number') out.push({ kind: 'moon', seat: record.moon, handEnd: true });
    return out;
  }
  // The same hand, moved on. A new deal, a redeal, an undo, End now or Keep playing is nothing the table watched.
  const hand = state.hand;
  if (!hand || hand.number !== mark.hand || hand.tricks.length < mark.done) return [];
  const out = trickEvents(hand.tricks.slice(mark.done), settings.jackOfDiamonds, false);
  if (!mark.broken && hand.heartsBroken) {
    // On the felt already, before its trick is over.
    const broke = firstPointCard(hand.current ? [...hand.tricks, hand.current] : hand.tricks);
    if (broke) out.push({ kind: 'hearts', seat: broke.seat, card: broke.card, handEnd: false });
  }
  return out;
}

/**
 * The moments one change made, in order: each newly finished trick (its winner, then the Q♠ and the
 * J♦ in it), hearts broken, then a Sun or Moon. Empty for anything the table didn't watch happen.
 * Never throws: it runs inside a move's transaction, and the move must stand either way.
 */
export function tableEvents(mark: FaceUpMark, state: GameState | null, settings: GameSettings): TableEvent[] {
  try {
    return eventsSince(mark, state, settings);
  } catch (err) {
    console.error('Failed to work out the table’s moments', err);
    return [];
  }
}
