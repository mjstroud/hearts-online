import { describe, expect, it } from 'vitest';
import { canAutoFinish } from './autofinish';
import { chooseBotPass, chooseBotPlay } from './bot';
import { type Card, type Rng, isPenaltyCard, penaltyPoints } from './cards';
import { type GameState, gamePlay } from './game';
import {
  type HandState,
  type Trick,
  dealHand,
  isFinalTrick,
  legalPlays,
  playCard,
  startHand,
  submitPass,
  trickWinner,
} from './hand';
import { reviewHand } from './review';
import { DEFAULT_SETTINGS, type GameSettings, passCycle } from './rules';
import { type HandRecord, scoreHand, tableTricks, tableTricksWon } from './scoring';
import { summarizeHand } from './view';

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

/** A finished trick from its leader and the cards in play order. */
function trick(leader: number, cards: Card[]): Trick {
  const t: Trick = { leader, plays: cards.map((card, i) => ({ seat: (leader + i) % cards.length, card })), winner: null };
  t.winner = trickWinner(t);
  return t;
}

/** The score facts a played-out ending must not change. */
const FIELDS = ['scores', 'sun', 'moon', 'penalty', 'hearts', 'queen', 'jack', 'cribPoints'] as const;
const outcome = (r: HandRecord) => Object.fromEntries(FIELDS.map((k) => [k, r[k]]));

/** Cards that score, or whose taker is stored. */
const counts = (c: Card) => isPenaltyCard(c) || c === 'JD';

type Policy = (h: HandState, seat: number, settings: GameSettings, rng: Rng) => Card;

/** Ways to play a hand. */
const policies = {
  first: (h, seat, settings) => legalPlays(h, seat, settings)[0],
  bot: (h, seat, settings) => chooseBotPlay(h, seat, settings),
  random: (h, seat, settings, rng) => {
    const legal = legalPlays(h, seat, settings);
    return legal[rng(legal.length)];
  },
  // Gets rid of point cards as soon as it may, so more hands reach "no points left" early.
  eager: (h, seat, settings, rng) => {
    const legal = legalPlays(h, seat, settings);
    const points = legal.filter(counts);
    const pool = points.length ? points : legal;
    return pool[rng(pool.length)];
  },
} satisfies Record<string, Policy>;

/** Play out the rest of a copy of the hand. */
function finish(hand: HandState, settings: GameSettings, policy: Policy, rng: Rng): HandRecord {
  const h = structuredClone(hand);
  while (h.phase === 'playing') playCard(h, h.turn!, policy(h, h.turn!, settings, rng), settings);
  return scoreHand(h, settings);
}

