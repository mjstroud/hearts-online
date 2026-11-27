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
export const BUBBLE_R = 25;
/** How far a bubble sits from its avatar's centre, in avatar widths. */
const OUT = 0.9;
/** The highest a throw may fly, from the arena's top edge. */
const TOP = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Beside an avatar, towards the middle of the table. Sideways, the top seats sit 6px from the top of the
 * screen, and upright your own plaque is at the bottom, so above or outwards would leave the screen. `ux`
 * and `uy` say which way it went (a unit vector), so the bubble can grow out of the avatar.
 */
export function beside(a: Spot, box: Box): { x: number; y: number; ux: number; uy: number } {
  const dx = box.width / 2 - a.x;
  const dy = box.height / 2 - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x: clamp(a.x + ux * a.size * OUT, BUBBLE_R, box.width - BUBBLE_R),
    y: clamp(a.y + uy * a.size * OUT, BUBBLE_R, box.height - BUBBLE_R),
    ux,
    uy,
  };
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
