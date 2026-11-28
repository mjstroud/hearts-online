/**
 * Table chat (Phase 4b). Messages belong to one game: only its seated players read or send them, a
 * rematch starts empty, and nobody deletes one by hand. Each is kept 24 hours: it's left out of history
 * from then on, and deleted the next time anyone sends a message or reads a chat (reads check at most
 * every few minutes), so there's no background job. Chat never goes through publish() or saveGame: no
 * version bump, and /games keeps its order.
 */

import { CHAT_HISTORY_MAX, CHAT_KEEP_MS, type ChatHistory, type ChatMessage } from '../chat';
import { now, sql, transaction } from './db';
import { sendToSeated } from './games';

interface Row {
  id: number;
  user_id: number;
  display_name: string;
  body: string;
  cid: string | null;
  created_at: number;
}

const COLUMNS = 'm.id, m.user_id, u.display_name, m.body, m.cid, m.created_at FROM chat_messages m JOIN users u ON u.id = m.user_id';

const toMessage = (r: Row, viewerId: number | null): ChatMessage => ({
  id: r.id,
  from: r.user_id,
  name: r.display_name,
  text: r.body,
  at: r.created_at,
  // Only the sender's own tabs need it, to match a message they're still showing as sending.
  ...(r.cid && (viewerId === null || r.user_id === viewerId) ? { cid: r.cid } : {}),
});

/** How often reading a chat also clears out old messages. Sending always does. */
const PRUNE_EVERY_MS = 5 * 60 * 1000;
const g = globalThis as typeof globalThis & { __heartsChatPruned?: number };

/** Delete every game's messages older than 24 hours. */
function prune(t: number) {
  sql('DELETE FROM chat_messages WHERE created_at < ?').run(t - CHAT_KEEP_MS);
  g.__heartsChatPruned = t;
}

/**
 * A page of a game's last 24 hours of chat, oldest first. With `after`, the messages newer than that id
 * (a tab that has the rest), from the oldest of them; without, the newest page. Callers check membership.
 */
export function chatHistory(gameId: string, viewerId: number, after = 0): ChatHistory {
  const t = now();
  // The first read after a restart prunes too.
  if (t - (g.__heartsChatPruned ?? 0) > PRUNE_EVERY_MS) prune(t);
  const since = t - CHAT_KEEP_MS;
  // One more than a page, to know whether there's more.
  const rows = (
    after > 0
      ? sql(`SELECT ${COLUMNS} WHERE m.game_id = ? AND m.id > ? AND m.created_at >= ? ORDER BY m.id LIMIT ?`).all(gameId, after, since, CHAT_HISTORY_MAX + 1)
      : sql(`SELECT ${COLUMNS} WHERE m.game_id = ? AND m.created_at >= ? ORDER BY m.id DESC LIMIT ?`).all(gameId, since, CHAT_HISTORY_MAX + 1)
  ) as unknown as Row[];
  const more = rows.length > CHAT_HISTORY_MAX;
  const page = rows.slice(0, CHAT_HISTORY_MAX);
  if (after <= 0) page.reverse();
  return { messages: page.map((r) => toMessage(r, viewerId)), more, now: t };
}

/** A message this person already sent with this client id, still within its 24 hours: a retry after a timeout. */
export function findChat(gameId: string, fromId: number, cid: string): ChatMessage | null {
  const row = sql(`SELECT ${COLUMNS} WHERE m.game_id = ? AND m.user_id = ? AND m.cid = ? AND m.created_at >= ?`).get(
    gameId,
    fromId,
    cid,
    now() - CHAT_KEEP_MS,
  ) as unknown as Row | undefined;
  return row ? toMessage(row, fromId) : null;
}

/**
 * Save a message (already cleaned and checked) and send it to every seated player's open streams.
 * A retry with a client id that's already saved gets the same message back and sends nothing.
 */
export function sendChat(gameId: string, fromId: number, text: string, cid?: string): { message: ChatMessage; created: boolean } {
  const result = transaction(() => {
    const t = now();
    // First, so an old message with the same client id is gone and can't block this one.
    prune(t);
    const existing = cid ? findChat(gameId, fromId, cid) : null;
    if (existing) return { message: existing, created: false };
    const res = sql('INSERT INTO chat_messages (game_id, user_id, body, cid, created_at) VALUES (?, ?, ?, ?, ?)').run(gameId, fromId, text, cid ?? null, t);
    const row = sql('SELECT display_name FROM users WHERE id = ?').get(fromId) as { display_name: string };
    const message: ChatMessage = { id: Number(res.lastInsertRowid), from: fromId, name: row.display_name, text, at: t, ...(cid ? { cid } : {}) };
    return { message, created: true };
  });
  // After the commit, so nobody hears of a message that isn't saved. Never throws.
  if (result.created) sendToSeated(gameId, 'chat', result.message);
  return result;
}
