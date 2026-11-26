import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { followPlays, queueSuit } from '../engine/hand';
import type { GameView } from '../types';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-kick-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const {
  createGame,
  endGame,
  getGameView,
  getHandRecord,
  getPlayers,
  isMember,
  joinGame,
  listGamesForUser,
  loadGame,
  performAction,
  toGameError,
  wasRemoved,
} = await import('./games');
const { gameStats, userOverview } = await import('./stats');
const { subscribe } = await import('./hub');
const { normalizeSettings } = await import('../engine/rules');
const { seatsToAct } = await import('../engine/game');
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
  const name = `kick${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

const state = (id: string) => loadGame(id)!.state!;
const premoveMap = () => (globalThis as { __heartsPremoves?: Map<string, Map<number, unknown>> }).__heartsPremoves!;

/** Four people and no cats, dealt and waiting on the first pass. `users` is in seat order. */
function startTable() {
  const users = [addUser(), addUser(), addUser(), addUser()];
  const id = createGame(users[0], 'Kick', normalizeSettings({}));
  for (const user of users.slice(1)) joinGame(id, user);
  performAction(id, users[0], { type: 'start' });
  return { id, users, host: users[0] };
}

/** Whoever the table is waiting on moves: a person from what their own view shows, a cat on its timer. */
function step(id: string) {
  const seat = seatsToAct(state(id))[0];
  const player = getPlayers(id)[seat];
  if (player.isBot) return void vi.advanceTimersByTime(3_000);
  const table = getGameView(id, player.userId)!.table!;
  if (table.phase === 'passing') performAction(id, player.userId, { type: 'pass', cards: table.myHand.slice(0, 3) });
  else performAction(id, player.userId, { type: 'play', card: table.legal[0] });
}

function playTo(id: string, hands: number) {
  for (let i = 0; loadGame(id)!.status === 'active' && state(id).handsPlayed < hands; i++) {
    if (i > 2_000) throw new Error('The game never got there.');
    step(id);
  }
}

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

const review = async (id: string, number: number, userId: number) =>
  (await getHands({ params: { id, number: String(number) }, locals: { user: { id: userId } } } as never)).json();

describe('removing a player', () => {
  it('in the waiting room, empties the seat as before', () => {
    const [host, bob, carol] = [addUser(), addUser(), addUser()];
    const id = createGame(host, 'Lobby', normalizeSettings({}));
    joinGame(id, bob);
    joinGame(id, carol);
    performAction(id, host, { type: 'removePlayer', userId: bob });
    expect(getPlayers(id).map((p) => [p.seat, p.userId])).toEqual([
      [0, host],
      [1, carol],
    ]);
    expect(wasRemoved(id, bob)).toBe(false);
  });

  it('mid-game, gives the seat to a cat for good, and the hands they finished stay theirs', async () => {
    const { id, users, host } = startTable();
    playTo(id, 1);
    // Hand 2 under way, with a lead card down so a follower can queue.
    for (let i = 0; state(id).hand!.phase !== 'playing' || state(id).hand!.current!.plays.length === 0; i++) {
      if (i > 50) throw new Error('Hand 2 never got going.');
      step(id);
    }
    const h = state(id).hand!;
    const seat = [0, 1, 2, 3].find((s) => s !== 0 && queueSuit(h.current, h.tricks.length === 0, s, h.turn) !== null)!;
    const target = users[seat];
    const suit = queueSuit(h.current, h.tricks.length === 0, seat, h.turn)!;
    const card = followPlays(h.hands[seat], suit, h.tricks.length === 0, loadGame(id)!.settings)[0];
    performAction(id, target, { type: 'premove', card, hand: h.number, trick: h.tricks.length + 1 });
    expect(premoveMap().get(id)?.has(target)).toBe(true);
    // A cat was sitting in for them: that ends with them.
    sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify({ ...state(id), autopilot: [false, false, false, false].map((_, s) => s === seat) }), id);

    // Nobody has left yet, so the seats say who played the last hand.
    expect(getGameView(id, host)!.lastHand!.number).toBe(1);
    expect(getGameView(id, host)!.lastHand).not.toHaveProperty('names');

    const events: string[] = [];
    let closed = 0;
    const stop = subscribe(id, { userId: target, send: (event) => events.push(event), close: () => closed++ });
    const others: GameView[] = [];
    const stopOther = subscribe(id, { userId: host, send: (event, data) => event === 'state' && others.push(data as GameView) });

    performAction(id, host, { type: 'removePlayer', userId: target });
    stop();
    stopOther();
    const players = getPlayers(id);
    const cat = players[seat];
    expect((sql('SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?').get(id) as { n: number }).n).toBe(4);
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(cat.isBot).toBe(true);
    expect(sql('SELECT seat, through_hand FROM removed_players WHERE game_id = ? AND user_id = ?').get(id, target)).toEqual({
      seat,
      through_hand: 1,
    });
    expect(events).toEqual(['removed']);
    expect(closed).toBe(1);
    expect(others).toHaveLength(1);
    expect(others[0].players[seat]).toMatchObject({ isBot: true, userId: cat.userId });
    expect(state(id).autopilot?.[seat]).toBe(false);
    expect(premoveMap().get(id)?.has(target) ?? false).toBe(false);
    // The last hand's result still names who played it, not the cat sitting there now.
    const handOneNames = players.map((p) => (p.seat === seat ? getName(target) : p.displayName));
    expect(others[0].lastHand!.names).toEqual(handOneNames);
    expect(getGameView(id, host)!.lastHand!.names).toEqual(handOneNames);

    // They're out: no game page, no stream, not on their list.
    expect(wasRemoved(id, target)).toBe(true);
    expect(wasRemoved(id, users.find((u) => u !== target && u !== host)!)).toBe(false);
    expect(isMember(id, target)).toBe(false);
    expect(getGameView(id, target)).toBeNull();
    expect(listGamesForUser(target).some((g) => g.id === id)).toBe(false);
    expect(refusal(() => performAction(id, target, { type: 'play', card: '2C' }))).toMatchObject({ status: 403 });

    // The cat plays out hand 2, which is the cat's.
    playTo(id, 2);
    const [r1, r2] = [getHandRecord(id, 1)!, getHandRecord(id, 2)!];
    expect(r1.players![seat]).toBe(target);
    expect(r2.players![seat]).toBe(cat.userId);
    // Everyone who played hand 2 is still seated.
    expect(getGameView(id, host)!.lastHand!.number).toBe(2);
    expect(getGameView(id, host)!.lastHand).not.toHaveProperty('names');

    const stats = gameStats(id);
    const byId = (userId: number) => stats.players.find((p) => p.userId === userId)!;
    expect(stats.players.map((p) => p.userId)).toEqual([...players.map((p) => p.userId), target]);
    expect(byId(target)).toMatchObject({ hands: 1, total: r1.scores[seat] });
    expect(byId(cat.userId)).toMatchObject({ hands: 1, total: r2.scores[seat] });
    expect(stats.removed).toEqual([{ seat, userId: target, displayName: getName(target), throughHand: 1 }]);
    // The seat's running total is the game's: one line per seat.
    expect(stats.series[seat].totals).toEqual([r1.scores[seat], r1.scores[seat] + r2.scores[seat]]);

    const theirs = userOverview(target, 'them');
    expect(theirs.me).toMatchObject({ hands: 1, total: r1.scores[seat] });
    expect(theirs.games).toEqual([
      expect.objectContaining({ id, removed: true, myHands: 1, handsPlayed: 1, myScore: r1.scores[seat], rank: 0, won: false }),
    ]);
    expect(theirs.everyone.find((p) => p.userId === cat.userId)).toBeUndefined();
    const host2 = userOverview(host, 'host');
    expect(host2.me.hands).toBe(2);
    expect(host2.games[0]).toMatchObject({ removed: false, myHands: 2, handsPlayed: 2 });
    expect(host2.everyone.find((p) => p.userId === target)!.hands).toBe(1);
    expect(host2.everyone.find((p) => p.userId === cat.userId)!.hands).toBe(1);

    // Each hand's review names who played it.
    expect((await review(id, 1, host)).names[seat]).toBe(getName(target));
    expect((await review(id, 2, host)).names[seat]).toBe(cat.displayName);

    // Records from before players were stored fall back to the removal.
    sql("UPDATE hands SET record = json_remove(record, '$.players') WHERE game_id = ?").run(id);
    expect(getHandRecord(id, 1)!.players).toBeUndefined();
    const old = gameStats(id);
    expect(old.players.find((p) => p.userId === target)).toMatchObject({ hands: 1, total: r1.scores[seat] });
    expect(old.players.find((p) => p.userId === cat.userId)).toMatchObject({ hands: 1, total: r2.scores[seat] });
    expect((await review(id, 1, host)).names[seat]).toBe(getName(target));
    expect((await review(id, 2, host)).names[seat]).toBe(cat.displayName);

    // Over, a game can't lose anyone until it's back in play.
    vi.setSystemTime(Date.now() + 60_000);
    endGame(id, host, 'now');
    const someone = getPlayers(id).find((p) => !p.isBot && p.userId !== host)!.userId;
    expect(refusal(() => performAction(id, host, { type: 'removePlayer', userId: someone }))).toEqual({
      status: 400,
      message: 'This game is over. Tap Keep playing first to remove someone.',
    });

    // Finished, it's still not a game they finished or could have won, and it stays where they left it.
    const removedAt = (sql('SELECT removed_at FROM removed_players WHERE game_id = ? AND user_id = ?').get(id, target) as { removed_at: number })
      .removed_at;
    expect(loadGame(id)!.updatedAt).toBeGreaterThan(removedAt);
    const after = userOverview(target, 'them');
    expect(after).toMatchObject({ gamesFinished: 0, gamesWon: 0 });
    expect(after.games).toEqual([expect.objectContaining({ id, status: 'finished', removed: true, won: false, updatedAt: removedAt })]);
    expect(userOverview(host, 'host')).toMatchObject({ gamesFinished: 1 });
  });

  it('mid-game, is only for the host, never the host, and never a cat; leaving is still only for the waiting room', () => {
    const { id, users, host } = startTable();
    expect(refusal(() => performAction(id, users[1], { type: 'leave' }))).toEqual({
      status: 400,
      message: 'That can only be done before the game starts.',
    });
    expect(refusal(() => performAction(id, users[1], { type: 'removePlayer', userId: users[2] }))).toMatchObject({ status: 403 });
    expect(refusal(() => performAction(id, host, { type: 'removePlayer', userId: host }))).toMatchObject({ status: 400 });
    expect(refusal(() => performAction(id, host, { type: 'removePlayer', userId: 999_999 }))).toMatchObject({ status: 400 });
    performAction(id, host, { type: 'removePlayer', userId: users[3] });
    const cat = getPlayers(id)[3].userId;
    expect(refusal(() => performAction(id, host, { type: 'removePlayer', userId: cat }))).toEqual({
      status: 400,
      message: 'A cat is already playing that seat.',
    });
  });

  it('before any hand finished, leaves nothing of theirs in the stats', () => {
    const { id, users, host } = startTable();
    performAction(id, host, { type: 'removePlayer', userId: users[2] });
    expect(gameStats(id).players.map((p) => p.userId)).toEqual(getPlayers(id).map((p) => p.userId));
    expect(gameStats(id).removed).toMatchObject([{ seat: 2, userId: users[2], throughHand: 0 }]);
    expect(userOverview(users[2], 'them')).toMatchObject({ gamesFinished: 0, me: { hands: 0 } });
    playTo(id, 1);
    expect(gameStats(id).players.find((p) => p.userId === users[2])).toBeUndefined();
    expect(getHandRecord(id, 1)!.players![2]).toBe(getPlayers(id)[2].userId);
  });
});

function getName(userId: number) {
  return (sql('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string }).display_name;
}
