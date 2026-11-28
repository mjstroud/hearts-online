import { describe, expect, it } from 'vitest';
import { BUBBLE_R, COVER, type Rect, arc, beside } from './taunt-client';

// A 360px phone held upright (a 328 × 330 arena) and sideways on the small Android (a 676 × 264 arena).
const UPRIGHT = { width: 328, height: 330 };
const SIDEWAYS = { width: 676, height: 264 };

describe('an emote bubble', () => {
  it('sits just clear of the avatar, towards the middle of the table, when nothing is in the way', () => {
    // Your own plaque, at the bottom: the bubble goes up.
    const mine = beside({ x: 164, y: 288, size: 38 }, UPRIGHT);
    expect(mine.x).toBeCloseTo(164);
    expect(mine.y).toBeCloseTo(288 - (19 + BUBBLE_R + 6));
    expect(mine.uy).toBeCloseTo(-1);
    // The left seat: it goes right, and a little down to the middle.
    const left = beside({ x: 23, y: 140, size: 38 }, UPRIGHT);
    expect(left.x).toBeGreaterThan(23 + 30);
    expect(left.y).toBeGreaterThan(140);
    expect(left.ux).toBeGreaterThan(0.9);
  });

  // More than a 2px graze, as beside() counts it.
  const covers = (b: { x: number; y: number }, r: Rect) =>
    Math.hypot(Math.min(Math.max(b.x, r.left), r.right) - b.x, Math.min(Math.max(b.y, r.top), r.bottom) - b.y) < BUBBLE_R - 2;

  it('never covers a trick card’s rank corner: sideways, the top seat’s goes round the card below it', () => {
    // A top seat held sideways, with the top trick card's rank corner straight below its avatar.
    const corner = { left: 322, top: 62, right: 340, bottom: 90, weight: COVER.corner };
    const b = beside({ x: 338, y: 26, size: 30 }, SIDEWAYS, [corner]);
    expect(covers(b, corner)).toBe(false);
    expect(b.y - BUBBLE_R).toBeGreaterThanOrEqual(0);
  });

  it('keeps off a flat plaque’s name and the message slot when there’s room elsewhere', () => {
    // Desktop's left seat: the name runs to the right of the avatar, which is the way in.
    const name = { left: 40, top: 120, right: 190, bottom: 160, weight: COVER.plaque };
    const left = beside({ x: 22, y: 140, size: 38 }, { width: 900, height: 500 }, [name]);
    expect(covers(left, name)).toBe(false);
    // Upright, your own bubble would cover the message ("Your lead") straight above your plaque.
    const msg = { left: 110, top: 230, right: 218, bottom: 260, weight: COVER.message };
    const mine = beside({ x: 164, y: 288, size: 38 }, UPRIGHT, [msg]);
    expect(covers(mine, msg)).toBe(false);
  });

  it('may use the screen just above the table, upright, rather than cover a top seat’s own name', () => {
    // Upright, a top seat's plaque (avatar over name) starts at the table's top edge; above it are the chips.
    const plaque = { left: 118, top: -6, right: 210, bottom: 72, weight: COVER.plaque };
    const onTable = beside({ x: 164, y: 17, size: 34 }, UPRIGHT, [plaque]);
    expect(covers(onTable, plaque)).toBe(true);
    const above = beside({ x: 164, y: 17, size: 34 }, UPRIGHT, [plaque], { left: -16, top: -60, right: 344, bottom: 344 });
    expect(covers(above, plaque)).toBe(false);
    expect(above.y + BUBBLE_R).toBeLessThanOrEqual(-6 + 2);
    // Never under the site's header: with no room above, it stays on the table.
    const tight = beside({ x: 164, y: 17, size: 34 }, UPRIGHT, [plaque], { left: -16, top: 0, right: 344, bottom: 344 });
    expect(tight.y - BUBBLE_R).toBeGreaterThanOrEqual(0);
  });

  it('gives a rank corner no allowance for a graze', () => {
    // Straight in (down) from this avatar puts the bubble's centre at y 170, its edge 1px over the corner's top.
    const corner = { left: 190, top: 170 + BUBBLE_R - 1, right: 210, bottom: 230, weight: COVER.corner };
    const b = beside({ x: 200, y: 140, size: 4 }, { width: 400, height: 400 }, [corner]);
    const gap = Math.hypot(Math.min(Math.max(b.x, 190), 210) - b.x, Math.min(Math.max(b.y, corner.top), 230) - b.y);
    expect(gap).toBeGreaterThanOrEqual(BUBBLE_R);
    // A plaque there would only be grazed, so straight in is fine.
    const plaque = { ...corner, weight: COVER.plaque };
    expect(beside({ x: 200, y: 140, size: 4 }, { width: 400, height: 400 }, [plaque]).y).toBeCloseTo(170);
  });

  it('would sooner cover a plaque than a rank corner', () => {
    const corner = { left: 150, top: 200, right: 180, bottom: 250, weight: COVER.corner };
    const plaques = [0, 1, 2, 3].map((i) => ({ left: 100 + i * 40, top: 180, right: 140 + i * 40, bottom: 330, weight: COVER.plaque }));
    const b = beside({ x: 164, y: 288, size: 38 }, UPRIGHT, [corner, ...plaques]);
    expect(covers(b, corner)).toBe(false);
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
