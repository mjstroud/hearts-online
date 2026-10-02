import type { APIRoute } from 'astro';
import { getGameView, performAction, toGameError } from '../../../../lib/server/games';
import { jsonError } from '../../../../lib/server/http';
import type { GameAction } from '../../../../lib/types';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  let action: GameAction;
  try {
    action = await request.json();
  } catch {
    return jsonError('Invalid request.');
  }
  try {
    performAction(params.id!, user.id, action);
  } catch (err) {
    const e = toGameError(err);
    return jsonError(e.message, e.status);
  }
  return Response.json(getGameView(params.id!, user.id));
};
