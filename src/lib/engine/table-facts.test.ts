import { describe, expect, it } from 'vitest';
import { chooseBotPlay } from './bot';
import { type Card, type Rng, rankValue } from './cards';
import type { GameState } from './game';
import { type HandState, type Trick, dealHand, legalPlays, playCard, startHand } from './hand';
import { presetSpec } from './presets';
import { DEFAULT_SETTINGS, type GameSettings, normalizeSettings } from './rules';
import { scoreHand } from './scoring';
import { publicFacts, sunWatchFrom, tableViewFor } from './view';

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

/** A bare game around one hand, so a view can be built at any point in it. */
const gameOf = (hand: HandState): GameState => ({
  numPlayers: hand.numPlayers,
  hand,
  scores: hand.dealt.map(() => 0),
  handsPlayed: 0,
  lastHand: null,
  over: false,
});

const viewFor = (hand: HandState, seat: number | null, settings: GameSettings = S) => tableViewFor(gameOf(hand), seat, settings)!;

const factsFor = (hand: HandState, seat: number | null, settings: GameSettings = S) => {
  const v = viewFor(hand, seat, settings);
  return { heartsBrokenBy: v.heartsBrokenBy, sunWatch: v.sunWatch, moonWatch: v.moonWatch };
};

const isPoint = (c: Card) => c[1] === 'H' || c === 'QS';

/** The facts worked out the slow, obvious way from face-up cards, to check the view against. */
function expected(hand: HandState, settings: GameSettings = S) {
  const done = hand.tricks;
  const faceUp = [...done, ...(hand.current ? [hand.current] : [])].flatMap((t, i) => t.plays.map((p) => ({ ...p, trick: i + 1 })));
  const first = faceUp.find((p) => isPoint(p.card));
  const trickWinners = new Set(done.map((t) => t.winner));
  const pointWinners = new Set(done.filter((t) => t.plays.some((p) => isPoint(p.card))).map((t) => t.winner));
  const hearts = done.flatMap((t) => t.plays).filter((p) => p.card[1] === 'H').length;
  const sunFrom = hand.numPlayers === 5 ? 3 : 4;
  return {
    heartsBrokenBy: first ? { seat: first.seat, card: first.card, trick: first.trick } : null,
    sunWatch: settings.showWatches && settings.shootTheSun && done.length >= sunFrom && trickWinners.size === 1 ? done[0].winner : null,
    moonWatch: settings.showWatches && settings.shootTheMoon && pointWinners.size === 1 && hearts >= 7 ? [...pointWinners][0] : null,
  };
}

/** Every seat (the crib winner included) and an onlooker get the same facts, and they match the face-up cards. */
function check(hand: HandState, settings: GameSettings = S) {
  const seats = [null, ...hand.dealt.map((_, s) => s)];
  const all = seats.map((seat) => factsFor(hand, seat, settings));
  for (const f of all) expect(f).toEqual(all[0]);
  expect(all[0]).toEqual(expected(hand, settings));
  return all[0];
}

/** The shooter always plays its highest legal card; everyone else plays like a bot or at random. */
function playOut(hand: HandState, shooter: number, rng: Rng, randomOthers: boolean, after: () => void) {
  after();
  while (hand.phase === 'playing') {
    const seat = hand.turn!;
    const legal = legalPlays(hand, seat, S);
    let card: Card;
    if (seat === shooter) card = legal.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
    else if (randomOthers) card = legal[rng(legal.length)];
    else card = chooseBotPlay(hand, seat, S);
    playCard(hand, seat, card, S);
    after();
  }
  return scoreHand(hand, S);
}

/** A finished trick that `winner` led and won (the watches only look at cards and winners). */
const won = (winner: number, ...cards: Card[]): Trick => ({
  leader: winner,
  plays: cards.map((card, i) => ({ seat: (winner + i) % 4, card })),
  winner,
});

