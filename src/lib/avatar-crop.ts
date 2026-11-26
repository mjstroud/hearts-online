/**
 * The photo editor's square crop, as pure math (no DOM) so it can be unit tested.
 *
 * A crop is kept in source-image pixels, so it doesn't depend on how big the stage is on screen:
 * - `zoom`: 1 means the square just covers the image (its side is the image's short side), up to MAX_ZOOM.
 * - `x`, `y`: the source point shown at the centre of the square.
 *
 * Stage coordinates are CSS pixels from the stage's top-left corner. The stage shows exactly the
 * crop square, `stageSide` pixels across.
 */

export const MAX_ZOOM = 4;

export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

/** The part of the source to draw, for drawImage(source, sx, sy, side, side, ...). */
export interface SourceRect {
  sx: number;
  sy: number;
  side: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** NaN becomes the fallback; an infinity is left to clamp to an edge. */
const num = (v: number, fallback: number) => (Number.isNaN(v) ? fallback : v);
const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
const clampZoom = (zoom: number) => clamp(num(zoom, 1), 1, MAX_ZOOM);

/** Side of the visible square, in source pixels. */
export const visibleSide = (zoom: number, w: number, h: number) => Math.min(w, h) / clampZoom(zoom);

/** Stage pixels per source pixel. */
const stageScale = (zoom: number, stageSide: number, w: number, h: number) => stageSide / visibleSide(zoom, w, h);

/** The whole short side, centred. */
export function initialCrop(w: number, h: number): Crop {
  return { zoom: 1, x: w / 2, y: h / 2 };
}

/** Zoom limited to [1, MAX_ZOOM], and the centre kept where the visible square stays inside the image. */
export function clampCrop(c: Crop, w: number, h: number): Crop {
  const zoom = clampZoom(c.zoom);
  const half = Math.min(w, h) / zoom / 2;
  return {
    zoom,
    x: clamp(num(c.x, w / 2), half, w - half),
    y: clamp(num(c.y, h / 2), half, h - half),
  };
}

/** Drag the photo by (dx, dy) stage pixels: it follows the pointer, so the centre moves the other way. */
export function pan(c: Crop, dx: number, dy: number, stageSide: number, w: number, h: number): Crop {
  const from = clampCrop(c, w, h);
  const k = stageScale(from.zoom, stageSide, w, h);
  return clampCrop({ zoom: from.zoom, x: from.x - num(dx, 0) / k, y: from.y - num(dy, 0) / k }, w, h);
}

/** Zoom to `newZoom`, keeping the source point under (focusX, focusY) where it is, unless that would leave the image. */
export function zoomAt(c: Crop, newZoom: number, focusX: number, focusY: number, stageSide: number, w: number, h: number): Crop {
  const from = clampCrop(c, w, h);
  const zoom = clampZoom(num(newZoom, from.zoom));
  const before = stageScale(from.zoom, stageSide, w, h);
  const after = stageScale(zoom, stageSide, w, h);
  const ox = finite(focusX, stageSide / 2) - stageSide / 2;
  const oy = finite(focusY, stageSide / 2) - stageSide / 2;
  // The focused source point is x + ox / scale, before and after.
  return clampCrop({ zoom, x: from.x + ox / before - ox / after, y: from.y + oy / before - oy / after }, w, h);
}

/** The source square for the crop, always inside the image. */
export function sourceRect(c: Crop, w: number, h: number): SourceRect {
  const { zoom, x, y } = clampCrop(c, w, h);
  const side = Math.min(w, h) / zoom;
  // Clamp again so rounding can't put an edge a hair outside the image (some browsers then draw nothing).
  return { sx: clamp(x - side / 2, 0, w - side), sy: clamp(y - side / 2, 0, h - side), side };
}
