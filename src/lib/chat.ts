/**
 * Table chat (Phase 4b): what the server and the browser agree on. Plain text, one line, kept 24 hours,
 * for the players seated at one game. Its history has its own endpoint and new messages their own
 * live-stream event (`chat`), so chat never goes through a game update.
 */

import { graphemes, normalizeDisplayName } from './names';

/** Longest message, counted the way people count characters (an emoji is one). */
export const CHAT_MAX = 280;

/** Backstop on raw length, and the input's maxlength, which browsers count in code units. */
export const CHAT_MAX_UNITS = CHAT_MAX * 4;

/** Messages are deleted (and left out of history) once they're this old. */
export const CHAT_KEEP_MS = 24 * 60 * 60 * 1000;

/** One page of history: at most this many messages. A family's evening of chat is far fewer. */
export const CHAT_HISTORY_MAX = 200;

/** A mild spam limit, per person: this many messages in this long. */
export const CHAT_BURST = { limit: 5, windowMs: 10_000 } as const;

/** The owner of a playtest table talking as its cats (one tap per line) gets a looser limit, but still one. */
export const CHAT_AS_BURST = { limit: 20, windowMs: 10_000 } as const;

/** A client's own id for one message, so its echo can be matched and a retry isn't stored twice. */
export const CHAT_CID = /^[\w.-]{1,32}$/;

/**
 * One message, as history and the live stream send it. Tabs stay open for days running old code, and a
 * future app will read it too, so only ever add fields; never rename or remove one.
 */
export interface ChatMessage {
  id: number;
  /** The sender's user id. */
  from: number;
  /** The sender's display name, now. Someone the host has removed keeps theirs here. */
  name: string;
  text: string;
  /** When the server took it, in ms since the epoch. */
  at: number;
  /**
   * The sending tab's id for it, so that tab can match its own echo. History includes it only on your own
   * messages; the live stream sends the same message to everyone, so it isn't private (it's a random id).
   */
  cid?: string;
}

/** What GET /api/games/:id/chat answers. */
export interface ChatHistory {
  /** Oldest first. */
  messages: ChatMessage[];
  /**
   * More messages than one page: with `after`, newer ones (ask again, after the last of these); without
   * it, older ones than these (the newest page comes first).
   */
  more: boolean;
  /** The server's clock, so a device whose clock is off still lets messages go at 24 hours. */
  now: number;
}

/** What POST /api/games/:id/chat takes. */
export interface ChatRequest {
  text: string;
  cid?: string;
}

/** One line, no control or invisible characters, single spaces, trimmed: the way display names are cleaned. */
export const cleanChat = (raw: string): string => normalizeDisplayName(raw);

/** Why a (cleaned) message can't be sent, or null if it's fine. */
export function chatError(text: string): string | null {
  // Something to read: a letter, number, symbol (emoji are symbols) or punctuation, not just a stray accent.
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(text)) return 'Type a message first.';
  if (text.length > CHAT_MAX_UNITS || graphemes(text).length > CHAT_MAX) return `Messages can be up to ${CHAT_MAX} characters.`;
  return null;
}
