import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAttempts, rateLimit, takeAttempt } from './rate-limit';

const MINUTE = 60_000;

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a fresh 15-minute window once the old one is over', () => {
    const key = { key: 'expiry', limit: 2 };
    expect(rateLimit([key])).toEqual({ ok: true, retryAfterMs: 0 });
    expect(rateLimit([key]).ok).toBe(true);
    expect(rateLimit([key]).ok).toBe(false);

    vi.advanceTimersByTime(15 * MINUTE);
    expect(rateLimit([key]).ok).toBe(false); // the window's last millisecond still counts
    vi.advanceTimersByTime(1);
    expect(rateLimit([key]).ok).toBe(true);
    expect(rateLimit([key]).ok).toBe(true);
    expect(rateLimit([key]).ok).toBe(false);
  });

  it('says how long until trying again works', () => {
    const key = { key: 'retry', limit: 1 };
    expect(takeAttempt([key])).toBe(true);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(rateLimit([key])).toEqual({ ok: false, retryAfterMs: 10 * MINUTE + 1 });

    // A refusal doesn't push the window back, and the answer counts down.
    vi.advanceTimersByTime(10 * MINUTE);
    expect(rateLimit([key])).toEqual({ ok: false, retryAfterMs: 1 });
    vi.advanceTimersByTime(1);
    expect(rateLimit([key]).ok).toBe(true);
  });

  it('takes the window from the caller, for short cooldowns', () => {
    const key = { key: 'cooldown', limit: 1, windowMs: 15_000 };
    expect(rateLimit([key]).ok).toBe(true);
    vi.advanceTimersByTime(4_000);
    expect(rateLimit([key])).toEqual({ ok: false, retryAfterMs: 11_001 });
    vi.advanceTimersByTime(11_001);
    expect(rateLimit([key]).ok).toBe(true);
  });

  it('counts each key on its own', () => {
    const a = { key: 'separate:a', limit: 1 };
    const b = { key: 'separate:b', limit: 2 };
    expect(takeAttempt([a])).toBe(true);
    expect(takeAttempt([a])).toBe(false);
    expect(takeAttempt([b])).toBe(true);
    expect(takeAttempt([b])).toBe(true);
    expect(takeAttempt([b])).toBe(false);
    expect(takeAttempt([{ key: 'separate:c', limit: 1 }])).toBe(true);
  });

  it('refuses when any key is full, without counting the others, and waits for the last to clear', () => {
    const user = { key: 'both:user', limit: 1, windowMs: 10 * MINUTE };
    const ip = { key: 'both:ip', limit: 3 };
    expect(rateLimit([user, ip]).ok).toBe(true); // user 1/1, ip 1/3
    vi.advanceTimersByTime(MINUTE);
    expect(rateLimit([{ key: 'both:other', limit: 1, windowMs: 2 * MINUTE }]).ok).toBe(true);
    expect(rateLimit([{ key: 'both:other', limit: 1 }, user]).retryAfterMs).toBe(9 * MINUTE + 1);
    // Refused, so the ip key is still at 1 of 3 and has room for two more.
    expect(rateLimit([ip]).ok).toBe(true);
    expect(rateLimit([ip]).ok).toBe(true);
    expect(rateLimit([ip]).ok).toBe(false);
  });

  it('forgets a key once it is cleared', () => {
    const key = { key: 'cleared', limit: 1 };
    expect(takeAttempt([key])).toBe(true);
    expect(takeAttempt([key])).toBe(false);
    clearAttempts(key.key);
    expect(takeAttempt([key])).toBe(true);
  });

  it('keeps its counts when the module is loaded again, as the dev server does', async () => {
    const key = { key: 'reload', limit: 1 };
    expect(takeAttempt([key])).toBe(true);
    vi.resetModules();
    const fresh = await import('./rate-limit');
    expect(fresh.takeAttempt([key])).toBe(false);
  });
});
