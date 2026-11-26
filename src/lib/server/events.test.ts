import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameView } from '../types';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, joinGame, performAction } = await import('./games');
const { normalizeSettings } = await import('../engine/rules');
const { GET } = await import('../../pages/api/games/[id]/events');

let userCount = 0;
function addUser(): number {
  const name = `streamer${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

/** Opens a player's live stream. close() hangs up and returns every event the stream sent. */
async function openStream(gameId: string, userId: number) {
  const hangUp = new AbortController();
  const request = new Request(`http://localhost/api/games/${gameId}/events`, { signal: hangUp.signal });
  const res = (await GET({ params: { id: gameId }, locals: { user: { id: userId } }, request } as never)) as Response;
  const reader = res.body!.getReader();
  /** Every event sent, once the stream has ended. */
  const drain = async () => {
    let text = '';
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text
      .split('\n\n')
      .map((block) => /^event: (\w+)\ndata: (.*)$/s.exec(block))
      .filter((m) => m !== null)
      .map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
  };
  return {
    close() {
      hangUp.abort();
      return drain();
    },
    /** For a stream the server hangs up on itself. */
    drain,
  };
}

describe('live stream', () => {
  it('sends a new stream one first state, and tells everyone else it came online', async () => {
    const alice = addUser();
    const bob = addUser();
    const id = createGame(alice, 'Stream table', normalizeSettings({}));
    joinGame(id, bob);

    const bobStream = await openStream(id, bob);
    const aliceStream = await openStream(id, alice);
    const aliceEvents = await aliceStream.close();
    const bobEvents = await bobStream.close();

    const states = (events: { event: string; data: unknown }[]) =>
      events.filter((e) => e.event === 'state').map((e) => e.data as GameView);
    const aliceOnline = (v: GameView) => v.players.find((p) => p.userId === alice)!.online;

    // Alice: the build id, then exactly one state.
    expect(aliceEvents.map((e) => e.event)).toEqual(['build', 'state']);
    expect(typeof aliceEvents[0].data).toBe('string');
    // Bob: his own first state, Alice coming online, then Alice leaving.
    expect(bobEvents.map((e) => e.event)).toEqual(['build', 'state', 'state', 'state']);
    expect(states(bobEvents).map(aliceOnline)).toEqual([false, true, false]);
  });

  it('hangs up on someone the host removes mid-game, after telling them once', async () => {
    // The cat that takes the seat moves on a timer: keep it still.
    vi.useFakeTimers();
    try {
      const [alice, bob, carol, dave] = [addUser(), addUser(), addUser(), addUser()];
      const id = createGame(alice, 'Kick table', normalizeSettings({}));
      for (const user of [bob, carol, dave]) joinGame(id, user);
      performAction(id, alice, { type: 'start' });

      const bobStream = await openStream(id, bob);
      const carolStream = await openStream(id, carol);
      performAction(id, alice, { type: 'removePlayer', userId: bob });
      const bobEvents = await bobStream.drain();
      // His first state, Carol coming online, then the one goodbye.
      expect(bobEvents.map((e) => e.event)).toEqual(['build', 'state', 'state', 'removed']);

      // Everyone else just gets the new seat: nobody is told Bob went offline on top of that.
      const carolEvents = await carolStream.close();
      expect(carolEvents.map((e) => e.event)).toEqual(['build', 'state', 'state']);
      expect((carolEvents[2].data as GameView).players[1].isBot).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
