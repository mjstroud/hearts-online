import { describe, expect, it } from 'vitest';
import { HOLD_MS, type TauntTable, dueHeld, routeTaunt, sendOutcome } from './taunt-route';
import type { TauntEvent } from './taunts';

// You are user 1, at a table with users 2 and 3.
const table = (over: Partial<TauntTable> = {}): TauntTable => ({
  status: 'active',
  players: [{ userId: 1 }, { userId: 2 }, { userId: 3 }],
  me: 1,
  hidden: false,
  holding: false,
  sent: new Set(),
  ...over,
});
const laugh = (from: number, cid?: string): TauntEvent => ({ taunt: 'laugh', from, to: null, cid });
const tomato = (from: number, to: number | null): TauntEvent => ({ taunt: 'tomato', from, to });

describe('an incoming taunt', () => {
  it('shows someone else’s emote, or their throw at anyone seated', () => {
    expect(routeTaunt(laugh(2), table())).toEqual({ route: 'show', cooldown: false });
    expect(routeTaunt(tomato(2, 1), table())).toEqual({ route: 'show', cooldown: false });
    expect(routeTaunt(tomato(2, 3), table())).toEqual({ route: 'show', cooldown: false });
  });

  it('skips this tab’s own echo, and forgets its id', () => {
    const sent = new Set(['ab.1', 'ab.2']);
    expect(routeTaunt(laugh(1, 'ab.1'), table({ sent }))).toEqual({ route: 'echo', cooldown: false });
    expect([...sent]).toEqual(['ab.2']);
  });

  it('forgets an echo’s id even when it lands on a hidden tab, a finished game or the end of a hand', () => {
    for (const over of [{ hidden: true }, { status: 'finished' as const }, { holding: true }]) {
      const sent = new Set(['ab.1']);
      expect(routeTaunt(laugh(1, 'ab.1'), table({ ...over, sent })).route).toBe('echo');
      expect(sent.size).toBe(0);
    }
  });

  it('shows one from your other tab or device, and starts the cooldown here too', () => {
    const sent = new Set(['ab.1']);
    expect(routeTaunt(laugh(1, 'cd.1'), table({ sent }))).toEqual({ route: 'show', cooldown: true });
    expect(routeTaunt(tomato(1, 2), table({ sent }))).toEqual({ route: 'show', cooldown: true });
    expect([...sent]).toEqual(['ab.1']);
  });

  it('starts the cooldown for your other device’s taunt even when this tab won’t show it', () => {
    expect(routeTaunt(laugh(1, 'cd.1'), table({ hidden: true }))).toEqual({ route: 'drop', cooldown: true });
    expect(routeTaunt({ taunt: 'banana', from: 1, to: null, cid: 'cd.2' }, table())).toEqual({ route: 'drop', cooldown: true });
  });

  it('drops a taunt newer than this tab’s list', () => {
    expect(routeTaunt({ taunt: 'banana', from: 2, to: null }, table())).toEqual({ route: 'drop', cooldown: false });
  });

  it('drops one from someone who isn’t seated, or thrown at someone who isn’t', () => {
    expect(routeTaunt(laugh(9), table()).route).toBe('drop');
    expect(routeTaunt(tomato(2, 9), table()).route).toBe('drop');
    expect(routeTaunt(tomato(2, null), table()).route).toBe('drop');
  });

  it('drops everything outside play', () => {
    expect(routeTaunt(laugh(2), table({ status: 'lobby' })).route).toBe('drop');
    expect(routeTaunt(laugh(2), table({ status: 'finished' })).route).toBe('drop');
  });

  it('drops everything on a hidden tab, so no pile plays on return', () => {
    expect(routeTaunt(laugh(2), table({ hidden: true })).route).toBe('drop');
    expect(routeTaunt(laugh(2), table({ hidden: true, holding: true })).route).toBe('drop');
  });

  it('holds one through the end of a hand or its result', () => {
    expect(routeTaunt(laugh(2), table({ holding: true }))).toEqual({ route: 'hold', cooldown: false });
    expect(routeTaunt(laugh(1, 'cd.1'), table({ holding: true }))).toEqual({ route: 'hold', cooldown: true });
  });
});

describe('the held taunts, once the end of a hand clears', () => {
  const now = 100_000;
  const held = [{ at: now - HOLD_MS - 1 }, { at: now - HOLD_MS }, { at: now - HOLD_MS + 1 }, { at: now - 10 }];
  const live = { status: 'active' as const, hidden: false };

  it('plays only those under 8 seconds old, in the order they came', () => {
    expect(HOLD_MS).toBe(8000);
    expect(dueHeld(held, now, live)).toEqual([held[2], held[3]]);
  });

  it('plays none on a finished game or a hidden tab', () => {
    expect(dueHeld(held, now, { status: 'finished', hidden: false })).toEqual([]);
    expect(dueHeld(held, now, { status: 'active', hidden: true })).toEqual([]);
  });

  it('copes with nothing held', () => {
    expect(dueHeld([], now, live)).toEqual([]);
  });
});

describe('the answer to a send', () => {
  const sentAt = 50_000;
  const now = 50_400;

  it('takes the server’s cooldown, counted from the send, and keeps the id for the echo', () => {
    expect(sendOutcome({ ok: true, status: 200, data: { ok: true, cooldownMs: 15_000 } }, sentAt, now)).toEqual({ until: 65_000, forget: false, toast: null });
  });

  it('leaves the cooldown as it is when an answer doesn’t give one', () => {
    expect(sendOutcome({ ok: true, status: 200, data: {} }, sentAt, now)).toEqual({ until: null, forget: false, toast: null });
  });

  it('on a 429, waits as long as the server says, counted from now, and says why', () => {
    const res = { ok: false, status: 429, data: { error: 'Slow down a little.', retryAfterMs: 9000 } };
    expect(sendOutcome(res, sentAt, now)).toEqual({ until: 59_400, forget: true, toast: 'Slow down a little.' });
  });

  it('on a 429 with no body (a proxy’s page), leaves the cooldown and says something general', () => {
    expect(sendOutcome({ ok: false, status: 429, data: {} }, sentAt, now)).toEqual({ until: null, forget: true, toast: 'Something went wrong.' });
  });

  it('keeps the id when no answer came, since it may have landed and its echo may still come', () => {
    expect(sendOutcome({ ok: false, status: 0, data: {} }, sentAt, now)).toEqual({ until: null, forget: false, toast: 'Network hiccup — please try again.' });
  });

  it('passes on any other refusal, and forgets the id', () => {
    const res = { ok: false, status: 409, data: { error: 'The game isn’t being played.' } };
    expect(sendOutcome(res, sentAt, now)).toEqual({ until: null, forget: true, toast: 'The game isn’t being played.' });
    expect(sendOutcome({ ok: false, status: 502, data: {} }, sentAt, now)).toEqual({ until: null, forget: true, toast: 'Something went wrong.' });
  });

  it('never takes a retryAfterMs from anything but a 429', () => {
    expect(sendOutcome({ ok: false, status: 400, data: { error: 'No such taunt.', retryAfterMs: 9000 } }, sentAt, now).until).toBeNull();
  });
});
