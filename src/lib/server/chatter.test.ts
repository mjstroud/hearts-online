import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Rng } from '../engine/cards';
import type { GameState } from '../engine/game';
import { startHand } from '../engine/hand';
import type { TableEvent } from '../engine/table-events';
import { MIN_SHOW_MS, SHOT_MS, STAGGER_MS } from '../moments';
import { TAUNTS, type TauntEvent, tauntById } from '../taunts';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-chatter-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, createPlaytest, deleteGame, endGame, getPlayers, joinGame, loadGame, performAction, scheduleBots } = await import('./games');
const { subscribe } = await import('./hub');
const { catHit, catsReact, hitReaction, reactionTo } = await import('./chatter');
const { normalizeSettings } = await import('../engine/rules');

/** The chatter's dice: whatever a test scripts, in order, then 1, which no chance passes. */
let script: number[] = [];
/** The size of each roll asked for, in order. */
let asked: number[] = [];
const dice: Rng = (max) => {
  asked.push(max);
  return (script.shift() ?? 1) % max;
};

const g = globalThis as {
  __heartsChatter?: { off?: boolean; rng?: Rng };
  __heartsCatTimers?: Map<string, unknown>;
  __heartsBotTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
const catTimers = () => g.__heartsCatTimers!;

// vitest.setup.ts turns the chatter off for every other test file; here it's on, with scripted dice.
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  script = [];
  asked = [];
  g.__heartsChatter = { rng: dice };
});
afterEach(() => {
  vi.clearAllTimers();
  catTimers().clear();
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(): number {
  const name = `chat${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

/** A started table with people and cats in the seats asked for. `users` is in seat order; the host is the first person. */
function table(seats: ('person' | 'cat')[], settings: Record<string, unknown> = {}) {
  const people = seats.filter((s) => s === 'person').map(() => addUser());
  const host = people[0];
  const id = createGame(host, 'Chatter', normalizeSettings(settings));
  for (const user of people.slice(1)) joinGame(id, user);
  for (const s of seats) if (s === 'cat') performAction(id, host, { type: 'addBot' });
  const cats = getPlayers(id)
    .filter((p) => p.isBot)
    .map((p) => p.userId);
  const waiting = [...people];
  const users = seats.map((s) => (s === 'person' ? waiting.shift()! : cats.shift()!));
  sql('UPDATE game_players SET seat = -seat - 1 WHERE game_id = ?').run(id);
  users.forEach((user, seat) => sql('UPDATE game_players SET seat = ? WHERE game_id = ? AND user_id = ?').run(seat, id, user));
  performAction(id, host, { type: 'start' });
  return { id, host, users };
}

/**
 * A keep hand, so play starts at once. Seat 0 leads the 2♣; seat 2 has no clubs, so it plays the J♦
 * on trick 1, which seat 3 wins with a club.
 */
const DEAL: Card[][] = [
  ['2C', '3C', '4C', '5C', '6C', '7C', '2D', '3D', '4D', '5D', '6D', '7D'],
  ['8C', '9C', 'TC', '8D', '9D', 'TD', '2S', '3S', '4S', '5S', '6S', '7S'],
  ['JD', 'QD', 'KD', 'AD', '8S', '9S', 'TS', 'JS', '2H', '3H', '4H', '5H'],
  ['JC', 'QC', 'KC', 'AC', 'QS', 'KS', 'AS', '6H', '7H', '8H', '9H', 'TH'],
];
const CRIB: Card[] = ['JH', 'QH', 'KH', 'AH'];

/**
 * Deal `hands` in place of the hand in progress (with any other state given), and plan the cats'
 * next move afresh. A test shortcut: real moves always go through performAction.
 */
function deal(id: string, hands: Card[][] = DEAL, more: Partial<GameState> = {}) {
  const s = loadGame(id)!.state!;
  const hand = startHand(s.hand!.number, 4, hands.map((cards) => cards.slice()), CRIB.slice(), 0);
  sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify({ ...s, ...more, hand }), id);
  clearTimeout(g.__heartsBotTimers!.get(id));
  g.__heartsBotTimers!.delete(id);
  scheduleBots(id);
}

/** Listen in on what one player's open tab is sent, and pick out the taunts. */
function listen(id: string, userId: number) {
  const events: { event: string; data: unknown }[] = [];
  const stop = subscribe(id, { userId, send: (event, data) => events.push({ event, data }) });
  return { events, stop, taunts: () => events.filter((e) => e.event === 'taunt').map((e) => e.data as TauntEvent) };
}

const ev = (kind: 'trick' | 'queen' | 'jack' | 'sun' | 'moon', seat: number, handEnd = false): TableEvent => ({ kind, seat, handEnd });
const broke = (seat: number, card: Card = '2H'): TableEvent => ({ kind: 'hearts', seat, card, handEnd: false });

describe('a cat at the table reacts, lightly', () => {
  it('when the moment is its own and the dice say so, once the card has landed, and every seated person hears it', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tabs = [listen(id, users[0]), listen(id, users[2])];
    // The 1 in 4 passes, then "shock" of sob and shock, then the shortest wait.
    script = [0, 1, 0];
    catsReact(id, [ev('queen', 1)]);
    expect(asked).toEqual([4, 2, 801]);
    vi.advanceTimersByTime(699);
    expect(tabs[0].taunts()).toEqual([]);
    vi.advanceTimersByTime(1);
    for (const tab of tabs) expect(tab.taunts()).toEqual([{ taunt: 'shock', from: users[1], to: null }]);
  });

  it('and not otherwise: nothing is even scheduled', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    script = [1];
    catsReact(id, [ev('queen', 1)]);
    expect(asked).toEqual([4]);
    expect(catTimers().has(id)).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([]);
  });

  it('rarely for a plain trick, and waits between 700 and 1500ms', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    script = [0, 800];
    catsReact(id, [ev('trick', 3)]);
    expect(asked).toEqual([20, 801]);
    vi.advanceTimersByTime(1_499);
    expect(tab.taunts()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tab.taunts()).toEqual([{ taunt: 'cool', from: users[3], to: null }]);
  });

  it('only to the biggest moment of a change, and only one cat', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    // A person's Q♠ beats a cat's hearts, J♦ and trick: some other cat (here the second) may laugh.
    script = [0, 1, 0];
    catsReact(id, [ev('trick', 1), ev('jack', 3), broke(3), ev('queen', 0)]);
    expect(asked).toEqual([8, 2, 801]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([{ taunt: 'laugh', from: users[3], to: null }]);

    // Hearts broken beats a J♦ and a trick.
    asked = [];
    script = [0, 0];
    catsReact(id, [ev('trick', 3), ev('jack', 3), broke(1, 'QS')]);
    expect(asked).toEqual([4, 801]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts().at(-1)).toEqual({ taunt: 'devil', from: users[1], to: null });
  });

  it('keeps one reaction waiting at a time per game', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    script = [0, 0, 0, 0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    catsReact(id, [ev('queen', 3)]);
    catHit(id, users[3], users[0], 'rose');
    // The later ones didn't even roll.
    expect(asked).toEqual([4, 2, 801]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([{ taunt: 'sob', from: users[1], to: null }]);
    // Once it's sent, the next can be planned.
    catsReact(id, [ev('queen', 3)]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toHaveLength(2);
  });

  it('under its own 15s cooldown, kept per table: a cat at two tables isn’t held up by the other', () => {
    const a = table(['person', 'cat', 'person', 'person']);
    const b = table(['person', 'cat', 'person', 'person']);
    const cat = a.users[1];
    sql('UPDATE game_players SET user_id = ? WHERE game_id = ? AND seat = 1').run(cat, b.id);
    deal(a.id);
    deal(b.id);
    const tabs = [listen(a.id, a.host), listen(b.id, b.host)];
    const react = (id: string) => {
      script = [0, 0, 0];
      catsReact(id, [ev('queen', 1)]);
    };
    react(a.id);
    react(b.id);
    vi.advanceTimersByTime(700);
    for (const tab of tabs) expect(tab.taunts()).toEqual([{ taunt: 'sob', from: cat, to: null }]);

    // Again at the first table, too soon: it rolls, but the cooldown stops it at the last moment.
    react(a.id);
    vi.advanceTimersByTime(700);
    expect(tabs[0].taunts()).toHaveLength(1);
    // The cooldown began when the first went out, 1.4s ago.
    vi.advanceTimersByTime(14_000);
    react(a.id);
    vi.advanceTimersByTime(700);
    expect(tabs[0].taunts()).toHaveLength(2);
    expect(tabs[1].taunts()).toHaveLength(1);
  });

  it('never from a seat on autopilot, which is a person’s; a cat may still laugh at its Q♠', () => {
    const { id, users } = table(['person', 'person', 'cat', 'cat']);
    deal(id, DEAL, { autopilot: [false, true, false, false] });
    const tab = listen(id, users[0]);
    script = [0, 0, 0, 0, 0, 0];
    catsReact(id, [ev('jack', 1)]);
    catsReact(id, [broke(1)]);
    catsReact(id, [ev('trick', 1)]);
    expect(asked).toEqual([]);
    catsReact(id, [ev('queen', 1)]);
    expect(asked).toEqual([8, 2, 801]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([{ taunt: 'laugh', from: users[2], to: null }]);
  });

  it('a person’s shot gets a cat’s shock or clap, a cat’s own a cool or a devil', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    script = [0, 0, 1, 0];
    catsReact(id, [ev('trick', 0), ev('sun', 0)]);
    vi.advanceTimersByTime(30_000);
    script = [0, 1, 0];
    catsReact(id, [ev('queen', 3), ev('moon', 3)]);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([
      { taunt: 'clap', from: users[1], to: null },
      { taunt: 'devil', from: users[3], to: null },
    ]);
  });

  it('depends on the moment alone: other hidden hands, the same reaction', () => {
    const swapped = [DEAL[0], DEAL[2], DEAL[1], DEAL[3]];
    const sent = [DEAL, swapped].map((hands) => {
      const { id, users } = table(['person', 'cat', 'person', 'cat']);
      deal(id, hands);
      const tab = listen(id, users[0]);
      asked = [];
      script = [0, 1, 300];
      catsReact(id, [ev('queen', 1)]);
      vi.advanceTimersByTime(999);
      const early = tab.taunts().length;
      vi.advanceTimersByTime(1);
      return { asked, early, taunts: tab.taunts().map((t) => ({ ...t, from: t.from === users[1] })) };
    });
    expect(sent[0]).toEqual({ asked: [4, 2, 801], early: 0, taunts: [{ taunt: 'shock', from: true, to: null }] });
    expect(sent[1]).toEqual(sent[0]);
  });
});

describe('a cat says nothing', () => {
  it('when nobody seated has the table open, and it costs nothing', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    catHit(id, users[1], users[0], 'tomato');
    expect(asked).toEqual([]);
    expect(catTimers().has(id)).toBe(false);
  });

  it('when the tab closed before its moment came, and that doesn’t use up its cooldown', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const first = listen(id, users[0]);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    first.stop();
    vi.advanceTimersByTime(700);
    expect(first.taunts()).toEqual([]);
    const again = listen(id, users[0]);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    vi.advanceTimersByTime(700);
    expect(again.taunts()).toEqual([{ taunt: 'sob', from: users[1], to: null }]);
  });

  it('when it has left its seat by then', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    const other = (sql('SELECT id FROM users WHERE is_bot = 1').all() as { id: number }[]).find((r) => !users.includes(r.id))!.id;
    sql('UPDATE game_players SET user_id = ? WHERE game_id = ? AND seat = 1').run(other, id);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([]);
  });

  it('when whoever it would throw back at has been removed by then', () => {
    const { id, host, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, host);
    script = [0, 0, 0];
    catHit(id, users[1], users[2], 'tomato');
    expect(catTimers().has(id)).toBe(true);
    performAction(id, host, { type: 'removePlayer', userId: users[2] });
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([]);
  });

  it('when the game has ended by then', () => {
    const { id, host } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, host);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    endGame(id, host, 'now');
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([]);
  });

  it('when the game is deleted, which drops the reaction waiting', () => {
    const { id, host } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, host);
    script = [0, 0, 0];
    catsReact(id, [ev('queen', 1)]);
    expect(catTimers().has(id)).toBe(true);
    const before = tab.events.length;
    deleteGame(id, host);
    expect(catTimers().has(id)).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tab.events.slice(before).map((e) => e.event)).toEqual(['deleted']);
  });

  it('when the chatter is switched off', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    listen(id, users[0]);
    g.__heartsChatter = { off: true, rng: dice };
    catsReact(id, [ev('queen', 1)]);
    catHit(id, users[1], users[0], 'tomato');
    expect(asked).toEqual([]);
    expect(catTimers().has(id)).toBe(false);
  });
});

describe('hit by a throw', () => {
  /** A cat at seat 1, hit by the host. */
  function hit(thrown: string, roll: number[]) {
    const { id, host, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const tab = listen(id, host);
    script = roll;
    catHit(id, users[1], host, thrown);
    return { tab, host, cat: users[1] };
  }

  it('a tomato or a pie: a sob or a shock, about a second later (after its flight)', () => {
    const { tab, cat } = hit('tomato', [0, 1, 0, 0]);
    expect(asked).toEqual([4, 3, 2, 701]);
    vi.advanceTimersByTime(899);
    expect(tab.taunts()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tab.taunts()).toEqual([{ taunt: 'sob', from: cat, to: null }]);

    asked = [];
    const pie = hit('pie', [0, 2, 1, 700]);
    expect(asked).toEqual([4, 3, 2, 701]);
    vi.advanceTimersByTime(1_599);
    expect(pie.tab.taunts()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pie.tab.taunts()).toEqual([{ taunt: 'shock', from: pie.cat, to: null }]);
  });

  it('or, about 1 time in 3, the same thing straight back at the thrower', () => {
    const { tab, host, cat } = hit('tomato', [0, 0, 0]);
    expect(asked).toEqual([4, 3, 701]);
    vi.advanceTimersByTime(900);
    expect(tab.taunts()).toEqual([{ taunt: 'tomato', from: cat, to: host }]);
  });

  it('a rose or a fish: a heart', () => {
    for (const thrown of ['rose', 'fish']) {
      asked = [];
      const { tab, cat } = hit(thrown, [0, 0]);
      expect(asked).toEqual([4, 701]);
      vi.advanceTimersByTime(900);
      expect(tab.taunts()).toEqual([{ taunt: 'heart', from: cat, to: null }]);
    }
  });

  it('nothing when the dice say no, for an emote, or for a person who was hit', () => {
    const { tab } = hit('rose', [1]);
    expect(asked).toEqual([4]);
    const { id, host, users } = table(['person', 'cat', 'person', 'cat']);
    deal(id);
    const other = listen(id, host);
    asked = [];
    script = [0, 0, 0];
    catHit(id, users[1], host, 'laugh');
    catHit(id, users[2], host, 'tomato');
    catHit(id, users[1], host, 'brick');
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect([...tab.taunts(), ...other.taunts()]).toEqual([]);
  });
});

describe('the moves that set it off', () => {
  it('a cat’s own card, through its turn: it took the J♦ with the trick', () => {
    const { id, users } = table(['person', 'person', 'person', 'cat']);
    deal(id);
    const tab = listen(id, users[0]);
    performAction(id, users[0], { type: 'play', card: '2C' });
    performAction(id, users[1], { type: 'play', card: '8C' });
    performAction(id, users[2], { type: 'play', card: 'JD' });
    expect(asked).toEqual([]);
    script = [0, 0];
    // The cat plays after its usual pause, and wins the trick: the J♦ beats the trick itself.
    vi.advanceTimersByTime(900);
    expect(loadGame(id)!.state!.hand!.tricks).toHaveLength(1);
    expect(asked).toEqual([4, 801]);
    vi.advanceTimersByTime(700);
    expect(tab.taunts()).toEqual([{ taunt: 'cool', from: users[3], to: null }]);
  });

  it('a person’s move: here, the playtest panel playing for every seat', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Panel', normalizeSettings({}), 4);
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom: { hands: DEAL.map((h) => h.join(' ')), crib: CRIB.join(' ') }, passOffset: 0 });
    const tab = listen(id, owner);
    const cat = getPlayers(id)[3].userId;
    for (const [seat, card] of [[0, '2C'], [1, '8C'], [2, 'JD']] as const) performAction(id, owner, { type: 'dev:act', seat, move: { type: 'play', card } });
    expect(asked).toEqual([]);
    script = [0, 0];
    performAction(id, owner, { type: 'dev:act', seat: 3, move: { type: 'play', card: 'AC' } });
    expect(asked).toEqual([4, 801]);
    vi.advanceTimersByTime(700);
    expect(tab.taunts()).toEqual([{ taunt: 'cool', from: cat, to: null }]);
  });

  // Seat 0 holds every club but the 3♣ and wins every trick; the others have no clubs and dump every
  // point card by trick 6, when the rest is played out (the deal from the auto-finish tests in pace.test.ts).
  const AUTO = {
    hands: [
      '2C 4C 5C 6C 7C 8C 9C TC JC QC KC AC',
      '2H 3H 4H 5H 6H 4D 5D 6D 7D 8D 9D TD',
      '7H 8H 9H TH JH 3S 4S 5S 6S 7S 8S 9S',
      'QH KH AH QS JD QD KD AD TS JS KS AS',
    ],
    crib: '3C 2D 3D 2S',
  };
  const AUTO_TRICKS: Card[][] = [
    ['2C', '4D', '3S', 'QD'],
    ['AC', '2H', '7H', 'QH'],
    ['KC', '3H', '8H', 'KH'],
    ['QC', '4H', '9H', 'AH'],
    ['JC', '5H', 'TH', 'QS'],
    ['TC', '6H', 'JH', 'JD'],
  ];

  /** Seat 0 (the owner) plays every card but the last, which ends the hand with the Moon shot. */
  function toMoon(settings: Record<string, unknown> = {}) {
    const owner = addUser();
    const id = createPlaytest(owner, 'Moon', normalizeSettings({ shootTheSun: false, ...settings }), 4);
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom: AUTO, passOffset: 0 });
    const tab = listen(id, owner);
    const cards = AUTO_TRICKS.flat();
    // The dice say no to everything on the way (the cat breaking hearts, the owner eating the Q♠).
    cards.slice(0, -1).forEach((card, i) => performAction(id, owner, { type: 'dev:act', seat: i % 4, move: { type: 'play', card } }));
    expect(tab.taunts()).toEqual([]);
    const last = () => performAction(id, owner, { type: 'dev:act', seat: 3, move: { type: 'play', card: 'JD' } });
    return { id, owner, tab, last };
  }

  it('the end of a hand waits until every screen has shown the result', () => {
    const { id, tab, last } = toMoon();
    asked = [];
    // The owner's Moon beats the trick and the J♦: the onlooker's 1 in 8, the first of three cats, "shock".
    script = [0, 0, 0];
    last();
    expect(loadGame(id)!.state!.lastHand).toMatchObject({ moon: 0, autoFrom: 7 });
    expect(asked).toEqual([8, 3, 2]);
    // The final trick's four cards land one after another, then its two messages (played out, the
    // J♦) take their turns, then the Moon banner, then a second's margin.
    const wait = 3 * STAGGER_MS + 2 * MIN_SHOW_MS + SHOT_MS + 1_000;
    vi.advanceTimersByTime(wait - 1);
    expect(tab.taunts()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tab.taunts()).toEqual([{ taunt: 'shock', from: getPlayers(id)[1].userId, to: null }]);
  });

  it('but not when that hand ended the game', () => {
    const { id, tab, last } = toMoon({ scoreLimit: 1 });
    script = [0, 0, 0];
    last();
    expect(loadGame(id)!.status).toBe('finished');
    expect(catTimers().has(id)).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tab.taunts()).toEqual([]);
  });
});

describe('what a cat can say', () => {
  it('is always on the taunt list: an emote to nobody, or a throw back at whoever threw', () => {
    const players = [
      { seat: 0, userId: 10, isBot: false },
      { seat: 1, userId: 11, isBot: true },
      { seat: 2, userId: 12, isBot: true },
    ];
    const said = new Set<string>();
    for (const roll of [0, 1, 2]) {
      // Every chance passes; the choices go through each option.
      const always: Rng = (max) => (max <= 3 ? roll % max : 0);
      for (const seat of [0, 1]) {
        const events = [...(['trick', 'queen', 'jack', 'sun', 'moon'] as const).map((kind) => ev(kind, seat)), broke(seat)];
        for (const event of events) {
          const r = reactionTo(event, players, always);
          if (!r) continue;
          expect(tauntById(r.taunt)?.kind).toBe('emote');
          expect(r.to).toBeNull();
          said.add(r.taunt);
        }
      }
      for (const thrown of TAUNTS.filter((t) => t.kind === 'throw').map((t) => t.id)) {
        const r = hitReaction(11, 10, thrown, always)!;
        expect(r.cat).toBe(11);
        if (r.to !== null) expect(r).toEqual({ cat: 11, taunt: thrown, to: 10 });
        else expect(tauntById(r.taunt)?.kind).toBe('emote');
        said.add(r.taunt);
      }
    }
    expect([...said].every((id) => tauntById(id))).toBe(true);
    expect(said.size).toBeGreaterThanOrEqual(8);
  });
});
