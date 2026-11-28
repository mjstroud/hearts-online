import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAUNT_COOLDOWN_MS, type TauntEvent } from '../taunts';

// How a cat answers a throw is the chatter's own business: here we only check that it's asked.
const { catHit } = vi.hoisted(() => ({ catHit: vi.fn() }));
// Partial, so games.ts still finds the chatter's other exports (catsReact, clearCatReaction).
vi.mock('./chatter', async (original) => ({ ...(await original<typeof import('./chatter')>()), catHit }));

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-taunt-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, createPlaytest, deleteGame, endGame, getPlayers, joinGame, performAction, sendToSeated } = await import('./games');
const { subscribe } = await import('./hub');
const { normalizeSettings } = await import('../engine/rules');
const { POST } = await import('../../pages/api/games/[id]/taunt');

// Nothing moves on a timer unless a test moves the clock on. The cooldowns live on globalThis for the
// whole file, so every test uses fresh people and fresh games.
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  catHit.mockReset();
});
const hangUps: (() => void)[] = [];
afterEach(() => {
  for (const stop of hangUps.splice(0)) stop();
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(): number {
  const name = `taunt${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

/** A started table: `people` people (the host first), then `cats` cats. */
function table(people = 2, cats = 2) {
  const users = Array.from({ length: people }, () => addUser());
  const host = users[0];
  const id = createGame(host, 'Taunts', normalizeSettings({}));
  for (const user of users.slice(1)) joinGame(id, user);
  for (let i = 0; i < cats; i++) performAction(id, host, { type: 'addBot' });
  performAction(id, host, { type: 'start' });
  const catIds = getPlayers(id)
    .filter((p) => p.isBot)
    .map((p) => p.userId);
  return { id, host, users, cats: catIds };
}

/** One open tab: everything the hub sends it, and how often it was hung up. Hanging up leaves it subscribed, like a stream not yet closed. */
function tab(id: string, userId: number) {
  const t = { sent: [] as { event: string; data: unknown }[], closed: 0 };
  hangUps.push(subscribe(id, { userId, send: (event, data) => t.sent.push({ event, data }), close: () => t.closed++ }));
  return t;
}
const taunts = (t: ReturnType<typeof tab>) => t.sent.filter((s) => s.event === 'taunt').map((s) => s.data as TauntEvent);

/** Calls the taunt endpoint as a signed-in user (the middleware has already turned away everyone else). */
async function send(id: string, userId: number, body: unknown) {
  const res = await POST({
    params: { id },
    locals: { user: { id: userId } },
    request: new Request(`http://localhost/api/games/${id}/taunt`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never);
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
}

const saved = (id: string) => sql('SELECT version, updated_at FROM games WHERE id = ?').get(id);

describe('sendToSeated', () => {
  it('reaches every open tab of everyone seated, and never a cat', () => {
    const { id, users, cats } = table();
    const [hostA, hostB, guest, cat] = [tab(id, users[0]), tab(id, users[0]), tab(id, users[1]), tab(id, cats[0])];
    sendToSeated(id, 'taunt', { hello: 1 });
    for (const t of [hostA, hostB, guest]) expect(t.sent).toEqual([{ event: 'taunt', data: { hello: 1 } }]);
    expect(cat.sent).toEqual([]);
    expect([hostA, hostB, guest, cat].map((t) => t.closed)).toEqual([0, 0, 0, 0]);
  });

  it('skips someone taken out mid-game whose stream is still open, without hanging up on anyone', () => {
    const { id, host, users } = table(3, 1);
    const [stays, gone] = [tab(id, users[1]), tab(id, users[2])];
    performAction(id, host, { type: 'removePlayer', userId: users[2] });
    expect(gone.closed).toBe(1); // publish() said goodbye
    stays.sent.length = 0;
    gone.sent.length = 0;

    sendToSeated(id, 'taunt', { hello: 2 });
    expect(stays.sent).toEqual([{ event: 'taunt', data: { hello: 2 } }]);
    expect(gone.sent).toEqual([]);
    expect([stays.closed, gone.closed]).toEqual([0, 1]);
  });

  it('does nothing once the game is deleted, or for a game that never was', () => {
    const { id, host } = table();
    const t = tab(id, host);
    deleteGame(id, host);
    expect(t.sent.map((s) => s.event)).toEqual(['deleted']);
    t.sent.length = 0;
    sendToSeated(id, 'taunt', { hello: 3 });
    expect(t.sent).toEqual([]);
    expect(() => sendToSeated('nosuchgame', 'taunt', {})).not.toThrow();
  });
});

describe('POST /api/games/:id/taunt', () => {
  it('gives a stranger and an unknown game the same 404', async () => {
    const { id } = table();
    const stranger = addUser();
    const notFound = { status: 404, body: { error: 'Game not found.' }, retryAfter: null };
    expect(await send(id, stranger, { taunt: 'laugh' })).toEqual(notFound);
    expect(await send('nosuchgame', stranger, { taunt: 'laugh' })).toEqual(notFound);
  });

  it('sends one identical event to every seated tab, with the cid echoed, and saves nothing', async () => {
    const { id, host, users } = table();
    const tabs = [tab(id, host), tab(id, host), tab(id, users[1])];
    const before = saved(id);
    vi.setSystemTime(Date.now() + 5_000); // a save now would show in updated_at; no timers fire

    expect(await send(id, host, { taunt: 'tomato', to: users[1], cid: 'tab-1.a_b' })).toEqual({
      status: 200,
      body: { ok: true, cooldownMs: TAUNT_COOLDOWN_MS },
      retryAfter: null,
    });
    for (const t of tabs) expect(t.sent).toEqual([{ event: 'taunt', data: { taunt: 'tomato', from: host, to: users[1], cid: 'tab-1.a_b' } }]);
    expect(saved(id)).toEqual(before);

    // An emote with no cid goes out without one, aimed at nobody.
    expect((await send(id, users[1], { taunt: 'heart', to: null })).status).toBe(200);
    for (const t of tabs) expect(taunts(t)[1]).toStrictEqual({ taunt: 'heart', from: users[1], to: null });
    expect(saved(id)).toEqual(before);
    expect(catHit).not.toHaveBeenCalled();
  });

  it('turns away bad requests with a 400, without starting the cooldown', async () => {
    const { id, host, users, cats } = table();
    const stranger = addUser();
    const t = tab(id, users[1]);
    const bad: unknown[] = [
      '{not json',
      'null',
      '[]',
      '5',
      {},
      { taunt: 'nope' },
      { taunt: 'TOMATO', to: users[1] },
      { taunt: 'laugh', to: users[1] },
      { taunt: 'laugh', to: 0 },
      { taunt: 'tomato' },
      { taunt: 'tomato', to: null },
      { taunt: 'tomato', to: String(users[1]) },
      { taunt: 'tomato', to: users[1] + 0.5 },
      { taunt: 'tomato', to: host },
      { taunt: 'tomato', to: stranger },
      { taunt: 'laugh', cid: 'has space' },
      { taunt: 'laugh', cid: 'x'.repeat(33) },
      { taunt: 'laugh', cid: '' },
      { taunt: 'laugh', cid: 5 },
      { taunt: 'laugh', as: cats[0] }, // not a playtest table
    ];
    for (const body of bad) {
      const res = await send(id, host, body);
      expect([body, res.status, typeof res.body.error]).toEqual([body, 400, 'string']);
    }
    expect(t.sent).toEqual([]);
    expect((await send(id, host, { taunt: 'laugh' })).status).toBe(200);
  });

  it('misses someone just taken out of the game, who can no longer taunt either', async () => {
    const { id, host, users } = table(3, 1);
    const gone = users[2];
    const t = tab(id, gone);
    performAction(id, host, { type: 'removePlayer', userId: gone });
    expect(await send(id, host, { taunt: 'pie', to: gone })).toEqual({
      status: 400,
      body: { error: 'They aren’t at this table.' },
      retryAfter: null,
    });
    expect((await send(id, gone, { taunt: 'laugh' })).status).toBe(404);
    expect((await send(id, host, { taunt: 'laugh' })).status).toBe(200);
    expect(taunts(t)).toEqual([]);
  });

  it('is only for the table during play: not the waiting room, not the end screen', async () => {
    const [host, guest] = [addUser(), addUser()];
    const id = createGame(host, 'Lobby', normalizeSettings({}));
    joinGame(id, guest);
    const refused = { status: 409, body: { error: 'Taunts are for the table during play.' }, retryAfter: null };
    expect(await send(id, host, { taunt: 'laugh' })).toEqual(refused);
    expect(await send(id, host, { taunt: 'rose', to: guest })).toEqual(refused);

    performAction(id, host, { type: 'addBot' });
    performAction(id, host, { type: 'addBot' });
    performAction(id, host, { type: 'start' });
    expect((await send(id, host, { taunt: 'laugh' })).status).toBe(200); // the 409 didn't start the cooldown

    endGame(id, host, 'now');
    expect(await send(id, guest, { taunt: 'laugh' })).toEqual(refused);
  });

  it('allows one taunt per person every 15s, emotes and throws together', async () => {
    const { id, host, users } = table();
    expect((await send(id, host, { taunt: 'cool' })).status).toBe(200);

    const tooSoon = await send(id, host, { taunt: 'fish', to: users[1] });
    expect(tooSoon).toEqual({
      status: 429,
      body: { error: 'Wait 15s for the next taunt.', retryAfterMs: TAUNT_COOLDOWN_MS },
      retryAfter: '15',
    });
    // Everyone else has their own.
    expect((await send(id, users[1], { taunt: 'sob' })).status).toBe(200);

    vi.advanceTimersByTime(10_000);
    const later = await send(id, host, { taunt: 'cool' });
    expect([later.status, later.body.retryAfterMs, later.retryAfter]).toEqual([429, 5_001, '6']);
    expect(later.body.retryAfterMs).toBeLessThanOrEqual(TAUNT_COOLDOWN_MS);

    vi.advanceTimersByTime(5_001); // the window's last millisecond still counts
    expect((await send(id, host, { taunt: 'fish', to: users[1] })).status).toBe(200);
  });

  it('keeps the cooldown per table, so one person can taunt at two games at once', async () => {
    const one = table();
    const host = one.host;
    const id2 = createGame(host, 'Second', normalizeSettings({}));
    for (let i = 0; i < 3; i++) performAction(id2, host, { type: 'addBot' });
    performAction(id2, host, { type: 'start' });

    expect((await send(one.id, host, { taunt: 'devil' })).status).toBe(200);
    expect((await send(id2, host, { taunt: 'devil' })).status).toBe(200);
    expect((await send(one.id, host, { taunt: 'devil' })).status).toBe(429);
    expect((await send(id2, host, { taunt: 'devil' })).status).toBe(429);
  });

  it('tells a cat it was hit, after the throw has gone out', async () => {
    const { id, host, users, cats } = table();
    const t = tab(id, users[1]);
    let sentFirst = -1;
    catHit.mockImplementation(() => {
      sentFirst = taunts(t).length;
    });
    expect((await send(id, host, { taunt: 'fish', to: cats[1] })).status).toBe(200);
    expect(catHit).toHaveBeenCalledTimes(1);
    expect(catHit).toHaveBeenCalledWith(id, cats[1], host, 'fish');
    expect(sentFirst).toBe(1);
    expect(taunts(t)).toEqual([{ taunt: 'fish', from: host, to: cats[1] }]);

    // A cat that fails to answer never spoils the throw.
    catHit.mockImplementation(() => {
      throw new Error('hiss');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send(id, users[1], { taunt: 'pie', to: cats[0] })).status).toBe(200);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(taunts(t)).toHaveLength(2);
    catHit.mockReset();

    // Emotes and throws at people leave the cats alone.
    vi.advanceTimersByTime(TAUNT_COOLDOWN_MS + 1);
    expect((await send(id, host, { taunt: 'rose', to: users[1] })).status).toBe(200);
    expect((await send(id, users[1], { taunt: 'clap' })).status).toBe(200);
    expect(catHit).not.toHaveBeenCalled();
  });

  it('lets the owner of a playtest table send as its cats, with no cooldown', async () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Playtest', normalizeSettings({}), 4);
    const cats = getPlayers(id)
      .filter((p) => p.isBot)
      .map((p) => p.userId);
    expect(cats).toHaveLength(3);
    const t = tab(id, owner);

    for (let i = 0; i < 2; i++) {
      expect(await send(id, owner, { taunt: 'sleepy', as: cats[0] })).toEqual({ status: 200, body: { ok: true, cooldownMs: 0 }, retryAfter: null });
    }
    // A cat's throw can be aimed at the owner, and at another cat, which is then told it was hit.
    expect((await send(id, owner, { taunt: 'tomato', to: owner, as: cats[0] })).status).toBe(200);
    expect(catHit).not.toHaveBeenCalled();
    expect((await send(id, owner, { taunt: 'pie', to: cats[2], as: cats[1] })).status).toBe(200);
    expect(catHit).toHaveBeenCalledWith(id, cats[2], cats[1], 'pie');
    expect(taunts(t)).toEqual([
      { taunt: 'sleepy', from: cats[0], to: null },
      { taunt: 'sleepy', from: cats[0], to: null },
      { taunt: 'tomato', from: cats[0], to: owner },
      { taunt: 'pie', from: cats[1], to: cats[2] },
    ]);

    // Not as a person, not as a cat from somewhere else, and a cat can't hit itself.
    const elsewhere = (sql('SELECT id FROM users WHERE is_bot = 1').all() as { id: number }[]).map((r) => r.id).find((c) => !cats.includes(c));
    expect(elsewhere).toBeDefined();
    for (const body of [
      { taunt: 'laugh', as: owner },
      { taunt: 'laugh', as: String(cats[0]) },
      { taunt: 'laugh', as: elsewhere },
      { taunt: 'fish', to: cats[0], as: cats[0] },
    ]) {
      expect((await send(id, owner, body)).status).toBe(400);
    }

    // The owner's own taunts still have the cooldown, which sending as the cats never touched.
    expect((await send(id, owner, { taunt: 'laugh' })).body).toEqual({ ok: true, cooldownMs: TAUNT_COOLDOWN_MS });
    expect((await send(id, owner, { taunt: 'laugh' })).status).toBe(429);
    expect((await send(id, owner, { taunt: 'laugh', as: cats[0] })).status).toBe(200);
  });

  it('is only for the owner of a playtest table: not a host or guest at a family game', async () => {
    const { id, host, users, cats } = table();
    for (const sender of [host, users[1]]) {
      expect(await send(id, sender, { taunt: 'laugh', as: cats[0] })).toEqual({
        status: 400,
        body: { error: 'Only the owner of a playtest table can send as one of its cats.' },
        retryAfter: null,
      });
    }
    expect((await send(id, users[1], { taunt: 'laugh' })).status).toBe(200);
  });
});
