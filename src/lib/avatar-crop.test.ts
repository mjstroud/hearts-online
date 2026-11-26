import { describe, expect, it } from 'vitest';
import { type Crop, MAX_ZOOM, clampCrop, initialCrop, pan, sourceRect, visibleSide, zoomAt } from './avatar-crop';

const STAGE = 280;
const EPS = 1e-6;

/** The source point drawn at stage point (fx, fy). */
function pointAt(c: Crop, fx: number, fy: number, w: number, h: number, stage = STAGE) {
  const k = stage / visibleSide(c.zoom, w, h);
  return { x: c.x + (fx - stage / 2) / k, y: c.y + (fy - stage / 2) / k };
}

function expectInBounds(c: Crop, w: number, h: number) {
  expect(c.zoom).toBeGreaterThanOrEqual(1);
  expect(c.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  const r = sourceRect(c, w, h);
  expect(r.side).toBeCloseTo(Math.min(w, h) / c.zoom, 9);
  expect(r.sx).toBeGreaterThanOrEqual(0);
  expect(r.sy).toBeGreaterThanOrEqual(0);
  expect(r.sx + r.side).toBeLessThanOrEqual(w + EPS);
  expect(r.sy + r.side).toBeLessThanOrEqual(h + EPS);
  // The centre is the middle of that square.
  expect(c.x).toBeCloseTo(r.sx + r.side / 2, 6);
  expect(c.y).toBeCloseTo(r.sy + r.side / 2, 6);
}

/** A small deterministic random sequence, so failures are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SIZES: [string, number, number][] = [
  ['portrait', 3024, 4032],
  ['landscape', 4032, 3024],
  ['square', 800, 800],
  ['panorama', 12000, 1500],
  ['tall strip', 300, 5000],
  ['tiny', 3, 2],
  ['one pixel', 1, 1],
  ['huge', 40000, 30000],
];

describe('initialCrop', () => {
  it('covers the short side of a portrait photo, centred', () => {
    const c = initialCrop(600, 900);
    expect(c).toEqual({ zoom: 1, x: 300, y: 450 });
    expect(sourceRect(c, 600, 900)).toEqual({ sx: 0, sy: 150, side: 600 });
  });

  it('covers the short side of a landscape photo, centred', () => {
    expect(sourceRect(initialCrop(1600, 900), 1600, 900)).toEqual({ sx: 350, sy: 0, side: 900 });
  });

  it('uses all of a square photo', () => {
    expect(sourceRect(initialCrop(500, 500), 500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });

  it.each(SIZES)('is in bounds for a %s source', (_, w, h) => {
    expectInBounds(initialCrop(w, h), w, h);
  });
});

describe('clampCrop', () => {
  it('limits zoom to 1..MAX_ZOOM', () => {
    expect(clampCrop({ zoom: 0.2, x: 50, y: 50 }, 100, 100).zoom).toBe(1);
    expect(clampCrop({ zoom: 0, x: 50, y: 50 }, 100, 100).zoom).toBe(1);
    expect(clampCrop({ zoom: -3, x: 50, y: 50 }, 100, 100).zoom).toBe(1);
    expect(clampCrop({ zoom: 10, x: 50, y: 50 }, 100, 100).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: Infinity, x: 50, y: 50 }, 100, 100).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: -Infinity, x: 50, y: 50 }, 100, 100).zoom).toBe(1);
    expect(clampCrop({ zoom: NaN, x: 50, y: 50 }, 100, 100).zoom).toBe(1);
    expect(clampCrop({ zoom: 2.5, x: 50, y: 50 }, 100, 100).zoom).toBe(2.5);
  });

  it('keeps the visible square inside the image', () => {
    // 400x200 at zoom 2: the square is 100 across, so the centre stays 50 from each edge.
    expect(clampCrop({ zoom: 2, x: -500, y: -500 }, 400, 200)).toEqual({ zoom: 2, x: 50, y: 50 });
    expect(clampCrop({ zoom: 2, x: 5000, y: 5000 }, 400, 200)).toEqual({ zoom: 2, x: 350, y: 150 });
    expect(clampCrop({ zoom: 2, x: 123, y: 77 }, 400, 200)).toEqual({ zoom: 2, x: 123, y: 77 });
  });

  it('pins the short axis at zoom 1', () => {
    expect(clampCrop({ zoom: 1, x: 0, y: 0 }, 400, 200)).toEqual({ zoom: 1, x: 100, y: 100 });
    expect(clampCrop({ zoom: 1, x: 999, y: 999 }, 400, 200)).toEqual({ zoom: 1, x: 300, y: 100 });
  });

  it('recentres a centre that is not a number, and sends an infinite one to the edge', () => {
    expect(clampCrop({ zoom: 2, x: NaN, y: NaN }, 400, 200)).toEqual({ zoom: 2, x: 200, y: 100 });
    expect(clampCrop({ zoom: 2, x: -Infinity, y: Infinity }, 400, 200)).toEqual({ zoom: 2, x: 50, y: 150 });
  });
});

describe('pan', () => {
  it('moves the photo with the pointer', () => {
    // 1600x900 on a 300px stage at zoom 1: 3 source pixels per stage pixel.
    const c = pan(initialCrop(1600, 900), 100, 0, 300, 1600, 900);
    expect(c.x).toBeCloseTo(800 - 300, 9);
    expect(c.y).toBe(450);
    expect(sourceRect(c, 1600, 900).sx).toBeCloseTo(50, 9);
  });

  it('pans less source per stage pixel when zoomed in', () => {
    const start = { zoom: 2, x: 800, y: 450 };
    const c = pan(start, -30, 20, 300, 1600, 900);
    // Visible side 450 on 300px: 1.5 source pixels per stage pixel.
    expect(c.x).toBeCloseTo(845, 9);
    expect(c.y).toBeCloseTo(420, 9);
  });

  it('cannot move along the short side at zoom 1', () => {
    expect(pan(initialCrop(1600, 900), 0, 250, 300, 1600, 900).y).toBe(450);
    expect(pan(initialCrop(900, 1600), 250, 0, 300, 900, 1600).x).toBe(450);
  });

  it('stops at the edges', () => {
    expect(sourceRect(pan(initialCrop(1600, 900), 1e9, 0, 300, 1600, 900), 1600, 900)).toEqual({ sx: 0, sy: 0, side: 900 });
    expect(sourceRect(pan(initialCrop(1600, 900), -1e9, 0, 300, 1600, 900), 1600, 900)).toEqual({ sx: 700, sy: 0, side: 900 });
    const corner = pan({ zoom: MAX_ZOOM, x: 400, y: 400 }, -1e12, -1e12, 300, 800, 800);
    expect(sourceRect(corner, 800, 800)).toEqual({ sx: 600, sy: 600, side: 200 });
  });

  it('ignores a delta that is not a number, and takes an infinite one to the edge', () => {
    const start = { zoom: 2, x: 300, y: 300 };
    expect(pan(start, NaN, NaN, 280, 800, 800)).toEqual(start);
    expect(pan(start, NaN, Infinity, 280, 800, 800)).toEqual({ zoom: 2, x: 300, y: 200 });
    expect(pan(start, -Number.MAX_VALUE, 0, 280, 800, 800)).toEqual({ zoom: 2, x: 600, y: 300 });
  });

  it.each(SIZES)('stays in bounds for a %s source under extreme drags', (_, w, h) => {
    let c = zoomAt(initialCrop(w, h), 2.7, 30, 250, STAGE, w, h);
    for (const [dx, dy] of [
      [1e9, 0],
      [0, 1e9],
      [-1e9, -1e9],
      [1e-9, -1e-9],
      [12345.6, -0.5],
      [-Number.MAX_VALUE, Number.MAX_VALUE],
    ]) {
      c = pan(c, dx, dy, STAGE, w, h);
      expectInBounds(c, w, h);
    }
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed when nothing gets clamped', () => {
    const w = 4000;
    const h = 3000;
    const start: Crop = { zoom: 1.5, x: 2000, y: 1500 };
    for (const [z, fx, fy] of [
      [2, 70, 200],
      [1.2, 10, 10],
      [3.3, 270, 140],
      [1.6, 140, 140],
    ]) {
      const before = pointAt(start, fx, fy, w, h);
      const next = zoomAt(start, z, fx, fy, STAGE, w, h);
      expect(next.zoom).toBe(z);
      const after = pointAt(next, fx, fy, w, h);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expectInBounds(next, w, h);
    }
  });

  it('keeps the focus fixed through a chain of zooms', () => {
    const w = 6000;
    const h = 6000;
    let c: Crop = initialCrop(w, h);
    const target = pointAt(c, 100, 180, w, h);
    for (const z of [1.1, 1.4, 2, 2.8, 3.9, 2.2, 1.3]) {
      c = zoomAt(c, z, 100, 180, STAGE, w, h);
      const p = pointAt(c, 100, 180, w, h);
      expect(p.x).toBeCloseTo(target.x, 6);
      expect(p.y).toBeCloseTo(target.y, 6);
    }
  });

  it('zooms about the centre when the focus is the middle of the stage', () => {
    const c = zoomAt({ zoom: 1, x: 500, y: 400 }, 2, STAGE / 2, STAGE / 2, STAGE, 1000, 800);
    expect(c).toEqual({ zoom: 2, x: 500, y: 400 });
  });

  it('clamps the zoom and stays in bounds', () => {
    const w = 1200;
    const h = 900;
    const max = zoomAt(initialCrop(w, h), 50, 0, 0, STAGE, w, h);
    expect(max.zoom).toBe(MAX_ZOOM);
    expectInBounds(max, w, h);
    const min = zoomAt(max, 0.01, STAGE, STAGE, STAGE, w, h);
    expect(min.zoom).toBe(1);
    expectInBounds(min, w, h);
    expect(zoomAt(max, NaN, 10, 10, STAGE, w, h).zoom).toBe(MAX_ZOOM);
  });

  it('zooming all the way out from a corner covers the image again', () => {
    const w = 1600;
    const h = 900;
    let c = zoomAt(initialCrop(w, h), MAX_ZOOM, 0, 0, STAGE, w, h);
    c = pan(c, 1e9, 1e9, STAGE, w, h); // top-left corner
    c = zoomAt(c, 1, STAGE, STAGE, STAGE, w, h);
    expect(sourceRect(c, w, h)).toEqual({ sx: 0, sy: 0, side: 900 });
  });

  it('pulls the square back inside when zooming out near an edge', () => {
    const w = 1000;
    const h = 1000;
    // Zoomed into the bottom-right corner, then zoom out around the far corner of the stage.
    const c = zoomAt({ zoom: 4, x: 875, y: 875 }, 2, 0, 0, STAGE, w, h);
    expect(c.zoom).toBe(2);
    expectInBounds(c, w, h);
    expect(sourceRect(c, w, h)).toEqual({ sx: 500, sy: 500, side: 500 });
  });

  it.each(SIZES)('stays in bounds for a %s source under random pans and zooms', (_, w, h) => {
    const rand = rng(w * 31 + h);
    let c = initialCrop(w, h);
    for (let i = 0; i < 400; i++) {
      if (rand() < 0.5) c = pan(c, (rand() - 0.5) * 2000, (rand() - 0.5) * 2000, STAGE, w, h);
      else c = zoomAt(c, rand() * 6 - 0.5, rand() * STAGE * 1.4 - STAGE * 0.2, rand() * STAGE * 1.4 - STAGE * 0.2, STAGE, w, h);
      expectInBounds(c, w, h);
    }
  });
});

describe('sourceRect', () => {
  it('works from an unclamped crop', () => {
    expect(sourceRect({ zoom: 9, x: -1, y: 1e9 }, 400, 400)).toEqual({ sx: 0, sy: 300, side: 100 });
  });

  it('never reaches past the image, even with awkward fractions', () => {
    const w = 1001;
    const h = 777;
    for (const zoom of [1, 1.1, 1.3333333, 2.9999999, 3.7, 4]) {
      for (const [x, y] of [
        [1e9, 1e9],
        [-1e9, -1e9],
        [w / 3, h / 7],
      ]) {
        const r = sourceRect({ zoom, x, y }, w, h);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.side).toBeLessThanOrEqual(w);
        expect(r.sy + r.side).toBeLessThanOrEqual(h);
      }
    }
  });
});
