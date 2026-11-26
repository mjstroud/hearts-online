/**
 * Browser-only helpers for the photo editor: open a picked file, draw the crop, and encode the small
 * square the server stores (see ./avatars). Everything here needs a DOM.
 */
import type { SourceRect } from './avatar-crop';
import { AVATAR_MAX_BYTES, AVATAR_SIZE, type AvatarType } from './avatars';

/** Biggest file we'll try to open. Phone photos are a few MB; this leaves room for big camera files. */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** A problem to show the person as is. Anything else thrown here gets a general message. */
export class AvatarImageError extends Error {}

export const CANT_READ = 'We couldn’t read that image. Try a JPEG or PNG.';
const TOO_BIG_FILE = 'That file is too big. Pick a photo under 30 MB.';
const TOO_BIG_TO_EDIT = 'That photo is too big to edit on this device. Try a smaller one.';
const TOO_DETAILED = 'That photo has too much detail to save small enough. Try zooming in, or pick another one.';

export interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  /** Frees the decoded pixels. */
  close(): void;
}

/** Decode a picked or dropped file, upright (phone photos store their rotation separately). */
export async function decodeImage(file: File): Promise<DecodedImage> {
  if (file.size > MAX_FILE_BYTES) throw new AvatarImageError(TOO_BIG_FILE);
  // Some systems don't know the type of a newer format (it arrives as ''), so only a known non-image is refused.
  // SVG is refused too: it has no pixels of its own to crop.
  if (file.size === 0 || (file.type && !file.type.startsWith('image/')) || file.type === 'image/svg+xml') {
    throw new AvatarImageError(CANT_READ);
  }
  let image: DecodedImage | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      image = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older Safari and Firefox refuse the option, and some formats only decode through <img>.
    }
  }
  image ??= await decodeWithImg(file);
  if (!(image.width > 0 && image.height > 0)) {
    image.close();
    throw new AvatarImageError(CANT_READ);
  }
  return image;
}

async function decodeWithImg(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => img.removeAttribute('src') };
  } catch {
    img.removeAttribute('src');
    throw new AvatarImageError(CANT_READ);
  } finally {
    // The decoded image stays usable after this; only the URL goes.
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // Phones refuse canvases past their memory limit by handing back no context.
  if (!ctx) throw new AvatarImageError(TOO_BIG_TO_EDIT);
  smooth(ctx);
  return [canvas, ctx];
}

function smooth(ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

/** Give a canvas's memory back straight away (iOS counts it until then, even after it's unreachable). */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Largest in-between canvas while shrinking (iOS refuses canvases much bigger than this). */
const MAX_STEP_PIXELS = 4096 * 4096;

/**
 * Draw a region of `source` at dw x dh on a new canvas, halving step by step on the way down so
 * a big reduction stays smooth instead of aliasing. `background` fills the canvas first.
 */
function downscale(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  background?: string,
): HTMLCanvasElement {
  let src = source;
  let from = { x: sx, y: sy, w: sw, h: sh };
  let step: HTMLCanvasElement | null = null;
  try {
    while (from.w > dw * 2 && from.h > dh * 2) {
      let nw = Math.round(from.w / 2);
      let nh = Math.round(from.h / 2);
      if (nw * nh > MAX_STEP_PIXELS) {
        const k = Math.sqrt(MAX_STEP_PIXELS / (nw * nh));
        nw = Math.floor(nw * k);
        nh = Math.floor(nh * k);
      }
      nw = Math.max(dw, nw);
      nh = Math.max(dh, nh);
      const [next, ctx] = makeCanvas(nw, nh);
      ctx.drawImage(src, from.x, from.y, from.w, from.h, 0, 0, nw, nh);
      if (step) releaseCanvas(step);
      src = step = next;
      from = { x: 0, y: 0, w: nw, h: nh };
    }
    const [out, ctx] = makeCanvas(dw, dh);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, dw, dh);
    }
    ctx.drawImage(src, from.x, from.y, from.w, from.h, 0, 0, dw, dh);
    return out;
  } finally {
    if (step) releaseCanvas(step);
  }
}

