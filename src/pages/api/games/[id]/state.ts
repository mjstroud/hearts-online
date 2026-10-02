import type { APIRoute } from 'astro';
import { getGameView } from '../../../../lib/server/games';
import { jsonError } from '../../../../lib/server/http';

export const GET: APIRoute = ({ params, locals }) => {
  const view = getGameView(params.id!, locals.user!.id);
  return view ? Response.json(view, { headers: { 'Cache-Control': 'no-store' } }) : jsonError('Game not found.', 404);
};
