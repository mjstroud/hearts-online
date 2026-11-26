import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine/game';
import type { GameAction, GameView } from '../types';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-rematch-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const {
  createGame,
  createPlaytest,
  deleteGame,
  endGame,
  getGameView,
  getHandRecords,
  getPlayers,
  joinGame,
  listGamesForUser,
  loadGame,
  performAction,
  rematchGame,
  rematchName,
  toGameError,
} = await import('./games');
const { gameStats, userOverview } = await import('./stats');
const { subscribe } = await import('./hub');
const { normalizeSettings, passOffsetForHand } = await import('../engine/rules');
const { seatsToAct } = await import('../engine/game');
const { GAME_NAME_MAX } = await import('../names');
const { POST } = await import('../../pages/api/games/[id]/action');

// Nothing moves on a timer unless a test moves the clock on.
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(): number {
  const name = `player${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

/** Four people and no cats, dealt and waiting on the first pass. `users` is in seat order. */
function startTable(settings: Record<string, unknown> = {}) {
  const users = [addUser(), addUser(), addUser(), addUser()];
  const id = createGame(users[0], 'Sunday', normalizeSettings(settings));
  for (const user of users.slice(1)) joinGame(id, user);
  performAction(id, users[0], { type: 'start' });
  return { id, users, host: users[0] };
}

const state = (id: string) => loadGame(id)!.state!;
const handCount = (id: string) => (sql('SELECT COUNT(*) AS n FROM hands WHERE game_id = ?').get(id) as { n: number }).n;
const gameCount = () => (sql('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;

/** Whoever the table is waiting on makes a legal move, using only what their own view shows. */
function step(id: string) {
  const seat = seatsToAct(state(id))[0];
  const user = getPlayers(id)[seat].userId;
  const table = getGameView(id, user)!.table!;
  if (table.phase === 'passing') performAction(id, user, { type: 'pass', cards: table.myHand.slice(0, 3) });
  else performAction(id, user, { type: 'play', card: table.legal[0] });
}

/** Play on until `hands` hands are finished, or the game ends. */
function playTo(id: string, hands: number) {
  for (let i = 0; loadGame(id)!.status === 'active' && state(id).handsPlayed < hands; i++) {
    if (i > 20_000) throw new Error('The game never got there.');
    step(id);
  }
}
const playOut = (id: string) => playTo(id, Infinity);

type Extend = Omit<Extract<GameAction, { type: 'extend' }>, 'type'>;
/** "Keep playing", sent the way the end screen sends it: with the hand count it showed. */
const extend = (id: string, userId: number, rest: Extend = {}) =>
  performAction(id, userId, { type: 'extend', handsPlayed: state(id).handsPlayed, ...rest });

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

/** Rewrite a waiting room's seats in the given order. */
function setSeats(id: string, userIds: number[]) {
  sql('UPDATE game_players SET seat = -seat - 1 WHERE game_id = ?').run(id);
  userIds.forEach((user, seat) => sql('UPDATE game_players SET seat = ? WHERE game_id = ? AND user_id = ?').run(seat, id, user));
}

/** Listen in on what one player's open tab is sent. */
function listen(id: string, userId: number) {
  const views: GameView[] = [];
  const stop = subscribe(id, { userId, send: (event, data) => event === 'state' && views.push(data as GameView) });
  return { views, stop };
}

describe('keep playing', () => {
  it('needs a whole-number limit above the highest total once the limit was reached', () => {
    const { id, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    expect(loadGame(id)!.status).toBe('finished');
    const top = Math.max(...state(id).scores);
    const version = loadGame(id)!.version;
    const refused = { status: 400, message: `Pick a limit above ${top}, or no limit.` };
    // Left out, the limit stays at 1, which has already been reached.
    expect(refusal(() => extend(id, host))).toEqual(refused);
    for (const scoreLimit of [top, top - 1, 0, -5, 1.5, top + 0.5, 1_000_001, Infinity, NaN, '150', '', true, {}, []]) {
      expect(refusal(() => extend(id, host, { scoreLimit: scoreLimit as never }))).toEqual(refused);
    }
    expect(loadGame(id)!.status).toBe('finished');
    expect(loadGame(id)!.version).toBe(version);

    extend(id, host, { scoreLimit: top + 1 });
    expect(loadGame(id)!.status).toBe('active');
    expect(loadGame(id)!.settings.scoreLimit).toBe(top + 1);
  });

  it('takes the highest limit allowed, or no limit', () => {
    for (const scoreLimit of [1_000_000, null]) {
      const { id, users, host } = startTable({ scoreLimit: 1 });
      playOut(id);
      extend(id, host, { scoreLimit });
      expect(loadGame(id)!.settings.scoreLimit).toBe(scoreLimit);
      expect(getGameView(id, users[2])!.settings.scoreLimit).toBe(scoreLimit);
    }
  });

  it('is only for the host of a finished game', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    expect(refusal(() => extend(id, host, { scoreLimit: null }))).toEqual({ status: 400, message: 'This game is already back in play.' });
    playOut(id);
    expect(refusal(() => extend(id, users[1], { scoreLimit: null }))).toEqual({ status: 403, message: 'Only the game’s owner can do that.' });
    expect(refusal(() => extend(id, addUser(), { scoreLimit: null }))).toEqual({ status: 403, message: 'You are not in this game.' });
    expect(refusal(() => performAction('nosuchgame', host, { type: 'extend', scoreLimit: null }))).toMatchObject({ status: 404 });
    const lobby = createGame(host, 'Waiting', normalizeSettings({}));
    expect(refusal(() => performAction(lobby, host, { type: 'extend', scoreLimit: null }))).toEqual({
      status: 400,
      message: 'Only a finished game can be continued.',
    });
  });

  it('deals the next hand of the same game, with everyone back in their own seat', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const before = loadGame(id)!;
    const finished = before.state!;
    // Someone had a cat sitting in for them when the game ended.
    sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify({ ...finished, autopilot: [false, true, false, false] }), id);
    const hands = handCount(id);
    const top = Math.max(...finished.scores);
    const n = finished.handsPlayed;
    vi.advanceTimersByTime(60_000);
    extend(id, host, { scoreLimit: top + 40 });

    const game = loadGame(id)!;
    const s = game.state!;
    expect(game.status).toBe('active');
    expect(game.finishedAt).toBeNull();
    expect(game.startedAt).toBe(before.startedAt);
    // Play resumes, so the game moves up the games list.
    expect(game.updatedAt).toBe(Date.now());
    expect(s.scores).toEqual(finished.scores);
    expect(s.handsPlayed).toBe(n);
    expect(s.over).toBe(false);
    expect(s.hand!.number).toBe(n + 1);
    expect(s.hand!.passOffset).toBe(passOffsetForHand(n + 1, 4));
    expect(s.endAfterHand).toBeUndefined();
    expect(s.autopilot).toBeUndefined();
    expect(handCount(id)).toBe(hands);
    expect(s.extensions).toEqual([{ afterHand: n, from: 1, to: top + 40, at: Date.now() }]);

    const view = getGameView(id, users[1])!;
    expect(view).toMatchObject({ status: 'active', handsPlayed: n, endAfterHand: false, rematchId: null, settings: { scoreLimit: top + 40 } });
    expect(view.table!.handNumber).toBe(n + 1);
    expect(view.toAct).toEqual([0, 1, 2, 3]);
    expect(view.players.map((p) => p.autopilot)).toEqual([false, false, false, false]);
    // The last hand is still the one everyone has seen, so its result doesn't open again.
    expect(view.lastHand!.number).toBe(n);
    // The history stays on the server.
    expect(JSON.stringify(view)).not.toContain('extensions');
  });

  it('carries on hand by hand until the new limit ends it again, and can keep going after that', () => {
    const { id, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const first = state(id);
    const raised = Math.max(...first.scores) + 1;
    extend(id, host, { scoreLimit: raised });
    playTo(id, 2);
    // Hand 2 is recorded as hand 2, and the stats run straight on from hand 1.
    expect(getHandRecords(id).map((h) => h.number)).toEqual([1, 2]);
    const { series } = gameStats(id);
    expect(series.every((p) => p.totals.length === 2)).toBe(true);
    expect(series.map((p) => p.totals[1])).toEqual(state(id).scores);

    playOut(id);
    const game = loadGame(id)!;
    expect(game.status).toBe('finished');
    expect(game.settings.scoreLimit).toBe(raised);
    expect(Math.max(...game.state!.scores)).toBeGreaterThanOrEqual(raised);

    // A second "Keep playing" is a second entry.
    extend(id, host, { scoreLimit: null });
    expect(state(id).extensions!.map(({ afterHand, from, to }) => ({ afterHand, from, to }))).toEqual([
      { afterHand: 1, from: 1, to: raised },
      { afterHand: game.state!.handsPlayed, from: raised, to: null },
    ]);
  });

  it('after a final hand with no limit, keeps no limit and the next hand doesn’t end it', () => {
    const { id, host } = startTable();
    endGame(id, host, 'after-hand');
    playOut(id);
    expect(loadGame(id)!.status).toBe('finished');
    expect(state(id).endAfterHand).toBe(true);
    extend(id, host);
    expect(loadGame(id)!.settings.scoreLimit).toBeNull();
    expect(state(id).endAfterHand).toBeUndefined();
    expect(getGameView(id, host)!.endAfterHand).toBe(false);
    playTo(id, 2);
    expect(loadGame(id)!.status).toBe('active');
    expect(state(id).hand!.number).toBe(3);
  });

  it('after “End now”, deals the thrown-away hand again and keeps a limit not yet reached', () => {
    const { id, host } = startTable({ scoreLimit: 500 });
    playTo(id, 1);
    for (let i = 0; i < 10; i++) step(id);
    endGame(id, host, 'now');
    expect(state(id).handsPlayed).toBe(1);
    extend(id, host);
    expect(loadGame(id)!.settings.scoreLimit).toBe(500);
    expect(state(id).hand!.number).toBe(2);
    playTo(id, 2);
    expect(getHandRecords(id).map((h) => h.number)).toEqual([1, 2]);
  });

  it('turns away a second click, and a click from an old screen', () => {
    const { id, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const shown = state(id).handsPlayed;
    const send = (handsPlayed: unknown) => performAction(id, host, { type: 'extend', scoreLimit: null, handsPlayed: handsPlayed as number });
    expect(refusal(() => send(shown - 1))).toEqual({ status: 409, message: 'This game has moved on. Reload and try again.' });
    for (const bad of [String(shown), 1.5, null, true]) expect(refusal(() => send(bad))).toEqual({ status: 400, message: 'Invalid request.' });

    send(shown);
    // The same click again, from a second device.
    expect(refusal(() => send(shown))).toEqual({ status: 400, message: 'This game is already back in play.' });
    // The game finishes again, and a screen still showing the first finish tries again.
    playTo(id, shown + 1);
    endGame(id, host, 'now');
    expect(refusal(() => send(shown))).toMatchObject({ status: 409 });
  });

  it('starts the cats and a fresh move clock', () => {
    const alice = addUser();
    const bob = addUser();
    const id = createGame(alice, 'Timed', normalizeSettings({ moveTimer: 30 }));
    joinGame(id, bob);
    performAction(id, alice, { type: 'addBot' });
    performAction(id, alice, { type: 'addBot' });
    performAction(id, alice, { type: 'start' });
    // The cats pass, and both people run out of time.
    vi.advanceTimersByTime(60_000);
    expect(state(id).autopilot).toEqual([true, true, false, false]);
    endGame(id, alice, 'now');

    extend(id, alice, { scoreLimit: null });
    expect(state(id).autopilot).toBeUndefined();
    const view = getGameView(id, bob)!;
    expect(view.players.some((p) => p.autopilot)).toBe(false);
    expect(view.moveClock!.seconds).toBe(30);
    expect(view.moveClock!.endsIn).toBeGreaterThan(29_000);
    expect(seatsToAct(state(id))).toEqual([0, 1, 2, 3]);
    vi.advanceTimersByTime(2_000);
    expect(seatsToAct(state(id))).toEqual([0, 1]);
  });

  it('counts as in progress in lifetime stats until it finishes again', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const overview = () => userOverview(users[1], 'player');
    expect(overview().gamesFinished).toBe(1);
    extend(id, host, { scoreLimit: null });
    expect(overview()).toMatchObject({ gamesFinished: 0, gamesWon: 0 });
    expect(overview().games[0].status).toBe('active');
    expect(listGamesForUser(users[1]).find((g) => g.id === id)!.status).toBe('active');
    endGame(id, host, 'now');
    expect(overview().gamesFinished).toBe(1);
  });
});

describe('rematch', () => {
  it('seats the same five, cats included, in the same order, with the same host and settings', () => {
    const [alice, bob, carol] = [addUser(), addUser(), addUser()];
    const settings = normalizeSettings({ scoreLimit: 75, moveTimer: 60, jackOfDiamonds: false, showWatches: false });
    const id = createGame(alice, 'Five', settings);
    joinGame(id, bob);
    joinGame(id, carol);
    performAction(id, alice, { type: 'addBot' });
    performAction(id, alice, { type: 'addBot' });
    const cats = getPlayers(id)
      .filter((p) => p.isBot)
      .map((p) => p.userId);
    // The host isn't in seat 0.
    const order = [bob, cats[0], alice, carol, cats[1]];
    setSeats(id, order);
    performAction(id, alice, { type: 'start' });
    endGame(id, alice, 'now');

    const games = gameCount();
    const rid = rematchGame(id, alice);
    expect(gameCount()).toBe(games + 1);
    const r = loadGame(rid)!;
    expect(r).toMatchObject({ name: 'Five rematch', ownerId: alice, mode: 'normal', status: 'lobby', state: null, settings });
    expect(r.startedAt).toBeNull();
    expect(r.joinCode).not.toBe(loadGame(id)!.joinCode);
    expect(getPlayers(rid).map((p) => [p.seat, p.userId])).toEqual(order.map((user, seat) => [seat, user]));
    expect(handCount(rid)).toBe(0);
    // Everyone finds it under Waiting rooms.
    expect(listGamesForUser(carol).find((g) => g.id === rid)).toMatchObject({ status: 'lobby', isOwner: false });
    // And the host deals it as it stands.
    performAction(rid, alice, { type: 'start' });
    expect(state(rid).numPlayers).toBe(5);
    expect(getGameView(rid, bob)!.rematchId).toBeNull();
  });

  it('gives a second click the same rematch, without writing anything', () => {
    const { id, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const rid = rematchGame(id, host);
    const version = loadGame(id)!.version;
    const games = gameCount();
    expect(rematchGame(id, host)).toBe(rid);
    performAction(id, host, { type: 'rematch' });
    expect(gameCount()).toBe(games);
    expect(loadGame(id)!.version).toBe(version);
  });

  it('leaves the finished game as it was, apart from the link, which blocks “Keep playing”', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const old = loadGame(id)!;
    const hands = getHandRecords(id);
    vi.advanceTimersByTime(60_000);
    const rid = rematchGame(id, host);

    const after = loadGame(id)!;
    expect(after.version).toBe(old.version + 1);
    expect(after.updatedAt).toBe(old.updatedAt);
    expect(after.finishedAt).toBe(old.finishedAt);
    expect(after.status).toBe('finished');
    expect(after.settings).toEqual(old.settings);
    expect(after.state).toEqual({ ...old.state, rematchId: rid });
    expect(getHandRecords(id)).toEqual(hands);
    for (const user of users) expect(getGameView(id, user)!.rematchId).toBe(rid);
    // The waiting room's own views never carry one.
    expect(getGameView(rid, host)!.rematchId).toBeNull();

    expect(refusal(() => extend(id, host, { scoreLimit: null }))).toEqual({
      status: 409,
      message: 'This game already has a rematch. Delete the rematch to keep playing this one.',
    });
  });

  it('takes the link away from anyone who leaves the rematch or is removed, straight away', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const rid = rematchGame(id, host);
    const removed = listen(id, users[1]);
    const left = listen(id, users[2]);
    performAction(rid, host, { type: 'removePlayer', userId: users[1] });
    performAction(rid, users[2], { type: 'leave' });
    removed.stop();
    left.stop();
    expect(removed.views.at(-1)!.rematchId).toBeNull();
    expect(left.views.at(-1)!.rematchId).toBeNull();
    expect(getGameView(id, users[1])!.rematchId).toBeNull();
    expect(getGameView(id, users[2])!.rematchId).toBeNull();
    expect(getGameView(id, users[3])!.rematchId).toBe(rid);
    expect(getGameView(id, host)!.rematchId).toBe(rid);
  });

  it('after the rematch is deleted, makes a new one, or keeps playing', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    const first = rematchGame(id, host);
    const tab = listen(id, users[1]);
    deleteGame(first, host);
    tab.stop();
    expect(tab.views.map((v) => v.rematchId)).toEqual([null]);
    expect(getGameView(id, host)!.rematchId).toBeNull();

    const second = rematchGame(id, host);
    expect(second).not.toBe(first);
    expect(state(id).rematchId).toBe(second);
    deleteGame(second, host);
    extend(id, host, { scoreLimit: null });
    expect(loadGame(id)!.status).toBe('active');
    expect(state(id).rematchId).toBeUndefined();
  });

  it('is only for the host of a finished game', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    const unfinished = { status: 400, message: 'Only a finished game can have a rematch.' };
    expect(refusal(() => rematchGame(id, host))).toEqual(unfinished);
    playOut(id);
    expect(refusal(() => rematchGame(id, users[1]))).toEqual({ status: 403, message: 'Only the game’s owner can do that.' });
    expect(refusal(() => performAction(id, addUser(), { type: 'rematch' }))).toEqual({ status: 403, message: 'You are not in this game.' });
    expect(refusal(() => rematchGame('nosuchgame', host))).toMatchObject({ status: 404 });
    const lobby = createGame(host, 'Waiting', normalizeSettings({}));
    expect(refusal(() => rematchGame(lobby, host))).toEqual(unfinished);
    // "Keep playing" got there first, and a rematch click arrives from the old screen.
    const games = gameCount();
    extend(id, host, { scoreLimit: null });
    expect(refusal(() => rematchGame(id, host))).toEqual(unfinished);
    expect(gameCount()).toBe(games);
  });

  it('goes back to the limit the game first finished with, “no limit” included', () => {
    const a = startTable({ scoreLimit: 1 });
    playOut(a.id);
    extend(a.id, a.host, { scoreLimit: 500 });
    endGame(a.id, a.host, 'now');
    expect(loadGame(rematchGame(a.id, a.host))!.settings.scoreLimit).toBe(1);

    const b = startTable();
    endGame(b.id, b.host, 'now');
    extend(b.id, b.host, { scoreLimit: 200 });
    endGame(b.id, b.host, 'now');
    extend(b.id, b.host, { scoreLimit: 300 });
    endGame(b.id, b.host, 'now');
    expect(state(b.id).extensions!.map((e) => [e.from, e.to])).toEqual([
      [null, 200],
      [200, 300],
    ]);
    const rb = rematchGame(b.id, b.host);
    expect(loadGame(rb)!.settings.scoreLimit).toBeNull();

    // A rematch of the rematch.
    performAction(rb, b.host, { type: 'start' });
    endGame(rb, b.host, 'now');
    expect(loadGame(rematchGame(rb, b.host))!.name).toBe('Sunday rematch 2');
  });

  it('names each rematch so it is easy to tell apart and to type', () => {
    expect(rematchName('Sunday')).toBe('Sunday rematch');
    expect(rematchName('Sunday rematch')).toBe('Sunday rematch 2');
    expect(rematchName('Sunday rematch 2')).toBe('Sunday rematch 3');
    expect(rematchName('Sunday Rematch')).toBe('Sunday rematch 2');
    expect(rematchName('rematch')).toBe('rematch rematch');
    // A full-length name is cut short so the suffix always fits.
    const long = 'L'.repeat(GAME_NAME_MAX);
    expect(rematchName(long)).toBe(`${'L'.repeat(GAME_NAME_MAX - 8)} rematch`);
    expect(rematchName(rematchName(long))).toBe(`${'L'.repeat(GAME_NAME_MAX - 10)} rematch 2`);
    // Never half an emoji, and never a space before the suffix.
    expect(rematchName(`${'x'.repeat(50)} 😀😀`)).toBe(`${'x'.repeat(50)} rematch`);
  });
});

describe('playtest tables', () => {
  /** A playtest whose limit of 1 ends it after one hand, played by the computer. */
  function finishedPlaytest(players: number) {
    const owner = addUser();
    const id = createPlaytest(owner, 'Sandbox', normalizeSettings({ scoreLimit: 1 }), players);
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect(loadGame(id)!.status).toBe('finished');
    return { id, owner };
  }

  it('a rematch is dealt straight away, with the same seats and playtest settings', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Sandbox', normalizeSettings({ scoreLimit: 1 }), 5);
    performAction(id, owner, { type: 'dev:bots', speed: 'slow' });
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    const rid = rematchGame(id, owner);
    const r = loadGame(rid)!;
    expect(r).toMatchObject({ name: 'Sandbox rematch', mode: 'playtest', status: 'active', dev: { botMode: 'auto', speed: 'slow' } });
    expect(r.startedAt).toBe(Date.now());
    expect(r.state).toMatchObject({ numPlayers: 5, handsPlayed: 0, scores: [0, 0, 0, 0, 0] });
    expect(r.state!.hand!.number).toBe(1);
    expect(getPlayers(rid).map((p) => p.userId)).toEqual(getPlayers(id).map((p) => p.userId));
    expect(getGameView(rid, owner)!.dev).not.toBeNull();
    // The cats pass on their own.
    vi.advanceTimersByTime(2_500);
    expect(seatsToAct(state(rid))).toEqual([0]);
  });

  it('undoing past “Keep playing” puts the old limit back', () => {
    const { id, owner } = finishedPlaytest(4);
    extend(id, owner, { scoreLimit: 400 });
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect(state(id).handsPlayed).toBe(2);
    performAction(id, owner, { type: 'dev:undo' });
    expect(loadGame(id)!.settings.scoreLimit).toBe(400);
    expect(state(id).extensions).toHaveLength(1);
    performAction(id, owner, { type: 'dev:undo' });
    const game = loadGame(id)!;
    expect(game.status).toBe('finished');
    expect(game.settings.scoreLimit).toBe(1);
    expect(game.state!.extensions).toBeUndefined();
    expect(getHandRecords(id)).toHaveLength(1);
    // And it can keep playing again from there.
    extend(id, owner, { scoreLimit: 300 });
    expect(state(id).extensions!.map((e) => e.from)).toEqual([1]);
  });

  it('an undo keeps the rematch link, so there is never a second rematch', () => {
    const { id, owner } = finishedPlaytest(4);
    const rid = rematchGame(id, owner);
    performAction(id, owner, { type: 'dev:undo' });
    expect(loadGame(id)!.status).toBe('active');
    expect(state(id).rematchId).toBe(rid);
    expect(getGameView(id, owner)!.rematchId).toBeNull();
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect(getGameView(id, owner)!.rematchId).toBe(rid);
    expect(rematchGame(id, owner)).toBe(rid);
    expect(refusal(() => extend(id, owner, { scoreLimit: null }))).toMatchObject({ status: 409 });
  });
});

describe('games saved before this existed', () => {
  it('keeps playing and rematches a game an older build finished', () => {
    const { id, users, host } = startTable({ scoreLimit: 1 });
    playOut(id);
    // An older build wrote fewer settings, and none of the new state.
    const { numPlayers, scores, handsPlayed, lastHand } = state(id) as GameState;
    sql('UPDATE games SET settings = ?, state = ? WHERE id = ?').run(
      JSON.stringify({ scoreLimit: 1, jackOfDiamonds: true, shootTheMoon: true, shootTheSun: true, noPointsOnFirstTrick: true }),
      JSON.stringify({ numPlayers, hand: null, scores, handsPlayed, lastHand, over: true }),
      id,
    );
    expect(getGameView(id, users[1])!.rematchId).toBeNull();

    const rid = rematchGame(id, host);
    expect(loadGame(rid)!.settings).toEqual(normalizeSettings({ scoreLimit: 1 }));
    expect(getGameView(id, users[1])!.rematchId).toBe(rid);
    deleteGame(rid, host);

    extend(id, host, { scoreLimit: Math.max(...scores) + 50 });
    expect(state(id).extensions).toHaveLength(1);
    expect(state(id).extensions![0].from).toBe(1);
    expect(state(id).hand!.number).toBe(handsPlayed + 1);
  });
});

describe('JSON API', () => {
  async function post(id: string, userId: number, body: unknown) {
    const request = new Request(`http://localhost/api/games/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = (await POST({ params: { id }, request, locals: { user: { id: userId } } } as never)) as Response;
    return { status: res.status, body: await res.json() };
  }

  it('keeps playing and sets up a rematch through the action endpoint', async () => {
    const a = startTable({ scoreLimit: 1 });
    playOut(a.id);
    const limit = Math.max(...state(a.id).scores) + 100;
    const extended = await post(a.id, a.host, { type: 'extend', scoreLimit: limit, handsPlayed: 1 });
    expect(extended.status).toBe(200);
    expect(extended.body).toMatchObject({ id: a.id, status: 'active', rematchId: null, settings: { scoreLimit: limit } });
    expect(extended.body.table.handNumber).toBe(2);

    const b = startTable({ scoreLimit: 1 });
    playOut(b.id);
    const made = await post(b.id, b.host, { type: 'rematch' });
    expect(made.status).toBe(200);
    // The finished game's own view, with the link. An app opens /api/games/{rematchId}/state next.
    expect(made.body).toMatchObject({ id: b.id, status: 'finished', rematchId: state(b.id).rematchId });
    expect(getGameView(made.body.rematchId, b.users[2])!.status).toBe('lobby');

    expect(await post(b.id, b.host, { type: 'extend', scoreLimit: null, handsPlayed: 1 })).toEqual({
      status: 409,
      body: { error: 'This game already has a rematch. Delete the rematch to keep playing this one.' },
    });
    expect(await post(b.id, b.users[1], { type: 'rematch' })).toEqual({ status: 403, body: { error: 'Only the game’s owner can do that.' } });
  });
});
