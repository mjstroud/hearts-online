import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, getGameView, joinGame, loadGame, performAction, updateSettings } = await import('./games');
const { normalizeSettings } = await import('../engine/rules');
const { seatsToAct } = await import('../engine/game');

afterAll(() => {
  vi.useRealTimers();
});

let userCount = 0;
function addUser(): number {
  const name = `player${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}

/** Two people (seats 0 and 1) and two cats, dealt and waiting on the first pass. */
function startTable(moveTimer: number | null) {
  const alice = addUser();
  const bob = addUser();
  const id = createGame(alice, 'Test table', normalizeSettings({ moveTimer }));
  joinGame(id, bob);
  performAction(id, alice, { type: 'addBot' });
  performAction(id, alice, { type: 'addBot' });
  performAction(id, alice, { type: 'start' });
  return { id, alice, bob };
}

const state = (id: string) => loadGame(id)!.state!;

describe('move timer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  it('waits for people forever when the timer is off', () => {
    const { id } = startTable(null);
    vi.advanceTimersByTime(60 * 60_000);
    expect(seatsToAct(state(id))).toEqual([0, 1]);
    expect(state(id).autopilot ?? []).not.toContain(true);
    expect(getGameView(id, userCount)!.moveClock).toBeNull();
  });

  it('sits a cat in for whoever runs out of time, and lets them come back', () => {
    const { id, alice, bob } = startTable(30);
    vi.advanceTimersByTime(2_000); // the cats pass
    expect(seatsToAct(state(id))).toEqual([0, 1]);
    expect(getGameView(id, alice)!.moveClock?.seconds).toBe(30);

    // Alice passes in time; Bob doesn't. Everyone's passing clock started at the deal.
    performAction(id, alice, { type: 'pass', cards: state(id).hand!.hands[0].slice(0, 3) });
    vi.advanceTimersByTime(27_000);
    expect(state(id).hand!.phase).toBe('passing');
    vi.advanceTimersByTime(2_000);
    expect(state(id).autopilot?.[1]).toBe(true);
    expect(state(id).hand!.phase).toBe('playing');
    expect(getGameView(id, alice)!.players[1].autopilot).toBe(true);

    // Bob's seat keeps playing while Alice is here. When Alice runs out of time too, the table pauses.
    vi.advanceTimersByTime(10 * 60_000);
    expect(state(id).autopilot?.[0]).toBe(true);
    const paused = loadGame(id)!.version;
    vi.advanceTimersByTime(10 * 60_000);
    expect(loadGame(id)!.version).toBe(paused);

    // Alice comes back: Bob's cat carries on, and Alice gets a fresh clock on her turns.
    performAction(id, alice, { type: 'resume' });
    expect(state(id).autopilot?.[0]).toBe(false);
    vi.advanceTimersByTime(5_000);
    const toAct = seatsToAct(state(id));
    expect(toAct.length).toBe(1);
    if (toAct[0] === 0) expect(getGameView(id, alice)!.moveClock!.endsIn).toBeGreaterThan(0);

    // Bob plays a card himself (or presses I'm back) to take his seat back.
    performAction(id, bob, { type: 'resume' });
    expect(state(id).autopilot?.[1]).toBe(false);
  });

  it('turning the timer off brings everyone back and stops the clock', () => {
    const { id, alice } = startTable(30);
    vi.advanceTimersByTime(60_000);
    expect(state(id).autopilot).toEqual([true, true, false, false]);
    updateSettings(id, alice, '', { moveTimer: null });
    expect(state(id).autopilot).toBeUndefined();
    const version = loadGame(id)!.version;
    vi.advanceTimersByTime(60 * 60_000);
    expect(loadGame(id)!.version).toBe(version);
    expect(getGameView(id, alice)!.moveClock).toBeNull();
  });
});
