import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-auth-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { takeAttempt, trackedAttemptKeys, validateSignup } = await import('./auth');

describe('rate limiter', () => {
  it('allows up to the limit, then refuses without counting the refusals', () => {
    const key = { key: 'test:a', limit: 3 };
    expect([1, 2, 3].map(() => takeAttempt([key]))).toEqual([true, true, true]);
    expect(takeAttempt([key])).toBe(false);
    // A blocked IP shouldn't start new counters for other keys either.
    const before = trackedAttemptKeys();
    expect(takeAttempt([{ key: 'test:fresh', limit: 5 }, key])).toBe(false);
    expect(trackedAttemptKeys()).toBe(before);
  });

  it('stays bounded under a flood of distinct keys', () => {
    for (let i = 0; i < 25_000; i++) takeAttempt([{ key: `flood:${i}`, limit: 1 }]);
    expect(trackedAttemptKeys()).toBeLessThanOrEqual(10_000);
  });
});

describe('sign-up names', () => {
  it('keeps the cats’ usernames for the cats', () => {
    expect(validateSignup('bot-1', 'Imposter', 'long-enough-pw')).toMatch(/taken/);
    expect(validateSignup('BOT-7', 'Imposter', 'long-enough-pw')).toMatch(/taken/);
    expect(validateSignup('bottle', 'Bottle', 'long-enough-pw')).toBeNull();
  });

  it('creates all seven cats when the database is set up', () => {
    const cats = sql('SELECT username FROM users WHERE is_bot = 1 ORDER BY username').all() as { username: string }[];
    expect(cats.map((c) => c.username)).toEqual(['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5', 'bot-6', 'bot-7']);
  });
});
