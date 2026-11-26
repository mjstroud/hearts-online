import { randomBytes } from 'node:crypto';
import { AVATAR_ID_RE, AVATAR_MAX_BYTES, AVATAR_MAX_SIDE, AVATAR_MIN_SIDE, AVATAR_TYPES, type AvatarType } from '../avatars';
import { now, sql, transaction } from './db';

/**
 * Profile photo storage. The browser crops and re-encodes photos before uploading them, but the
 * server relies on none of that: it works out the format from the bytes themselves, parses the
 * file far enough to read its real size, strips metadata, and only then stores it.
 *
 * The size checks matter for everyone else at the table: a tiny file can claim to be 30000px
 * square, and every browser that showed it would try to set aside gigabytes to decode it.
 */

const ERRORS = {
  empty: 'That photo is empty.',
  tooBig: `That photo is too large. Photos can be up to ${Math.floor(AVATAR_MAX_BYTES / 1000)} KB.`,
  format: 'Photos need to be JPEG or WebP images.',
  broken: 'That photo couldn’t be read. Please try a different one.',
  animated: 'Animated images can’t be used as photos.',
  square: 'Photos need to be square.',
  side: `Photos need to be between ${AVATAR_MIN_SIDE} and ${AVATAR_MAX_SIDE} pixels across.`,
};

type Failure = { error: string };
const broken: Failure = { error: ERRORS.broken };

export interface AvatarInfo {
  type: AvatarType;
  width: number;
  height: number;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The format, judged from the first bytes only. */
function sniff(b: Uint8Array): AvatarType | null {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0) === 'RIFF' && ascii(b, 8) === 'WEBP') return 'image/webp';
  return null;
}

// ---------------------------------------------------------------------------
// JPEG: a run of marker segments, then entropy-coded scan data, ending with EOI (FF D9).

interface JpegLayout {
  width: number;
  height: number;
  /** Byte ranges of the metadata segments (EXIF, XMP, ICC, comments...). */
  metadata: [number, number][];
}

/** Start-of-frame markers: SOF0–3, 5–7, 9–11, 13–15 (C4, C8 and CC are other things). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/** APP0 (JFIF) and APP14 (Adobe) change how the picture decodes. Every other APPn, and COM, is metadata. */
const isJpegMetadata = (m: number) => (m >= 0xe1 && m <= 0xef && m !== 0xee) || m === 0xfe;

function readJpeg(b: Uint8Array): JpegLayout | Failure {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return broken;
  let frame: { width: number; height: number } | null = null;
  let scanning = false; // past the first SOS, where entropy-coded data sits between markers
  const metadata: [number, number][] = [];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      // Before the first scan, segments sit back to back.
      if (!scanning) return broken;
      i++;
      continue;
    }
    const start = i;
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return broken;
    const m = b[i++];
    if (m === 0x00) {
      // A stuffed FF byte, which only exists inside scan data.
      if (!scanning) return broken;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // TEM and RSTn stand alone
    if (m === 0xd9) {
      // EOI ends the image and must end the file, so nothing can ride along after it.
      return scanning && i === b.length ? { ...frame!, metadata } : broken;
    }
    if (m === 0xd8) return broken;
    if (i + 2 > b.length) return broken;
    const len = (b[i] << 8) | b[i + 1];
    const end = i + len;
    if (len < 2 || end > b.length) return broken;
    if (isSof(m)) {
      if (frame || len < 8) return broken;
      const height = (b[i + 3] << 8) | b[i + 4];
      const width = (b[i + 5] << 8) | b[i + 6];
      const components = b[i + 7];
      if (!width || !height || !components || len !== 8 + 3 * components) return broken;
      frame = { width, height };
    } else if (m === 0xda) {
      if (!frame) return broken;
      scanning = true;
    } else if (isJpegMetadata(m)) {
      metadata.push([start, end]);
    }
    i = end;
  }
  return broken; // cut off before EOI
}

// ---------------------------------------------------------------------------
// WebP: 'RIFF' <size> 'WEBP', then chunks (4-byte name, u32 size, data, a pad byte if the size is odd).

