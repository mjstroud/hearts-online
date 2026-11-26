import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/cards';
import type { GameState } from '../engine/game';
import { type HandState, isFinalTrick, legalPlays, playCard, startHand } from '../engine/hand';
import type { GameAction, GameView } from '../types';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-pace-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const {
  createGame,
  createPlaytest,
  deleteGame,
  endGame,
  getGameView,
  getHandRecord,
  getPlayers,
  joinGame,
  listGamesForUser,
  loadGame,
  performAction,
  scheduleBots,
  toGameError,
} = await import('./games');
const { gameStats } = await import('./stats');
const { subscribe } = await import('./hub');
const { settingsFromForm } = await import('./forms');
const { normalizeSettings } = await import('../engine/rules');
const { tableTricks } = await import('../engine/scoring');
const { POST } = await import('../../pages/api/games/[id]/action');
const { GET: getHands } = await import('../../pages/api/games/[id]/hands/[number]');

// Nothing moves on a timer unless a test moves the clock on.
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(): number {
  const name = `pace${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

const state = (id: string) => loadGame(id)!.state!;
const hand = (id: string) => state(id).hand!;
const version = (id: string) => loadGame(id)!.version;
const botTimers = () => (globalThis as { __heartsBotTimers?: Map<string, ReturnType<typeof setTimeout>> }).__heartsBotTimers!;
const premoveMap = () => (globalThis as { __heartsPremoves?: Map<string, Map<number, unknown>> }).__heartsPremoves!;
const undoMap = () => (globalThis as { __heartsUndo?: Map<string, unknown[]> }).__heartsUndo!;

/** A started table with people and cats in the seats asked for. `users` is in seat order; the host is the first person. */
function table(seats: ('person' | 'cat')[], settings: Record<string, unknown> = {}) {
  const people = seats.filter((s) => s === 'person').map(() => addUser());
  const host = people[0];
  const id = createGame(host, 'Pace', normalizeSettings(settings));
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

/** Cancel the computer players' pending timer and plan afresh, as after any real move. */
function rearm(id: string) {
  clearTimeout(botTimers().get(id));
  botTimers().delete(id);
  scheduleBots(id);
}

/** Overwrite the saved game state (a test shortcut: real moves always go through performAction). */
function writeState(id: string, next: GameState) {
  sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify(next), id);
  rearm(id);
}

/**
 * A keep hand, so play starts at once. Seat 0 leads the 2♣; seat 1 has to follow in clubs; seat 2
 * has no clubs (and no points allowed on trick 1); seat 3 holds the top clubs, so it wins trick 1.
 */
const DEAL: Card[][] = [
  ['2C', '3C', '4C', '5C', '6C', '7C', '2D', '3D', '4D', '5D', '6D', '7D'],
  ['8C', '9C', 'TC', '8D', '9D', 'TD', '2S', '3S', '4S', '5S', '6S', '7S'],
  ['JD', 'QD', 'KD', 'AD', '8S', '9S', 'TS', 'JS', '2H', '3H', '4H', '5H'],
  ['JC', 'QC', 'KC', 'AC', 'QS', 'KS', 'AS', '6H', '7H', '8H', '9H', 'TH'],
];
const CRIB: Card[] = ['JH', 'QH', 'KH', 'AH'];

/** Deal DEAL in place of the hand in progress. `prepare` can move it on first. */
function deal(id: string, prepare?: (h: HandState) => void) {
  const s = state(id);
  const h = startHand(s.hand!.number, 4, DEAL.map((cards) => cards.slice()), CRIB.slice(), 0);
  prepare?.(h);
  writeState(id, { ...s, hand: h });
}

/** Play the hand on (lowest legal card each time) until only the final trick is left. */
function toFinalTrick(h: HandState) {
  const settings = normalizeSettings({});
  while (!isFinalTrick(h)) playCard(h, h.turn!, legalPlays(h, h.turn!, settings)[0], settings);
}

/** Queue a card (or cancel with null) for the trick in progress, as the table showed it. */
function queue(id: string, userId: number, card: Card | null, at: { hand?: number; trick?: number } = {}) {
  const h = hand(id);
  performAction(id, userId, { type: 'premove', card, hand: at.hand ?? h.number, trick: at.trick ?? h.tricks.length + 1 });
}

const play = (id: string, userId: number, card: Card) => performAction(id, userId, { type: 'play', card });
const myView = (id: string, userId: number) => getGameView(id, userId)!;

/** How an action was turned away. */
function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    const e = toGameError(err);
    return { status: e.status, message: e.message };
  }
  throw new Error('Expected the action to be refused.');
}

/** Listen in on everything one player's open tab is sent. */
function listen(id: string, userId: number) {
  const events: { event: string; data: unknown }[] = [];
  const stop = subscribe(id, { userId, send: (event, data) => events.push({ event, data }) });
  return { events, stop, views: () => events.filter((e) => e.event === 'state').map((e) => e.data as GameView) };
}

describe('one rule for seats the server is about to play', () => {
  it('plays the final trick itself after the usual pause: nobody is on turn or timed, and every card goes down in one update', () => {
    const { id, users } = table(['person', 'person', 'person', 'person'], { moveTimer: 30 });
    deal(id, toFinalTrick);
    // Even with the move clock long run out, nobody is handed to a cat over the final trick.
    writeState(id, { ...state(id), turnSince: Date.now() - 10 * 60_000 });
    const turn = hand(id).turn!;
    expect(myView(id, users[turn])).toMatchObject({ toAct: [turn], yourTurn: false, moveClock: null });
    expect(listGamesForUser(users[turn]).find((g) => g.id === id)).toMatchObject({ yourTurn: false, waitingOn: [] });

    const tabs = users.map((user) => listen(id, user));
    const before = version(id);
    vi.advanceTimersByTime(1_699);
    expect(version(id)).toBe(before);
    vi.advanceTimersByTime(1);
    expect(version(id)).toBe(before + 1);
    expect(state(id).handsPlayed).toBe(1);
    expect(getHandRecord(id, 1)!.tricks).toHaveLength(12);
    expect(state(id).autopilot ?? []).not.toContain(true);
    for (const tab of tabs) {
      expect(tab.views()).toHaveLength(1);
      expect(tab.views()[0].lastHand!.finalTrick!.plays).toHaveLength(4);
      tab.stop();
    }
  });

  it('with the option off, waits for the person on turn, until the host switches it back on mid-trick', () => {
    const { id, host, users } = table(['person', 'person', 'person', 'person'], { autoPlayLast: false, moveTimer: 30 });
    deal(id, toFinalTrick);
    const turn = hand(id).turn!;
    const name = getPlayers(id)[turn].displayName;
    expect(myView(id, users[turn]).yourTurn).toBe(true);
    expect(myView(id, users[turn]).moveClock).not.toBeNull();
    expect(listGamesForUser(users[turn]).find((g) => g.id === id)).toMatchObject({ yourTurn: true, waitingOn: [name] });
    vi.advanceTimersByTime(5_000);
    expect(isFinalTrick(hand(id))).toBe(true);

    performAction(id, host, { type: 'settings', settings: { autoPlayLast: true } });
    expect(myView(id, users[turn]).yourTurn).toBe(false);
    vi.advanceTimersByTime(1_700);
    expect(state(id).handsPlayed).toBe(1);
  });

  it('leaves a table everyone walked away from alone, final trick included', () => {
    const { id } = table(['person', 'person', 'person', 'person'], { moveTimer: 30 });
    deal(id, toFinalTrick);
    writeState(id, { ...state(id), autopilot: [true, true, true, true], turnSince: Date.now() - 60_000 });
    const before = version(id);
    vi.advanceTimersByTime(60 * 60_000);
    expect(version(id)).toBe(before);
    expect(isFinalTrick(hand(id))).toBe(true);
  });

  it('only lists people as the ones the table is waiting on', () => {
    const { id, users } = table(['person', 'cat', 'person', 'cat']);
    // Dealt: everyone owes a pass, but the cats are about to make theirs.
    expect(state(id).hand!.phase).toBe('passing');
    const names = getPlayers(id).map((p) => p.displayName);
    expect(listGamesForUser(users[0]).find((g) => g.id === id)).toMatchObject({ yourTurn: true, waitingOn: [names[0], names[2]] });
    expect(myView(id, users[2]).yourTurn).toBe(true);
  });
});

describe('late taps', () => {
  it('succeed without a change when the card is already down: in the same hand, after the hand moved on, and after the game ended', () => {
    // Same hand: a queued card went down first.
    const a = table(['person', 'person', 'person', 'person']);
    deal(a.id);
    queue(a.id, a.users[1], '9C');
    play(a.id, a.users[0], '2C');
    const tab = listen(a.id, a.users[0]);
    let before = version(a.id);
    play(a.id, a.users[1], '9C');
    expect(version(a.id)).toBe(before);
    expect(tab.events).toEqual([]);
    tab.stop();

    // The final trick played itself and the next hand was dealt.
    for (const scoreLimit of [null, 1]) {
      const { id, users } = table(['person', 'person', 'person', 'person'], { scoreLimit });
      deal(id, toFinalTrick);
      const last = hand(id).hands.map((cards) => cards[0]);
      vi.advanceTimersByTime(1_700);
      expect(state(id).handsPlayed).toBe(1);
      // With a limit of 1, that was the last hand of the game.
      expect(loadGame(id)!.status).toBe(scoreLimit ? 'finished' : 'active');
      before = version(id);
      users.forEach((user, seat) => play(id, user, last[seat]));
      expect(version(id)).toBe(before);
    }
  });

  it('answers with the view, through the endpoint, like any other play', async () => {
    const { id, users } = table(['person', 'person', 'person', 'person']);
    deal(id, toFinalTrick);
    const last = hand(id).hands[2][0];
    vi.advanceTimersByTime(1_700);
    const res = await POST({
      params: { id },
      locals: { user: { id: users[2] } },
      request: new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ type: 'play', card: last }) }),
    } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).handsPlayed).toBe(1);
  });

  it('means "I’m back" when a cat was sitting in', () => {
    const { id, users } = table(['person', 'person', 'person', 'person'], { moveTimer: 30 });
    deal(id);
    writeState(id, { ...state(id), autopilot: [false, true, false, false] });
    play(id, users[0], '2C');
    vi.advanceTimersByTime(900); // the cat plays for seat 1
    const played = hand(id).current!.plays[1];
    expect(played.seat).toBe(1);
    const before = version(id);
    play(id, users[1], played.card);
    expect(state(id).autopilot?.[1]).toBe(false);
    expect(version(id)).toBe(before + 1);
    expect(hand(id).current!.plays).toHaveLength(2);
  });
});

describe('queued cards', () => {
  it('change nothing anyone else can see, and go down the instant the turn arrives', () => {
    const { id, users } = table(['person', 'person', 'cat', 'cat'], { moveTimer: 30 });
    deal(id);
    const game = loadGame(id)!;
    const timer = botTimers().get(id);
    const since = state(id).turnSince;
    expect(timer).toBeDefined();
    const host = listen(id, users[0]);
    const mine = listen(id, users[1]);

    vi.advanceTimersByTime(1_000);
    queue(id, users[1], '9C');
    expect(loadGame(id)).toMatchObject({ version: game.version, updatedAt: game.updatedAt });
    expect(state(id).turnSince).toBe(since);
    expect(botTimers().get(id)).toBe(timer);
    expect(host.events).toEqual([]);
    expect(mine.views().map((v) => v.premove)).toEqual(['9C']);
    expect(myView(id, users[1])).toMatchObject({ premove: '9C', yourTurn: false });
    expect(myView(id, users[0]).premove).toBeNull();

    // Another card replaces it.
    queue(id, users[1], 'TC');
    expect(myView(id, users[1]).premove).toBe('TC');
    expect(host.events).toEqual([]);

    play(id, users[0], '2C');
    expect(hand(id).current!.plays).toEqual([
      { seat: 0, card: '2C' },
      { seat: 1, card: 'TC' },
    ]);
    expect(version(id)).toBe(game.version + 1);
    expect(host.views()).toHaveLength(1);
    expect(host.views()[0].table!.current!.plays).toHaveLength(2);
    expect(myView(id, users[1]).premove).toBeNull();
    host.stop();
    mine.stop();
  });

  it('go down in the same update as the cat’s move that brought the turn round', () => {
    const { id, users } = table(['cat', 'person', 'person', 'person']);
    deal(id);
    queue(id, users[1], '9C');
    const tabs = [1, 2, 3].map((seat) => listen(id, users[seat]));
    const before = version(id);
    vi.advanceTimersByTime(899);
    expect(version(id)).toBe(before);
    vi.advanceTimersByTime(1); // the cat leads the 2♣
    expect(hand(id).current!.plays).toEqual([
      { seat: 0, card: '2C' },
      { seat: 1, card: '9C' },
    ]);
    expect(version(id)).toBe(before + 1);
    for (const tab of tabs) {
      expect(tab.views()).toHaveLength(1);
      expect(tab.views()[0].table!).toMatchObject({ turn: 2, current: { plays: [{ card: '2C' }, { card: '9C' }] } });
      tab.stop();
    }
  });

  it('chain: two queued seats both go down in one update, and queueing once on turn plays the card', () => {
    const { id, users } = table(['person', 'person', 'person', 'person']);
    deal(id);
    queue(id, users[1], '8C');
    queue(id, users[2], 'JD');
    const tab = listen(id, users[3]);
    play(id, users[0], '2C');
    expect(hand(id).current!.plays.map((p) => p.card)).toEqual(['2C', '8C', 'JD']);
    expect(tab.views()).toHaveLength(1);
    expect(tab.views()[0]).toMatchObject({ yourTurn: true, table: { turn: 3 } });
    tab.stop();

    // Seat 3's turn arrived while its card was on the way: it's simply played.
    const before = version(id);
    queue(id, users[3], 'AC');
    expect(version(id)).toBe(before + 1);
    expect(hand(id).tricks[0]).toMatchObject({ winner: 3 });
  });

  it('is refused for a lead, an illegal follow, a card you don’t hold, a bad request, or a seat a cat is playing', () => {
    const { id, users } = table(['person', 'person', 'person', 'person']);
    deal(id);
    const refused = (userId: number, action: Partial<Extract<GameAction, { type: 'premove' }>>) =>
      refusal(() => performAction(id, userId, { type: 'premove', card: null, hand: 1, trick: 1, ...action }));
    expect(refused(users[0], { card: '2C' })).toEqual({ status: 400, message: 'It’s your lead: play a card.' });
    expect(refused(users[1], { card: '8D' })).toEqual({ status: 400, message: 'You must follow suit.' });
    expect(refused(users[2], { card: '2H' })).toEqual({ status: 400, message: 'No points can be played on the first trick.' });
    expect(refused(users[3], { card: 'QS' })).toEqual({ status: 400, message: 'You must follow suit.' });
    expect(refused(users[1], { card: 'AH' })).toEqual({ status: 400, message: 'That card is not in your hand.' });
    for (const bad of [{ card: 'XX' }, { card: '8C', hand: undefined }, { card: '8C', trick: '1' }, { card: '8C', hand: 1.5 }]) {
      expect(refused(users[1], bad as never)).toEqual({ status: 400, message: 'Invalid request.' });
    }
    expect(premoveMap().has(id)).toBe(false);

    // Trick 2 has no lead card yet, so nobody knows the suit.
    for (const [seat, card] of [
      [0, '2C'],
      [1, '8C'],
      [2, 'JD'],
      [3, 'AC'],
    ] as const)
      play(id, users[seat], card);
    expect(hand(id).turn).toBe(3);
    expect(refused(users[0], { card: '3C', trick: 2 })).toEqual({ status: 400, message: 'You can queue a card once the lead card is down.' });

    writeState(id, { ...state(id), autopilot: [false, true, false, false] });
    expect(refused(users[1], { card: '9C', trick: 2 })).toEqual({ status: 400, message: 'Tap “I’m back” first.' });
  });

  it('can be cancelled, and a card for a trick that is over (or one you played in) is ignored', () => {
    const { id, users } = table(['person', 'person', 'person', 'person']);
    deal(id);
    queue(id, users[1], '8C');
    queue(id, users[1], null);
    expect(myView(id, users[1]).premove).toBeNull();
    play(id, users[0], '2C');
    expect(hand(id).turn).toBe(1);
    expect(hand(id).current!.plays).toHaveLength(1);

    const before = version(id);
    queue(id, users[2], 'JD', { trick: 2 });
    queue(id, users[2], 'JD', { hand: 2 });
    expect(myView(id, users[2]).premove).toBeNull();
    play(id, users[1], '8C');
    queue(id, users[1], '9C');
    expect(myView(id, users[1]).premove).toBeNull();
    expect(version(id)).toBe(before + 1);
    expect(hand(id).turn).toBe(2);
  });

  it('are dropped by a request from a screen that is behind', () => {
    const { id, users } = table(['person', 'person', 'person', 'person']);
    deal(id);
    for (const [seat, card] of [
      [0, '2C'],
      [1, '8C'],
      [2, 'JD'],
      [3, 'AC'],
    ] as const)
      play(id, users[seat], card);
    play(id, users[3], 'JC');
    queue(id, users[1], '9C');
    expect(myView(id, users[1]).premove).toBe('9C');
    // Sent from a screen still showing trick 1: what's queued may not be what they want any more.
    queue(id, users[1], 'TC', { trick: 1 });
    expect(premoveMap().get(id)?.has(users[1]) ?? false).toBe(false);
    expect(myView(id, users[1]).premove).toBeNull();
    // So nothing goes down for them when the turn comes round.
    play(id, users[0], '3C');
    expect(hand(id).current!.plays.map((p) => p.card)).toEqual(['JC', '3C']);
    expect(hand(id).turn).toBe(1);
  });

  it('are cleared when the game is deleted, and every open tab is told once and hung up on', () => {
    const { id, host, users } = table(['person', 'person', 'person', 'person']);
    deal(id);
    queue(id, users[1], '9C');
    expect(premoveMap().get(id)?.has(users[1])).toBe(true);
    const tabs = [host, users[1]].map((userId) => {
      const tab = { events: [] as string[], closed: 0, stop: () => {} };
      tab.stop = subscribe(id, { userId, send: (event) => tab.events.push(event), close: () => tab.closed++ });
      return tab;
    });
    deleteGame(id, host);
    expect(premoveMap().has(id)).toBe(false);
    for (const tab of tabs) {
      expect(tab).toMatchObject({ events: ['deleted'], closed: 1 });
      tab.stop();
    }
  });

  it('is cleared by the end of the hand, undo, a new deal and End now, but not by ending after the hand or changing your mind', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Queue', normalizeSettings({}), 4);
    // DEAL moved round one seat: a cat in seat 3 leads the 2♣, and the owner follows.
    const custom = { hands: [0, 1, 2, 3].map((s) => DEAL[(s + 1) % 4].join(' ')), crib: CRIB.join(' ') };
    const redeal = () => performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom, passOffset: 0 });
    redeal();
    expect(hand(id).turn).toBe(3);

    queue(id, owner, '9C');
    endGame(id, owner, 'after-hand', 1);
    expect(myView(id, owner).premove).toBe('9C');
    endGame(id, owner, 'cancel');
    expect(myView(id, owner).premove).toBe('9C');

    redeal();
    expect(premoveMap().has(id)).toBe(false);
    queue(id, owner, '9C');
    performAction(id, owner, { type: 'dev:undo' });
    expect(premoveMap().has(id)).toBe(false);

    // Fires after a computer move made from the playtest panel, and one undo takes back only the queued card.
    redeal();
    queue(id, owner, '9C');
    performAction(id, owner, { type: 'dev:ai', scope: 'move' });
    expect(hand(id).current!.plays).toEqual([
      { seat: 3, card: '2C' },
      { seat: 0, card: '9C' },
    ]);
    performAction(id, owner, { type: 'dev:undo' });
    expect(hand(id).current!.plays).toEqual([{ seat: 3, card: '2C' }]);
    expect(hand(id).turn).toBe(0);

    // The end of a hand clears whatever is left (here, a stray entry nobody's turn would ever reach).
    premoveMap().set(id, new Map([[-1, { hand: 1, trick: 1, card: '2C' }]]));
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect(state(id).handsPlayed).toBe(1);
    expect(premoveMap().has(id)).toBe(false);

    redeal();
    queue(id, owner, '9C');
    expect(premoveMap().get(id)?.has(owner)).toBe(true);
    endGame(id, owner, 'now');
    expect(premoveMap().has(id)).toBe(false);

    // "Keep playing" starts clean too.
    premoveMap().set(id, new Map([[owner, { hand: 9, trick: 1, card: '2C' }]]));
    performAction(id, owner, { type: 'extend', scoreLimit: null });
    expect(premoveMap().has(id)).toBe(false);
  });

  it('come off the undo history before the move that set them off, even once the history is full', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Undo cap', normalizeSettings({}), 4);
    const custom = { hands: [0, 1, 2, 3].map((s) => DEAL[(s + 1) % 4].join(' ')), crib: CRIB.join(' ') };
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom, passOffset: 0 });
    // At its limit, so every step added pushes the oldest off.
    const filler = { state: JSON.stringify(state(id)), status: 'active', finishedAt: null, by: 'bot' };
    undoMap().set(id, Array.from({ length: 400 }, () => ({ ...filler })));
    queue(id, owner, '9C');
    performAction(id, owner, { type: 'dev:ai', scope: 'move' });
    expect(hand(id).current!.plays).toEqual([
      { seat: 3, card: '2C' },
      { seat: 0, card: '9C' },
    ]);
    expect(undoMap().get(id)).toHaveLength(400);
    performAction(id, owner, { type: 'dev:undo' });
    expect(hand(id).current!.plays).toEqual([{ seat: 3, card: '2C' }]);
    performAction(id, owner, { type: 'dev:undo' });
    expect(hand(id).current!.plays).toEqual([]);
  });
});

describe('settings', () => {
  it('lets the host change the pace options mid-game from JSON, while the house rules stay put', async () => {
    const { id, host, users } = table(['person', 'person', 'person', 'person']);
    expect(loadGame(id)!.settings).toMatchObject({ autoPlayLast: true, autoFinish: true });
    performAction(id, host, {
      type: 'settings',
      name: '  Renamed  ',
      settings: { autoPlayLast: false, autoFinish: false, jackOfDiamonds: false, showWatches: false },
    });
    expect(loadGame(id)!).toMatchObject({
      name: 'Renamed',
      settings: { autoPlayLast: false, autoFinish: false, jackOfDiamonds: true, showWatches: false },
    });

    expect(refusal(() => performAction(id, users[1], { type: 'settings', settings: { autoFinish: true } }))).toMatchObject({ status: 403 });
    for (const bad of [{ settings: null }, { settings: [] }, { settings: 'on' }, { settings: {}, name: 5 }]) {
      expect(refusal(() => performAction(id, host, { type: 'settings', ...bad } as never))).toEqual({ status: 400, message: 'Invalid request.' });
    }
    // A value that's off, even with good ones beside it, is refused rather than read as "off" or "no limit".
    const saved = loadGame(id)!;
    for (const settings of [
      { autoFinish: 'false' },
      { scoreLimit: 'abc' },
      { scoreLimit: 0 },
      { scoreLimit: 2.5 },
      { moveTimer: 45 },
      { moveTimer: '30' },
      { nope: true },
      { showWatches: true, autoPlayLast: 1 },
    ]) {
      expect(refusal(() => performAction(id, host, { type: 'settings', settings, name: 'Changed' }))).toEqual({ status: 400, message: 'Invalid request.' });
    }
    expect(loadGame(id)!).toMatchObject({ name: saved.name, settings: saved.settings, version: saved.version });
    // The good values still go through.
    performAction(id, host, { type: 'settings', settings: { scoreLimit: 150, moveTimer: 60, showWatches: true } });
    expect(loadGame(id)!.settings).toMatchObject({ scoreLimit: 150, moveTimer: 60, showWatches: true });
    performAction(id, host, { type: 'settings', settings: { scoreLimit: null, moveTimer: null } });
    expect(loadGame(id)!.settings).toMatchObject({ scoreLimit: null, moveTimer: null });

    // Through the endpoint, it answers with the view.
    const res = await POST({
      params: { id },
      locals: { user: { id: host } },
      request: new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ type: 'settings', settings: { autoFinish: true } }) }),
    } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toMatchObject({ autoPlayLast: false, autoFinish: true });
  });

  it('reads the pace switches from the settings form only when the form had them', () => {
    expect(settingsFromForm({ paceForm: '1', autoFinish: 'on' })).toEqual({ autoPlayLast: false, autoFinish: true });
    expect(settingsFromForm({ paceForm: '1', autoPlayLast: 'on', autoFinish: 'on' })).toEqual({ autoPlayLast: true, autoFinish: true });
    expect(settingsFromForm({ watchesForm: '1' })).not.toHaveProperty('autoFinish');
  });
});

describe('auto-finish', () => {
  // Seat 0 holds every club but the 3♣ and wins every trick; the others have no clubs and dump
  // every point card by trick 6. The crib has no points.
  const AUTO = {
    hands: [
      '2C 4C 5C 6C 7C 8C 9C TC JC QC KC AC',
      '2H 3H 4H 5H 6H 4D 5D 6D 7D 8D 9D TD',
      '7H 8H 9H TH JH 3S 4S 5S 6S 7S 8S 9S',
      'QH KH AH QS JD QD KD AD TS JS KS AS',
    ],
    crib: '3C 2D 3D 2S',
  };
  const TRICKS: Card[][] = [
    ['2C', '4D', '3S', 'QD'],
    ['AC', '2H', '7H', 'QH'],
    ['KC', '3H', '8H', 'KH'],
    ['QC', '4H', '9H', 'AH'],
    ['JC', '5H', 'TH', 'QS'],
    ['TC', '6H', 'JH', 'JD'],
  ];

  it('plays out the rest once nothing can score, marks where, and leaves those tricks out of the review and trick counts', async () => {
    const owner = addUser();
    // The Sun off: seat 0 winning every trick would otherwise keep it open.
    const id = createPlaytest(owner, 'Auto', normalizeSettings({ shootTheSun: false }), 4);
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom: AUTO, passOffset: 0 });
    TRICKS.forEach((cards, t) =>
      cards.forEach((card, seat) => {
        expect(state(id).handsPlayed).toBe(0);
        expect(hand(id).tricks).toHaveLength(t);
        performAction(id, owner, { type: 'dev:act', seat, move: { type: 'play', card } });
      }),
    );

    expect(state(id).handsPlayed).toBe(1);
    const record = getHandRecord(id, 1)!;
    expect(record.autoFrom).toBe(7);
    expect(record.tricks).toHaveLength(12);
    expect(record.players).toEqual(getPlayers(id).map((p) => p.userId));
    expect(tableTricks(record)).toHaveLength(6);

    const summary = myView(id, owner).lastHand!;
    expect(summary.autoFrom).toBe(7);
    expect(summary.tricksWon).toEqual([6, 0, 0, 0]);
    expect(summary.finalTrick!.plays.map((p) => p.card)).toEqual(TRICKS[5]);

    const res = await getHands({ params: { id, number: '1' }, locals: { user: { id: owner } } } as never);
    const review = await res.json();
    expect(review.autoFrom).toBe(7);
    expect(review.tricks).toHaveLength(6);
    expect(gameStats(id).players[0].tricks).toBe(6);
  });

  it('lets a late tap on a card it played out succeed without a change', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Auto tap', normalizeSettings({ shootTheSun: false }), 4);
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom: AUTO, passOffset: 0 });
    for (const cards of TRICKS) cards.forEach((card, seat) => performAction(id, owner, { type: 'dev:act', seat, move: { type: 'play', card } }));
    const record = getHandRecord(id, 1)!;
    expect(record.autoFrom).toBe(7);
    // The owner's 9♣ went down in a trick the server played out, never one the table saw.
    const played = (tricks: typeof record.tricks) => tricks.some((t) => t.plays.some((p) => p.seat === 0 && p.card === '9C'));
    expect(played(record.tricks)).toBe(true);
    expect(played(tableTricks(record))).toBe(false);
    const before = version(id);
    play(id, owner, '9C');
    expect(version(id)).toBe(before);
    expect(state(id).handsPlayed).toBe(1);
  });

  it('can be switched off', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Auto off', normalizeSettings({ shootTheSun: false, autoFinish: false }), 4);
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    performAction(id, owner, { type: 'dev:deal', preset: 'custom', custom: AUTO, passOffset: 0 });
    for (const cards of TRICKS) cards.forEach((card, seat) => performAction(id, owner, { type: 'dev:act', seat, move: { type: 'play', card } }));
    expect(state(id).handsPlayed).toBe(0);
    expect(hand(id).tricks).toHaveLength(6);
  });
});
