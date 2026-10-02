import { describe, expect, it } from 'vitest';
import { chooseBotPass, chooseBotPlay } from './bot';
import { type Card, type Rng, newDeck, penaltyPoints } from './cards';
import { gamePass, gamePlay, newGame, seatsToAct } from './game';
import { type HandState, cardsWon, dealHand, legalPlays, playCard, startHand, submitPass } from './hand';
import { DEFAULT_SETTINGS, type GameSettings, normalizeSettings, passCycle, passLabel, passOffsetForHand } from './rules';
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

/** Play the current trick to completion with bots. */
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

  it('cycles through every other player then keep with five players', () => {
    expect(passCycle(5)).toEqual([1, 4, 2, 3, 0]);
    expect(passCycle(5).map((o) => passLabel(o, 5))).toEqual(['Left', 'Right', '2 to the left', '2 to the right', 'Keep']);
  });
});

describe('dealing', () => {
  it.each([
    [4, 2, 12, 4],
    [5, 2, 10, 2],
    [5, 7, 9, 7],
  ] as const)('%i players (5p crib %i) get %i cards with a %i-card crib', (players, five, per, crib) => {
    const settings = { ...S, fivePlayerCribSize: five };
    const hand = dealHand(1, players, settings, seeded(players * 31 + five));
    expect(hand.hands.every((h) => h.length === per)).toBe(true);
    expect(hand.crib).toHaveLength(crib);
    const all = [...hand.hands.flat(), ...hand.crib];
    expect(new Set(all).size).toBe(52);
    expect(all.sort()).toEqual(newDeck().sort());
  });

  it('starts in the passing phase except on keep hands', () => {
    expect(dealHand(1, 4, S, seeded(1)).phase).toBe('passing');
    expect(dealHand(4, 4, S, seeded(1)).phase).toBe('playing');
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
});

describe('passing', () => {
  it('exchanges cards in the right direction once everyone has passed', () => {
    const hand = dealHand(1, 4, S, seeded(7)); // pass left
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

  it('rejects bad passes', () => {
    const hand = dealHand(2, 4, S, seeded(9));
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
    // Seat 0 holds every heart, the queen, and the top spades.
    const hand = keepHand(
      [
        ['2C', 'AH', 'KH', 'QH', 'JH', 'TH', '9H', '8H', '7H', 'QS', 'KS', 'AS'],
        ['3C', '4C', '5C', '6C', '7C', '8C', '9C', '2D', '3D', '4D', '5D', '6D'],
        ['TC', 'JC', 'QC', 'KC', 'AC', '7D', '8D', '9D', 'TD', '2S', '3S', '4S'],
        ['JD', 'QD', 'KD', 'AD', '5S', '6S', '7S', '8S', '9S', 'TS', 'JS', '6H'],
      ],
      ['2H', '3H', '4H', '5H'],
    );
    // Hand-crafted lines: seat 0 opens 2C; seat 2 wins with AC and takes the crib, so 0 can't moon.
    autoPlay(hand);
    const r = scoreHand(hand, S);
    expect(r.cribWinner).not.toBe(0);
    expect(r.moon).toBeNull();
  });

  it('applies moon and sun adjustments', () => {
    const base = dealHand(4, 4, S, seeded(42));
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
  it.each([
    [4, 2],
    [5, 2],
    [5, 7],
  ] as const)('bots can play many hands without breaking invariants (%i players, 5p crib %i)', (players, five) => {
    const settings = { ...S, fivePlayerCribSize: five };
    const rng = seeded(1234 + players + five);
    const game = newGame(players, settings, rng);
    let hands = 0;
    while (hands < 300) {
      const hand = game.hand!;
      // Each seat's view must hide other hands and the crib until won.
      for (let seat = 0; seat < players; seat++) {
        const view = tableViewFor(game, seat, settings)!;
        expect(view.myHand).toEqual(hand.hands[seat]);
        expect(view.myCrib === null || hand.cribWinner === seat).toBe(true);
      }
      if (hand.phase === 'passing') {
        for (const seat of seatsToAct(game)) gamePass(game, seat, chooseBotPass(hand.hands[seat]));
        continue;
      }
      const seat = seatsToAct(game)[0];
      const before = game.scores.slice();
      const res = gamePlay(game, seat, chooseBotPlay(hand, seat, settings), settings, rng);
      if (res.completedHand) {
        hands++;
        const r = res.completedHand;
        expect(r.penalty.reduce((a, b) => a + b, 0)).toBe(26);
        expect(r.tricksWon.reduce((a, b) => a + b, 0)).toBe(r.tricks.length);
        const sum = r.scores.reduce((a, b) => a + b, 0);
        if (r.sun !== null) expect(sum).toBe(52 * (players - 1) - 10);
        else if (r.moon !== null) expect(sum).toBe(26 * (players - 1) - 10);
        else expect(sum).toBe(26 - 10);
        expect(game.scores).toEqual(before.map((b, s) => b + r.scores[s]));
        expect(game.hand!.number).toBe(r.number + 1);
      }
    }
  });

  it('ends when the score limit is reached', () => {
    const settings = { ...S, scoreLimit: 50 };
    const rng = seeded(99);
    const game = newGame(4, settings, rng);
    let guard = 0;
    while (!game.over && guard++ < 100_000) {
      const hand = game.hand!;
      if (hand.phase === 'passing') {
        for (const seat of seatsToAct(game)) gamePass(game, seat, chooseBotPass(hand.hands[seat]));
      } else {
        const seat = seatsToAct(game)[0];
        gamePlay(game, seat, chooseBotPlay(hand, seat, settings), settings, rng);
      }
    }
    expect(game.over).toBe(true);
    expect(Math.max(...game.scores)).toBeGreaterThanOrEqual(50);
    expect(game.hand).toBeNull();
  });
});

describe('settings', () => {
  it('normalizes untrusted input', () => {
    expect(normalizeSettings({ scoreLimit: '100', fivePlayerCribSize: '7', jackOfDiamonds: false })).toMatchObject({
      scoreLimit: 100,
      fivePlayerCribSize: 7,
      jackOfDiamonds: false,
      shootTheSun: true,
    });
    expect(normalizeSettings({ scoreLimit: -5, fivePlayerCribSize: 3 })).toMatchObject({ scoreLimit: null, fivePlayerCribSize: 2 });
  });
});
