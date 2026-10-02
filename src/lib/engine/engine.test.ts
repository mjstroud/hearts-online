import { describe, expect, it } from 'vitest';
import { chooseBotPass, chooseBotPlay } from './bot';
import { type Card, type Rng, newDeck, penaltyPoints, rankValue } from './cards';
import { aiStep, gamePass, gamePlay, newGame, redealHand, seatsToAct } from './game';
import { type HandState, cardsWon, dealHand, legalPlays, playCard, stackDeck, startHand, submitPass } from './hand';
import { parseCardList, presetSpec } from './presets';
import { DEFAULT_SETTINGS, type GameSettings, deckFor, normalizeSettings, passCycle, passLabel, passOffsetForHand } from './rules';
import { scoreHand } from './scoring';
import { tableViewFor } from './view';

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

/** Play the current hand to completion with bots. */
function autoPlay(state: HandState, settings: GameSettings = S) {
  while (state.phase === 'playing') {
    const seat = state.turn!;
    playCard(state, seat, chooseBotPlay(state, seat, settings), settings);
  }
}

/** Build a 4-player keep hand (hand #4) with explicit cards. */
function keepHand(hands: Card[][], crib: Card[]): HandState {
  return startHand(4, 4, hands, crib);
}

describe('passing cycle', () => {
  it('cycles left, right, across, keep with four players', () => {
    expect(passCycle(4).map((o) => passLabel(o, 4))).toEqual(['Left', 'Right', 'Across', 'Keep']);
    expect([1, 2, 3, 4, 5].map((h) => passOffsetForHand(h, 4))).toEqual([1, 3, 2, 0, 1]);
  });

  it('cycles left, right, left across, right across, keep with five players', () => {
    expect(passCycle(5)).toEqual([1, 4, 2, 3, 0]);
    expect(passCycle(5).map((o) => passLabel(o, 5))).toEqual(['Left', 'Right', 'Left across', 'Right across', 'Keep']);
  });
});

describe('dealing', () => {
  it('deals four players 12 cards each with a 4-card crib from the full deck', () => {
    const hand = dealHand(1, 4, seeded(31));
    expect(hand.hands.every((h) => h.length === 12)).toBe(true);
    expect(hand.crib).toHaveLength(4);
    expect([...hand.hands.flat(), ...hand.crib].sort()).toEqual(newDeck().sort());
  });

  it('removes the three non-heart twos with five players: 9 cards each and a 4-card crib', () => {
    expect(deckFor(5)).toHaveLength(49);
    for (let seed = 1; seed < 30; seed++) {
      const hand = dealHand(1, 5, seeded(seed));
      expect(hand.hands.every((h) => h.length === 9)).toBe(true);
      expect(hand.crib).toHaveLength(4);
      const all = [...hand.hands.flat(), ...hand.crib];
      expect(new Set(all).size).toBe(49);
      for (const two of ['2C', '2D', '2S']) expect(all).not.toContain(two);
      expect(all).toContain('2H');
    }
  });

  it('starts in the passing phase except on keep hands', () => {
    expect(dealHand(1, 4, seeded(1)).phase).toBe('passing');
    expect(dealHand(4, 4, seeded(1)).phase).toBe('playing');
    expect(dealHand(5, 5, seeded(1)).phase).toBe('playing');
  });

  it('opens with the lowest club in play when the 2 of clubs is in the crib', () => {
    const deck = newDeck(); // C2..CA, D2..DA, S2..SA, H2..HA
    const crib: Card[] = ['2C', '5D', '6D', '7D'];
    const rest = deck.filter((c) => !crib.includes(c));
    const hands = [0, 1, 2, 3].map((s) => rest.filter((_, i) => i % 4 === s));
    const hand = keepHand(hands, crib);
    expect(hand.openingCard).toBe('3C');
    expect(hand.turn).toBe(hands.findIndex((h) => h.includes('3C')));
    expect(legalPlays(hand, hand.turn!, S)).toEqual(['3C']);
  });

  it('opens five-player hands with the 3 of clubs, or the next club up if it is in the crib', () => {
    const normal = dealHand(5, 5, seeded(3), { spec: { crib: ['QD'] } });
    const holder = normal.hands.findIndex((h) => h.includes('3C'));
    if (holder >= 0) expect(normal.openingCard).toBe('3C');
    const hidden = dealHand(5, 5, seeded(3), { spec: { crib: ['3C'] } });
    expect(hidden.openingCard).toBe('4C');
    expect(hidden.turn).toBe(hidden.hands.findIndex((h) => h.includes('4C')));
  });
});

