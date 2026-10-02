import type { APIRoute } from 'astro';
import { getGameView, isMember, publish } from '../../../../lib/server/games';
import { jsonError } from '../../../../lib/server/http';
import { subscribe } from '../../../../lib/server/hub';

/** Server-Sent Events stream: pushes this player's view whenever the game changes. */
export const GET: APIRoute = ({ params, locals, request }) => {
  const gameId = params.id!;
  const userId = locals.user!.id;
  if (!isMember(gameId, userId)) return jsonError('Game not found.', 404);

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const unsubscribe = subscribe(gameId, { userId, send });
      const heartbeat = setInterval(() => write(': keep-alive\n\n'), 25_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        publish(gameId); // update everyone's online indicators
      };
      request.signal.addEventListener('abort', () => cleanup());
      if (request.signal.aborted) return cleanup();

      write('retry: 3000\n\n');
      send('state', getGameView(gameId, userId));
      publish(gameId);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
