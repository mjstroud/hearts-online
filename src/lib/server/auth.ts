import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AstroCookies } from 'astro';
import { now, sql } from './db';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = 'hearts_session';
const SESSION_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface User {
  id: number;
  username: string;
  displayName: string;
  isBot: boolean;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string | null;
  is_bot: number;
}

const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, displayName: r.display_name, isBot: !!r.is_bot });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(key, expected);
}

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

export function validateSignup(username: string, displayName: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) return 'Usernames are 3–24 letters, numbers, dots, dashes or underscores.';
  if (!displayName || displayName.length > 32) return 'Display name must be 1–32 characters.';
  if (password.length < 8) return 'Passwords need at least 8 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export async function createUser(username: string, displayName: string, password: string): Promise<User | null> {
  if (sql('SELECT 1 FROM users WHERE username = ?').get(username)) return null;
  const hash = await hashPassword(password);
  try {
    const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      username,
      displayName,
      hash,
      now(),
    );
    return { id: Number(res.lastInsertRowid), username, displayName, isBot: false };
  } catch {
    return null; // lost a race for the same username
  }
}

// Dummy hash so failed lookups take as long as real ones.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export async function authenticate(username: string, password: string): Promise<User | null> {
  const row = sql('SELECT * FROM users WHERE username = ? AND is_bot = 0').get(username) as UserRow | undefined;
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  return ok && row ? toUser(row) : null;
}

export function getUser(id: number): User | null {
  const row = sql('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function updateDisplayName(userId: number, displayName: string) {
  sql('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
}

export async function changePassword(userId: number, current: string, next: string): Promise<string | null> {
  const row = sql('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!row?.password_hash || !(await verifyPassword(current, row.password_hash))) return 'Your current password is incorrect.';
  if (next.length < 8 || next.length > 200) return 'Passwords need at least 8 characters.';
  sql('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), userId);
  return null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(userId: number): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const expires = now() + SESSION_DAYS * DAY;
  sql('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);
  sql('DELETE FROM sessions WHERE expires_at < ?').run(now());
  return { token, expires: new Date(expires) };
}

/** Look up a session, sliding its expiry forward when it's getting old. */
export function getSessionUser(token: string): { user: User; renewed: Date | null } | null {
  const id = hashToken(token);
  const row = sql(
    'SELECT u.*, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
  ).get(id) as (UserRow & { expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    sql('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  let renewed: Date | null = null;
  if (row.expires_at - now() < (SESSION_DAYS / 2) * DAY) {
    const expires = now() + SESSION_DAYS * DAY;
    sql('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expires, id);
    renewed = new Date(expires);
  }
  return { user: toUser(row), renewed };
}

export function deleteSession(token: string) {
  sql('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

export function setSessionCookie(cookies: AstroCookies, token: string, expires: Date, secure: boolean) {
  cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires });
}

/**
 * Small in-memory rate limiter (fixed 15-minute windows). Attempts are counted
 * up front, before any slow password hashing, so parallel requests can't slip past.
 */
const WINDOW = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; until: number }>();

function prune() {
  if (attempts.size < 5000) return;
  const t = now();
  for (const [k, v] of attempts) if (v.until < t) attempts.delete(k);
}

/** Count an attempt for every key; returns false if any key is over its limit. */
export function takeAttempt(keys: { key: string; limit: number }[]): boolean {
  prune();
  const t = now();
  let ok = true;
  for (const { key, limit } of keys) {
    let a = attempts.get(key);
    if (!a || a.until < t) attempts.set(key, (a = { count: 0, until: t + WINDOW }));
    a.count += 1;
    if (a.count > limit) ok = false;
  }
  return ok;
}

export function clearAttempts(key: string) {
  attempts.delete(key);
}

/** If SIGNUP_CODE is set, new accounts need it (keeps the site family-only). */
export const signupCodeRequired = () => !!process.env.SIGNUP_CODE;
export function signupCodeValid(code: string): boolean {
  const expected = process.env.SIGNUP_CODE;
  if (!expected) return true;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(code.trim()), digest(expected));
}

/** Sign out every other session, e.g. after a password change. */
export function deleteOtherSessions(userId: number, keepToken: string | undefined) {
  sql('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepToken ? hashToken(keepToken) : '');
}