describe('canAutoFinish', () => {
  // Four players. The clubs trick goes to seat 3, then all 13 hearts, the Q♠ and the J♦ come out.
  const opening = trick(0, ['2C', '3C', '4C', '5C']);
  const hearts = [
    trick(3, ['2H', '3H', '4H', '5H']),
    trick(2, ['6H', '7H', '8H', '9H']),
    trick(1, ['TH', 'JH', 'QH', 'KH']),
  ];

  it('fires once every heart, the Q♠ and the J♦ are face-up and two seats have won tricks', () => {
    const tricks = [opening, ...hearts, trick(0, ['AH', 'QS', 'JD', '6C'])];
    expect(canAutoFinish(tricks, 4, S)).toBe(true);
    expect(canAutoFinish(tricks, 4, { ...S, shootTheSun: false, shootTheMoon: false, jackOfDiamonds: false })).toBe(true);
    // One trick earlier the A♥, Q♠ and J♦ were still out.
    expect(canAutoFinish(tricks.slice(0, -1), 4, S)).toBe(false);
  });

  it('waits while the Sun is still possible', () => {
    // Seat 0 wins everything, all the points included.
    const sweep = [
      trick(0, ['AC', '2C', '3C', '4C']),
      trick(0, ['AH', '2H', '3H', '4H']),
      trick(0, ['KH', '5H', '6H', '7H']),
      trick(0, ['QH', '8H', '9H', 'TH']),
      trick(0, ['JH', 'QS', 'JD', '5C']),
    ];
    expect(canAutoFinish(sweep, 4, S)).toBe(false);
    expect(canAutoFinish(sweep, 4, { ...S, shootTheSun: false })).toBe(true);
    // Once a second seat takes a trick, the Sun is gone.
    expect(canAutoFinish([...sweep, trick(0, ['6C', '7C', '8C', '9C'])], 4, S)).toBe(true);
  });

  it('waits while a heart is unplayed and someone may still hold it', () => {
    // The A♥ hasn't shown up and nobody has shown they're out of hearts.
    const tricks = [opening, ...hearts, trick(0, ['6D', 'QS', 'JD', '6C'])];
    expect(canAutoFinish(tricks, 4, S)).toBe(false);
    expect(canAutoFinish(tricks, 4, { ...S, shootTheSun: false, shootTheMoon: false })).toBe(false);
  });

  it('waits for the Q♠', () => {
    const tricks = [opening, ...hearts, trick(0, ['AH', '2S', 'JD', '6C'])];
    expect(canAutoFinish(tricks, 4, S)).toBe(false);
  });

  it('waits for the J♦ even with its rule off, since who took it is still recorded', () => {
    const tricks = [opening, ...hearts, trick(0, ['AH', 'QS', '6D', '6C'])];
    expect(canAutoFinish(tricks, 4, S)).toBe(false);
    expect(canAutoFinish(tricks, 4, { ...S, jackOfDiamonds: false })).toBe(false);
  });

  it('counts cards of a suit every seat is out of as being in the crib', () => {
    // Built by hand, not dealt: in real play whoever leads a suit last never shows they're out
    // of it, so this clause is a safety net the rule states rather than a path play can reach.
    const tricks = [
      trick(0, ['2C', '3C', 'JD', '5C']),
      trick(3, ['2H', '3H', '4H', '5H']),
      trick(2, ['6H', '7H', '8H', '9H']),
      trick(1, ['TH', '6D', '7C', 'QS']), // seats 2, 3 and 0 are out of hearts
    ];
    // Seat 1 may still hold the J♥, Q♥, K♥ or A♥.
    expect(canAutoFinish(tricks, 4, S)).toBe(false);
    // Seat 1 plays a club on a heart lead: the rest of the hearts can only be in the crib.
    expect(canAutoFinish([...tricks, trick(3, ['JH', '8C', '9C', '8D'])], 4, S)).toBe(true);
  });

  it('works with five players', () => {
    const tricks = [
      trick(0, ['3C', '4C', '5C', '6C', '7C']),
      trick(4, ['2H', '3H', '4H', '5H', '6H']),
      trick(3, ['7H', '8H', '9H', 'TH', 'JH']),
      trick(2, ['QH', 'KH', 'AH', 'QS', 'JD']),
    ];
    expect(canAutoFinish(tricks, 5, S)).toBe(true);
    const missingAce = [...tricks.slice(0, 3), trick(2, ['QH', 'KH', '8C', 'QS', 'JD'])];
    expect(canAutoFinish(missingAce, 5, S)).toBe(false);
  });

  it('only ever sees face-up tricks: no hands, no crib', () => {
    // The signature is the guarantee: tricks, table size and settings. Nothing else to leak.
    expect(canAutoFinish.length).toBe(3);
    // The trick in progress isn't counted, even if it's passed in by mistake.
    const tricks = [opening, ...hearts];
    const inPlay: Trick = { leader: 0, plays: [{ seat: 0, card: 'AH' }, { seat: 1, card: 'QS' }, { seat: 2, card: 'JD' }], winner: null };
    expect(canAutoFinish([...tricks, inPlay], 4, S)).toBe(false);
  });

  it.each([4, 5])('never changes the score, however the rest is played (%i players, random hands)', (players) => {
    const rng = seeded(9000 + players);
    let fired = 0;
    let hands = 0;
    for (let flags = 0; flags < 8; flags++) {
      const settings: GameSettings = {
        ...S,
        jackOfDiamonds: !(flags & 1),
        shootTheSun: !(flags & 2),
        noPointsOnFirstTrick: !(flags & 4),
      };
      for (let i = 0; i < 200; i++, hands++) {
        const hand = dealHand((i % passCycle(players).length) + 1, players, rng);
        if (hand.phase === 'passing') hand.hands.forEach((h, seat) => submitPass(hand, seat, chooseBotPass(h)));
        // Bots, random play, bots against random players, or everyone dumping points early.
        const style = i % 4;
        const policy = (seat: number) =>
          style === 0 || (style === 2 && seat % 2) ? policies.bot : style === 3 ? policies.eager : policies.random;
        let firedAt: HandRecord | null = null;
        while (hand.phase === 'playing') {
          const seat = hand.turn!;
          playCard(hand, seat, policy(seat)(hand, seat, settings, rng), settings);
          if (hand.phase !== 'playing' || hand.current!.plays.length) continue;
          const can = canAutoFinish(hand.tricks, players, settings);
          // Once it's true it stays true: more face-up cards only settle more.
          if (firedAt) expect(can).toBe(true);
          if (!can || firedAt) continue;
          // Nothing left in anyone's hand can score.
          expect(hand.hands.flat().filter(counts)).toEqual([]);
          const endings = Object.values(policies).map((p) => finish(hand, settings, p, rng));
          for (const e of endings) expect(outcome(e)).toEqual(outcome(endings[0]));
          firedAt = endings[0];
          fired++;
        }
        // And the hand as it was actually played out ends the same way.
        if (firedAt) expect(outcome(scoreHand(hand, settings))).toEqual(outcome(firedAt));
      }
    }
    expect(hands).toBe(1600);
    expect(fired).toBeGreaterThan(30);
  });
});

