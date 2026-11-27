import { describe, expect, it } from 'vitest';
import { chooseBotPlay } from './bot';
import { type Card, type Rng, rankValue } from './cards';
import { type GameState, aiStep, continueGame, gamePass, gamePlay, newGame, redealHand } from './game';
import { type HandState, dealHand, legalPlays, startHand } from './hand';
import { presetSpec } from './presets';
import { DEFAULT_SETTINGS, type GameSettings } from './rules';
import { type HandRecord, tableTricks } from './scoring';
import { type TableEvent, faceUpMark, tableEvents } from './table-events';
import { publicFacts } from './view';

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

/** A game around one hand, as the server holds it. */
const gameOf = (hand: HandState): GameState => ({
  numPlayers: hand.numPlayers,
  hand,
  scores: hand.dealt.map(() => 0),
  handsPlayed: hand.number - 1,
  lastHand: null,
  over: false,
});

/** One change to the game, as performAction or a cat's turn makes it: the events it made. */
function change(game: GameState, settings: GameSettings, fn: () => void): TableEvent[] {
  const mark = faceUpMark(game);
  fn();
  return tableEvents(mark, game, settings);
}

const play = (game: GameState, seat: number, card: Card, settings: GameSettings = S) =>
  change(game, settings, () => gamePlay(game, seat, card, settings, seeded(5)));

const plays = (game: GameState, moves: [number, Card][], settings: GameSettings = S) => moves.map(([seat, card]) => play(game, seat, card, settings));

// Seat 0 holds the 2♣; seat 3 has no clubs or diamonds. The J♦ is in the crib.
const HANDS: Card[][] = [
  ['2C', '3C', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', '2H', '3H', '4H'],
  ['4C', '5C', '6C', '7C', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '5H'],
  ['8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '2D', '3D', '9S', 'TS', '6H'],
  ['7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH', 'QS', 'KS', 'AS', 'JS'],
];
const CRIB: Card[] = ['JD', 'QD', 'KD', 'AD'];
/** The same, with seat 2's 2♦ swapped for the J♦ from the crib. */
const JACK_HANDS = HANDS.map((h) => h.map((c): Card => (c === '2D' ? 'JD' : c)));
const JACK_CRIB: Card[] = ['2D', 'QD', 'KD', 'AD'];

const keepHand = (hands = HANDS, crib = CRIB, number = 1) => gameOf(startHand(number, 4, hands.map((h) => h.slice()), crib.slice(), 0));

const ev = (kind: 'trick' | 'queen' | 'jack' | 'sun' | 'moon', seat: number, handEnd = false): TableEvent => ({ kind, seat, handEnd });
const hearts = (seat: number, card: Card, handEnd = false): TableEvent => ({ kind: 'hearts', seat, card, handEnd });

describe('moments during a hand', () => {
  it('a finished trick gives its winner, and the Q♠ goes with it; the Q♠ breaks hearts the moment it lands', () => {
    const game = keepHand();
    expect(plays(game, [[0, '2C'], [1, '4C'], [2, '8C']])).toEqual([[], [], []]);
    expect(play(game, 3, 'JS')).toEqual([ev('trick', 2)]);
    expect(play(game, 2, '2D')).toEqual([]);
    // Shown while the trick is still on the felt.
    expect(play(game, 3, 'QS')).toEqual([hearts(3, 'QS')]);
    expect(play(game, 0, '4D')).toEqual([]);
    // Hearts were broken already, so only the trick and the Queen.
    expect(play(game, 1, '5H')).toEqual([ev('trick', 0), ev('queen', 0)]);
  });

  it('breaks hearts only the first time', () => {
    const game = keepHand();
    plays(game, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, '3D']]);
    expect(play(game, 3, '7H')).toEqual([hearts(3, '7H')]);
    expect(plays(game, [[0, '4D'], [1, '5H']])).toEqual([[], [ev('trick', 0)]]);
    // A heart led, and more played on it: no news.
    expect(plays(game, [[0, '2H'], [1, '2S'], [2, '6H'], [3, '8H']])).toEqual([[], [], [], [ev('trick', 3)]]);
  });

  it('the J♦ goes with its trick only while its rule is on', () => {
    const moves: [number, Card][] = [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, 'JD'], [3, 'QS'], [0, '4D']];
    const on = keepHand(JACK_HANDS, JACK_CRIB);
    plays(on, moves);
    expect(play(on, 1, '5H')).toEqual([ev('trick', 2), ev('queen', 2), ev('jack', 2)]);

    const settings = { ...S, jackOfDiamonds: false };
    const off = keepHand(JACK_HANDS, JACK_CRIB);
    plays(off, moves, settings);
    expect(play(off, 1, '5H', settings)).toEqual([ev('trick', 2), ev('queen', 2)]);
  });

  it('never tells of a J♦ or Q♠ in the crib, which the first trick’s winner takes unseen', () => {
    for (const hidden of ['jack', 'queen'] as const) {
      // HANDS has the J♦ in the crib; for the Q♠, seat 3 swaps it for the J♦.
      const hands = hidden === 'jack' ? HANDS : HANDS.map((h) => h.map((c): Card => (c === 'QS' ? 'JD' : c)));
      const crib: Card[] = hidden === 'jack' ? CRIB : ['QD', 'KD', 'AD', 'QS'];
      const game = keepHand(hands, crib);
      expect(plays(game, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS']]).flat()).toEqual([ev('trick', 2)]);
      const { changes, record } = playOut(game, S, (h, s) => chooseBotPlay(h, s, S), seeded(4));
      // Seat 2 won the crib, and the card with it.
      expect(record[hidden]).toBe(2);
      expect(changes.flat().some((e) => e.kind === hidden)).toBe(false);
    }
  });

  it('counts only, so a mark taken before a change still says what was there', () => {
    const game = keepHand();
    plays(game, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, '2D']]);
    const mark = faceUpMark(game);
    plays(game, [[3, 'QS'], [0, '4D'], [1, '5H']]);
    expect(mark).toEqual({ hand: 1, done: 1, broken: false, lastHand: 0 });
    // Both changes together, as one dev:ai step would make them.
    expect(tableEvents(mark, game, S)).toEqual([ev('trick', 0), ev('queen', 0), hearts(3, 'QS')]);
  });
});

