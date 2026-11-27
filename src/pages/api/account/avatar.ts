import type { APIRoute } from 'astro';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, avatarSrc } from '../../../lib/avatars';
import { removeAvatar, saveAvatar } from '../../../lib/server/avatars';
import { publishPlayerChange } from '../../../lib/server/games';
import { jsonError } from '../../../lib/server/http';
import { takeAttempt } from '../../../lib/server/rate-limit';

/** Uploads per person per 15 minutes. Plenty for trying a few crops. */
const UPLOAD_LIMIT = 30;
const TOO_BIG = `That photo is too large. Photos can be up to ${Math.floor(AVATAR_MAX_BYTES / 1000)} KB.`;

const noStore = (res: Response) => {
  res.headers.set('Cache-Control', 'no-store');
  return res;
};

/**
 * Read at most `limit` bytes of the body. Returns null when there's more than that, or when the
 * stream fails (the server's own 64 KiB request cap ends it with an error).
 */
async function readCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Upload a new photo: the raw JPEG or WebP bytes as the body. The browser has already cropped it. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;
  if (!takeAttempt([{ key: `avatar:user:${user.id}`, limit: UPLOAD_LIMIT }])) {
    return noStore(jsonError('That’s a lot of new photos. Please wait a few minutes and try again.', 429));
  }
  // Only image types are accepted, which a plain HTML form can't send.
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!(AVATAR_TYPES as readonly string[]).includes(type)) {
    return noStore(jsonError('Photos need to be JPEG or WebP images.', 415));
  }
  const declared = Number(request.headers.get('content-length'));
  if (declared > AVATAR_MAX_BYTES) return noStore(jsonError(TOO_BIG, 413));

  const bytes = await readCapped(request, AVATAR_MAX_BYTES);
  if (!bytes) return noStore(jsonError(TOO_BIG, 413));
  if (!bytes.length) return noStore(jsonError('No photo was sent.', 400));

  const saved = saveAvatar(user.id, bytes);
  if ('error' in saved) return noStore(jsonError(saved.error, 400));
  publishPlayerChange(user.id);
  return noStore(Response.json({ avatar: avatarSrc(saved.id) }));
};

/** Remove the photo and go back to initials. */
export const DELETE: APIRoute = ({ locals }) => {
  const user = locals.user!;
  if (removeAvatar(user.id)) publishPlayerChange(user.id);
  return noStore(Response.json({ avatar: null }));
};
