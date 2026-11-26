import type { APIRoute } from 'astro';
import { reviewHand } from '../../../../../lib/engine/review';
import { getHandRecord, isMember } from '../../../../../lib/server/games';
import { jsonError } from '../../../../../lib/server/http';
import { handNames } from '../../../../../lib/server/stats';

/** The trick review for one finished hand. Every trick in it was played face up, so any member may see it. */
export const GET: APIRoute = ({ params, locals }) => {
  const gameId = params.id!;
  // Same answer for "no such game" and "not your game", like the state endpoint.
  if (!isMember(gameId, locals.user!.id)) return jsonError('Game not found.', 404);
  const number = /^\d{1,9}$/.test(params.number ?? '') ? Number(params.number) : 0;
  const record = number > 0 ? getHandRecord(gameId, number) : null;
  // Only finished hands are on record, so a hand still being played is "not found" too.
  if (!record) return jsonError('Hand not found.', 404);
  // The names of the people who played this hand: a seat may have changed hands since.
  const review = { ...reviewHand(record), names: handNames(gameId, record) };
  return Response.json(review, { headers: { 'Cache-Control': 'no-store' } });
};
