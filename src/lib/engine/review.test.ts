import { describe, expect, it } from 'vitest';
import { chooseBotPlay } from './bot';
import type { Rng } from './cards';
import { aiStep, newGame } from './game';
import { dealHand, playCard } from './hand';
import { reviewHand } from './review';
import { DEFAULT_SETTINGS } from './rules';
import { scoreHand } from './scoring';

/** Deterministic RNG for reproducible tests. */
function seeded(seed: number): Rng {
  let x = seed >>> 0 || 1;
  return (max) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % max;
  };
}

const S = DEFAULT_SETTINGS;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('trick review', () => {
  it.each([4, 5])('lists every trick of a finished hand in order, with who led, who won and the points (%i players)', (players) => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = seeded(500 + seed * players);
      const game = newGame(players, rng);
      while (!game.lastHand) aiStep(game, S, () => true, rng);
      const record = game.lastHand;
      const review = reviewHand(record);

      expect(review.number).toBe(1);
      expect(review.numPlayers).toBe(players);
      expect(review.passLabel).toBe('Left');
      expect(review.tricks.map((t) => t.number)).toEqual(Array.from({ length: players === 5 ? 9 : 12 }, (_, i) => i + 1));
      review.tricks.forEach((t, i) => {
        // Play order goes clockwise from the leader, and each winner leads the next trick.
        expect(t.plays.map((p) => p.seat)).toEqual(Array.from({ length: players }, (_, k) => (t.leader + k) % players));
        if (i > 0) expect(t.leader).toBe(review.tricks[i - 1].winner);
      });
      expect(review.cribWinner).toBe(review.tricks[0].winner);
      // The tricks and the crib between them hold every point: 26, and −10 for the jack.
      expect(sum(review.tricks.map((t) => t.points)) + review.cribPoints).toBe(16);
      expect(review.scores).toEqual(record.scores);
      expect(review.crib).toEqual(record.crib);
      expect([review.moon, review.sun]).toEqual([record.moon, record.sun]);
      // Only face-up cards and the crib (shown to everyone after the hand): no deal or passes.
      expect(Object.keys(review)).not.toContain('dealt');
      expect(Object.keys(review)).not.toContain('passes');
    }
  });

  it('counts the J♦ only when it was scored', () => {
    const hand = dealHand(4, 4, seeded(9), { spec: { hands: [['JD']] } });
    while (hand.phase === 'playing') playCard(hand, hand.turn!, chooseBotPlay(hand, hand.turn!, S), S);
    const on = reviewHand(scoreHand(hand, S));
    const off = reviewHand(scoreHand(hand, { ...S, jackOfDiamonds: false }));
    const i = on.tricks.findIndex((t) => t.plays.some((p) => p.card === 'JD'));
    expect(on.tricks[i].points).toBe(off.tricks[i].points - 10);
    expect(sum(off.tricks.map((t) => t.points)) + off.cribPoints).toBe(26);
  });
});
