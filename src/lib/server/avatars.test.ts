import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { APIContext } from 'astro';
import { describe, expect, it, vi } from 'vitest';

// A throwaway database, set before the server modules open it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-avatar-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const { sql } = await import('./db');
const { inspectAvatar, loadAvatar, removeAvatar, sanitizeAvatar, saveAvatar } = await import('./avatars');
const { getUser } = await import('./auth');
const { createGame, getGameView, joinGame, listGamesForUser, performAction, publishPlayerChange } = await import('./games');
const { subscribe } = await import('./hub');
const { normalizeSettings } = await import('../engine/rules');
const { AVATAR_ID_RE, AVATAR_MAX_BYTES } = await import('../avatars');
const avatarApi = await import('../../pages/api/account/avatar');
const avatarRoute = await import('../../pages/avatars/[id]');

// ---------------------------------------------------------------------------
// Tiny image builders. The bytes only need to be structurally right: nothing here decodes pixels.

const text = (s: string) => [...Buffer.from(s, 'latin1')];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const has = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));

/** A JPEG marker segment: FF, marker, 2-byte big-endian length (including itself), payload. */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 255, ...payload];
}

interface JpegOptions {
  width?: number;
  height?: number;
  progressive?: boolean;
  exif?: boolean;
  comment?: boolean;
  sof?: boolean;
  /** Extra APP segment bytes, to make a file of a given size. */
  padding?: number;
}

/** Entropy-coded scan data, with a stuffed FF 00 and a restart marker in it. */
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a];

