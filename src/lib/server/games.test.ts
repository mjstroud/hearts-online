import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createGame, createPlaytest, endGame, getGameView, joinGame, loadGame, performAction, resumeBots, updateSettings } = await import('./games');
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
    const { id, bob } = startTable(null);
    vi.advanceTimersByTime(60 * 60_000);
    expect(seatsToAct(state(id))).toEqual([0, 1]);
    expect(state(id).autopilot ?? []).not.toContain(true);
    expect(getGameView(id, bob)!.moveClock).toBeNull();
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

  it('gives everyone a fresh clock after a restart instead of timing them out', () => {
    const { id } = startTable(30);
    vi.advanceTimersByTime(2_000);
    // Pretend the server was down for a long deploy: the saved clock is now well past due.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    // A fresh process: no pending timers anywhere.
    vi.clearAllTimers();
    (globalThis as { __heartsBotTimers?: Map<string, unknown> }).__heartsBotTimers?.clear();
    const lastActivity = loadGame(id)!.updatedAt;
    resumeBots();
    expect(state(id).autopilot ?? []).not.toContain(true);
    // The restart isn't "activity": the games list keeps its order.
    expect(loadGame(id)!.updatedAt).toBe(lastActivity);
    vi.advanceTimersByTime(29_000);
    expect(state(id).autopilot ?? []).not.toContain(true);
    vi.advanceTimersByTime(2_000);
    expect(state(id).autopilot).toEqual([true, true, false, false]);
  });

  it('a "final hand" click that arrives after that hand ended stops the game there', () => {
    const { id, alice } = startTable(null);
    const game = loadGame(id)!;
    // The host's page still says hand 1, but hand 2 has just been dealt.
    sql('UPDATE games SET state = ? WHERE id = ?').run(
      JSON.stringify({ ...game.state, handsPlayed: 1, hand: { ...game.state!.hand!, number: 2 } }),
      id,
    );
    endGame(id, alice, 'after-hand', 1);
    expect(loadGame(id)!.status).toBe('finished');
    expect(state(id).handsPlayed).toBe(1);

    // A stale "end now" (which throws away a hand) is refused instead of guessing.
    const other = startTable(null);
    const g2 = loadGame(other.id)!;
    sql('UPDATE games SET state = ? WHERE id = ?').run(JSON.stringify({ ...g2.state, hand: { ...g2.state!.hand!, number: 3 } }), other.id);
    expect(() => endGame(other.id, other.alice, 'now', 2)).toThrow(/Reload/);
    endGame(other.id, other.alice, 'after-hand', 3);
    expect(loadGame(other.id)!.status).toBe('active');
    expect(state(other.id).endAfterHand).toBe(true);
  });

  it('has no clock at a playtest table while the computer players are on manual', () => {
    const owner = addUser();
    const id = createPlaytest(owner, 'Sandbox', normalizeSettings({ moveTimer: 30 }), 4);
    expect(getGameView(id, owner)!.moveClock).not.toBeNull();
    performAction(id, owner, { type: 'dev:bots', botMode: 'manual' });
    expect(getGameView(id, owner)!.moveClock).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(state(id).autopilot ?? []).not.toContain(true);
    // Back on auto: a fresh 30 seconds, not an allowance that ran out while on manual.
    performAction(id, owner, { type: 'dev:bots', botMode: 'auto' });
    expect(getGameView(id, owner)!.moveClock!.endsIn).toBeGreaterThan(29_000);
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