/** Working copies big enough for a 256px result at 4x zoom, and well inside iPhone canvas limits. */
const WORK_SHORT_SIDE = 2048;
const WORK_LONG_SIDE = 4096;
/** Smallest level kept for the stage and previews. */
const MIN_LEVEL_SIDE = 32;

/** The photo at a manageable size, plus halved copies so each frame can draw from a level that fits. */
export interface WorkingImage {
  /** Full working size first, then each about half the one before. */
  levels: HTMLCanvasElement[];
  width: number;
  height: number;
}

/** Make the working copies. The decoded image can be closed afterwards. */
export function makeWorkingImage(image: DecodedImage): WorkingImage {
  const { width: w, height: h } = image;
  const scale = Math.min(1, WORK_SHORT_SIDE / Math.min(w, h), WORK_LONG_SIDE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const levels = [downscale(image.source, 0, 0, w, h, width, height)];
  try {
    for (let top = levels[0]; Math.min(top.width, top.height) >= MIN_LEVEL_SIDE * 2; ) {
      top = downscale(top, 0, 0, top.width, top.height, Math.round(top.width / 2), Math.round(top.height / 2));
      levels.push(top);
    }
  } catch (err) {
    levels.forEach(releaseCanvas);
    throw err;
  }
  return { levels, width, height };
}

export function releaseWorkingImage(work: WorkingImage) {
  work.levels.forEach(releaseCanvas);
}

/**
 * Draw the crop over the whole of `ctx`'s (square) canvas, on `background`, from the smallest level
 * that still has a pixel for every canvas pixel. One drawImage: cheap enough for every animation frame.
 */
export function drawCrop(ctx: CanvasRenderingContext2D, work: WorkingImage, rect: SourceRect, background: string) {
  const side = ctx.canvas.width;
  let i = 0;
  while (i + 1 < work.levels.length && (rect.side * work.levels[i + 1].width) / work.width >= side) i++;
  const level = work.levels[i];
  const kx = level.width / work.width;
  const ky = level.height / work.height;
  smooth(ctx);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, side, ctx.canvas.height);
  ctx.drawImage(level, rect.sx * kx, rect.sy * ky, rect.side * kx, rect.side * ky, 0, 0, side, ctx.canvas.height);
}

/**
 * The finished square: the crop drawn at `side` x `side` on `background`, so a transparent PNG sits
 * on the person's usual avatar colour (JPEG has no transparency anyway).
 */
export function renderAvatar(source: CanvasImageSource, rect: SourceRect, side: number, background: string): HTMLCanvasElement {
  return downscale(source, rect.sx, rect.sy, rect.side, rect.side, side, side, background);
}

const QUALITIES = [0.86, 0.78, 0.7, 0.6, 0.5];
const FORMATS: AvatarType[] = ['image/webp', 'image/jpeg'];
/** Smaller squares to try if a very detailed photo won't fit at full size. */
const SMALLER = [192, 128];

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Encode the square for upload: WebP if the browser can make it, otherwise JPEG, at the best quality
 * that fits in AVATAR_MAX_BYTES. A photo that won't fit at full size is tried smaller.
 */
export async function encodeAvatar(canvas: HTMLCanvasElement): Promise<Blob> {
  let webp = true;
  const sizes = [canvas.width, ...SMALLER.filter((s) => s < Math.min(canvas.width, AVATAR_SIZE))];
  for (const size of sizes) {
    const c = size === canvas.width ? canvas : downscale(canvas, 0, 0, canvas.width, canvas.height, size, size);
    try {
      for (const type of FORMATS) {
        if (type === 'image/webp' && !webp) continue;
        for (const quality of QUALITIES) {
          const blob = await toBlob(c, type, quality);
          // Safari can't make WebP and quietly hands back a PNG instead.
          if (!blob || blob.type !== type) {
            if (type === 'image/webp') webp = false;
            break;
          }
          if (blob.size <= AVATAR_MAX_BYTES) return blob;
        }
      }
    } finally {
      if (c !== canvas) releaseCanvas(c);
    }
  }
  throw new AvatarImageError(TOO_DETAILED);
}