/** A bare game around one hand, so gamePlay can finish it. */
const gameOf = (hand: HandState): GameState => ({
  numPlayers: hand.numPlayers,
  hand,
  scores: hand.dealt.map(() => 0),
  handsPlayed: 0,
  lastHand: null,
  over: false,
});

/** Checks every record must pass, played out early or not. */
function checkRecord(r: HandRecord) {
  const total = r.dealt[0].length;
  const table = tableTricks(r);
  expect(r.tricks).toHaveLength(total);
  expect(sum(r.tricksWon)).toBe(r.tricks.length);
  expect(sum(tableTricksWon(r))).toBe((r.autoFrom ?? r.tricks.length + 1) - 1);
  expect(table).toHaveLength((r.autoFrom ?? total + 1) - 1);
  // The tricks played out on their own carry nothing that counts.
  for (const t of r.tricks.slice(table.length)) expect(t.plays.filter((p) => counts(p.card))).toEqual([]);
  const s = summarizeHand(r);
  expect(s.autoFrom).toBe(r.autoFrom ?? null);
  expect(s.tricksWon).toEqual(tableTricksWon(r));
  expect(s.finalTrick).toEqual(table.at(-1));
  const review = reviewHand(r);
  expect(review.tricks).toHaveLength(table.length);
  expect(review.autoFrom).toBe(r.autoFrom ?? null);
  expect(sum(review.tricks.map((t) => t.points)) + r.cribPoints).toBe(r.jackScored ? 16 : 26);
}

