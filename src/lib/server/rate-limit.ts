/**
 * Small in-memory rate limiter with fixed windows, 15 minutes long unless the caller picks another.
 * Attempts are counted up front, before any slow work such as password hashing, so parallel requests
 * can't slip past. The counts live on globalThis like the hub's, so a dev-server module reload doesn't
 * reset them. A restart does, which is fine.
 */

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
/** Hard ceiling on tracked keys, so a flood of distinct keys can't grow memory without bound. */
const MAX_KEYS = 10_000;

export interface AttemptKey {
  key: string;
  /** Attempts allowed in one window. */
  limit: number;
  /** How long a window lasts, in ms. 15 minutes if left out. */
  windowMs?: number;
}

export interface AttemptResult {
  ok: boolean;
  /** When refused, the ms until every key that refused it starts a fresh window. 0 when allowed. */
  retryAfterMs: number;
}

/** A window still counts at `until` itself, and is over from the next millisecond. */
interface Counter {
  count: number;
  until: number;
}

const g = globalThis as typeof globalThis & { __heartsAttempts?: Map<string, Counter> };
const attempts: Map<string, Counter> = (g.__heartsAttempts ??= new Map());

function prune(t: number) {
  if (attempts.size < MAX_KEYS / 2) return;
  for (const [k, v] of attempts) if (v.until < t) attempts.delete(k);
  // Still full of live windows? Drop the oldest first (a Map iterates in insertion order).
  for (const k of attempts.keys()) {
    if (attempts.size < MAX_KEYS) break;
    attempts.delete(k);
  }
}

/**
 * Count an attempt for every key, unless any key is already at its limit.
 * A refused attempt isn't counted, so a blocked client stops adding entries.
 */
export function rateLimit(keys: AttemptKey[]): AttemptResult {
  const t = Date.now();
  prune(t);
  const live = (key: string) => {
    const a = attempts.get(key);
    return a && a.until >= t ? a : undefined;
  };
  const full = keys.filter(({ key, limit }) => (live(key)?.count ?? 0) >= limit);
  if (full.length) {
    const until = Math.max(...full.map(({ key }) => live(key)?.until ?? t));
    return { ok: false, retryAfterMs: until + 1 - t };
  }
  for (const { key, windowMs = DEFAULT_WINDOW_MS } of keys) {
    let a = live(key);
    if (!a) attempts.set(key, (a = { count: 0, until: t + windowMs }));
    a.count += 1;
  }
  return { ok: true, retryAfterMs: 0 };
}

/** The same, for callers with no cooldown to show: true if the attempt is allowed. */
export const takeAttempt = (keys: AttemptKey[]): boolean => rateLimit(keys).ok;

/** Forget a key's count, e.g. once someone has signed in. */
export function clearAttempts(key: string) {
  attempts.delete(key);
}

/** For tests: how many keys the limiter is tracking. */
export const trackedAttemptKeys = () => attempts.size;
