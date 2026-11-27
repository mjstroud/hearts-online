import { describe, expect, it } from 'vitest';
import { chooseBotPass, chooseBotPlay } from './engine/bot';
import { type Card, type Rng, rankValue } from './engine/cards';
import { type GameState, gamePass, gamePlay, newGame } from './engine/game';
import { type HandState, type Trick, dealHand, legalPlays, playCard } from './engine/hand';
import { presetSpec } from './engine/presets';
import { DEFAULT_SETTINGS, type GameSettings } from './engine/rules';
import { scoreHand } from './engine/scoring';
import { type HandSummary, type TableView, summarizeHand, tableViewFor } from './engine/view';
import {
  FINAL_TRICK_MS,
  MIN_SHOW_MS,
  type Message,
  STAGGER_MS,
  type Who,
  arrivalDelays,
  detectMoments,
  endedLive,
  enqueue,
  finalMoments,
  finalTrickHoldMs,
  playedOutNote,
  restingMessage,
  takeNext,
} from './moments';

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
const NAMES = ['Ann', 'Bob', 'Cat', 'Dee', 'Eve'];
const onlooker = (jack = true): Who => ({ names: NAMES, me: null, jack });
/** A message as it reads on the felt (without the text-not-emoji selector after the \u2600). */
const text = (m: Message) => `${m.pre}${m.name}${m.post}`.replace(/\u00a0/g, ' ').replace(/\ufe0e/g, '');
const texts = (ms: Message[]) => ms.map(text);

const gameOf = (hand: HandState): GameState => ({
  numPlayers: hand.numPlayers,
  hand,
  scores: hand.dealt.map(() => 0),
  handsPlayed: 0,
  lastHand: null,
  over: false,
});
// A copy, as the browser gets: the view shares the hand's live trick objects, which the next play changes.
const viewFor = (hand: HandState, seat: number | null, settings: GameSettings = S) =>
  structuredClone(tableViewFor(gameOf(hand), seat, settings)!);

/**
 * Plays a hand out card by card, feeding every seat's consecutive views (and an onlooker's) through
 * detectMoments. Returns the onlooker's moments, after checking every seat saw exactly the same ones.
 */
function playThrough(hand: HandState, pick: (seat: number) => Card, settings: GameSettings = S) {
  const seats = [null, ...hand.dealt.map((_, s) => s)];
  let prev = seats.map((s) => viewFor(hand, s, settings));
  const all: { messages: Message[]; ripple: Card | null; trick: number }[] = [];
  while (hand.phase === 'playing') {
    playCard(hand, hand.turn!, pick(hand.turn!), settings);
    const next = seats.map((s) => viewFor(hand, s, settings));
    const seen = next.map((v, i) => detectMoments(prev[i], v, onlooker(settings.jackOfDiamonds)));
    // The crib winner's own view counts the crib, but every seat sees the same moments.
    for (const m of seen) expect(m).toEqual(seen[0]);
    all.push({ ...seen[0], trick: hand.tricks.length });
    prev = next;
  }
  return all;
}

const kinds = (all: ReturnType<typeof playThrough>, kind: Message['kind']) => all.flatMap((a) => a.messages.filter((m) => m.kind === kind));

