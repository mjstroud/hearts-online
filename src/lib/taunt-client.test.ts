import { describe, expect, it } from 'vitest';
import { BUBBLE_R, arc, beside } from './taunt-client';

// A 360px phone held upright (a 328 × 330 arena) and sideways on the small Android (a 676 × 264 arena).
const UPRIGHT = { width: 328, height: 330 };
const SIDEWAYS = { width: 676, height: 264 };

describe('an emote bubble', () => {
  it('sits beside the avatar, towards the middle of the table', () => {
    // Your own plaque, at the bottom: the bubble goes up.
    const mine = beside({ x: 164, y: 288, size: 38 }, UPRIGHT);
    expect(mine.x).toBeCloseTo(164);
    expect(mine.y).toBeCloseTo(288 - 38 * 0.9);
    expect(mine.uy).toBeCloseTo(-1);
    // The left seat: it goes right, and a little down to the middle.
    const left = beside({ x: 23, y: 140, size: 38 }, UPRIGHT);
    expect(left.x).toBeGreaterThan(23 + 30);
    expect(left.y).toBeGreaterThan(140);
    expect(left.ux).toBeGreaterThan(0.9);
  });

  it('stays on the table beside a top seat held sideways, 6px from the screen’s edge', () => {
    const b = beside({ x: 338, y: 25, size: 34 }, SIDEWAYS);
    expect(b.y - BUBBLE_R).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThan(25);
  });

  it('is kept whole against an edge', () => {
    const b = beside({ x: 2, y: 2, size: 120 }, { width: 100, height: 100 });
    expect(b.x).toBeGreaterThanOrEqual(BUBBLE_R);
    expect(b.y).toBeGreaterThanOrEqual(BUBBLE_R);
    expect(b.x).toBeLessThanOrEqual(100 - BUBBLE_R);
    expect(b.y).toBeLessThanOrEqual(100 - BUBBLE_R);
  });

  it('copes with an avatar right in the middle', () => {
    const b = beside({ x: 164, y: 165, size: 38 }, UPRIGHT);
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });
});

describe('a throw’s flight', () => {
  const left = { x: 23, y: 165, size: 38 };
  const right = { x: 305, y: 165, size: 38 };

  it('runs from one avatar’s centre to the other’s', () => {
    const path = arc(left, right);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual([23, 165]);
    expect(path[4]).toEqual([305, 165]);
  });

  it('rises in the middle when there is room above', () => {
    const [, a, mid, b] = arc(left, right);
    expect(mid[1]).toBeLessThan(165 - 40);
    expect(a[1]).toBeGreaterThan(mid[1]);
    expect(b[1]).toBeGreaterThan(mid[1]);
    expect(mid[0]).toBeCloseTo(164);
  });

  it('dips instead between two top seats held sideways, and never leaves the table', () => {
    const path = arc({ x: 259, y: 25, size: 34 }, { x: 417, y: 25, size: 34 });
    expect(path[2][1]).toBeGreaterThan(25);
    for (const [, y] of path) expect(y).toBeGreaterThanOrEqual(16);
  });

  it('never flies above the table’s top edge', () => {
    for (const [, y] of arc({ x: 40, y: 20, size: 34 }, { x: 300, y: 250, size: 34 })) expect(y).toBeGreaterThanOrEqual(16);
  });
});
