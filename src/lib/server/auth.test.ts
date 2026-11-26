import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-auth-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { createUser, getUser, takeAttempt, trackedAttemptKeys, updateDisplayName, validateSignup } = await import('./auth');

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

  it('limits display names to 16 characters, ignoring stray spaces', () => {
    expect(validateSignup('grandmajo', 'Grandma Jo', 'long-enough-pw')).toBeNull();
    expect(validateSignup('grandmajo', `  ${'W'.repeat(16)}  `, 'long-enough-pw')).toBeNull();
    expect(validateSignup('grandmajo', 'W'.repeat(17), 'long-enough-pw')).toMatch(/up to 16 characters/);
    expect(validateSignup('grandmajo', ' \u200b ', 'long-enough-pw')).toMatch(/enter a display name/);
  });

  it('saves display names tidied, and keeps the old one when a rename is refused', async () => {
    const user = await createUser('renamer', '  Old   Name ', 'long-enough-pw');
    expect(user?.displayName).toBe('Old Name');
    expect(getUser(user!.id)?.displayName).toBe('Old Name');
    expect(updateDisplayName(user!.id, ' New\u200b \n Name ')).toEqual({ name: 'New Name' });
    expect(updateDisplayName(user!.id, 'x'.repeat(17))).toEqual({ error: 'Display names can be up to 16 characters.' });
    expect(updateDisplayName(user!.id, '\u202e')).toEqual({ error: 'Please enter a display name.' });
    expect(getUser(user!.id)?.displayName).toBe('New Name');
  });

  it('creates all seven cats when the database is set up', () => {
    const cats = sql('SELECT username FROM users WHERE is_bot = 1 ORDER BY username').all() as { username: string }[];
    expect(cats.map((c) => c.username)).toEqual(['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5', 'bot-6', 'bot-7']);
  });
});