describe('auto-finish in gamePlay', () => {
  // A keep hand where the last heart is played on trick 9 of 12.
  const hands: Card[][] = [
    ['2C', '3C', '4C', '5C', '2H', '3H', '4H', '2S', '3S', '4S', '5S', '6S'],
    ['AC', 'KC', 'QC', 'JC', '5H', '6H', '7H', '2D', '3D', '4D', '5D', '6D'],
    ['6C', '7C', '8C', '8H', '9H', 'TH', 'JH', '7D', '8D', '9D', 'TD', 'QS'],
    ['9C', 'TC', 'QH', 'KH', 'AH', 'JD', '7S', '8S', '9S', 'TS', 'JS', 'KS'],
  ];
  const crib: Card[] = ['QD', 'KD', 'AD', 'AS'];
  // Each trick in play order, from its leader.
  const script: Card[][] = [
    ['2C', 'AC', '6C', '9C'], // seat 1 wins and takes the (pointless) crib
    ['KC', '7C', 'TC', '3C'],
    ['QC', '8C', 'AH', '4C'], // seat 3 breaks hearts
    ['5H', '8H', 'QH', '2H'], // seat 3 wins
    ['KH', '3H', '6H', '9H'],
    ['JD', '4H', '2D', '7D'],
    ['7S', '2S', '7H', 'QS'], // seat 2 has to follow with the Q♠
    ['TH', '8S', '3S', '3D'],
    ['JH', '9S', '4S', '4D'], // the last heart
  ];

  const OFF: GameSettings = { ...S, autoFinish: false };

  function playScript(settings: GameSettings) {
    const game = gameOf(startHand(4, 4, hands, crib));
    const hand = game.hand!;
    let record: HandRecord | null = null;
    for (const cards of script) {
      for (const card of cards) {
        expect(record).toBeNull();
        record = gamePlay(game, hand.turn!, card, settings, seeded(1)).completedHand;
      }
    }
    return { game, hand, record };
  }

  /** Play whole tricks with the first legal card; returns the record if the hand finishes. */
  function playTricks(game: GameState, hand: HandState, count: number, settings: GameSettings): HandRecord | null {
    for (let i = 0; i < count * hand.numPlayers; i++) {
      const r = gamePlay(game, hand.turn!, legalPlays(hand, hand.turn!, settings)[0], settings, seeded(1)).completedHand;
      if (r) return r;
    }
    return null;
  }

  it('plays out the rest at once and marks where it took over', () => {
    const { game, record } = playScript(S);
    expect(record).not.toBeNull();
    const r = record!;
    expect(r.autoFrom).toBe(10);
    expect(r.tricks).toHaveLength(12);
    expect(tableTricksWon(r)).toEqual([0, 3, 3, 3]);
    expect(r.scores).toEqual([0, 1, 16, -1]);
    expect(r.jack).toBe(3);
    expect(game.lastHand).toBe(r);
    expect(game.hand!.number).toBe(5);
    const s = summarizeHand(r);
    expect(s.finalTrick).toEqual({ leader: 2, plays: r.tricks[8].plays, winner: 2 });
    expect(s.autoFrom).toBe(10);
    expect(reviewHand(r).tricks.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    checkRecord(r);
  });

  it('plays on as usual with auto-finish off', () => {
    const { game, hand, record } = playScript(OFF);
    expect(record).toBeNull();
    const r = playTricks(game, hand, 3, OFF)!;
    expect(Object.keys(r)).not.toContain('autoFrom');
    expect(tableTricksWon(r)).toEqual(r.tricksWon);
    expect(r.scores).toEqual([0, 1, 16, -1]);
    checkRecord(r);
  });

  it('takes over at the next trick end when the host switches it on mid-hand', () => {
    const { game, hand } = playScript(OFF);
    const r = playTricks(game, hand, 1, S)!;
    expect(r.autoFrom).toBe(11);
    expect(r.scores).toEqual([0, 1, 16, -1]);
    checkRecord(r);
  });

  it('leaves a lone final trick to autoPlayLast, so the table sees it played', () => {
    for (const autoPlayLast of [true, false]) {
      const { game, hand } = playScript(OFF);
      expect(playTricks(game, hand, 1, OFF)).toBeNull(); // trick 10
      const settings = { ...S, autoPlayLast };
      const r = playTricks(game, hand, 1, settings); // trick 11: now nothing left can score
      if (autoPlayLast) {
        // Trick 12 is played like any other (the server plays it for everyone after the usual pause).
        expect(r).toBeNull();
        expect(isFinalTrick(hand)).toBe(true);
        const last = playTricks(game, hand, 1, settings)!;
        expect(Object.keys(last)).not.toContain('autoFrom');
        checkRecord(last);
      } else {
        expect(r!.autoFrom).toBe(12);
        expect(r!.scores).toEqual([0, 1, 16, -1]);
        checkRecord(r!);
      }
    }
  });

  /** Play a hand out in full with no auto-finish, noting every card, so it can be replayed. */
  function corpus(players: number, count: number, seed: number) {
    const rng = seeded(seed);
    const out: { start: HandState; plays: { seat: number; card: Card }[]; full: HandRecord; settings: GameSettings }[] = [];
    for (let i = 0; i < count; i++) {
      const settings: GameSettings = { ...S, autoFinish: false, shootTheSun: i % 4 !== 3, jackOfDiamonds: i % 5 !== 4 };
      const hand = dealHand((i % passCycle(players).length) + 1, players, rng);
      if (hand.phase === 'passing') hand.hands.forEach((h, seat) => submitPass(hand, seat, chooseBotPass(h)));
      const start = structuredClone(hand);
      const plays: { seat: number; card: Card }[] = [];
      while (hand.phase === 'playing') {
        const seat = hand.turn!;
        const card = [policies.bot, policies.random, policies.eager][i % 3](hand, seat, settings, rng);
        plays.push({ seat, card });
        playCard(hand, seat, card, settings);
      }
      out.push({ start, plays, full: scoreHand(hand, settings), settings });
    }
    return out;
  }

  it.each([4, 5])('takes over at the first chance, never for a lone final trick with autoPlayLast on (%i players)', (players) => {
    const hands = corpus(players, 400, 70 + players);
    const seen = { early: 0, lastOnly: 0, lastWhenOff: 0 };
    for (const { start, plays, full, settings } of hands) {
      const total = start.dealt[0].length;
      for (const autoPlayLast of [true, false]) {
        for (const autoFinish of [true, false]) {
          const s = { ...settings, autoPlayLast, autoFinish };
          const game = gameOf(structuredClone(start));
          let r: HandRecord | null = null;
          for (const p of plays) {
            r = gamePlay(game, p.seat, p.card, s, seeded(3)).completedHand;
            if (r) break;
          }
          expect(r).not.toBeNull();
          const rec = r!;
          checkRecord(rec);
          expect(outcome(rec)).toEqual(outcome(full));
          // The first finished trick after which the rule allows it.
          let first: number | null = null;
          for (let k = 1; k < total && first === null; k++) {
            const tricks = full.tricks.slice(0, k);
            if (canAutoFinish(tricks, players, s) && (total - k >= 2 || !autoPlayLast)) first = k;
          }
          expect(rec.autoFrom ?? null).toBe(autoFinish && first !== null ? first + 1 : null);
          if (autoPlayLast) expect(rec.autoFrom).not.toBe(total);
          if (autoFinish && rec.autoFrom && rec.autoFrom < total) seen.early++;
          if (autoFinish && autoPlayLast && !rec.autoFrom && canAutoFinish(full.tricks.slice(0, total - 1), players, s)) seen.lastOnly++;
          if (autoFinish && !autoPlayLast && rec.autoFrom === total) seen.lastWhenOff++;
        }
      }
    }
    // Every branch was exercised.
    expect(seen.early).toBeGreaterThan(10);
    expect(seen.lastOnly).toBeGreaterThan(0);
    expect(seen.lastWhenOff).toBeGreaterThan(0);
  });
});
