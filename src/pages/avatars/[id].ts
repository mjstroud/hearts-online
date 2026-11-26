import type { APIRoute } from 'astro';
import { loadAvatar } from '../../lib/server/avatars';

/**
 * A profile photo, for signed-in people only. Every upload gets a new random id, so a URL always
 * means the same picture and the browser can keep it forever.
 */
function serve(id: string | undefined, signedIn: boolean): Response {
  const plain = (message: string, status: number) =>
    new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!signedIn) return plain('Please sign in.', 401);
  const avatar = loadAvatar(id ?? '');
  if (!avatar) return plain('Not found.', 404);
  return new Response(avatar.data, {
    headers: {
      'Content-Type': avatar.type,
      'Content-Length': String(avatar.data.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Even opened directly, it's only ever a picture: no scripts, no styles, no requests.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': `inline; filename="avatar.${avatar.type === 'image/webp' ? 'webp' : 'jpg'}"`,
    },
  });
}

export const GET: APIRoute = ({ params, locals }) => serve(params.id, !!locals.user);

export const HEAD: APIRoute = ({ params, locals }) => {
  const res = serve(params.id, !!locals.user);
  return new Response(null, { status: res.status, headers: res.headers });
};
