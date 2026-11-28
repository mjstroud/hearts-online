import type { APIRoute } from 'astro';
import { CHAT_AS_BURST, CHAT_BURST, CHAT_CID, CHAT_MAX, CHAT_MAX_UNITS, type ChatRequest, chatError, cleanChat } from '../../../../lib/chat';
import { chatHistory, findChat, sendChat } from '../../../../lib/server/chat';
import { sql } from '../../../../lib/server/db';
import { getPlayers, isMember } from '../../../../lib/server/games';
import { jsonError, jsonTooSoon } from '../../../../lib/server/http';
import { rateLimit } from '../../../../lib/server/rate-limit';

/** Left out or null: a future app's JSON may send either. */
const given = (value: unknown) => value !== undefined && value !== null;

/**
 * This game's last 24 hours of chat, a page at a time, oldest first: `{ messages, more, now }` (ChatHistory
 * in src/lib/chat.ts). Without `?after=<id>`, the newest page; with it, the messages after that id, so a
 * tab that has the rest asks again while `more` is true. Tabs ask on load, on every reconnect and when they
 * come back into view, because the live stream doesn't replay what a tab missed.
 */
export const GET: APIRoute = ({ params, locals, url }) => {
  const gameId = params.id!;
  const userId = locals.user!.id;
  // Same answer for "no such game" and "not your game", like the state endpoint.
  if (!isMember(gameId, userId)) return jsonError('Game not found.', 404);
  const raw = url.searchParams.get('after');
  const after = raw === null ? 0 : Number(raw);
  if (!Number.isSafeInteger(after) || after < 0) return jsonError('Invalid request.');
  return Response.json(chatHistory(gameId, userId, after), { headers: { 'Cache-Control': 'no-store' } });
};

/**
 * Send a message to the table: `{ text, cid? }`, answered with `{ message }`. It's saved, then goes out
 * on the live stream to everyone seated, never through a game update. A retry with the same `cid` gets
 * the first one back. The owner of a playtest table may add `as` (a cat's user id) to talk as that cat.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const gameId = params.id!;
  const userId = locals.user!.id;
  if (!isMember(gameId, userId)) return jsonError('Game not found.', 404);

  let body: Partial<Record<keyof ChatRequest | 'as', unknown>>;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Invalid request.');

  // Who's seated is read again now: the host may have removed this person while the body arrived.
  const players = getPlayers(gameId);
  if (!players.some((p) => p.userId === userId)) return jsonError('Game not found.', 404);

  if (typeof body.text !== 'string') return jsonError('Type a message first.');
  // Far too long is refused before any cleaning: the box itself stops at this many.
  if (body.text.length > CHAT_MAX_UNITS) return jsonError(`Messages can be up to ${CHAT_MAX} characters.`);
  const text = cleanChat(body.text);
  const problem = chatError(text);
  if (problem) return jsonError(problem);

  let cid: string | undefined;
  if (given(body.cid)) {
    if (typeof body.cid !== 'string' || !CHAT_CID.test(body.cid)) return jsonError('Invalid request.');
    cid = body.cid;
  }

  // A playtest helper, so the owner can see how someone else's message looks at the table.
  let from = userId;
  if (given(body.as)) {
    const game = sql('SELECT mode, owner_id FROM games WHERE id = ?').get(gameId) as { mode: string; owner_id: number } | undefined;
    const cat = players.find((p) => p.isBot && p.userId === body.as);
    if (game?.mode !== 'playtest' || game.owner_id !== userId || !cat) {
      return jsonError('Only the owner of a playtest table can talk as one of its cats.');
    }
    from = cat.userId;
  }

  // A retry of one that's already saved costs nothing and sends nothing new.
  const again = cid ? findChat(gameId, from, cid) : null;
  if (again) return Response.json({ message: again });

  // The owner talking as a cat gets a looser limit of its own, so they can try one after another; every
  // message is still a row in the database.
  const burst = from === userId ? CHAT_BURST : CHAT_AS_BURST;
  const limit = rateLimit([{ key: from === userId ? `chat:${userId}` : `chat:as:${userId}`, ...burst }]);
  if (!limit.ok) {
    const wait = Math.min(limit.retryAfterMs, burst.windowMs);
    return jsonTooSoon(`Slow down a little: wait ${Math.ceil(wait / 1000)}s.`, wait);
  }

  const { message } = sendChat(gameId, from, text, cid);
  return Response.json({ message });
};
