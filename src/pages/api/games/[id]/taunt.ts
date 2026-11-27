import type { APIRoute } from 'astro';
import { catHit } from '../../../../lib/server/chatter';
import { sql } from '../../../../lib/server/db';
import { type SeatedPlayer, getPlayers } from '../../../../lib/server/games';
import { jsonError, jsonTooSoon } from '../../../../lib/server/http';
import { sendTaunt, takeTauntCooldown } from '../../../../lib/server/taunting';
import { TAUNT_CID, TAUNT_COOLDOWN_MS, type TauntEvent, type TauntRequest, tauntById } from '../../../../lib/taunts';
import type { GameStatus } from '../../../../lib/types';

/** Left out or null: a future app's JSON may send either. */
const given = (value: unknown) => value !== undefined && value !== null;

/**
 * Send a taunt: an emote on your own avatar, or a throw at someone else at the table. It goes out on
 * the live stream and nowhere else: no save, no version bump and never publish(), so /games keeps its
 * order. Every refusal comes before the cooldown, so a bad or stale tap never costs the 15s.
 * The owner of a playtest table may add `as` (a cat's user id) to send as that cat.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const gameId = params.id!;
  const userId = locals.user!.id;
  const players = getPlayers(gameId);
  // Same answer for "no such game" and "not your game", like the state endpoint.
  if (!players.some((p) => p.userId === userId)) return jsonError('Game not found.', 404);

  let body: Partial<Record<keyof TauntRequest | 'as', unknown>>;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Invalid request.');

  // Just these three: loadGame would parse the whole saved state.
  const game = sql('SELECT status, mode, owner_id FROM games WHERE id = ?').get(gameId) as
    | { status: GameStatus; mode: string; owner_id: number }
    | undefined;
  if (!game) return jsonError('Game not found.', 404);

  const taunt = tauntById(body.taunt);
  if (!taunt) return jsonError('That isn’t one of the taunts.');

  let cid: string | undefined;
  if (given(body.cid)) {
    if (typeof body.cid !== 'string' || !TAUNT_CID.test(body.cid)) return jsonError('Invalid request.');
    cid = body.cid;
  }

  // A playtest helper, so the owner can see how a cat's taunt looks without waiting for one.
  let from = userId;
  if (given(body.as)) {
    const cat = players.find((p) => p.isBot && p.userId === body.as);
    if (game.mode !== 'playtest' || game.owner_id !== userId || !cat) {
      return jsonError('Only the owner of a playtest table can send as one of its cats.');
    }
    from = cat.userId;
  }

  let target: SeatedPlayer | undefined;
  if (taunt.kind === 'emote') {
    if (given(body.to)) return jsonError('Emotes aren’t aimed at anyone.');
  } else {
    if (!Number.isInteger(body.to)) return jsonError('Pick someone to throw it at.');
    // Looked up now, so a tray left open on someone just taken out of the game misses.
    target = players.find((p) => p.userId === body.to);
    if (!target) return jsonError('They aren’t at this table.');
    if (target.userId === from) return jsonError('Throw it at someone else.');
  }

  // Never in the waiting room or on the end screen.
  if (game.status !== 'active') return jsonError('Taunts are for the table during play.', 409);

  // The owner testing as a cat skips the cooldown, so they can try one after another.
  const dev = from !== userId;
  if (!dev) {
    const cooldown = takeTauntCooldown(gameId, from);
    if (!cooldown.ok) {
      // The limiter counts its window's last millisecond too; never ask for more than the 15s.
      const wait = Math.min(cooldown.retryAfterMs, TAUNT_COOLDOWN_MS);
      return jsonTooSoon(`Wait ${Math.ceil(wait / 1000)}s for the next taunt.`, wait);
    }
  }

  const event: TauntEvent = { taunt: taunt.id, from, to: target?.userId ?? null, ...(cid ? { cid } : {}) };
  sendTaunt(gameId, event);
  // A cat that's hit may answer. That's the chatter's business, and it never stops the throw.
  if (target?.isBot) {
    try {
      catHit(gameId, target.userId, from, taunt.id);
    } catch (err) {
      console.error('A cat failed to answer a throw', err);
    }
  }
  return Response.json({ ok: true, cooldownMs: dev ? 0 : TAUNT_COOLDOWN_MS });
};
