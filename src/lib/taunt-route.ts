/**
 * What a tab does with a taunt (Phase 4a): one from the live stream, or the answer to one it sent.
 * Game.svelte loads this on every game page, so it stays small. Where the table draws a taunt is in
 * taunt-client.ts, which only loads with the layer.
 */

import type { PostResult } from './post-json';
import { type TauntEvent, tauntById } from './taunts';
import type { GameStatus } from './types';

/** A taunt held through the end of a hand, or its result, still plays afterwards if it's younger than this. */
export const HOLD_MS = 8000;

/** The table as this tab sees it when a taunt arrives. */
export interface TauntTable {
  status: GameStatus;
  players: readonly { userId: number }[];
  /** Your own user id. */
  me: number;
  /** The tab is out of sight. */
  hidden: boolean;
  /** The end of a hand, or its result, is on screen. */
  holding: boolean;
  /** This tab's own sends, by client id. An echo's id is taken out here, as it comes back. */
  sent: Set<string>;
}

/**
 * - `echo`: this tab sent it, and it already played when it was tapped.
 * - `drop`: not one to show here: a finished game, a tab out of sight (no pile to replay on return), a
 *   taunt newer than this tab's list, or a sender or target who isn't seated.
 * - `hold`: play it once the end of the hand and its result have cleared.
 * - `show`: play it now.
 */
export type TauntRoute = 'echo' | 'drop' | 'hold' | 'show';

/**
 * Where an incoming taunt goes. `cooldown` is true for one from your own other tab or device: the server
 * took it, so you can't taunt again from here yet either, whether or not this tab shows it.
 */
export function routeTaunt(ev: TauntEvent, t: TauntTable): { route: TauntRoute; cooldown: boolean } {
  // First, so an echo that lands while the tab is hidden still takes its id out.
  if (ev.cid && t.sent.delete(ev.cid)) return { route: 'echo', cooldown: false };
  const cooldown = ev.from === t.me;
  const seated = (id: unknown) => t.players.some((p) => p.userId === id);
  const taunt = tauntById(ev.taunt);
  if (!taunt || t.status !== 'active' || t.hidden || !seated(ev.from) || (taunt.kind === 'throw' && !seated(ev.to))) {
    return { route: 'drop', cooldown };
  }
  return { route: t.holding ? 'hold' : 'show', cooldown };
}

/** The held taunts to play once the end of a hand has cleared: only fresh ones, and none on a finished game or a hidden tab. */
export function dueHeld<T extends { at: number }>(held: readonly T[], now: number, t: Pick<TauntTable, 'status' | 'hidden'>): T[] {
  if (t.status !== 'active' || t.hidden) return [];
  return held.filter((h) => now - h.at < HOLD_MS);
}

/**
 * What the answer to a send means. `until` is when you may taunt again (null leaves the cooldown as it
 * is), `forget` drops the send's client id since no echo is coming, and `toast` is what to tell you.
 * A taunt that already played stays played either way.
 */
export function sendOutcome({ ok, status, data }: PostResult, sentAt: number, now: number): { until: number | null; forget: boolean; toast: string | null } {
  if (ok) return { until: typeof data.cooldownMs === 'number' ? sentAt + data.cooldownMs : null, forget: false, toast: null };
  // Timed out: it may have landed, and its echo may still come, so the id stays.
  if (!status) return { until: null, forget: false, toast: 'Network hiccup — please try again.' };
  const until = status === 429 && typeof data.retryAfterMs === 'number' ? now + data.retryAfterMs : null;
  return { until, forget: true, toast: data.error ?? 'Something went wrong.' };
}
