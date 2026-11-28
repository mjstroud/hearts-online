import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-view-size-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, getGameView, joinGame, loadGame, performAction } = await import('./games');
const { normalizeSettings } = await import('../engine/rules');
const { seatsToAct } = await import('../engine/game');
const { GAME_NAME_MAX } = await import('../names');

/** One player's live update, in bytes (ROADMAP.md, ground rule 2). */
const LIVE_UPDATE_BUDGET = 4096;

// The move timer's wake-ups never fire, so nobody gets a cat sitting in for them.
beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
/** A person with an old 32-character name, the longest username allowed, and a photo. */
function addLongNamedUser(): number {
  const n = ++userCount;
  // Straight into the table: sign-up now stops at 16 characters, but older accounts kept up to 32.
  const res = sql('INSERT INTO users (username, display_name, password_hash, avatar_id, created_at) VALUES (?, ?, NULL, ?, ?)').run(
    `player${n}`.padEnd(24, 'x'),
    `Longname${n}`.padEnd(32, 'W'),
    randomBytes(16).toString('base64url'),
    Date.now(),
  );
  return Number(res.lastInsertRowid);
}

/** Everyone seated, with the longest game name and a move timer (so every view carries its clock). */
function startTable(numPlayers: number) {
  const users = Array.from({ length: numPlayers }, addLongNamedUser);
  const id = createGame(users[0], 'G'.repeat(GAME_NAME_MAX), normalizeSettings({ moveTimer: 300 }));
  for (const user of users.slice(1)) joinGame(id, user);
  performAction(id, users[0], { type: 'start' });
  return { id, users };
}

const handsPlayed = (id: string) => loadGame(id)!.state!.handsPlayed;

/** Whoever the table is waiting on makes a legal move, using only what their own view shows. */
function step(id: string, users: number[]) {
  const seat = seatsToAct(loadGame(id)!.state!)[0];
  const table = getGameView(id, users[seat])!.table!;
  if (table.phase === 'passing') performAction(id, users[seat], { type: 'pass', cards: table.myHand.slice(0, 3) });
  else performAction(id, users[seat], { type: 'play', card: table.legal[0] });
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** The biggest view anyone at the table is sent at any point in a hand, once a finished hand is on record. */
function largestUpdate(numPlayers: number) {
  const { id, users } = startTable(numPlayers);
  for (let i = 0; handsPlayed(id) === 0; i++) {
    if (i > 200) throw new Error('The first hand never finished.');
    step(id, users);
  }
  // A season's running totals run to four digits.
  const state = loadGame(id)!.state!;
  sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify({ ...state, scores: state.scores.map((s, seat) => s + 2000 + 111 * seat) }), id);

  let largest = { bytes: 0, where: '' };
  const measure = () => {
    for (const user of users) {
      const view = getGameView(id, user)!;
      const size = bytes(view);
      if (size > largest.bytes) {
        const t = view.table!;
        largest = { bytes: size, where: `seat ${view.me.seat}, hand ${t.handNumber}, ${t.phase}, trick ${t.trickNumber}` };
      }
    }
  };
  // Every move of the second hand, up to and including the update that deals the third.
  measure();
  for (let i = 0; handsPlayed(id) === 1; i++) {
    if (i > 200) throw new Error('The second hand never finished.');
    step(id, users);
    measure();
  }

  // Make sure this really was the worst case it claims to be.
  const view = getGameView(id, users[0])!;
  expect(view.lastHand).not.toBeNull();
  expect(view.moveClock).not.toBeNull();
  expect(view.players.every((p) => p.name.length === 32 && p.avatar !== null)).toBe(true);
  return largest;
}

describe('live update size', () => {
  it.each([5, 4])('%i players with 32-character names: every update stays under 4 KB', (numPlayers) => {
    const largest = largestUpdate(numPlayers);
    console.log(
      `Largest live update with ${numPlayers} players: ${largest.bytes} bytes of ${LIVE_UPDATE_BUDGET} (${largest.where})`,
    );
    expect(largest.bytes).toBeLessThan(LIVE_UPDATE_BUDGET);
  });
});

describe('chat message size', () => {
  it('a longest-possible message, from a 32-character name, stays under 4 KB on the live stream', async () => {
    const { CHAT_MAX_UNITS, chatError, cleanChat } = await import('../chat');
    const { subscribe } = await import('./hub');
    const users = [addLongNamedUser(), addLongNamedUser()];
    const id = createGame(users[0], 'Chat size', normalizeSettings({}));
    joinGame(id, users[1]);
    // The most bytes a message may hold: every code unit of the backstop, each one 3 bytes of UTF-8, as a
    // heart with three combining marks (cleaning keeps up to four on one letter).
    const text = cleanChat('♥⃝⃝⃝'.repeat(CHAT_MAX_UNITS / 4));
    expect(chatError(text)).toBeNull();
    let bytes = 0;
    const stop = subscribe(id, { userId: users[1], send: (event, data) => (bytes = Buffer.byteLength(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) });
    const { sendChat } = await import('./chat');
    sendChat(id, users[0], text, 'abcdefghijklmnopqrstuvwxyz012345');
    stop();
    console.log(`Largest chat message on the live stream: ${bytes} bytes of ${LIVE_UPDATE_BUDGET}`);
    expect(bytes).toBeGreaterThan(3000);
    expect(bytes).toBeLessThan(LIVE_UPDATE_BUDGET);
  });
});
