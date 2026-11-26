import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-auth-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const {
  TERMS_REQUIRED,
  acceptTerms,
  createSession,
  createUser,
  getSessionUser,
  getUser,
  signUp,
  takeAttempt,
  trackedAttemptKeys,
  updateDisplayName,
  validateSignup,
} = await import('./auth');
const { TERMS_VERSION, isPageLoad, needsTerms, termsGatedPath } = await import('../terms');

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

  // Plain CPU work, which can take a while when the rest of the suite is running alongside it.
  it('stays bounded under a flood of distinct keys', { timeout: 20_000 }, () => {
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

describe('terms and privacy', () => {
  const form = (over: Partial<Parameters<typeof signUp>[0]> = {}) => ({
    username: 'agreeable',
    displayName: 'Agreeable',
    password: 'long-enough-pw',
    confirmPassword: 'long-enough-pw',
    signupCode: '',
    agreedToTerms: true,
    ...over,
  });
  const termsRow = (username: string) =>
    sql('SELECT terms_version, terms_accepted_at FROM users WHERE username = ?').get(username) as
      | { terms_version: number | null; terms_accepted_at: number | null }
      | undefined;

  it('refuses to sign anyone up who hasn’t ticked the box', async () => {
    expect(await signUp(form({ username: 'holdout', agreedToTerms: false }), 'ip:holdout')).toEqual({ error: TERMS_REQUIRED });
    expect(termsRow('holdout')).toBeUndefined();
  });

  it('records the version and the time on sign-up, and the middleware’s lookup sees it', async () => {
    const before = Date.now();
    const res = await signUp(form(), 'ip:agreeable');
    if (!('user' in res)) throw new Error(res.error);
    expect(res.user.termsVersion).toBe(TERMS_VERSION);
    const row = termsRow('agreeable')!;
    expect(row.terms_version).toBe(TERMS_VERSION);
    expect(row.terms_accepted_at).toBeGreaterThanOrEqual(before);
    const { token } = createSession(res.user.id);
    expect(needsTerms(getSessionUser(token)!.user.termsVersion)).toBe(false);
  });

  it('still checks the invite code and the sign-up rate limit', async () => {
    process.env.SIGNUP_CODE = 'family';
    try {
      expect(await signUp(form({ username: 'nocode', signupCode: 'guess' }), 'ip:code')).toEqual({
        error: 'That family invite code isn’t right.',
      });
      expect('user' in (await signUp(form({ username: 'hascode', signupCode: 'family' }), 'ip:code'))).toBe(true);
      for (let i = 0; i < 18; i++) await signUp(form({ username: `spam${i}`, signupCode: 'guess' }), 'ip:code');
      const blocked = await signUp(form({ username: 'toolate', signupCode: 'family' }), 'ip:code');
      expect(blocked).toEqual({ error: 'Too many sign-up attempts. Please wait a few minutes and try again.' });
      expect(termsRow('toolate')).toBeUndefined();
    } finally {
      delete process.env.SIGNUP_CODE;
    }
  });

  it('asks people from before the terms once, and stops once they agree', async () => {
    const user = await createUser('oldtimer', 'Old Timer', 'long-enough-pw');
    expect(termsRow('oldtimer')).toEqual({ terms_version: null, terms_accepted_at: null });
    const { token } = createSession(user!.id);
    expect(needsTerms(getSessionUser(token)!.user.termsVersion)).toBe(true);

    acceptTerms(user!.id);
    expect(needsTerms(getSessionUser(token)!.user.termsVersion)).toBe(false);
    expect(termsRow('oldtimer')!.terms_accepted_at).toBeGreaterThan(0);

    // A newer version asks again.
    sql('UPDATE users SET terms_version = ? WHERE id = ?').run(TERMS_VERSION - 1, user!.id);
    expect(needsTerms(getSessionUser(token)!.user.termsVersion)).toBe(true);
    expect(needsTerms(TERMS_VERSION + 1)).toBe(false);
  });

  it('asks on page loads only, never on background calls or static files', () => {
    const pages = ['/', '/games', '/games/', '/games/abc123', '/games/abc123/scoreboard', '/stats', '/account', '/join/ABC123', '/admin'];
    for (const p of pages) expect(termsGatedPath(p), p).toBe(true);
    for (const p of [
      '/api/games/abc123/events',
      '/api/games/abc123/action',
      '/api/account/avatar',
      '/avatars/AAAAAAAAAAAAAAAAAAAAAA',
      '/healthz',
      '/logout',
      '/login',
      '/signup',
      '/reset/some-token',
      '/accept-terms',
      '/terms',
      '/terms/',
      '/privacy',
      '/rules',
      '/app',
      '/_astro/client.abc123.js',
      '/icons/icon-192.png',
      '/sw.js',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/robots.txt',
      '/apple-touch-icon.png',
    ]) {
      expect(termsGatedPath(p), p).toBe(false);
    }

    const page = (method: string, headers: Record<string, string>) => isPageLoad(method, new Headers(headers));
    expect(page('GET', { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' })).toBe(true);
    expect(page('GET', { accept: 'text/html,application/xhtml+xml' })).toBe(true); // older Safari sends no Sec-Fetch headers
    expect(page('POST', { 'sec-fetch-dest': 'document' })).toBe(false);
    expect(page('GET', { 'sec-fetch-dest': 'empty', accept: '*/*' })).toBe(false); // fetch()
    expect(page('GET', { 'sec-fetch-dest': 'empty', accept: 'text/event-stream' })).toBe(false); // the live stream
    expect(page('GET', { 'sec-fetch-dest': 'image', accept: 'image/webp,*/*' })).toBe(false);
    expect(page('GET', { accept: 'application/json' })).toBe(false);
  });
});
