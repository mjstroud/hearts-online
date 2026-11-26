import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-hands-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, createPlaytest, getGameView, getHandRecord, joinGame, loadGame, performAction, updateSettings } = await import('./games');
const { settingsFromForm } = await import('./forms');
const { normalizeSettings } = await import('../engine/rules');
const { reviewHand } = await import('../engine/review');
const { GET } = await import('../../pages/api/games/[id]/hands/[number]');

// The computer players' timers never fire: each test moves the game on itself.
beforeAll(() => {
  vi.useFakeTimers();
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

/** Calls the trick-review endpoint as a signed-in user (the middleware has already turned away everyone else). */
const getReview = async (gameId: string, number: string, userId: number) =>
  GET({ params: { id: gameId, number }, locals: { user: { id: userId } } } as never) as Promise<Response> | Response;

describe('trick review endpoint', () => {
  it('serves a finished hand to the people at the table, and nothing else', async () => {
    const owner = addUser();
    const outsider = addUser();
    const id = createPlaytest(owner, 'Sandbox', normalizeSettings({}), 4);
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect(loadGame(id)!.state!.handsPlayed).toBe(1);

    const res = await getReview(id, '1', owner);
    expect(res.status).toBe(200);
    const review = await res.json();
    expect(review).toEqual(reviewHand(getHandRecord(id, 1)!));
    expect(review.tricks).toHaveLength(12);
    expect(JSON.stringify(review)).not.toMatch(/dealt|passes/);

    // Hand 2 is still being played, so it isn't on record yet.
    for (const n of ['2', '99', '0', '-1', '1.5', '1e0', 'abc']) expect((await getReview(id, n, owner)).status).toBe(404);
    expect(getHandRecord(id, 2)).toBeNull();

    // Someone not at the table gets the same answer as for a game that doesn't exist.
    const outside = await getReview(id, '1', outsider);
    const missing = await getReview('nosuchgame', '1', owner);
    expect(outside.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await outside.json()).toEqual(await missing.json());
  });

  it('only ever reads hands from the game in the address', async () => {
    const alice = addUser();
    const bob = addUser();
    const mine = createPlaytest(alice, 'Mine', normalizeSettings({}), 4);
    const theirs = createPlaytest(bob, 'Theirs', normalizeSettings({}), 5);
    performAction(mine, alice, { type: 'dev:ai', scope: 'hand' });
    performAction(theirs, bob, { type: 'dev:ai', scope: 'hand' });

    const review = await (await getReview(mine, '1', alice)).json();
    expect(review).toEqual(reviewHand(getHandRecord(mine, 1)!));
    expect(review.numPlayers).toBe(4);
    // Bob's hand 1 exists, but Alice isn't at his table.
    expect((await getReview(theirs, '1', alice)).status).toBe(404);
  });

  it('forgets a hand that a playtest undo took back', async () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Undo', normalizeSettings({}), 4);
    performAction(id, owner, { type: 'dev:ai', scope: 'hand' });
    expect((await getReview(id, '1', owner)).status).toBe(200);
    performAction(id, owner, { type: 'dev:undo' });
    expect(loadGame(id)!.state!.handsPlayed).toBe(0);
    expect((await getReview(id, '1', owner)).status).toBe(404);
  });
});

describe('watches setting', () => {
  /** Two people and two cats, dealt and under way. */
  function startTable() {
    const alice = addUser();
    const bob = addUser();
    const id = createGame(alice, 'Test table', normalizeSettings({}));
    joinGame(id, bob);
    performAction(id, alice, { type: 'addBot' });
    performAction(id, alice, { type: 'addBot' });
    performAction(id, alice, { type: 'start' });
    return { id, alice, bob };
  }
  const settings = (id: string) => loadGame(id)!.settings;
  const HOUSE_RULES = { jackOfDiamonds: true, shootTheMoon: true, shootTheSun: true, noPointsOnFirstTrick: true };

  it('is on by default, and the host can switch it mid-game while the house rules stay locked', () => {
    const { id, alice, bob } = startTable();
    expect(settings(id).showWatches).toBe(true);
    expect(getGameView(id, bob)!.table!.sunWatch).toBeNull();

    // The settings page once cards are dealt: the house-rules checkboxes are disabled, so they aren't sent at all.
    updateSettings(id, alice, '', settingsFromForm({ rulesForm: '1', watchesForm: '1' }));
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, showWatches: false });
    expect(getGameView(id, bob)!.settings.showWatches).toBe(false);

    updateSettings(id, alice, '', settingsFromForm({ rulesForm: '1', watchesForm: '1', showWatches: 'on' }));
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, showWatches: true });

    // A form without the switch (a page from before it existed) leaves it alone.
    updateSettings(id, alice, '', { showWatches: false });
    updateSettings(id, alice, '', settingsFromForm({ rulesForm: '1', scoreLimit: '' }));
    expect(settings(id).showWatches).toBe(false);

    // The other house rules still can't change mid-game.
    updateSettings(id, alice, '', { jackOfDiamonds: false, shootTheSun: false, showWatches: true });
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, showWatches: true });

    // Only the host.
    expect(() => updateSettings(id, bob, '', { showWatches: false })).toThrow(/owner/);
    expect(settings(id).showWatches).toBe(true);
  });

  it('is on for games saved before it existed', () => {
    const { id } = startTable();
    const old = { scoreLimit: null, ...HOUSE_RULES, moveTimer: null };
    sql('UPDATE games SET settings = ? WHERE id = ?').run(JSON.stringify(old), id);
    expect(settings(id).showWatches).toBe(true);
  });

  it('saves alongside the score limit and move timer from the full settings form', () => {
    const { id, alice } = startTable();
    // Everything the settings page sends mid-game (the disabled house-rules boxes are left out).
    const page = (fields: Record<string, string>) =>
      settingsFromForm({ intent: 'save', name: 'Test table', rulesForm: '1', watchesForm: '1', ...fields });
    updateSettings(id, alice, 'Test table', page({ scoreLimit: '150', moveTimer: '60' }));
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, scoreLimit: 150, moveTimer: 60, showWatches: false });

    // Switching only the watches leaves the move clock alone.
    const since = loadGame(id)!.state!.turnSince;
    vi.setSystemTime(Date.now() + 5000);
    updateSettings(id, alice, 'Test table', page({ scoreLimit: '150', moveTimer: '60', showWatches: 'on' }));
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, scoreLimit: 150, moveTimer: 60, showWatches: true });
    expect(loadGame(id)!.state!.turnSince).toBe(since);

    updateSettings(id, alice, 'Test table', page({ scoreLimit: '', moveTimer: '', showWatches: 'on' }));
    expect(settings(id)).toMatchObject({ ...HOUSE_RULES, scoreLimit: null, moveTimer: null, showWatches: true });
  });
});