describe('stacked deals', () => {
  it('places requested cards and fills the rest randomly', () => {
    const { hands, crib } = stackDeck(4, { hands: [['QS', 'AH'], undefined, ['JD']], crib: ['2C'] }, seeded(5));
    expect(hands[0]).toEqual(expect.arrayContaining(['QS', 'AH']));
    expect(hands[2]).toContain('JD');
    expect(crib).toContain('2C');
    expect(new Set([...hands.flat(), ...crib]).size).toBe(52);
  });

  it('rejects impossible stacks', () => {
    expect(() => stackDeck(4, { hands: [['QS'], ['QS']] })).toThrow(/twice/);
    expect(() => stackDeck(4, { crib: ['2C', '3C', '4C', '5C', '6C'] })).toThrow(/at most 4/);
    expect(() => stackDeck(5, { hands: [['2S']] })).toThrow(/five|5-player/);
    expect(() => stackDeck(5, { hands: [deckFor(5).slice(0, 10)] })).toThrow(/at most 9/);
  });

  it('can force a pass direction', () => {
    expect(dealHand(1, 4, seeded(2), { passOffset: 0 }).phase).toBe('playing');
    expect(dealHand(4, 4, seeded(2), { passOffset: 2 }).passOffset).toBe(2);
  });

  it('parses loosely typed card lists', () => {
    expect(parseCardList('qs, 10h A♦ 2♣', 4)).toEqual({ cards: ['QS', 'TH', 'AD', '2C'] });
    expect(parseCardList('ZZ', 4)).toHaveProperty('error');
    expect(parseCardList('2D', 5)).toHaveProperty('error');
  });
});

describe('scenario presets', () => {
  /** The shooter always plays its highest legal card; everyone else plays like a bot or at random. */
  function playOut(hand: HandState, shooter: number, rng: Rng, randomOthers: boolean) {
    while (hand.phase === 'playing') {
      const seat = hand.turn!;
      const legal = legalPlays(hand, seat, S);
      let card: Card;
      if (seat === shooter) card = legal.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
      else if (randomOthers) card = legal[rng(legal.length)];
      else card = chooseBotPlay(hand, seat, S);
      playCard(hand, seat, card, S);
    }
    return scoreHand(hand, S);
  }

  for (const players of [4, 5]) {
    it(`Moon setup always shoots the moon (${players} players)`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const seat = seed % players;
        const rng = seeded(seed * 7);
        const hand = dealHand(1, players, rng, { spec: presetSpec('moon', players, seat), passOffset: 0 });
        const r = playOut(hand, seat, rng, seed % 2 === 0);
        expect(r.moon).toBe(seat);
        expect(r.sun).toBeNull();
        // Everyone else takes +26; the Jack of Diamonds still counts for whoever took it.
        expect(r.scores).toEqual(r.scores.map((_, s) => (s === seat ? 0 : 26) + (s === r.jack ? -10 : 0)));
      }
    });

    it(`Sun setup always shoots the sun (${players} players)`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const seat = seed % players;
        const rng = seeded(seed * 13);
        const hand = dealHand(1, players, rng, { spec: presetSpec('sun', players, seat), passOffset: 0 });
        const r = playOut(hand, seat, rng, seed % 2 === 0);
        expect(r.sun).toBe(seat);
        expect(r.scores[seat]).toBe(-10);
        expect(r.scores.filter((_, s) => s !== seat).every((v) => v === 52)).toBe(true);
      }
    });
  }

  it('hides the queen, the jack, or the lowest club in the crib', () => {
    expect(dealHand(4, 4, seeded(1), { spec: presetSpec('queen-crib', 4, 0) }).crib).toContain('QS');
    expect(dealHand(4, 4, seeded(1), { spec: presetSpec('jack-crib', 4, 0) }).crib).toContain('JD');
    expect(dealHand(4, 4, seeded(1), { spec: presetSpec('club-crib', 4, 0) }).openingCard).toBe('3C');
    expect(dealHand(5, 5, seeded(1), { spec: presetSpec('club-crib', 5, 0) }).openingCard).toBe('4C');
  });
});

