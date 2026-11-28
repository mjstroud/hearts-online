import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_AS_BURST, CHAT_BURST, CHAT_HISTORY_MAX, CHAT_KEEP_MS, CHAT_MAX, CHAT_MAX_UNITS, type ChatMessage } from '../chat';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-chat-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, createPlaytest, deleteGame, endGame, getPlayers, joinGame, performAction, rematchGame } = await import('./games');
const { subscribe } = await import('./hub');
const { chatHistory, sendChat } = await import('./chat');
const { normalizeSettings } = await import('../engine/rules');
const { GET, POST } = await import('../../pages/api/games/[id]/chat');

// The spam limit lives on globalThis for the whole file, so every test uses fresh people and games.
beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000_000 });
});
const hangUps: (() => void)[] = [];
afterEach(() => {
  for (const stop of hangUps.splice(0)) stop();
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(name?: string): number {
  const username = `chat${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(
    username,
    name ?? username,
    Date.now(),
  );
  return Number(res.lastInsertRowid);
}

/** A table of `people` people (the host first) and `cats` cats, started unless `lobby`. */
function table(people = 2, cats = 2, lobby = false) {
  const users = Array.from({ length: people }, () => addUser());
  const host = users[0];
  const id = createGame(host, 'Chat', normalizeSettings({}));
  for (const user of users.slice(1)) joinGame(id, user);
  for (let i = 0; i < cats; i++) performAction(id, host, { type: 'addBot' });
  if (!lobby) performAction(id, host, { type: 'start' });
  const catIds = getPlayers(id)
    .filter((p) => p.isBot)
    .map((p) => p.userId);
  return { id, host, users, cats: catIds };
}

/** One open tab: everything the hub sends it. */
function tab(id: string, userId: number) {
  const t = { sent: [] as { event: string; data: unknown }[], closed: 0 };
  hangUps.push(subscribe(id, { userId, send: (event, data) => t.sent.push({ event, data }), close: () => t.closed++ }));
  return t;
}
const chats = (t: ReturnType<typeof tab>) => t.sent.filter((s) => s.event === 'chat').map((s) => s.data as ChatMessage);

/** Calls the chat endpoint as a signed-in user (the middleware has already turned away everyone else). */
async function post(id: string, userId: number, body: unknown) {
  const res = await POST({
    params: { id },
    locals: { user: { id: userId } },
    request: new Request(`http://localhost/api/games/${id}/chat`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never);
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
}

async function get(id: string, userId: number, query = '') {
  const res = await GET({
    params: { id },
    locals: { user: { id: userId } },
    url: new URL(`http://localhost/api/games/${id}/chat${query}`),
  } as never);
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') };
}

const texts = (messages: ChatMessage[]) => messages.map((m) => m.text);
const saved = (id: string) => sql('SELECT version, updated_at FROM games WHERE id = ?').get(id);
const stored = (id: string) => (sql('SELECT COUNT(*) AS n FROM chat_messages WHERE game_id = ?').get(id) as { n: number }).n;

describe('POST /api/games/:id/chat', () => {
  it('gives a stranger and an unknown game the same 404, and stores nothing', async () => {
    const { id } = table();
    const stranger = addUser();
    const notFound = { status: 404, body: { error: 'Game not found.' }, retryAfter: null };
    expect(await post(id, stranger, { text: 'hi' })).toEqual(notFound);
    expect(await post('nosuchgame', stranger, { text: 'hi' })).toEqual(notFound);
    expect((await get(id, stranger)).status).toBe(404);
    expect((await get('nosuchgame', stranger)).status).toBe(404);
    expect(stored(id)).toBe(0);
  });

  it('saves the message and sends it to every seated tab, without touching the game', async () => {
    const { id, host, users, cats } = table();
    const tabs = [tab(id, host), tab(id, host), tab(id, users[1])];
    const cat = tab(id, cats[0]);
    const before = saved(id);
    vi.setSystemTime(Date.now() + 5_000);

    const res = await post(id, host, { text: 'Good luck all', cid: 'tab-1.a_b' });
    expect(res.status).toBe(200);
    const message = res.body.message as ChatMessage;
    expect(message).toEqual({ id: expect.any(Number), from: host, name: `chat${userCount - 1}`, text: 'Good luck all', at: Date.now(), cid: 'tab-1.a_b' });
    for (const t of tabs) expect(t.sent).toEqual([{ event: 'chat', data: message }]);
    expect(cat.sent).toEqual([]);
    // No save, no version bump: /games keeps its order and nobody's view is rebuilt.
    expect(saved(id)).toEqual(before);
    expect(stored(id)).toBe(1);
  });

  it('works in the waiting room, during play and on the end screen', async () => {
    const lobby = table(2, 0, true);
    expect((await post(lobby.id, lobby.users[1], { text: 'Waiting…' })).status).toBe(200);
    const done = table(2, 2);
    endGame(done.id, done.host, 'now');
    expect((await post(done.id, done.users[1], { text: 'Good game' })).status).toBe(200);
    expect(texts((await get(done.id, done.host)).body.messages)).toEqual(['Good game']);
  });

  it('cleans the text the way names are, and counts characters the way people do', async () => {
    const { id, host } = table();
    const sent = async (text: unknown) => (await post(id, host, { text })).body;
    expect((await sent('  two\n\nlines \t here  ')).message.text).toBe('two lines here');
    expect((await sent('hi​‮ there')).message.text).toBe('hi there');
    expect((await sent('<b>not bold</b> & stays text')).message.text).toBe('<b>not bold</b> & stays text');
    vi.setSystemTime(Date.now() + CHAT_BURST.windowMs + 1);
    expect((await sent('🎉'.repeat(CHAT_MAX))).message.text).toBe('🎉'.repeat(CHAT_MAX));
    expect((await sent('a'.repeat(CHAT_MAX))).message.text).toHaveLength(CHAT_MAX);

    const refused = async (body: unknown, error: string) => expect(await post(id, host, body)).toEqual({ status: 400, body: { error }, retryAfter: null });
    await refused({ text: 'a'.repeat(CHAT_MAX + 1) }, `Messages can be up to ${CHAT_MAX} characters.`);
    await refused({ text: '🎉'.repeat(CHAT_MAX + 1) }, `Messages can be up to ${CHAT_MAX} characters.`);
    // Far too long is refused before it's cleaned, even if cleaning would have shortened it.
    await refused({ text: 'a' + ' '.repeat(CHAT_MAX_UNITS) }, `Messages can be up to ${CHAT_MAX} characters.`);
    await refused({ text: '󠁁'.repeat(30_000) }, `Messages can be up to ${CHAT_MAX} characters.`);
    await refused({ text: '   \n\t ' }, 'Type a message first.');
    await refused({ text: '​⁠' }, 'Type a message first.');
    await refused({ text: '́' }, 'Type a message first.');
    await refused({ text: 42 }, 'Type a message first.');
    await refused({}, 'Type a message first.');
    await refused('not json', 'Invalid request.');
    await refused([], 'Invalid request.');
    await refused({ text: 'hi', cid: 'has spaces' }, 'Invalid request.');
    await refused({ text: 'hi', cid: 'x'.repeat(33) }, 'Invalid request.');
    await refused({ text: 'hi', cid: 7 }, 'Invalid request.');
  });

  it('allows a burst of five, then asks you to wait, and a refusal costs nothing', async () => {
    const { id, host, users } = table();
    const t = tab(id, users[1]);
    // A bad message doesn't use up the burst.
    expect((await post(id, host, { text: '' })).status).toBe(400);
    for (let i = 0; i < CHAT_BURST.limit; i++) expect((await post(id, host, { text: `msg ${i}` })).status).toBe(200);
    const slow = await post(id, host, { text: 'one too many' });
    expect(slow.status).toBe(429);
    expect(slow.body.error).toMatch(/^Slow down a little: wait \d+s\.$/);
    expect(slow.body.retryAfterMs).toBeGreaterThan(0);
    expect(slow.body.retryAfterMs).toBeLessThanOrEqual(CHAT_BURST.windowMs);
    expect(Number(slow.retryAfter)).toBeGreaterThan(0);
    expect(chats(t)).toHaveLength(CHAT_BURST.limit);
    // Someone else at the table isn't held up by it.
    expect((await post(id, users[1], { text: 'me too' })).status).toBe(200);
    vi.setSystemTime(Date.now() + CHAT_BURST.windowMs + 1);
    expect((await post(id, host, { text: 'later' })).status).toBe(200);
  });

  it('gives a retry with the same client id the first message back, uncounted and unsent', async () => {
    const { id, host, users } = table();
    const t = tab(id, users[1]);
    const first = (await post(id, host, { text: 'Did this send?', cid: 'tab.1' })).body.message;
    for (let i = 0; i < CHAT_BURST.limit - 1; i++) await post(id, host, { text: `more ${i}` });
    // The burst is used up, but a retry isn't a new message.
    expect(await post(id, host, { text: 'Did this send?', cid: 'tab.1' })).toEqual({ status: 200, body: { message: first }, retryAfter: null });
    expect(chats(t).filter((m) => m.cid === 'tab.1')).toHaveLength(1);
    expect(stored(id)).toBe(CHAT_BURST.limit);
    // The same client id from someone else, or at another game, is a message of its own.
    expect((await post(id, users[1], { text: 'Mine', cid: 'tab.1' })).body.message.from).toBe(users[1]);
    const other = table(1, 3);
    expect((await post(other.id, other.host, { text: 'Elsewhere', cid: 'tab.1' })).body.message.text).toBe('Elsewhere');
  });

  it('treats a retry the next day as a new message, since the first one has gone', async () => {
    const { id, host } = table();
    const first = (await post(id, host, { text: 'Hello?', cid: 'late.1' })).body.message;
    vi.setSystemTime(Date.now() + CHAT_KEEP_MS + 1);
    const again = (await post(id, host, { text: 'Hello?', cid: 'late.1' })).body.message;
    expect(again.id).toBeGreaterThan(first.id);
    expect(again.at).toBe(Date.now());
    expect(texts((await get(id, host)).body.messages)).toEqual(['Hello?']);
  });

  it('never gives out an id twice, even once every message has aged out', async () => {
    const { id, host } = table();
    const old = (await post(id, host, { text: 'before the lull' })).body.message;
    // Every game's messages have aged out and gone, as after a quiet day site-wide.
    sql('DELETE FROM chat_messages').run();
    const fresh = (await post(id, host, { text: 'after it' })).body.message;
    expect(fresh.id).toBeGreaterThan(old.id);
  });
});

describe('GET /api/games/:id/chat', () => {
  it('sends the last 24 hours, oldest first, and only newer ones after an id', async () => {
    const { id, host, users } = table();
    const a = (await post(id, host, { text: 'one', cid: 'h.1' })).body.message;
    const b = (await post(id, users[1], { text: 'two', cid: 'g.1' })).body.message;
    const all = await get(id, users[1]);
    expect(all.status).toBe(200);
    expect(all.cache).toBe('no-store');
    // A client id only goes back to the one who sent it.
    expect(all.body).toEqual({ messages: [{ ...a, cid: undefined }, b].map((m) => JSON.parse(JSON.stringify(m))), more: false, now: Date.now() });
    expect((await get(id, users[1], `?after=${a.id}`)).body.messages).toEqual([b]);
    expect((await get(id, users[1], `?after=${b.id}`)).body).toEqual({ messages: [], more: false, now: Date.now() });
    for (const bad of ['?after=-1', '?after=1.5', '?after=x', '?after=1e400']) expect((await get(id, host, bad)).status).toBe(400);
  });

  it('leaves out messages older than 24 hours, and deletes them on the next write', async () => {
    const { id, host } = table();
    const other = table();
    await post(id, host, { text: 'old news' });
    await post(other.id, other.host, { text: 'old elsewhere' });
    vi.setSystemTime(Date.now() + CHAT_KEEP_MS - 1);
    expect(texts((await get(id, host)).body.messages)).toEqual(['old news']);
    vi.setSystemTime(Date.now() + 2);
    expect((await get(id, host)).body.messages).toEqual([]);
    await post(id, host, { text: 'fresh' });
    // Every game's old messages go, not just this one's.
    expect(stored(id)).toBe(1);
    expect(stored(other.id)).toBe(0);
    expect(texts((await get(id, host)).body.messages)).toEqual(['fresh']);
  });

  it(`pages ${CHAT_HISTORY_MAX} at a time: the newest first, then onwards from an id`, () => {
    const { id, host } = table();
    for (let i = 0; i < CHAT_HISTORY_MAX + 3; i++) sendChat(id, host, `m${i}`);
    const newest = chatHistory(id, host);
    expect(newest.messages).toHaveLength(CHAT_HISTORY_MAX);
    expect(newest.messages[0].text).toBe('m3');
    expect(newest.messages.at(-1)!.text).toBe(`m${CHAT_HISTORY_MAX + 2}`);
    expect(newest.more).toBe(true); // older ones exist

    // A tab that had only the first message catches up a page at a time, and misses nothing in between.
    const first = chatHistory(id, host).messages[0].id - 3;
    const page1 = chatHistory(id, host, first);
    expect(page1.messages.map((m) => m.text)).toEqual(Array.from({ length: CHAT_HISTORY_MAX }, (_, i) => `m${i + 1}`));
    expect(page1.more).toBe(true);
    const page2 = chatHistory(id, host, page1.messages.at(-1)!.id);
    expect(page2.messages.map((m) => m.text)).toEqual([`m${CHAT_HISTORY_MAX + 1}`, `m${CHAT_HISTORY_MAX + 2}`]);
    expect(page2.more).toBe(false);
  });

  it('clears out old messages when a chat is read, every few minutes at most', async () => {
    const { id, host } = table();
    await post(id, host, { text: 'going stale' });
    vi.setSystemTime(Date.now() + CHAT_KEEP_MS + 10 * 60_000);
    expect(stored(id)).toBe(1);
    await get(id, host);
    expect(stored(id)).toBe(0);
  });
});

describe('who can read and send', () => {
  it('cuts off someone removed mid-game at once, and keeps their messages under their name', async () => {
    const { id, host, users } = table(3, 1);
    const gone = users[2];
    sql('UPDATE users SET display_name = ? WHERE id = ?').run('W'.repeat(32), gone);
    await post(id, gone, { text: 'still here' });
    const theirs = tab(id, gone);
    performAction(id, host, { type: 'removePlayer', userId: gone });
    expect(theirs.closed).toBe(1);
    theirs.sent.length = 0;

    expect((await post(id, gone, { text: 'let me back' })).status).toBe(404);
    expect((await get(id, gone)).status).toBe(404);
    await post(id, host, { text: 'bye' });
    expect(theirs.sent).toEqual([]);
    const left = (await get(id, users[1])).body.messages as ChatMessage[];
    expect(left.map((m) => [m.from, m.name, m.text])).toEqual([
      [gone, 'W'.repeat(32), 'still here'],
      [host, `chat${userCount - 2}`, 'bye'],
    ]);
  });

  it('lets someone who left a waiting room see the last 24 hours when they join again', async () => {
    const { id, host, users } = table(2, 0, true);
    await post(id, users[1], { text: 'brb' });
    performAction(id, users[1], { type: 'leave' });
    await post(id, host, { text: 'where did they go' });
    expect((await get(id, users[1])).status).toBe(404);
    joinGame(id, users[1]);
    expect(texts((await get(id, users[1])).body.messages)).toEqual(['brb', 'where did they go']);
  });

  it('starts a rematch empty, keeps it through Keep playing, and deletes it with the game', async () => {
    const { id, host } = table(1, 3);
    await post(id, host, { text: 'first game' });
    endGame(id, host, 'now');
    performAction(id, host, { type: 'extend' });
    expect(texts((await get(id, host)).body.messages)).toEqual(['first game']);

    endGame(id, host, 'now');
    const rematch = rematchGame(id, host);
    expect((await get(rematch, host)).body.messages).toEqual([]);

    deleteGame(id, host);
    expect(stored(id)).toBe(0);
    expect((await get(id, host)).status).toBe(404);
  });

  it('lets the owner of a playtest table talk as one of its cats, and nobody else', async () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Playtest', normalizeSettings({}), 4);
    const cat = getPlayers(id).find((p) => p.isBot)!.userId;
    const res = await post(id, owner, { text: 'Meow.', as: cat });
    expect(res.status).toBe(200);
    expect(res.body.message.from).toBe(cat);
    // A looser limit for a cat the owner is driving, but still one: each message is saved.
    for (let i = 1; i < CHAT_AS_BURST.limit; i++) expect((await post(id, owner, { text: `meow ${i}`, as: cat })).status).toBe(200);
    expect((await post(id, owner, { text: 'meow!', as: cat })).status).toBe(429);
    // Their own limit is separate.
    expect((await post(id, owner, { text: 'me, not the cat' })).status).toBe(200);

    const refusal = { status: 400, body: { error: 'Only the owner of a playtest table can talk as one of its cats.' }, retryAfter: null };
    expect(await post(id, owner, { text: 'hi', as: owner })).toEqual(refusal);
    const real = table(2, 2);
    expect(await post(real.id, real.host, { text: 'hi', as: real.cats[0] })).toEqual(refusal);
  });
});