function jpeg(o: JpegOptions = {}): Uint8Array {
  const w = o.width ?? 256;
  const h = o.height ?? w;
  const out: number[] = [0xff, 0xd8];
  out.push(...seg(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (o.exif) out.push(...seg(0xe1, [...text('Exif\0\0'), ...text('GPS 51.5N 0.1W iPhone')]));
  if (o.comment) out.push(...seg(0xfe, text('Taken at the lake house')));
  if (o.padding) out.push(...seg(0xe2, Array(o.padding).fill(0x41)));
  out.push(...seg(0xdb, [0x00, ...Array(64).fill(1)])); // DQT
  if (o.sof !== false) out.push(...seg(o.progressive ? 0xc2 : 0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]));
  out.push(...seg(0xc4, [0x00, 1, ...Array(15).fill(0), 0])); // DHT
  if (o.progressive) {
    out.push(...seg(0xda, [1, 1, 0x00, 0, 0, 0]), ...SCAN); // DC scan
    if (o.comment) out.push(...seg(0xfe, text('between scans')));
    out.push(...seg(0xc4, [0x10, 1, ...Array(15).fill(0), 0])); // AC table for the next scan
    out.push(...seg(0xda, [1, 1, 0x00, 1, 63, 0]), ...SCAN); // AC scan
  } else {
    out.push(...seg(0xda, [1, 1, 0x00, 0, 63, 0]), ...SCAN);
  }
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

/** A RIFF chunk: fourcc, u32 LE size, data, and a pad byte when the size is odd. */
function chunk(fourcc: string, data: number[]): number[] {
  return [...text(fourcc), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
}

function riff(chunks: number[][], sizeAdjust = 0): Uint8Array {
  const body = [...text('WEBP'), ...chunks.flat()];
  return bytes(text('RIFF'), u32le(body.length + sizeAdjust), body);
}

/** Lossy: key-frame tag, start code 9D 01 2A, 14-bit width and height, a little "data" (odd length, so padded). */
const vp8 = (w: number, h = w) => chunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f, 1, 2, 3]);
/** Lossless: signature 0x2F, then width-1 and height-1 packed in 14 bits each. */
const vp8l = (w: number, h = w) => chunk('VP8L', [0x2f, ...u32le(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)), 0, 0]);
const vp8x = (w: number, h = w, flags = 0) => chunk('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const ICCP = chunk('ICCP', text('fake icc profile'));
const ALPH = chunk('ALPH', [0, 1, 2]);
const EXIF = chunk('EXIF', text('Exif\0\0GPS 51.5N'));
const XMP = chunk('XMP ', text('<x:xmpmeta>secret</x:xmpmeta>'));
const FLAG_ICC = 0x20;
const FLAG_ALPHA = 0x10;
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;

const ok = (b: Uint8Array) => inspectAvatar(b);
const err = (b: Uint8Array) => {
  const res = inspectAvatar(b);
  return 'error' in res ? res.error : null;
};

// ---------------------------------------------------------------------------

describe('inspectAvatar', () => {
  it('accepts baseline and progressive JPEGs', () => {
    expect(ok(jpeg())).toEqual({ type: 'image/jpeg', width: 256, height: 256 });
    expect(ok(jpeg({ progressive: true, width: 128 }))).toEqual({ type: 'image/jpeg', width: 128, height: 128 });
    expect(ok(jpeg({ width: 32 }))).toMatchObject({ width: 32 });
    expect(ok(jpeg({ width: 512 }))).toMatchObject({ width: 512 });
  });

  it('accepts lossy, lossless and extended WebPs', () => {
    expect(ok(riff([vp8(256)]))).toEqual({ type: 'image/webp', width: 256, height: 256 });
    expect(ok(riff([vp8l(200)]))).toEqual({ type: 'image/webp', width: 200, height: 200 });
    expect(ok(riff([vp8x(256, 256, FLAG_ALPHA), ALPH, vp8(256)]))).toEqual({ type: 'image/webp', width: 256, height: 256 });
    expect(ok(riff([vp8x(64, 64, FLAG_ICC), ICCP, vp8l(64)]))).toMatchObject({ width: 64 });
    expect(ok(riff([vp8x(64, 64, FLAG_EXIF | FLAG_XMP), vp8(64), EXIF, XMP]))).toMatchObject({ width: 64 });
  });

  it('goes by the bytes, not the name: other formats are refused', () => {
    const format = 'Photos need to be JPEG or WebP images.';
    expect(err(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], text('IHDR'), u32le(0), u32le(0)))).toBe(format);
    expect(err(bytes(text('GIF89a'), [0, 1, 0, 1, 0, 0, 0], text(';')))).toBe(format);
    expect(err(bytes(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).toBe(format);
    expect(err(bytes(text('<!doctype html><html><script>alert(1)</script></html>')))).toBe(format);
    expect(err(bytes(text('RIFF'), u32le(4), text('WAVE')))).toBe(format);
    expect(err(new Uint8Array(0))).toBe('That photo is empty.');
  });

  it('refuses broken JPEGs', () => {
    const broken = /couldn’t be read/;
    const good = jpeg();
    expect(err(good.subarray(0, good.length - 2))).toMatch(broken); // no EOI
    expect(err(good.subarray(0, 30))).toMatch(broken); // cut off inside a segment
    expect(err(bytes([0xff, 0xd8]))).toMatch(broken);
    expect(err(bytes([0xff, 0xd8, 0xff, 0xd9]))).toMatch(broken);
    expect(err(jpeg({ sof: false }))).toMatch(broken);
    expect(err(jpeg({ width: 0 }))).toMatch(broken);
    // A second frame header.
    const sof = seg(0xc0, [8, 1, 0, 1, 0, 1, 1, 0x11, 0]);
    expect(err(bytes([...good.subarray(0, 2)], sof, [...good.subarray(2)]))).toMatch(broken);
    // Garbage between segments, before any scan.
    expect(err(bytes([...good.subarray(0, 2)], [0x00, 0x00], [...good.subarray(2)]))).toMatch(broken);
  });

  it('refuses anything riding along after the end of a JPEG', () => {
    const broken = /couldn’t be read/;
    expect(err(bytes([...jpeg()], text('<script>alert(1)</script>')))).toMatch(broken);
    expect(err(bytes([...jpeg()], [0x00]))).toMatch(broken);
    // Even when the extra bytes end with their own EOI.
    expect(err(bytes([...jpeg()], text('<html>'), [0xff, 0xd9]))).toMatch(broken);
  });

  it('only takes squares within the size limits', () => {
    expect(err(jpeg({ width: 256, height: 200 }))).toBe('Photos need to be square.');
    expect(err(riff([vp8(256, 255)]))).toBe('Photos need to be square.');
    expect(err(jpeg({ width: 31 }))).toMatch(/between 32 and 512 pixels/);
    expect(err(jpeg({ width: 513 }))).toMatch(/between 32 and 512 pixels/);
    expect(err(riff([vp8l(31)]))).toMatch(/between 32 and 512 pixels/);
    expect(err(riff([vp8(513)]))).toMatch(/between 32 and 512 pixels/);
    // A few hundred bytes claiming to be enormous: every browser at the table would try to decode it.
    const huge = jpeg({ width: 30000 });
    expect(huge.length).toBeLessThan(400);
    expect(err(huge)).toMatch(/between 32 and 512 pixels/);
    expect(err(riff([vp8(16383)]))).toMatch(/between 32 and 512 pixels/);
  });

  it('refuses files over the size limit before parsing them', () => {
    const big = jpeg({ padding: AVATAR_MAX_BYTES });
    expect(big.length).toBeGreaterThan(AVATAR_MAX_BYTES);
    expect(err(big)).toMatch(/too large/);
    const justUnder = jpeg({ padding: AVATAR_MAX_BYTES - 400 });
    expect(justUnder.length).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
    expect(err(justUnder)).toBeNull();
  });

  it('refuses broken WebPs', () => {
    const broken = /couldn’t be read/;
    expect(err(riff([vp8(256)], 2))).toMatch(broken); // RIFF size too big
    expect(err(riff([vp8(256)], -2))).toMatch(broken); // RIFF size too small
    // Trailing bytes, outside the RIFF size and inside it.
    expect(err(bytes([...riff([vp8(256)])], [1, 2]))).toMatch(broken);
    expect(err(riff([vp8(256), [1, 2]]))).toMatch(broken);
    // A chunk that claims more data than there is.
    const short = riff([vp8(256)]);
    short.set(u32le(200), 16);
    expect(err(short)).toMatch(broken);
    // Bad VP8 start code and VP8L signature.
    const badCode = riff([vp8(256)]);
    badCode[20 + 3] = 0x00;
    expect(err(badCode)).toMatch(broken);
    const badSig = riff([vp8l(256)]);
    badSig[20] = 0x00;
    expect(err(badSig)).toMatch(broken);
    // Two pictures, or one that isn't where it should be.
    expect(err(riff([vp8(256), vp8(256)]))).toMatch(broken);
    expect(err(riff([vp8x(256), vp8(256), vp8l(256)]))).toMatch(broken);
    expect(err(riff([vp8x(256), EXIF, vp8(256)]))).toMatch(broken);
    expect(err(riff([vp8x(256)]))).toMatch(broken);
    expect(err(riff([]))).toMatch(broken);
  });

  it('refuses a VP8X canvas that doesn’t match its image', () => {
    expect(err(riff([vp8x(512), vp8(256)]))).toMatch(/couldn’t be read/);
    expect(err(riff([vp8x(30000), vp8l(256)]))).toMatch(/couldn’t be read/);
  });

  it('refuses animations', () => {
    const animated = 'Animated images can’t be used as photos.';
    expect(err(riff([vp8x(256, 256, 0x02), vp8(256)]))).toBe(animated);
    expect(err(riff([vp8x(256), chunk('ANIM', [0, 0, 0, 0, 0, 0]), vp8(256)]))).toBe(animated);
    expect(err(riff([vp8x(256), chunk('ANMF', Array(16).fill(0))]))).toBe(animated);
  });
});

describe('sanitizeAvatar', () => {
  it('strips EXIF and comments from a JPEG and keeps the picture', () => {
    const dirty = jpeg({ exif: true, comment: true });
    expect(has(dirty, 'Exif')).toBe(true);
    const clean = sanitizeAvatar(dirty, 'image/jpeg');
    expect(has(clean, 'Exif')).toBe(false);
    expect(has(clean, 'lake house')).toBe(false);
    expect(has(clean, 'JFIF')).toBe(true);
    expect(Buffer.from(clean).equals(Buffer.from(jpeg()))).toBe(true);
    expect(ok(clean)).toEqual({ type: 'image/jpeg', width: 256, height: 256 });
  });

  it('strips comments between the scans of a progressive JPEG', () => {
    const clean = sanitizeAvatar(jpeg({ progressive: true, comment: true, exif: true }), 'image/jpeg');
    expect(has(clean, 'between scans')).toBe(false);
    expect(Buffer.from(clean).equals(Buffer.from(jpeg({ progressive: true })))).toBe(true);
    expect(ok(clean)).toMatchObject({ width: 256 });
  });

  it('leaves a clean JPEG and a simple WebP as they are', () => {
    const plain = jpeg();
    expect(Buffer.from(sanitizeAvatar(plain, 'image/jpeg')).equals(Buffer.from(plain))).toBe(true);
    const simple = riff([vp8(256)]);
    expect(Buffer.from(sanitizeAvatar(simple, 'image/webp')).equals(Buffer.from(simple))).toBe(true);
  });

  it('drops EXIF, XMP and unknown chunks from an extended WebP and fixes the header', () => {
    const flags = FLAG_ICC | FLAG_ALPHA | FLAG_EXIF | FLAG_XMP;
    const dirty = riff([vp8x(256, 256, flags), ICCP, ALPH, vp8(256), EXIF, XMP, chunk('ZZZZ', [1, 2, 3, 4])]);
    expect(ok(dirty)).toMatchObject({ width: 256 });
    const clean = sanitizeAvatar(dirty, 'image/webp');
    expect(has(clean, 'EXIF')).toBe(false);
    expect(has(clean, 'XMP ')).toBe(false);
    expect(has(clean, 'ZZZZ')).toBe(false);
    expect(clean[20]).toBe(FLAG_ICC | FLAG_ALPHA);
    expect(Buffer.from(clean).readUInt32LE(4)).toBe(clean.length - 8);
    expect(Buffer.from(clean).equals(Buffer.from(riff([vp8x(256, 256, FLAG_ICC | FLAG_ALPHA), ICCP, ALPH, vp8(256)])))).toBe(true);
    expect(ok(clean)).toEqual({ type: 'image/webp', width: 256, height: 256 });
  });

  it('throws on bytes that never passed inspection', () => {
    expect(() => sanitizeAvatar(bytes(text('<html>')), 'image/jpeg')).toThrow();
    expect(() => sanitizeAvatar(jpeg(), 'image/webp')).toThrow();
  });
});

// ---------------------------------------------------------------------------

let userCount = 0;
function addUser(): number {
  const name = `person${++userCount}`;
  const res = sql('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, NULL, ?)').run(name, name, Date.now());
  return Number(res.lastInsertRowid);
}
const avatarColumn = (userId: number) => (sql('SELECT avatar_id FROM users WHERE id = ?').get(userId) as { avatar_id: string | null }).avatar_id;
const avatarRows = (userId: number) => (sql('SELECT COUNT(*) AS n FROM avatars WHERE user_id = ?').get(userId) as { n: number }).n;
const catId = () => (sql('SELECT id FROM users WHERE is_bot = 1 ORDER BY id LIMIT 1').get() as { id: number }).id;
const saved = (res: ReturnType<typeof saveAvatar>) => {
  if ('error' in res) throw new Error(res.error);
  return res.id;
};

describe('storage', () => {
  it('saves a cleaned photo and points the account at it', () => {
    const user = addUser();
    const id = saved(saveAvatar(user, jpeg({ exif: true })));
    expect(id).toMatch(AVATAR_ID_RE);
    expect(avatarColumn(user)).toBe(id);
    expect(getUser(user)!.avatarId).toBe(id);
    const stored = loadAvatar(id)!;
    expect(stored.type).toBe('image/jpeg');
    expect(Buffer.from(stored.data).equals(Buffer.from(jpeg()))).toBe(true);
  });

  it('replaces the old photo with a new id', () => {
    const user = addUser();
    const first = saved(saveAvatar(user, jpeg()));
    const second = saved(saveAvatar(user, riff([vp8(256)])));
    expect(second).not.toBe(first);
    expect(loadAvatar(first)).toBeNull();
    expect(loadAvatar(second)!.type).toBe('image/webp');
    expect(avatarRows(user)).toBe(1);
  });

  it('removes a photo', () => {
    const user = addUser();
    const id = saved(saveAvatar(user, jpeg()));
    expect(removeAvatar(user)).toBe(true);
    expect(avatarColumn(user)).toBeNull();
    expect(avatarRows(user)).toBe(0);
    expect(loadAvatar(id)).toBeNull();
    expect(removeAvatar(user)).toBe(false);
  });

  it('refuses the cats, unknown accounts and bad images', () => {
    expect(saveAvatar(catId(), jpeg())).toEqual({ error: expect.any(String) });
    expect(avatarRows(catId())).toBe(0);
    expect(saveAvatar(999_999, jpeg())).toEqual({ error: expect.any(String) });
    const user = addUser();
    expect(saveAvatar(user, bytes(text('<svg/>')))).toEqual({ error: 'Photos need to be JPEG or WebP images.' });
    expect(avatarColumn(user)).toBeNull();
    expect(avatarRows(user)).toBe(0);
  });

  it('only looks up well-formed ids', () => {
    expect(loadAvatar('')).toBeNull();
    expect(loadAvatar('short')).toBeNull();
    expect(loadAvatar('../../../../etc/passwd')).toBeNull();
    expect(loadAvatar("' OR 1=1 --aaaaaaaaaaaa")).toBeNull();
    expect(loadAvatar('A'.repeat(22))).toBeNull();
  });

  it('brings a connection kept across a dev-server reload up to date', async () => {
    // The dev server keeps one connection on globalThis while it reloads modules, so one opened by
    // older code has to be migrated when the new db.ts loads, not only when a connection is opened.
    const g = globalThis as { __heartsDb?: DatabaseSync; __heartsStmts?: Map<string, unknown> };
    const kept = { db: g.__heartsDb, stmts: g.__heartsStmts };
    const old = new DatabaseSync(':memory:');
    g.__heartsDb = old;
    g.__heartsStmts = new Map();
    try {
      vi.resetModules();
      const reloaded = await import('./db');
      expect(reloaded.db).toBe(old);
      expect(old.prepare('SELECT COUNT(*) AS n FROM users WHERE avatar_id IS NOT NULL').get()).toEqual({ n: 0 });
      expect(old.prepare('SELECT COUNT(*) AS n FROM avatars').get()).toEqual({ n: 0 });
    } finally {
      g.__heartsDb = kept.db;
      g.__heartsStmts = kept.stmts;
      old.close();
    }
  });
});

describe('game views', () => {
  it('shows people’s photos, initials for everyone else, and never a photo for a cat', () => {
    const alice = addUser();
    const bob = addUser();
    const id = createGame(alice, 'Photo table', normalizeSettings({}));
    joinGame(id, bob);
    performAction(id, alice, { type: 'addBot' });
    const photo = saved(saveAvatar(alice, jpeg()));

    // Even a cat with a stray avatar_id shows the cat.
    const view = getGameView(id, bob)!;
    const cat = view.players.find((p) => p.isBot)!;
    sql('UPDATE users SET avatar_id = ? WHERE id = ?').run(photo, cat.userId);
    try {
      const players = getGameView(id, bob)!.players;
      expect(players.map((p) => p.avatar)).toEqual([`/avatars/${photo}`, null, null]);
      expect(listGamesForUser(bob).find((g) => g.id === id)!.players.map((p) => p.avatar)).toEqual([`/avatars/${photo}`, null, null]);
    } finally {
      sql('UPDATE users SET avatar_id = NULL WHERE id = ?').run(cat.userId);
    }
  });

  it('pushes the new photo to everyone at the person’s live tables', () => {
    const alice = addUser();
    const bob = addUser();
    const id = createGame(alice, 'Live table', normalizeSettings({}));
    joinGame(id, bob);
    const sent: { event: string; data: any }[] = [];
    const unsubscribe = subscribe(id, { userId: bob, send: (event, data) => sent.push({ event, data }) });
    try {
      const photo = saved(saveAvatar(alice, jpeg()));
      publishPlayerChange(alice);
      expect(sent.at(-1)!.event).toBe('state');
      expect(sent.at(-1)!.data.players[0].avatar).toBe(`/avatars/${photo}`);
      expect(() => publishPlayerChange(999_999)).not.toThrow();
    } finally {
      unsubscribe();
    }
  });
});

// ---------------------------------------------------------------------------
// The routes themselves, called with just the parts of the context they use.

const URL_BASE = 'http://localhost:4321';
function context(userId: number | null, request: Request, params: Record<string, string> = {}): APIContext {
  return { request, params, locals: { user: userId === null ? null : getUser(userId) } } as unknown as APIContext;
}
function upload(userId: number, body: Uint8Array | ReadableStream<Uint8Array> | null, headers: Record<string, string> = { 'content-type': 'image/jpeg' }) {
  const init: RequestInit & { duplex?: 'half' } = { method: 'POST', body: body as BodyInit | null, headers };
  if (body instanceof ReadableStream) init.duplex = 'half';
  return avatarApi.POST(context(userId, new Request(`${URL_BASE}/api/account/avatar`, init)));
}
const remove = (userId: number) => avatarApi.DELETE(context(userId, new Request(`${URL_BASE}/api/account/avatar`, { method: 'DELETE' })));
const fetchPhoto = (userId: number | null, src: string, method: 'GET' | 'HEAD' = 'GET') => {
  const id = src.replace('/avatars/', '');
  const route = method === 'GET' ? avatarRoute.GET : avatarRoute.HEAD;
  return route(context(userId, new Request(`${URL_BASE}${src}`, { method }), { id }));
};
/** A body that arrives in pieces, with no Content-Length. */
function streamOf(pieces: number, pieceSize: number, fail = false) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === pieces) {
        if (fail) controller.error(new Error('Body size limit exceeded'));
        else controller.close();
        return;
      }
      sent++;
      controller.enqueue(new Uint8Array(pieceSize).fill(0x41));
    },
  });
}