describe('passing', () => {
  it('exchanges cards in the right direction once everyone has passed', () => {
    const hand = dealHand(1, 4, seeded(7)); // pass left
    const passes = hand.hands.map((h) => h.slice(0, 3));
    passes.forEach((p, seat) => {
      expect(hand.phase).toBe('passing');
      submitPass(hand, seat, p);
    });
    expect(hand.phase).toBe('playing');
    for (let seat = 0; seat < 4; seat++) {
      const from = (seat + 3) % 4;
      for (const c of passes[from]) expect(hand.hands[seat]).toContain(c);
      expect(hand.received[seat].slice().sort()).toEqual(passes[from].slice().sort());
      expect(hand.hands[seat]).toHaveLength(12);
    }
  });

  it('passes left across and right across with five players', () => {
    for (const [handNumber, offset] of [
      [3, 2],
      [4, 3],
    ]) {
      const hand = dealHand(handNumber, 5, seeded(handNumber));
      expect(hand.passOffset).toBe(offset);
      const passes = hand.hands.map((h) => h.slice(0, 3));
      passes.forEach((p, seat) => submitPass(hand, seat, p));
      for (let seat = 0; seat < 5; seat++) expect(hand.received[(seat + offset) % 5].sort()).toEqual(passes[seat].slice().sort());
    }
  });

  it('rejects bad passes', () => {
    const hand = dealHand(2, 4, seeded(9));
    expect(() => submitPass(hand, 0, hand.hands[0].slice(0, 2))).toThrow();
    expect(() => submitPass(hand, 0, [hand.hands[0][0], hand.hands[0][0], hand.hands[0][1]])).toThrow();
    expect(() => submitPass(hand, 0, hand.hands[1].slice(0, 3))).toThrow();
    submitPass(hand, 0, hand.hands[0].slice(0, 3));
    expect(() => submitPass(hand, 0, hand.hands[0].slice(3, 6))).toThrow(/already/);
  });
});

