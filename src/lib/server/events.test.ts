import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameView } from '../types';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, joinGame } = await import('./games');
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
  return {
    async close() {
      hangUp.abort();
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
    },
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
});