interface WebpChunk {
  fourcc: string;
  start: number;
  data: number;
  size: number;
  /** Where the next chunk starts (after any pad byte). */
  end: number;
}

interface WebpLayout {
  width: number;
  height: number;
  chunks: WebpChunk[];
  /** A VP8X file, which can carry metadata chunks. */
  extended: boolean;
}

/** The chunks that make up the picture. Everything else (EXIF, XMP, unknown) is dropped. */
const PICTURE_CHUNKS = new Set(['VP8X', 'ICCP', 'ALPH', 'VP8 ', 'VP8L']);
const VP8X_XMP = 0x04;
const VP8X_EXIF = 0x08;
const VP8X_ANIMATION = 0x02;

/** Width and height from a VP8 (lossy) or VP8L (lossless) bitstream header. */
function readFrame(b: Uint8Array, c: WebpChunk): { width: number; height: number } | null {
  const d = c.data;
  if (c.fourcc === 'VP8 ') {
    // A key frame (bit 0 clear), then the start code 9D 01 2A, then 14-bit width and height.
    if (c.size < 10 || b[d] & 1 || b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
  }
  if (c.fourcc === 'VP8L') {
    // Signature 0x2F, then width-1 and height-1 as 14-bit fields, an alpha bit and a 3-bit version (0).
    if (c.size < 5 || b[d] !== 0x2f) return null;
    const bits = u32le(b, d + 1);
    if (bits >>> 29 !== 0) return null;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readWebp(b: Uint8Array): WebpLayout | Failure {
  if (b.length < 12 || ascii(b, 0) !== 'RIFF' || ascii(b, 8) !== 'WEBP') return broken;
  if (u32le(b, 4) !== b.length - 8) return broken;
  const chunks: WebpChunk[] = [];
  for (let i = 12; i < b.length; ) {
    if (i + 8 > b.length) return broken;
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size & 1);
    if (end > b.length) return broken;
    chunks.push({ fourcc: ascii(b, i), start: i, data: i + 8, size, end });
    i = end;
  }
  if (chunks.some((c) => c.fourcc === 'ANIM' || c.fourcc === 'ANMF')) return { error: ERRORS.animated };

  const first = chunks[0];
  if (!first) return broken;
  if (first.fourcc === 'VP8 ' || first.fourcc === 'VP8L') {
    const frame = chunks.length === 1 ? readFrame(b, first) : null;
    return frame ? { ...frame, chunks, extended: false } : broken;
  }
  if (first.fourcc !== 'VP8X' || first.size < 10) return broken;
  if (b[first.data] & VP8X_ANIMATION) return { error: ERRORS.animated };
  const width = u24le(b, first.data + 4) + 1;
  const height = u24le(b, first.data + 7) + 1;
  // VP8X, then an optional ICC profile, optional alpha, then the image itself.
  let k = 1;
  if (chunks[k]?.fourcc === 'ICCP') k++;
  if (chunks[k]?.fourcc === 'ALPH') k++;
  const frame = chunks[k] ? readFrame(b, chunks[k]) : null;
  if (!frame || frame.width !== width || frame.height !== height) return broken;
  // Only metadata may follow the image: no second picture hiding behind the first.
  if (chunks.slice(k + 1).some((c) => PICTURE_CHUNKS.has(c.fourcc))) return broken;
  return { width, height, chunks, extended: true };
}

// ---------------------------------------------------------------------------

/**
 * Check an uploaded photo: JPEG or WebP (decided from the bytes, never from a declared type),
 * square, between AVATAR_MIN_SIDE and AVATAR_MAX_SIDE pixels, and at most AVATAR_MAX_BYTES.
 */
export function inspectAvatar(bytes: Uint8Array): AvatarInfo | Failure {
  if (!bytes.length) return { error: ERRORS.empty };
  if (bytes.length > AVATAR_MAX_BYTES) return { error: ERRORS.tooBig };
  const type = sniff(bytes);
  if (!type) return { error: ERRORS.format };
  const layout = type === 'image/jpeg' ? readJpeg(bytes) : readWebp(bytes);
  if ('error' in layout) return layout;
  const { width, height } = layout;
  if (width !== height) return { error: ERRORS.square };
  if (width < AVATAR_MIN_SIDE || width > AVATAR_MAX_SIDE) return { error: ERRORS.side };
  return { type, width, height };
}

/** Copy `b` without the given byte ranges (sorted, not overlapping). */
function without(b: Uint8Array, ranges: [number, number][]): Uint8Array {
  if (!ranges.length) return b;
  const out = new Uint8Array(b.length - ranges.reduce((n, [s, e]) => n + e - s, 0));
  let from = 0;
  let at = 0;
  for (const [s, e] of ranges) {
    out.set(b.subarray(from, s), at);
    at += s - from;
    from = e;
  }
  out.set(b.subarray(from), at);
  return out;
}

/**
 * The same picture with its metadata (camera EXIF, location, XMP, comments) removed.
 * Call inspectAvatar first: this throws if the bytes aren't a readable `type` image.
 */
export function sanitizeAvatar(bytes: Uint8Array, type: AvatarType): Uint8Array {
  if (type === 'image/jpeg') {
    const layout = readJpeg(bytes);
    if ('error' in layout) throw new Error('sanitizeAvatar: not a readable JPEG');
    // APP0, APP14, the tables, the frame and all the scan data stay; APP1–13, APP15 and COM go.
    return without(bytes, layout.metadata);
  }
  const layout = readWebp(bytes);
  if ('error' in layout) throw new Error('sanitizeAvatar: not a readable WebP');
  if (!layout.extended) return bytes; // a single VP8 or VP8L chunk has nowhere to keep metadata
  const keep = layout.chunks.filter((c) => PICTURE_CHUNKS.has(c.fourcc));
  const size = 12 + keep.reduce((n, c) => n + c.end - c.start, 0);
  const out = new Uint8Array(size);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, size - 8, true);
  let at = 12;
  for (const c of keep) {
    out.set(bytes.subarray(c.start, c.end), at);
    at += c.end - c.start;
  }
  // VP8X is always first, so its flags byte is at 20. The EXIF and XMP chunks are gone now.
  out[20] &= ~(VP8X_EXIF | VP8X_XMP);
  return out;
}

/** Check, clean and store someone's new photo, replacing any old one. Returns the new photo's id. */
export function saveAvatar(userId: number, bytes: Uint8Array): { id: string } | { error: string } {
  const info = inspectAvatar(bytes);
  if ('error' in info) return info;
  const clean = sanitizeAvatar(bytes, info.type);
  const id = randomBytes(16).toString('base64url');
  return transaction(() => {
    const user = sql('SELECT is_bot FROM users WHERE id = ?').get(userId) as { is_bot: number } | undefined;
    if (!user) return { error: 'That account no longer exists.' };
    if (user.is_bot) return { error: 'The cats don’t have photos.' };
    sql('INSERT INTO avatars (id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, info.type, clean, now());
    sql('UPDATE users SET avatar_id = ? WHERE id = ?').run(id, userId);
    sql('DELETE FROM avatars WHERE user_id = ? AND id != ?').run(userId, id);
    return { id };
  });
}

/** Go back to initials. Returns true if there was a photo to remove. */
export function removeAvatar(userId: number): boolean {
  return transaction(() => {
    const removed = sql('DELETE FROM avatars WHERE user_id = ?').run(userId);
    sql('UPDATE users SET avatar_id = NULL WHERE id = ?').run(userId);
    return Number(removed.changes) > 0;
  });
}

/** A stored photo by id, or null. */
export function loadAvatar(id: string): { type: AvatarType; data: Uint8Array<ArrayBuffer> } | null {
  if (typeof id !== 'string' || !AVATAR_ID_RE.test(id)) return null;
  const row = sql('SELECT type, data FROM avatars WHERE id = ?').get(id) as { type: string; data: Uint8Array<ArrayBuffer> } | undefined;
  if (!row || !(AVATAR_TYPES as readonly string[]).includes(row.type)) return null;
  return { type: row.type as AvatarType, data: row.data };
}