// Seat 0 holds the 2♣; seat 3 has no clubs or diamonds.
const HANDS: Card[][] = [
  ['2C', '3C', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', '2H', '3H', '4H'],
  ['4C', '5C', '6C', '7C', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '5H'],
  ['8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '2D', '3D', '9S', 'TS', '6H'],
  ['7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH', 'QS', 'KS', 'AS', 'JS'],
];
const CRIB: Card[] = ['JD', 'QD', 'KD', 'AD'];

function play(hand: HandState, moves: [number, Card][]) {
  for (const [seat, card] of moves) playCard(hand, seat, card, S);
}

describe('who broke hearts', () => {
  it('is empty until a point card is played, including through the pass', () => {
    const passing = dealHand(1, 4, seeded(3));
    expect(passing.phase).toBe('passing');
    expect(check(passing)).toEqual({ heartsBrokenBy: null, sunWatch: null, moonWatch: null });

    const hand = startHand(4, 4, HANDS, CRIB);
    play(hand, [[0, '2C'], [1, '7C'], [2, 'AC'], [3, 'AS']]);
    expect(check(hand).heartsBrokenBy).toBeNull();
  });

  it('names the first heart the moment it lands, and keeps it', () => {
    const hand = startHand(4, 4, HANDS, CRIB);
    play(hand, [[0, '2C'], [1, '7C'], [2, 'AC'], [3, 'AS'], [2, '2D'], [3, '7H']]);
    // Shown while the trick is still on the felt.
    expect(check(hand).heartsBrokenBy).toEqual({ seat: 3, card: '7H', trick: 2 });
    play(hand, [[0, '4D'], [1, '5H']]);
    expect(hand.tricks).toHaveLength(2);
    expect(check(hand).heartsBrokenBy).toEqual({ seat: 3, card: '7H', trick: 2 });
  });

  it('counts the Q♠ as breaking hearts', () => {
    const hand = startHand(4, 4, HANDS, CRIB);
    play(hand, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, '2D'], [3, 'QS']]);
    expect(hand.heartsBroken).toBe(true);
    expect(check(hand).heartsBrokenBy).toEqual({ seat: 3, card: 'QS', trick: 2 });
    play(hand, [[0, '4D'], [1, '5H']]);
    expect(check(hand).heartsBrokenBy).toEqual({ seat: 3, card: 'QS', trick: 2 });
  });

  it('is shown whatever the watch settings', () => {
    const hand = startHand(4, 4, HANDS, CRIB);
    play(hand, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, '2D'], [3, 'QS']]);
    const off = { ...S, showWatches: false, shootTheMoon: false, shootTheSun: false };
    expect(check(hand, off).heartsBrokenBy).toEqual({ seat: 3, card: 'QS', trick: 2 });
  });
});

describe('Sun watch', () => {
  it('needs a third of the hand: 4 tricks of 12, 3 of 9', () => {
    expect(sunWatchFrom(12)).toBe(4);
    expect(sunWatchFrom(9)).toBe(3);
  });

  for (const players of [4, 5]) {
    const from = players === 5 ? 3 : 4;
    it(`starts once one seat has won the first ${from} tricks, and only counts finished tricks (${players} players)`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const seat = seed % players;
        const rng = seeded(seed * 13);
        const hand = dealHand(1, players, rng, { spec: presetSpec('sun', players, seat), passOffset: 0 });
        const r = playOut(hand, seat, rng, seed % 2 === 0, () => {
          expect(check(hand).sunWatch).toBe(hand.tricks.length >= from ? seat : null);
          // Off when the host hides watches, or when the Sun isn't a house rule.
          expect(check(hand, { ...S, showWatches: false }).sunWatch).toBeNull();
          expect(check(hand, { ...S, shootTheSun: false }).sunWatch).toBeNull();
        });
        expect(r.sun).toBe(seat);
      }
    });
  }

  it('ends for good once anyone else wins a trick', () => {
    const tricks = [won(1, '2C', '3C', '4C', '5C'), won(1, '6C', '7C', '8C', '9C'), won(1, 'TC', 'JC', 'QC', 'KC')];
    expect(publicFacts(tricks, null, 12, S).sunWatch).toBeNull();
    expect(publicFacts(tricks, null, 9, S).sunWatch).toBe(1);
    tricks.push(won(1, 'AD', '2D', '3D', '4D'));
    expect(publicFacts(tricks, null, 12, S).sunWatch).toBe(1);
    // A trick still being played doesn't end it.
    const current: Trick = { leader: 1, plays: [{ seat: 1, card: '5D' }, { seat: 2, card: '6D' }], winner: null };
    expect(publicFacts(tricks, current, 12, S).sunWatch).toBe(1);
    tricks.push(won(2, 'KD', '5D', '6D', '7D'));
    expect(publicFacts(tricks, null, 12, S).sunWatch).toBeNull();
    tricks.push(won(1, 'AS', '2S', '3S', '4S'));
    expect(publicFacts(tricks, null, 12, S).sunWatch).toBeNull();
  });
});