describe('moments over whole hands', () => {
  for (const players of [4, 5]) {
    it(`fire once each, from face-up cards, identically for every seat (${players} players)`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const rng = seeded(seed * 7 + players);
        const preset = seed % 5 === 0 ? 'queen-crib' : seed % 5 === 1 ? 'jack-crib' : 'random';
        const hand = dealHand(1, players, rng, { spec: presetSpec(preset, players, 0), passOffset: 0 });
        const jackRule = seed % 2 === 0;
        const settings = { ...S, jackOfDiamonds: jackRule };
        const all = playThrough(hand, (seat) => (seed % 3 ? chooseBotPlay(hand, seat, settings) : legalPlays(hand, seat, settings)[rng(legalPlays(hand, seat, settings).length)]), settings);

        // Hearts break exactly once, with the card that did it.
        const hearts = kinds(all, 'hearts');
        expect(hearts).toHaveLength(1);
        const first = hand.tricks.flatMap((t) => t.plays).find((p) => p.card[1] === 'H' || p.card === 'QS')!;
        expect(text(hearts[0])).toMatch(new RegExp(`^Hearts are broken: ${NAMES[first.seat]}’s `));
        expect(hearts[0].wash).toBe('hearts');

        // The Q♠: a ripple when it lands and one message when its trick closes, unless the crib hid it.
        const qTrick = hand.tricks.find((t) => t.plays.some((p) => p.card === 'QS'));
        expect(kinds(all, 'queen').map(text)).toEqual(qTrick ? [`${NAMES[qTrick.winner!]} eats the Queen · +13`] : []);
        expect(all.filter((a) => a.ripple === 'QS')).toHaveLength(qTrick ? 1 : 0);

        // The J♦ only when the rule is on.
        const jTrick = hand.tricks.find((t) => t.plays.some((p) => p.card === 'JD'));
        expect(kinds(all, 'jack').map(text)).toEqual(jTrick && jackRule ? [`${NAMES[jTrick.winner!]} grabs the Jack · −10`] : []);

        // Sun and Moon watches say nothing: the glow behind the watcher's avatar is the news.
        expect(all.flatMap((a) => texts(a.messages)).filter((m) => /Sun|Moon/.test(m))).toEqual([]);
      }
    });
  }

  it('reads "You" from your own seat', () => {
    const rng = seeded(11);
    const hand = dealHand(1, 4, rng, { passOffset: 0 });
    let prev = viewFor(hand, 0);
    const mine: string[] = [];
    while (hand.phase === 'playing') {
      playCard(hand, hand.turn!, chooseBotPlay(hand, hand.turn!, S), S);
      const next = viewFor(hand, 0);
      mine.push(...texts(detectMoments(prev, next, { names: NAMES, me: 0, jack: true }).messages));
      prev = next;
    }
    const q = hand.tricks.find((t) => t.plays.some((p) => p.card === 'QS'));
    if (q?.winner === 0) expect(mine).toContain('You eat the Queen · +13');
    const broke = hand.tricks.flatMap((t) => t.plays).find((p) => p.card[1] === 'H' || p.card === 'QS')!;
    if (broke.seat === 0) expect(mine.some((m) => m.startsWith('Hearts are broken: your '))).toBe(true);
  });

  for (const players of [4, 5]) {
    it(`a Sun or Moon run has no messages: the glow is the news (${players} players)`, () => {
      let shots = 0;
      for (const preset of ['sun', 'moon'] as const) {
        for (let seat = 0; seat < players; seat++) {
          const rng = seeded(seat * 31 + players);
          const hand = dealHand(1, players, rng, { spec: presetSpec(preset, players, seat), passOffset: 0 });
          const all = playThrough(hand, (s) => {
            const legal = legalPlays(hand, s, S);
            return s === seat ? legal.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a)) : chooseBotPlay(hand, s, S);
          });
          const r = scoreHand(hand, S);
          if ((r.sun ?? r.moon) === seat) shots++;
          expect(all.flatMap((a) => texts(a.messages)).filter((m) => /Sun|Moon/.test(m))).toEqual([]);
        }
      }
      expect(shots).toBeGreaterThan(0);
    });
  }
});

/** A bare view for hand-made cases: only the fields moments read. */
function tv(p: Partial<TableView>): TableView {
  return {
    handNumber: 3,
    phase: 'playing',
    trickNumber: 6,
    totalTricks: 12,
    handSizes: [7, 7, 7, 7],
    current: { leader: 0, plays: [], winner: null },
    lastTrick: null,
    heartsBrokenBy: null,
    sunWatch: null,
    moonWatch: null,
    ...p,
  } as TableView;
}

const won = (winner: number, ...cards: Card[]): Trick => ({
  leader: winner,
  plays: cards.map((card, i) => ({ seat: (winner + i) % 4, card })),
  winner,
});

