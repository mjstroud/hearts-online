import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, RANKS, type Suit, SUITS, suitOf } from './cards';
import type { Trick } from './hand';
import type { GameSettings } from './rules';

/**
 * Cards whose taker is part of the score or the stored record. The J♦ counts even with its rule
 * off: who took it is still stored, so it must come from a face-up card, not the server's playout.
 */
const ACCOUNTED: readonly Card[] = [...RANKS.map((r): Card => `${r}H`), QUEEN_OF_SPADES, JACK_OF_DIAMONDS];

/**
 * Whether the rest of the hand can be played out at once: nothing left in anyone's hand can score,
 * as everyone at the table can see. It's handed the finished tricks only, never the hands or the
 * crib, so firing (or not) can't tell the table where the crib's points are.
 */
export function canAutoFinish(tricks: readonly Trick[], numPlayers: number, settings: GameSettings): boolean {
  const done = tricks.filter((t) => t.winner !== null && t.plays.length > 0);
  // The Sun is still open while one seat has won every trick.
  if (settings.shootTheSun && new Set(done.map((t) => t.winner)).size < 2) return false;

  // A seat that didn't follow the lead suit has shown it holds none of that suit.
  const voids = Array.from({ length: numPlayers }, () => new Set<Suit>());
  const played = new Set<Card>();
  for (const t of done) {
    const lead = suitOf(t.plays[0].card);
    for (const p of t.plays) {
      played.add(p.card);
      if (suitOf(p.card) !== lead) voids[p.seat].add(lead);
    }
  }
  // A card nobody can hold can only be in the crib, whose winner is already known.
  const gone = new Set(SUITS.filter((suit) => voids.every((v) => v.has(suit))));
  // The Moon needs no check: once no scoring card is left in a hand, it's settled.
  return ACCOUNTED.every((c) => played.has(c) || gone.has(suitOf(c)));
}