describe('Moon watch', () => {
  it('starts at 7 hearts, all with one seat, and ends when anyone else takes a point card', () => {
    const tricks = [won(1, '2C', '3C', '4C', '5C'), won(2, 'AD', '2H', '3H', '4H'), won(2, 'KD', '5H', '6H', '7H')];
    // Six hearts isn't enough yet.
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBeNull();
    tricks.push(won(2, 'QD', '8H', '3D', '4D'));
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBe(2);
    // Someone else winning a trick with no points in it doesn't matter.
    tricks.push(won(0, 'AS', '2S', '3S', '4S'));
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBe(2);
    tricks.push(won(2, 'KS', 'QS', '5S', '6S'));
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBe(2);
    // A heart on the felt that hasn't been won yet doesn't count either way.
    const current: Trick = { leader: 3, plays: [{ seat: 3, card: 'JH' }], winner: null };
    expect(publicFacts(tricks, current, 12, S).moonWatch).toBe(2);
    // Blocked: and it stays blocked.
    tricks.push(won(3, 'JH', '7S', '8S', '9S'));
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBeNull();
    tricks.push(won(2, 'TH', 'TS', 'JS', '9H'));
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBeNull();
  });

  it('never starts once two seats have taken point cards, the Q♠ included', () => {
    const tricks = [
      won(0, 'KS', 'QS', '2S', '3S'),
      won(1, '2H', '3H', '4H', '5H'),
      won(1, '6H', '7H', '8H', '2D'),
      won(1, '9H', 'TH', 'JH', '3D'),
    ];
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBeNull();
  });

  it('follows the switches', () => {
    const tricks = [won(2, '2H', '3H', '4H', '5H'), won(2, '6H', '7H', '8H', '2D')];
    expect(publicFacts(tricks, null, 12, S).moonWatch).toBe(2);
    expect(publicFacts(tricks, null, 12, { ...S, showWatches: false }).moonWatch).toBeNull();
    expect(publicFacts(tricks, null, 12, { ...S, shootTheMoon: false }).moonWatch).toBeNull();
    // The Sun switch is separate.
    expect(publicFacts(tricks, null, 12, { ...S, shootTheSun: false }).moonWatch).toBe(2);
  });
});

describe('table facts never learn from the crib', () => {
  it.each([4, 5])(
    'a Moon watch shows for everyone, even the crib winner who can see it is already dead (%i players)',
    (players) => {
      for (let seed = 1; seed <= 12; seed++) {
        const seat = seed % players;
        const rng = seeded(seed * 7);
        // The Moon setup, but four hearts hide in the crib, which someone else wins.
        const spec = { ...presetSpec('moon', players, seat), crib: ['2H', '3H', '4H', '5H'] as Card[] };
        const hand = dealHand(1, players, rng, { spec, passOffset: 0 });
        let watched = false;
        const r = playOut(hand, seat, rng, seed % 2 === 0, () => {
          const facts = check(hand);
          if (facts.moonWatch !== null) {
            expect(facts.moonWatch).toBe(seat);
            watched = true;
          }
          expect(check(hand, { ...S, showWatches: false }).moonWatch).toBeNull();
          const winner = hand.cribWinner;
          if (winner !== null) {
            // The crib winner's own points include the crib's hearts, so they must never drive a fact.
            const someoneElse = (winner + 1) % players;
            expect(viewFor(hand, winner).pointsTaken[winner]).toBe(viewFor(hand, someoneElse).pointsTaken[winner] + 4);
          }
        });
        expect(watched).toBe(true);
        expect(r.cribWinner).not.toBe(seat);
        expect(r.moon).toBeNull();
      }
    },
  );

  // The top cards without the Q♠, which waits in the crib.
  const SUN_HAND: Record<number, Card[]> = {
    4: ['AC', 'KC', 'QC', 'AD', 'KD', 'QD', 'AS', 'KS', 'JS', 'AH', 'KH', 'QH'],
    5: ['AC', 'KC', 'AD', 'KD', 'AS', 'KS', 'JS', 'AH', 'KH'],
  };

  it.each([4, 5])('the crib winner sees the same facts when the crib holds the Q♠ and hearts (%i players)', (players) => {
    const from = players === 5 ? 3 : 4;
    for (let seed = 1; seed <= 12; seed++) {
      const seat = seed % players;
      const rng = seeded(seed * 31);
      const hands = Array.from({ length: players }, (_, s) => (s === seat ? SUN_HAND[players] : undefined));
      const hand = dealHand(1, players, rng, { spec: { hands, crib: ['QS', '2H', '3H', '4H'] }, passOffset: 0 });
      let moon = false;
      const r = playOut(hand, seat, rng, seed % 2 === 0, () => {
        const facts = check(hand);
        expect(facts.sunWatch).toBe(hand.tricks.length >= from ? seat : null);
        if (facts.moonWatch !== null) moon = true;
        // The Q♠ is never played face up, so only a heart can have broken hearts.
        if (facts.heartsBrokenBy) expect(facts.heartsBrokenBy.card).not.toBe('QS');
        if (hand.cribWinner !== null) {
          expect(viewFor(hand, seat).queenTakenBy).toBe(seat);
          expect(viewFor(hand, (seat + 1) % players).queenTakenBy).toBeNull();
        }
      });
      expect(moon).toBe(true);
      expect(r.cribWinner).toBe(seat);
      expect(r.sun).toBe(seat);
    }
  });
});