describe('detectMoments', () => {
  const before = tv({ lastTrick: won(2, '2C', '3C', '4C', '5C'), sunWatch: 2, moonWatch: 2 });
  const closes = (trick: Trick, p: Partial<TableView> = {}) =>
    tv({ trickNumber: 7, handSizes: [6, 6, 6, 6], current: { leader: trick.winner!, plays: [], winner: null }, lastTrick: trick, ...p });

  it('stays quiet on a first view, a new hand, a big jump or an undo', () => {
    const next = closes(won(1, '6C', '7C', '8C', 'QS'));
    expect(detectMoments(null, next, onlooker()).messages).toEqual([]);
    expect(detectMoments(tv({ handNumber: 2 }), next, onlooker()).messages).toEqual([]);
    // Two tricks at once: this tab missed updates (a reconnect catching up).
    expect(detectMoments(tv({ trickNumber: 5 }), next, onlooker()).messages).toEqual([]);
    expect(detectMoments(next, before, onlooker()).messages).toEqual([]);
  });

  it('says nothing when the host turns the watches off mid-trick', () => {
    const off = tv({ lastTrick: before.lastTrick, current: { leader: 2, plays: [{ seat: 2, card: '9D' }], winner: null } });
    expect(detectMoments(before, off, onlooker()).messages).toEqual([]);
  });

  it('says nothing when a watch starts or ends: the glow is the news', () => {
    expect(detectMoments(before, closes(won(3, '6H', '7C', '8C', '9C')), onlooker()).messages).toEqual([]);
    const starts = closes(won(1, '6C', '7C', '8C', '9C'), { sunWatch: 1, sunRun: { seat: 1, tricks: 4 } });
    expect(detectMoments(tv({ trickNumber: 6 }), starts, onlooker()).messages).toEqual([]);
  });

  it('breaks hearts the moment the card lands, with a wash, and ripples the Q♠', () => {
    const lands = tv({ current: { leader: 0, plays: [{ seat: 0, card: 'AS' }, { seat: 1, card: 'QS' }], winner: null }, heartsBrokenBy: { seat: 1, card: 'QS', trick: 6 } });
    const prev = tv({ current: { leader: 0, plays: [{ seat: 0, card: 'AS' }], winner: null } });
    const m = detectMoments(prev, lands, onlooker());
    expect(texts(m.messages)).toEqual(['Hearts are broken: Bob’s Q♠']);
    expect(m.ripple).toBe('QS');
    // Your own play: predicted first (no heartsBrokenBy yet), then the server names it.
    const mine = detectMoments({ ...lands, heartsBrokenBy: null }, lands, { names: NAMES, me: 1, jack: true });
    expect(texts(mine.messages)).toEqual(['Hearts are broken: your Q♠']);
    expect(mine.ripple).toBeNull();
  });

  it('keeps the spaces next to a name, which flex layout would drop', () => {
    const m = detectMoments(tv({}), closes(won(1, '6C', 'QS', '8C', '9C')), onlooker()).messages[0];
    expect(m.post.startsWith('\u00a0')).toBe(true);
    const r = restingMessage(won(1, '6C', '7C', '8C', '9C'), onlooker(), false)!;
    expect(r.post).toBe('\u00a0takes it');
  });
});

describe('resting message', () => {
  const t = won(2, '6C', '7C', '8C', '9C');
  it('names who took the trick, and folds in your lead', () => {
    expect(text(restingMessage(t, onlooker(), false)!)).toBe('Cat takes it');
    expect(text(restingMessage(t, { names: NAMES, me: 2, jack: true }, true)!)).toBe('You take it · your lead');
    expect(text(restingMessage(t, { names: NAMES, me: 2, jack: true }, false)!)).toBe('You take it');
    expect(restingMessage({ ...t, winner: null }, onlooker(), false)).toBeNull();
  });
});