/** The moments a whole hand should make, from its record: what the table saw, trick by trick. */
function fromRecord(r: HandRecord): TableEvent[] {
  return tableTricks(r).flatMap((t) => {
    const cards = t.plays.map((p) => p.card);
    return [
      ev('trick', t.winner),
      ...(cards.includes('QS') ? [ev('queen', t.winner)] : []),
      ...(r.jackScored && cards.includes('JD') ? [ev('jack', t.winner)] : []),
    ];
  });
}

/** Play the hand in progress to its end, one change per card, and return each change's events. */
function playOut(game: GameState, settings: GameSettings, choose: (hand: HandState, seat: number) => Card, rng: Rng) {
  const number = game.hand!.number;
  const changes: TableEvent[][] = [];
  while (game.hand?.number === number) {
    const hand = game.hand;
    const seat = hand.turn!;
    changes.push(change(game, settings, () => gamePlay(game, seat, choose(hand, seat), settings, rng)));
  }
  return { changes, record: game.lastHand! };
}

/** Everything a hand's changes told, checked against its record. */
function checkHand(changes: TableEvent[][], record: HandRecord) {
  const last = changes.at(-1)!;
  // The hand's end is a change of its own, and only that change's events wait for the hand end.
  expect(last.length).toBeGreaterThan(0);
  for (const e of last) expect(e.handEnd).toBe(true);
  for (const c of changes.slice(0, -1)) for (const e of c) expect(e.handEnd).toBe(false);

  const all = changes.flat().map((e) => ({ ...e, handEnd: false }));
  expect(all.filter((e) => e.kind !== 'hearts' && e.kind !== 'sun' && e.kind !== 'moon')).toEqual(fromRecord(record));
  // Hearts break once, at the first point card the table saw.
  const broke = publicFacts(tableTricks(record), null, 0, S).heartsBrokenBy!;
  expect(all.filter((e) => e.kind === 'hearts')).toEqual([hearts(broke.seat, broke.card)]);
  // A Sun or Moon comes with the end of the hand, from the result everyone is shown.
  const shots = last.filter((e) => e.kind === 'sun' || e.kind === 'moon');
  const shot = record.sun !== null ? [ev('sun', record.sun, true)] : record.moon !== null ? [ev('moon', record.moon, true)] : [];
  expect(shots).toEqual(shot);
  expect(all.filter((e) => e.kind === 'sun' || e.kind === 'moon')).toHaveLength(shot.length);
}

const highest = (hand: HandState, seat: number, settings: GameSettings) =>
  legalPlays(hand, seat, settings).reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));