describe('legal plays', () => {
  // Seat 0 holds 2C; everyone has clubs except seat 3 who is void.
  const hands: Card[][] = [
    ['2C', '3C', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', '2H', '3H', '4H'],
    ['4C', '5C', '6C', '7C', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '5H'],
    ['8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '2D', '3D', '9S', 'TS', '6H'],
    ['7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH', 'QS', 'KS', 'AS', 'JS'],
  ];
  const crib: Card[] = ['JD', 'QD', 'KD', 'AD'];

  it('forces following suit and blocks points on the first trick', () => {
    const hand = keepHand(hands, crib);
    expect(legalPlays(hand, 0, S)).toEqual(['2C']);
    playCard(hand, 0, '2C', S);
    expect(legalPlays(hand, 1, S)).toEqual(['4C', '5C', '6C', '7C']);
    expect(() => playCard(hand, 1, '2S', S)).toThrow(/follow suit/);
    playCard(hand, 1, '7C', S);
    playCard(hand, 2, 'AC', S);
    // Seat 3 has only hearts and spades: may not dump the queen or hearts while spades remain.
    expect(legalPlays(hand, 3, S)).toEqual(['JS', 'KS', 'AS']);
    playCard(hand, 3, 'AS', S);
    expect(hand.cribWinner).toBe(2);
    expect(cardsWon(hand, 2)).toEqual(expect.arrayContaining(crib));
  });

  it('lets a player with only point cards dump any of them on the first trick', () => {
    const onlyPoints: Card[][] = [
      ['2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QC', 'KC'],
      ['AC', '2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', 'JD', 'QD'],
      ['KD', 'AD', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'TS', 'JS'],
      ['QS', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', 'TH', 'JH', 'QH'],
    ];
    const hand = keepHand(onlyPoints, ['KS', 'AS', 'KH', 'AH']);
    playCard(hand, 0, '2C', S);
    playCard(hand, 1, 'AC', S);
    playCard(hand, 2, 'KD', S);
    expect(legalPlays(hand, 3, S)).toContain('QS');
    expect(legalPlays(hand, 3, S)).toHaveLength(12);
  });

  it('allows points on the first trick when the house rule is off', () => {
    const hand = keepHand(hands, crib);
    const loose = { ...S, noPointsOnFirstTrick: false };
    playCard(hand, 0, '2C', loose);
    playCard(hand, 1, '7C', loose);
    playCard(hand, 2, 'AC', loose);
    expect(legalPlays(hand, 3, loose)).toContain('QS');
  });

  it('does not allow leading hearts until broken', () => {
    const hand = keepHand(hands, crib);
    for (const [seat, card] of [[0, '2C'], [1, '7C'], [2, 'AC'], [3, 'AS']] as const) playCard(hand, seat, card, S);
    expect(hand.turn).toBe(2);
    expect(legalPlays(hand, 2, S)).not.toContain('6H');
    expect(() => playCard(hand, 2, '6H', S)).toThrow(/broken/);
  });
});

describe('scoring', () => {
  it('scores hearts, the queen, the jack, and the crib', () => {
    const hand = keepHand(
      [
        ['2C', '3C', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', '2H', '3H', '4H'],
        ['4C', '5C', '6C', '7C', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '5H'],
        ['8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', '2D', '3D', '9S', 'TS', '6H'],
        ['7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH', 'QS', 'KS', 'AS', 'JS'],
      ],
      ['JD', 'QD', 'KD', 'AD'],
    );
    autoPlay(hand);
    const r = scoreHand(hand, S);
    expect(r.penalty.reduce((a, b) => a + b, 0)).toBe(26);
    expect(r.cribWinner).toBe(2);
    expect(r.jack).toBe(2); // Jack of Diamonds was in the crib
    expect(r.cribPoints).toBe(-10);
    if (r.moon === null && r.sun === null) {
      expect(r.scores).toEqual(r.penalty.map((p, s) => p + (s === 2 ? -10 : 0)));
    }
  });

  it('cannot shoot the moon without the hearts hidden in the crib', () => {
    const hand = keepHand(
      [
        ['2C', 'AH', 'KH', 'QH', 'JH', 'TH', '9H', '8H', '7H', 'QS', 'KS', 'AS'],
        ['3C', '4C', '5C', '6C', '7C', '8C', '9C', '2D', '3D', '4D', '5D', '6D'],
        ['TC', 'JC', 'QC', 'KC', 'AC', '7D', '8D', '9D', 'TD', '2S', '3S', '4S'],
        ['JD', 'QD', 'KD', 'AD', '5S', '6S', '7S', '8S', '9S', 'TS', 'JS', '6H'],
      ],
      ['2H', '3H', '4H', '5H'],
    );
    // Seat 0 opens 2C; seat 2 wins with AC and takes the crib, so 0 can't moon.
    autoPlay(hand);
    const r = scoreHand(hand, S);
    expect(r.cribWinner).not.toBe(0);
    expect(r.moon).toBeNull();
  });

  it('applies moon and sun adjustments', () => {
    const base = dealHand(4, 4, seeded(42));
    autoPlay(base);
    // Rewrite history so seat 1 took every trick: Shooting the Sun.
    const sunHand: HandState = { ...base, cribWinner: 1, tricks: base.tricks.map((t) => ({ ...t, winner: 1 })) };
    const sun = scoreHand(sunHand, S);
    expect(sun.sun).toBe(1);
    expect(sun.scores).toEqual([52, -10, 52, 52]);

    const noSun = scoreHand(sunHand, { ...S, shootTheSun: false });
    expect(noSun.sun).toBeNull();
    expect(noSun.moon).toBe(1);
    expect(noSun.scores).toEqual([26, -10, 26, 26]);

    const plain = scoreHand(sunHand, { ...S, shootTheSun: false, shootTheMoon: false, jackOfDiamonds: false });
    expect(plain.scores).toEqual([0, 26, 0, 0]);

    // Moon without the sun: seat 2 takes one clean trick, seat 1 takes everything else.
    const cleanIdx = base.tricks.findIndex((t) => penaltyPoints(t.plays.map((p) => p.card)) === 0 && !t.plays.some((p) => p.card === 'JD'));
    if (cleanIdx > 0) {
      const moonHand: HandState = {
        ...sunHand,
        tricks: sunHand.tricks.map((t, i) => (i === cleanIdx ? { ...t, winner: 2 } : t)),
      };
      const moon = scoreHand(moonHand, S);
      expect(moon.sun).toBeNull();
      expect(moon.moon).toBe(1);
      expect(moon.scores).toEqual([26, -10, 26, 26]);
    }
  });
});

describe('full games', () => {
  it.each([4, 5])('bots can play many hands without breaking invariants (%i players)', (players) => {
    const rng = seeded(1234 + players);
    const game = newGame(players, rng);
    let hands = 0;
    while (hands < 300) {
      const hand = game.hand!;
      // Each seat's view must hide other hands and the crib until won.
      for (let seat = 0; seat < players; seat++) {
        const view = tableViewFor(game, seat, S)!;
        expect(view.myHand).toEqual(hand.hands[seat]);
        expect(view.myCrib === null || hand.cribWinner === seat).toBe(true);
      }
      if (hand.phase === 'passing') {
        for (const seat of seatsToAct(game)) gamePass(game, seat, chooseBotPass(hand.hands[seat]));
        continue;
      }
      const seat = seatsToAct(game)[0];
      const before = game.scores.slice();
      const res = gamePlay(game, seat, chooseBotPlay(hand, seat, S), S, rng);
      if (res.completedHand) {
        hands++;
        const r = res.completedHand;
        expect(r.penalty.reduce((a, b) => a + b, 0)).toBe(26);
        expect(r.tricksWon.reduce((a, b) => a + b, 0)).toBe(r.tricks.length);
        expect(r.tricks).toHaveLength(players === 5 ? 9 : 12);
        const sum = r.scores.reduce((a, b) => a + b, 0);
        if (r.sun !== null) expect(sum).toBe(52 * (players - 1) - 10);
        else if (r.moon !== null) expect(sum).toBe(26 * (players - 1) - 10);
        else expect(sum).toBe(26 - 10);
        expect(game.scores).toEqual(before.map((b, s) => b + r.scores[s]));
        expect(game.hand!.number).toBe(r.number + 1);
      }
    }
  });

  it('only ends once a completed hand has someone at or over the score limit', () => {
    const settings = { ...S, scoreLimit: 50 };
    const rng = seeded(99);
    const game = newGame(4, rng);
    let guard = 0;
    while (!game.over && guard++ < 100_000) {
      // Mid-hand, nobody is over the limit yet (otherwise the previous hand would have ended it).
      expect(Math.max(...game.scores)).toBeLessThan(50);
      aiStep(game, settings, () => true, rng);
    }
    expect(game.over).toBe(true);
    expect(Math.max(...game.scores)).toBeGreaterThanOrEqual(50);
    expect(game.hand).toBeNull();
    expect(game.lastHand).not.toBeNull();
  });

  it('ends after the hand in progress when the host asks', () => {
    const rng = seeded(7);
    const game = newGame(4, rng);
    aiStep(game, S, () => true, rng); // everyone passes
    game.endAfterHand = true;
    while (!game.over) aiStep(game, S, () => true, rng);
    expect(game.handsPlayed).toBe(1);
    expect(game.hand).toBeNull();
  });

  it('redeals the current hand with a stacked deck', () => {
    const rng = seeded(11);
    const game = newGame(4, rng);
    redealHand(game, rng, { spec: presetSpec('queen-crib', 4, 0), passOffset: 0 });
    expect(game.hand!.number).toBe(1);
    expect(game.hand!.crib).toContain('QS');
    expect(game.hand!.phase).toBe('playing');
  });
});

describe('settings', () => {
  it('normalizes untrusted input', () => {
    expect(normalizeSettings({ scoreLimit: '100', jackOfDiamonds: false })).toMatchObject({
      scoreLimit: 100,
      jackOfDiamonds: false,
      shootTheSun: true,
      shootTheMoon: true,
    });
    expect(normalizeSettings({ scoreLimit: -5 })).toMatchObject({ scoreLimit: null });
  });
});
