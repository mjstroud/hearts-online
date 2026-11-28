/**
 * Where the table draws a taunt (Phase 4a). Worked out from the avatars' places as each one starts, since
 * they move when a phone turns and with the length of a name. Only TauntLayer.svelte imports this (types
 * aside), so it loads with the layer, not on every game page.
 */

import type { TauntEvent } from './taunts';

/** A taunt for the table to draw: what came over the live stream (or was just sent), numbered as it arrived. */
export interface TauntShow extends TauntEvent {
  id: number;
  /** When it was handed to the table, on this device's clock. */
  at: number;
}

/** An avatar's centre and width, measured from the arena's top-left corner. */
export interface Spot {
  x: number;
  y: number;
  size: number;
}

export interface Box {
  width: number;
  height: number;
}

/** Half an emote bubble's width, so a bubble near an edge stays whole. */
export const BUBBLE_R = 22;
/** The gap between an avatar and its bubble: enough to clear the plaque's own padding around the avatar. */
const GAP = 6;
/** Grazing an edge by this much doesn't count as covering it. */
const GRAZE = 2;
/** The highest a throw may fly, from the arena's top edge. */
const TOP = 16;

/** A rectangle measured from the arena's top-left corner. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Something a bubble should keep off, and how much it matters. A card's rank corner is one it must never
 * cover (ground rule: nothing does); a plaque, the message or the status cluster only for a moment's tidiness.
 */
export interface Obstacle extends Rect {
  weight: number;
}

/**
 * What it costs to cover each kind of thing. A rank corner never; the sender's own plaque only lightly,
 * since a bubble on your own nameplate still reads as yours; someone else's more, as it would look like theirs.
 */
export const COVER = { corner: 100, button: 20, plaque: 12, own: 6, message: 4, tag: 2 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Half a rectangular bubble's size: a chat preview, wider than it's tall. Taunts' bubbles are round. */
export interface Half {
  x: number;
  y: number;
}

/**
 * A bubble at (x, y) overlaps this rectangle. Grazing a plaque's edge doesn't count; a rank corner gets no
 * such allowance. A round one (a taunt's) by its radius, a rectangular one (a chat preview's) by its sides.
 */
function meets(x: number, y: number, o: Obstacle, half: Half | null): boolean {
  const graze = o.weight >= COVER.corner ? 0 : GRAZE;
  if (!half) return Math.hypot(clamp(x, o.left, o.right) - x, clamp(y, o.top, o.bottom) - y) < BUBBLE_R - graze;
  const w = Math.min(x + half.x, o.right) - Math.max(x - half.x, o.left);
  const h = Math.min(y + half.y, o.bottom) - Math.max(y - half.y, o.top);
  return w > graze && h > graze;
}

/**
 * Beside an avatar, just clear of it: of sixteen spots around it, the one that covers the least, leaning
 * towards the middle of the table, and always whole inside `bounds` (the table, unless told otherwise).
 * Sideways the top seats sit 6px from the top of the screen, and upright your own plaque is at the bottom,
 * so above or outwards would leave the screen; a flat plaque's name runs beside the avatar; and the trick's
 * rank corners must always show. `ux` and `uy` say which way it went (a unit vector), so the bubble can
 * grow out of the avatar. `half` makes it a rectangle of that half-size (a chat preview) instead of a taunt's
 * round bubble, and `cost` says what the chosen spot covers (COVER.corner or more: a rank corner).
 */
export function beside(
  a: Spot,
  box: Box,
  avoid: readonly Obstacle[] = [],
  bounds: Rect = { left: 0, top: 0, right: box.width, bottom: box.height },
  half: Half | null = null,
): { x: number; y: number; ux: number; uy: number; cost: number } {
  const hx = half?.x ?? BUBBLE_R;
  const hy = half?.y ?? BUBBLE_R;
  const dx = box.width / 2 - a.x;
  const dy = box.height / 2 - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const inward = Math.atan2(dy / len, dx / len);
  // How far the bubble reaches back towards the avatar from its centre, along the line between them: a round
  // one's radius, or a rectangle's furthest corner that way, so none of it lands on the avatar.
  const reach = (ux: number, uy: number) => (half ? hx * Math.abs(ux) + hy * Math.abs(uy) : BUBBLE_R);
  let best: { x: number; y: number; ux: number; uy: number; cost: number } | null = null;
  let least = Infinity;
  // Straight in first, then round both ways a sixteenth of a turn at a time, so a tie goes to the more inward.
  for (let k = 0; k < 16; k++) {
    const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const ux = Math.cos(inward + (step * Math.PI) / 8);
    const uy = Math.sin(inward + (step * Math.PI) / 8);
    const d = a.size / 2 + reach(ux, uy) + GAP;
    const x = a.x + ux * d;
    const y = a.y + uy * d;
    if (x - hx < bounds.left || y - hy < bounds.top || x + hx > bounds.right || y + hy > bounds.bottom) continue;
    let covered = 0;
    for (const o of avoid) if (meets(x, y, o, half)) covered += o.weight;
    const cost = Math.abs(step) * 0.75 + covered;
    if (cost < least) [least, best] = [cost, { x, y, ux, uy, cost: covered }];
  }
  if (best) return best;
  // Nowhere fits (a table smaller than any phone's): inwards, kept on the table.
  const d = a.size / 2 + reach(dx / len, dy / len) + GAP;
  const x = clamp(a.x + (dx / len) * d, hx, box.width - hx);
  const y = clamp(a.y + (dy / len) * d, hy, box.height - hy);
  return { x, y, ux: dx / len, uy: dy / len, cost: avoid.reduce((c, o) => c + (meets(x, y, o, half) ? o.weight : 0), 0) };
}

/**
 * A throw's flight from one avatar's centre to another's: five points on a lob, evenly spaced in time, so
 * at a steady pace between them it moves the way a thrown thing does. It rises in the middle, unless that
 * would leave the table (two top seats, with the screen's edge just above them), and then it dips instead.
 */
export function arc(from: Spot, to: Spot): [number, number][] {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const h = Math.min(90, 20 + Math.hypot(to.x - from.x, to.y - from.y) / 4);
  // The curve's halfway point is h from the middle when its control point is 2h away.
  const cy = my - 2 * (my - h >= TOP ? h : -h);
  return [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const s = 1 - t;
    return [s * s * from.x + 2 * s * t * mx + t * t * to.x, Math.max(TOP, s * s * from.y + 2 * s * t * cy + t * t * to.y)];
  });
}
