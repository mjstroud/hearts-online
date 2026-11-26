import type { APIRoute } from 'astro';
import { isMember, publish } from '../../../../lib/server/games';
import { jsonError } from '../../../../lib/server/http';
import { subscribe } from '../../../../lib/server/hub';

// Tests run without the build's defines.
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Server-Sent Events stream: pushes this player's view whenever the game changes. */
export const GET: APIRoute = ({ params, locals, request }) => {
  const gameId = params.id!;
  const userId = locals.user!.id;
  if (!isMember(gameId, userId)) return jsonError('Game not found.', 404);

  const encoder = new TextEncoder();
  let cleanup = (_announce = true) => {};

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

      // The server hangs up after 'removed' or 'deleted'. Nobody else needs telling: this person is
      // no longer at the table (or there is no table).
      const unsubscribe = subscribe(gameId, { userId, send, close: () => cleanup(false) });
      const heartbeat = setInterval(() => write(': keep-alive\n\n'), 25_000);
      cleanup = (announce = true) => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (announce) publish(gameId); // update everyone's online indicators
      };
      request.signal.addEventListener('abort', () => cleanup());
      if (request.signal.aborted) return cleanup();

      write('retry: 3000\n\n');
      // Its own event rather than a view field, so old tabs simply ignore it.
      send('build', BUILD_ID);
      // One push does both: this stream's first state, and everyone else's online dot for us.
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