describe('the hand-end sequence', () => {
  const summary = (p: Partial<HandSummary>): HandSummary =>
    ({ number: 3, jackScored: true, sun: null, moon: null, finalTrick: won(1, '2D', 'QS', 'JD', '4D'), ...p }) as HandSummary;

  const final = (s: HandSummary, w = onlooker()) => finalMoments(s.finalTrick!, s, w);

  it('tells the final trick but leaves a shot to the full-screen celebration', () => {
    const m = final(summary({ moon: 1 }));
    expect(texts(m)).toEqual(['Bob eats the Queen · +13', 'Bob grabs the Jack · −10']);
    expect(m.some((x) => x.kind === 'shot')).toBe(false);
    expect(final(summary({ jackScored: false, sun: 0, finalTrick: won(0, '2D', '3D', '4D', '5D') }), { names: NAMES, me: 0, jack: false })).toEqual([]);
  });

  it('holds the final trick long enough for its cards to land and each of its messages', () => {
    const s = summary({});
    // Three of its cards already down: the fourth lands at once.
    const threeDown = tv({ trickNumber: 12, handSizes: [0, 0, 0, 1], current: { ...s.finalTrick!, plays: s.finalTrick!.plays.slice(0, 3), winner: null } });
    expect(finalTrickHoldMs(threeDown, s.finalTrick!, s, onlooker())).toBe(2 * MIN_SHOW_MS);
    // All four in one update (queued cards firing behind the lead): they slide in one after another first.
    expect(finalTrickHoldMs(null, s.finalTrick!, s, onlooker())).toBe(3 * STAGGER_MS + 2 * MIN_SHOW_MS);
    const quiet = summary({ finalTrick: won(0, '2D', '3D', '4D', '5D') });
    expect(finalTrickHoldMs(null, quiet.finalTrick!, quiet, onlooker())).toBe(3 * STAGGER_MS + FINAL_TRICK_MS);
  });

  it('says an auto-finished hand is over', () => {
    // The server played out tricks 10-12, so trick 9 was the last the table saw.
    const s = summary({ autoFrom: 10 });
    const inPlay = { leader: 1, plays: s.finalTrick!.plays.slice(0, 2), winner: null };
    const at9 = tv({ trickNumber: 9, handSizes: [4, 3, 3, 4], current: inPlay, sunWatch: 0 });
    const m = final(s);
    expect(m[0].kind).toBe('auto');
    expect(texts(m)).toEqual(['No points left · hand over', 'Bob eats the Queen · +13', 'Bob grabs the Jack · −10']);
    // Two cards still to land, then three messages.
    expect(finalTrickHoldMs(at9, s.finalTrick!, s, onlooker())).toBe(STAGGER_MS + 3 * MIN_SHOW_MS);
    // Without the summary there's no knowing the hand ended early.
    expect(texts(finalMoments(s.finalTrick!, null, onlooker()))).not.toContain('No points left · hand over');
  });

  it('without the hand’s summary, tells only what the trick itself shows', () => {
    // After a game's last hand the felt holds a view whose lastHand is the hand before.
    const trick = won(1, '2D', 'QS', 'JD', '4D');
    expect(texts(finalMoments(trick, null, onlooker(false)))).toEqual(['Bob eats the Queen · +13']);
    expect(texts(finalMoments(trick, null, onlooker(true)))).toEqual(['Bob eats the Queen · +13', 'Bob grabs the Jack · −10']);
  });

  it('works from a real game: the next hand is dealt with the last card', () => {
    const rng = seeded(5);
    const game = newGame(4, rng);
    const h = game.hand!;
    for (let s = 0; s < 4; s++) gamePass(game, s, chooseBotPass(h.hands[s]));
    let before: TableView | null = null;
    while (game.hand === h) {
      before = structuredClone(tableViewFor(game, null, S));
      gamePlay(game, h.turn!, chooseBotPlay(h, h.turn!, S), S, rng);
    }
    const s = summarizeHand(game.lastHand!);
    const after = tableViewFor(game, null, S)!;
    expect(after.handNumber).toBe(2);
    // Across hands, detectMoments says nothing; the sequence uses the summary instead.
    expect(detectMoments(before, after, onlooker()).messages).toEqual([]);
    const m = texts(finalMoments(s.finalTrick!, s, onlooker()));
    const q = s.finalTrick!.plays.some((p) => p.card === 'QS');
    expect(m.includes(`${NAMES[s.finalTrick!.winner!]} eats the Queen · +13`)).toBe(q);
  });

  /** Plays hands with bots (and some random cards), keeping each hand's last view before it ended, as Game.svelte holds it. */
  function playHands(seed: number, hands: number, settings: GameSettings = S) {
    const rng = seeded(seed);
    const game = newGame(4, rng);
    const ends: { before: TableView; after: TableView | null; s: HandSummary; hand: HandState }[] = [];
    while (ends.length < hands) {
      const h = game.hand!;
      if (h.phase === 'passing') for (let s = 0; s < 4; s++) gamePass(game, s, chooseBotPass(h.hands[s]));
      let before: TableView | null = null;
      while (game.hand === h) {
        before = structuredClone(tableViewFor(game, null, settings));
        const legal = legalPlays(h, h.turn!, settings);
        gamePlay(game, h.turn!, rng(3) ? chooseBotPlay(h, h.turn!, settings) : legal[rng(legal.length)], settings, rng);
      }
      ends.push({ before: before!, after: tableViewFor(game, null, settings), s: summarizeHand(game.lastHand!), hand: h });
    }
    return ends;
  }

  it('works from real auto-finished hands: the last table trick is the one before autoFrom', () => {
    let finished = 0;
    for (let seed = 1; seed <= 40 && finished < 3; seed++) {
      for (const { before, s, hand } of playHands(seed, 4)) {
        if (!s.autoFrom) continue;
        finished++;
        // The tab saw that trick in progress, so the hand-end sequence plays.
        expect(before.trickNumber).toBe(s.autoFrom - 1);
        expect(endedLive(before, s)).toBe(true);
        expect(s.finalTrick).toEqual(hand.tricks[s.autoFrom - 2]);
        expect(finalMoments(s.finalTrick!, s, onlooker())[0].kind).toBe('auto');
      }
    }
    expect(finished).toBeGreaterThan(0);
  });

  it('knows when this tab watched a hand end, rather than loading in after', () => {
    let auto = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const { before, after, s } of playHands(seed, 4)) {
        // The last view before the hand ended shows its last table trick in progress.
        expect(endedLive(before, s)).toBe(true);
        // The next hand's first view (straight into play after a Keep hand) is no stand-in.
        expect(endedLive(after, s)).toBe(false);
        expect(endedLive(null, s)).toBe(false);
        if (!s.autoFrom) continue;
        auto++;
        // The hand's last trick, which the server played out on its own, is one the table never saw.
        expect(endedLive({ ...before, trickNumber: before.totalTricks }, s)).toBe(false);
      }
    }
    expect(auto).toBeGreaterThan(0);
  });

  it('a hand followed by a Keep hand still ends live', () => {
    // 4 players pass left, right, across, then keep: hand 4 starts straight into play.
    const [, , { before, after, s }] = playHands(3, 3);
    expect(after?.handNumber).toBe(4);
    expect(after?.phase).toBe('playing');
    expect(endedLive(before, s)).toBe(true);
    // The next hand's first view, also mid-play, can't stand in for it.
    expect(endedLive(after, s)).toBe(false);
  });
});

