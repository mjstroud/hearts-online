/**
 * Profile photos ("avatars"). Shared by the server, the pages and the browser-side photo editor.
 *
 * The browser crops and re-encodes every photo to a small square before uploading it, so the
 * server only ever stores a few tens of kilobytes per person, with no camera metadata.
 */

/** Width and height, in pixels, of the square the editor produces. Seats show it at 38px, so this covers 3x screens with room to spare. */
export const AVATAR_SIZE = 256;

/** Smallest and largest square side the server will store. */
export const AVATAR_MIN_SIDE = 32;
export const AVATAR_MAX_SIDE = 512;

/**
 * Largest upload, in bytes. The upload body is the raw image, so this stays under the server's
 * 64 KiB request limit (astro.config.mjs). A 256px photo is usually 10–30 KB.
 */
export const AVATAR_MAX_BYTES = 60_000;

/** Formats the editor sends and the server stores. */
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Avatar ids are 16 random bytes, base64url: unguessable, and new for every upload. */
export const AVATAR_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** Where the browser loads a photo from, or null when there isn't one. */
export function avatarSrc(id: string | null | undefined): string | null {
  return id && AVATAR_ID_RE.test(id) ? `/avatars/${id}` : null;
}

/** The upload and removal endpoint for the signed-in person's own photo. */
export const AVATAR_API = '/api/account/avatar';