describe('moments at the end of a hand', () => {
  it.each([4, 5])('match the hand’s record over whole hands, played out or not (%i players)', (players) => {
    for (const autoFinish of [true, false]) {
      const settings = { ...S, autoFinish };
      for (let seed = 1; seed <= 30; seed++) {
        const rng = seeded(4000 + seed * players);
        const game = gameOf(dealHand(seed, players, rng, { passOffset: 0 }));
        const random = seed % 2 === 0;
        const { changes, record } = playOut(game, settings, (h, s) => (random ? legalPlays(h, s, settings)[rng(legalPlays(h, s, settings).length)] : chooseBotPlay(h, s, settings)), rng);
        checkHand(changes, record);
        // The next hand is dealt in the same change, and tells nothing yet.
        expect(game.hand!.number).toBe(seed + 1);
      }
    }
  });

  it.each([4, 5])('tell of a Sun with the final trick (%i players)', (players) => {
    for (let seed = 1; seed <= 12; seed++) {
      const seat = seed % players;
      const rng = seeded(seed * 17);
      const game = gameOf(dealHand(1, players, rng, { spec: presetSpec('sun', players, seat), passOffset: 0 }));
      const { changes, record } = playOut(game, S, (h, s) => (s === seat ? highest(h, s, S) : chooseBotPlay(h, s, S)), rng);
      expect(record.sun).toBe(seat);
      expect(changes.at(-1)!.slice(-1)).toEqual([ev('sun', seat, true)]);
      checkHand(changes, record);
    }
  });

  it.each([4, 5])('tell of a Moon only when it was really shot (%i players)', (players) => {
    let shots = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const seat = seed % players;
      const rng = seeded(seed * 101);
      const game = gameOf(dealHand(1, players, rng, { spec: presetSpec('moon', players, seat), passOffset: 0 }));
      const { changes, record } = playOut(game, S, (h, s) => (s === seat ? highest(h, s, S) : legalPlays(h, s, S)[rng(legalPlays(h, s, S).length)]), rng);
      if (record.moon === seat) shots++;
      expect(changes.at(-1)!.some((e) => e.kind === 'moon')).toBe(record.moon !== null);
      checkHand(changes, record);
    }
    expect(shots).toBeGreaterThan(0);
  });

  // Seat 0 holds every club but the 3♣ and wins every trick; the others have no clubs and dump every
  // point card by trick 6 (the same deal as the auto-finish tests in pace.test.ts).
  const AUTO: Card[][] = [
    ['2C', '4C', '5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC'],
    ['2H', '3H', '4H', '5H', '6H', '4D', '5D', '6D', '7D', '8D', '9D', 'TD'],
    ['7H', '8H', '9H', 'TH', 'JH', '3S', '4S', '5S', '6S', '7S', '8S', '9S'],
    ['QH', 'KH', 'AH', 'QS', 'JD', 'QD', 'KD', 'AD', 'TS', 'JS', 'KS', 'AS'],
  ];
  const AUTO_CRIB: Card[] = ['3C', '2D', '3D', '2S'];
  const AUTO_TRICKS: Card[][] = [
    ['2C', '4D', '3S', 'QD'],
    ['AC', '2H', '7H', 'QH'],
    ['KC', '3H', '8H', 'KH'],
    ['QC', '4H', '9H', 'AH'],
    ['JC', '5H', 'TH', 'QS'],
    ['TC', '6H', 'JH', 'JD'],
  ];

  it('leave out the tricks the server played out once nothing could score, and tell the J♦ and the Moon with the last one the table saw', () => {
    const settings = { ...S, shootTheSun: false };
    const game = keepHand(AUTO, AUTO_CRIB);
    const changes = AUTO_TRICKS.flatMap((cards) => cards.map((card, seat) => play(game, seat, card, settings)));
    const record = game.lastHand!;
    expect(record.autoFrom).toBe(7);
    expect(record.moon).toBe(0);
    expect(changes.at(-1)).toEqual([ev('trick', 0, true), ev('jack', 0, true), ev('moon', 0, true)]);
    expect(changes.flat().filter((e) => e.kind === 'trick')).toHaveLength(6);
    expect(changes[5]).toEqual([hearts(1, '2H')]);
    checkHand(changes, record);
  });

  it('take the J♦ rule from the record, which says how the hand was scored', () => {
    const settings = { ...S, shootTheSun: false };
    const game = keepHand(AUTO, AUTO_CRIB);
    AUTO_TRICKS.flat().slice(0, -1).forEach((card, i) => play(game, i % 4, card, settings));
    const mark = faceUpMark(game);
    gamePlay(game, 3, 'JD', settings, seeded(1));
    expect(tableEvents(mark, game, { ...settings, jackOfDiamonds: false })).toEqual([ev('trick', 0, true), ev('jack', 0, true), ev('moon', 0, true)]);
  });

  it('come with the game’s last hand too, when no next hand is dealt', () => {
    const game = keepHand();
    game.endAfterHand = true;
    const rng = seeded(3);
    const { changes, record } = playOut(game, S, (h, s) => chooseBotPlay(h, s, S), rng);
    expect(game).toMatchObject({ over: true, hand: null });
    checkHand(changes, record);
  });
});