describe('cards that arrive together', () => {
  it('slide in one after another, in play order; cards already down don’t wait', () => {
    const trick = won(1, '2D', 'QS', 'JD', '4D');
    expect([...arrivalDelays([], trick).values()]).toEqual([0, STAGGER_MS, 2 * STAGGER_MS, 3 * STAGGER_MS]);
    expect([...arrivalDelays(['2D', 'QS'], trick).values()]).toEqual([0, 0, 0, STAGGER_MS]);
    expect(arrivalDelays(['2D', 'QS', 'JD', '4D'], trick).get('4D')).toBe(0);
    expect(arrivalDelays([], null).size).toBe(0);
  });
});

describe('played-out note', () => {
  it('names the tricks the server played on its own', () => {
    expect(playedOutNote(10, 12)).toBe('Tricks 10–12 played out on their own: no points were left.');
    expect(playedOutNote(9, 9)).toBe('Trick 9 played out on its own: no points were left.');
    expect(playedOutNote(null, 12)).toBeNull();
    expect(playedOutNote(undefined, 12)).toBeNull();
  });
});

describe('message queue', () => {
  const m = (kind: Message['kind'], name: string, delay?: number): Message => ({ kind, pre: '', name, post: '', delay });

  it('orders by priority, then arrival, and keeps the first few', () => {
    const q = enqueue([], [m('takes', 't'), m('hearts', 'h'), m('jack', 'j1'), m('queen', 'q'), m('jack', 'j2')], 0);
    expect(q.map((x) => x.name)).toEqual(['q', 'h', 'j1', 'j2']);
    expect(enqueue(q, [m('shot', 's')], 0).map((x) => x.name)).toEqual(['s', 'q', 'h', 'j1']);
  });

  it('holds a delayed message back until it is due', () => {
    const q = enqueue([], [m('shot', 's', 1200), m('queen', 'q')], 1000);
    let r = takeNext(q, 1000);
    expect(r.next?.name).toBe('q');
    r = takeNext(r.rest, 1100);
    expect(r).toMatchObject({ next: null, wait: 1100 });
    expect(takeNext(r.rest, 2200).next?.name).toBe('s');
    expect(takeNext([], 0)).toEqual({ next: null, rest: [], wait: null });
  });
});