describe('upload and photo routes', () => {
  it('only takes JPEG and WebP content types', async () => {
    const user = addUser();
    for (const type of ['text/plain', 'image/png', 'image/svg+xml', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await upload(user, jpeg(), { 'content-type': type });
      expect(res.status).toBe(415);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).error).toMatch(/JPEG or WebP/);
    }
    expect((await upload(user, jpeg(), {})).status).toBe(415);
    // Case and parameters don't matter.
    expect((await upload(user, jpeg(), { 'content-type': 'IMAGE/JPEG; foo=bar' })).status).toBe(200);
  });

  it('turns away oversized bodies', async () => {
    const user = addUser();
    const byHeader = await upload(user, jpeg(), { 'content-type': 'image/jpeg', 'content-length': String(AVATAR_MAX_BYTES + 1) });
    expect(byHeader.status).toBe(413);
    expect((await byHeader.json()).error).toMatch(/too large/);
    expect((await upload(user, streamOf(10, 8_000))).status).toBe(413);
    expect((await upload(user, new Uint8Array(AVATAR_MAX_BYTES + 1))).status).toBe(413);
    // The server's own request cap ends the stream with an error part way through.
    expect((await upload(user, streamOf(2, 1_000, true))).status).toBe(413);
    expect(avatarColumn(user)).toBeNull();
  });

  it('turns away things that aren’t usable photos', async () => {
    const user = addUser();
    const garbage = await upload(user, bytes(text('<!doctype html><script>alert(1)</script>')));
    expect(garbage.status).toBe(400);
    expect((await garbage.json()).error).toBe('Photos need to be JPEG or WebP images.');
    expect((await upload(user, new Uint8Array(0))).status).toBe(400);
    expect((await upload(user, null)).status).toBe(400);
    const tooBigOnScreen = await upload(user, jpeg({ width: 30000 }));
    expect(tooBigOnScreen.status).toBe(400);
    expect((await tooBigOnScreen.json()).error).toMatch(/between 32 and 512 pixels/);
  });

  it('stores a photo, serves it to signed-in people, and removes it', async () => {
    const user = addUser();
    const viewer = addUser();
    const res = await upload(user, jpeg({ exif: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { avatar } = (await res.json()) as { avatar: string };
    expect(avatar).toMatch(/^\/avatars\/[A-Za-z0-9_-]{22}$/);
    expect(getUser(user)!.avatarId).toBe(avatar.slice('/avatars/'.length));

    const photo = await fetchPhoto(viewer, avatar);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(photo.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(photo.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(photo.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(photo.headers.get('content-disposition')).toBe('inline; filename="avatar.jpg"');
    const served = new Uint8Array(await photo.arrayBuffer());
    expect(photo.headers.get('content-length')).toBe(String(served.length));
    expect(Buffer.from(served).equals(Buffer.from(jpeg()))).toBe(true); // EXIF gone

    const head = await fetchPhoto(viewer, avatar, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(served.length));
    expect(head.body).toBeNull();

    expect((await fetchPhoto(null, avatar)).status).toBe(401);
    expect((await fetchPhoto(viewer, '/avatars/nope')).status).toBe(404);
    expect((await fetchPhoto(viewer, `/avatars/${'B'.repeat(22)}`)).status).toBe(404);

    const removed = await remove(user);
    expect(removed.status).toBe(200);
    expect(removed.headers.get('cache-control')).toBe('no-store');
    expect(await removed.json()).toEqual({ avatar: null });
    expect(getUser(user)!.avatarId).toBeNull();
    expect((await fetchPhoto(viewer, avatar)).status).toBe(404);
  });

  it('serves WebP with its own name', async () => {
    const user = addUser();
    const { avatar } = (await (await upload(user, riff([vp8l(256)]), { 'content-type': 'image/webp' })).json()) as { avatar: string };
    const photo = await fetchPhoto(user, avatar);
    expect(photo.headers.get('content-type')).toBe('image/webp');
    expect(photo.headers.get('content-disposition')).toBe('inline; filename="avatar.webp"');
  });

  it('stores what the bytes are, whatever the upload claimed', async () => {
    const user = addUser();
    const { avatar } = (await (await upload(user, riff([vp8(256)]), { 'content-type': 'image/jpeg' })).json()) as { avatar: string };
    expect((await fetchPhoto(user, avatar)).headers.get('content-type')).toBe('image/webp');
  });

  it('limits how many uploads one person can make', async () => {
    const user = addUser();
    for (let i = 0; i < 30; i++) expect((await upload(user, bytes(text('nope')))).status).toBe(400);
    const limited = await upload(user, jpeg());
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toEqual(expect.any(String));
    // Someone else isn't affected.
    expect((await upload(addUser(), jpeg())).status).toBe(200);
  });
});