describe('watch setting', () => {
  it('is on by default, including for games saved before it existed', () => {
    expect(S.showWatches).toBe(true);
    const stored = { scoreLimit: null, jackOfDiamonds: true, shootTheMoon: true, shootTheSun: true, noPointsOnFirstTrick: true, moveTimer: null };
    expect(normalizeSettings(stored).showWatches).toBe(true);
    expect(normalizeSettings({ showWatches: false }).showWatches).toBe(false);
    expect(normalizeSettings({ showWatches: 'no' }).showWatches).toBe(true);
  });
});

describe('table facts over whole hands', () => {
  /** Plays one hand to the end, checking the facts after every card, and returns what scoring made of it. */
  function watchHand(hand: HandState, shooter: number | null, rng: Rng, randomOthers: boolean) {
    const ended = { sunWatch: new Set<number>(), moonWatch: new Set<number>() };
    let last = check(hand);
    const r = playOut(hand, shooter ?? -1, rng, randomOthers, () => {
      const facts = check(hand);
      // Set exactly when the engine counts hearts as broken (any heart, or the Q♠).
      expect(facts.heartsBrokenBy !== null).toBe(hand.heartsBroken);
      // Once set, it never changes for the rest of the hand.
      if (last.heartsBrokenBy) expect(facts.heartsBrokenBy).toEqual(last.heartsBrokenBy);
      for (const key of ['sunWatch', 'moonWatch'] as const) {
        // A watch never hands over to another seat, and once it ends it never comes back.
        if (last[key] !== null && facts[key] !== null) expect(facts[key]).toBe(last[key]);
        if (last[key] !== null && facts[key] === null) ended[key].add(last[key]);
        if (facts[key] !== null) expect(ended[key].has(facts[key])).toBe(false);
        // Watches only move when a trick closes.
        if (hand.current && hand.current.plays.length > 0) expect(facts[key]).toBe(last[key]);
      }
      last = facts;
    });
    return { r, final: last };
  }

  it.each([4, 5])('agree with how the hand was scored (%i players, random deals)', (players) => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seeded(9000 + seed * players);
      const hand = dealHand(1, players, rng, { passOffset: 0 });
      const { r, final } = watchHand(hand, null, rng, seed % 2 === 0);
      // The Sun is exact from face-up cards; a shot Moon was always on watch at the end.
      expect(final.sunWatch).toBe(r.sun);
      if (r.moon !== null) expect(final.moonWatch).toBe(r.moon);
    }
  });

  it.each([4, 5])('a Moon that is really shot was on watch until the end (%i players)', (players) => {
    let shots = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const seat = seed % players;
      const rng = seeded(seed * 101);
      const hand = dealHand(1, players, rng, { spec: presetSpec('moon', players, seat), passOffset: 0 });
      const { r, final } = watchHand(hand, seat, rng, seed % 2 === 0);
      expect(final.sunWatch).toBeNull();
      if (r.moon === seat) {
        shots++;
        expect(final.moonWatch).toBe(seat);
      }
      // Blocked on the felt means no Moon.
      if (final.moonWatch === null) expect(r.moon).toBeNull();
    }
    expect(shots).toBeGreaterThan(0);
  });

  it.each([4, 5])('a Sun run carries both watches for the sweeper (%i players)', (players) => {
    for (let seed = 1; seed <= 12; seed++) {
      const seat = seed % players;
      const rng = seeded(seed * 211);
      const hand = dealHand(1, players, rng, { spec: presetSpec('sun', players, seat), passOffset: 0 });
      const { r, final } = watchHand(hand, seat, rng, seed % 2 === 0);
      expect(r.sun).toBe(seat);
      expect(final).toMatchObject({ sunWatch: seat, moonWatch: seat });
    }
  });
});