describe('many cards in one change', () => {
  it('a playtest “play the trick” step tells every trick it finished', () => {
    const game = keepHand();
    const rng = seeded(8);
    const events = change(game, S, () => {
      for (let i = 0; i < 12; i++) aiStep(game, S, () => true, rng);
    });
    expect(game.hand!.tricks).toHaveLength(3);
    expect(events.filter((e) => e.kind === 'trick').map((e) => e.seat)).toEqual(game.hand!.tricks.map((t) => t.winner));
    for (const e of events) expect(e.handEnd).toBe(false);
  });

  it('a playtest “play the hand” step tells every trick from where it started, and the end of the hand', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const game = keepHand();
      const rng = seeded(seed);
      plays(game, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS']]);
      const hand = game.hand;
      const events = change(game, S, () => {
        while (game.hand === hand) aiStep(game, S, () => true, rng);
      });
      const record = game.lastHand!;
      for (const e of events) expect(e.handEnd).toBe(true);
      const shown = events.map((e) => ({ ...e, handEnd: false }));
      expect(shown.filter((e) => e.kind !== 'hearts' && e.kind !== 'sun' && e.kind !== 'moon')).toEqual(fromRecord(record).slice(1));
      expect(shown.filter((e) => e.kind === 'hearts')).toHaveLength(1);
    }
  });
});

describe('nothing to tell', () => {
  it('for passing and a new deal', () => {
    expect(tableEvents(faceUpMark(null), newGame(4, seeded(2)), S)).toEqual([]);
    const game = newGame(4, seeded(2));
    expect(game.hand!.phase).toBe('passing');
    const events = change(game, S, () => {
      for (let seat = 0; seat < 4; seat++) gamePass(game, seat, game.hand!.hands[seat].slice(0, 3));
    });
    expect(game.hand!.phase).toBe('playing');
    expect(events).toEqual([]);
  });

  it('for a redeal, an undo within a hand or across hands, End now and Keep playing', () => {
    const rng = seeded(11);
    const game = keepHand();
    plays(game, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS'], [2, '2D'], [3, 'QS']]);
    const saved = JSON.stringify(game);
    plays(game, [[0, '4D'], [1, '5H']]);
    // Undo, as the playtest panel does: the saved state comes back.
    expect(change(game, S, () => Object.assign(game, JSON.parse(saved)))).toEqual([]);
    expect(change(game, S, () => redealHand(game, rng, { passOffset: 0 }))).toEqual([]);

    // Across a hand: back from hand 2 to the final trick of hand 1.
    const full = { ...S, autoFinish: false };
    const one = keepHand();
    plays(one, [[0, '2C'], [1, '4C'], [2, '8C'], [3, 'JS']], full);
    while (one.hand!.tricks.length < 11) aiStep(one, full, () => true, rng);
    const late = JSON.stringify(one);
    playOut(one, full, (h, s) => chooseBotPlay(h, s, full), rng);
    expect(one.hand!.number).toBe(2);
    expect(change(one, S, () => Object.assign(one, JSON.parse(late)))).toEqual([]);

    // End now throws the hand away; Keep playing deals on.
    expect(
      change(one, S, () => {
        one.hand = null;
        one.over = true;
      }),
    ).toEqual([]);
    expect(change(one, S, () => continueGame(one, rng))).toEqual([]);
  });

  it('for no state at all', () => {
    expect(tableEvents(faceUpMark(null), null, S)).toEqual([]);
    expect(tableEvents({ hand: 1, done: 0, broken: false, lastHand: 0 }, null, S)).toEqual([]);
  });
});
