/**
 * What every game page does with table chat (Phase 4b): merging what arrives, counting what's unread, and
 * where a new message also shows. Game.svelte loads this on every game page, so it stays small; sending,
 * and the sheet itself, load only when chat is opened (chat-send.svelte.ts, ChatSheet.svelte).
 */

import { CHAT_KEEP_MS, type ChatMessage } from './chat';
import type { GameStatus } from './types';

/**
 * Add what arrived (history, the live stream, or the answer to a send) to what the tab holds: one copy of
 * each, in the order the server took them, none older than 24 hours by the server's clock (`now`). Returns
 * the same list when nothing changed, so nothing redraws.
 */
export function mergeChat(list: readonly ChatMessage[], incoming: readonly ChatMessage[], now: number): readonly ChatMessage[] {
  const cutoff = now - CHAT_KEEP_MS;
  const kept = list.filter((m) => m.at >= cutoff);
  const have = new Set(kept.map((m) => m.id));
  const fresh: ChatMessage[] = [];
  for (const m of incoming) {
    if (m.at < cutoff || have.has(m.id)) continue;
    have.add(m.id);
    fresh.push(m);
  }
  if (!fresh.length && kept.length === list.length) return list;
  return [...kept, ...fresh].sort((a, b) => a.id - b.id);
}

/** Messages from everyone else newer than the last one this device read. */
export const unreadCount = (list: readonly ChatMessage[], me: number, readId: number): number =>
  list.reduce((n, m) => n + (m.id > readId && m.from !== me ? 1 : 0), 0);

/** The newest message's id, or 0: what `?after=` asks from. */
export const lastChatId = (list: readonly ChatMessage[]): number => list.at(-1)?.id ?? 0;

/**
 * Where chat opens beside the table, over the standings column, and the table stays playable: a wide
 * screen that isn't also short enough for the sideways layout. Anywhere else it covers the screen.
 */
export const CHAT_BESIDE = '(min-width: 1081px) and (min-height: 501px)';

/** What a screen needs for its chat button, and the table for the previews' mute switch. */
export interface ChatControls {
  unread: number;
  /** The sheet is open. */
  open: boolean;
  show: () => void;
  /** Start fetching the sheet's code (on the first touch, before the tap lands). */
  preload: () => void;
  muted: boolean;
  toggleMute: () => void;
}

/** A preview for the table to draw on its sender's avatar, numbered as it arrived here. */
export interface ChatShow {
  id: number;
  from: number;
  text: string;
  /** When it was handed to the table, on this device's clock. */
  at: number;
}

/** The tab as it is when a message arrives. */
export interface ChatTable {
  status: GameStatus;
  players: readonly { userId: number }[];
  /** Your own user id. */
  me: number;
  /** The previews are switched off on this device. */
  muted: boolean;
  /** The chat sheet is open, so the message is already in front of you. */
  open: boolean;
  /** The tab is out of sight. */
  hidden: boolean;
  /** The end of a hand, or its result, is on screen. */
  holding: boolean;
}

/**
 * Where a new message from someone else also shows, besides the sheet and the count: a preview on the
 * sender's avatar at the table (held through the end of a hand and its result, like a taunt), or a short
 * note in the waiting room and on the end screen, which have no avatars to put one on. Never while muted,
 * never while the sheet already shows it, and never for your own (you know what you said).
 */
export function routeChat(m: ChatMessage, t: ChatTable): 'drop' | 'hold' | 'show' | 'toast' {
  if (m.from === t.me || t.muted || t.open || t.hidden) return 'drop';
  if (t.status !== 'active') return 'toast';
  if (!t.players.some((p) => p.userId === m.from)) return 'drop';
  return t.holding ? 'hold' : 'show';
}

/** Only each person's newest of the held previews: a newer one would replace the older at once anyway. */
export function newestEach<T extends { m: ChatMessage }>(held: readonly T[]): T[] {
  return held.filter((h, i) => !held.slice(i + 1).some((later) => later.m.from === h.m.from));
}
