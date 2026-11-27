/**
 * The phone sizes every phone-facing change is checked at (CLAUDE.md's phone rule), in CSS pixels, held
 * upright. /dev/phones shows the game at each one, upright and sideways.
 *
 * In a browser a page gets less than the whole screen: `bars` is roughly how much height the browser's
 * own bars take, upright and sideways. `notch` is the safe-area inset on each side of a sideways iPhone,
 * which the page pads itself away from. Both are estimates; they vary with the browser and its settings.
 */
export interface Phone {
  name: string;
  width: number;
  height: number;
  bars: { upright: number; sideways: number };
  notch: number;
}

export const PHONES: Phone[] = [
  { name: 'Small Android', width: 360, height: 780, bars: { upright: 104, sideways: 80 }, notch: 0 },
  { name: 'iPhone SE', width: 375, height: 667, bars: { upright: 119, sideways: 50 }, notch: 0 },
  { name: 'iPhone', width: 393, height: 852, bars: { upright: 193, sideways: 50 }, notch: 59 },
  { name: 'Large phone', width: 430, height: 932, bars: { upright: 193, sideways: 50 }, notch: 59 },
];

/** The page's own side padding on a sideways phone, wider than 640px (global.css): a notch only takes what's beyond it. */
const PAGE_PADDING = 20;

export interface Viewport {
  phone: string;
  sideways: boolean;
  width: number;
  height: number;
}

/**
 * What a page gets on one phone held one way: the whole screen as an installed app, or less in a browser.
 * A frame can't fake a safe-area inset, so a sideways notch is taken off the width instead.
 */
export function viewport(phone: Phone, sideways: boolean, inBrowser: boolean): Viewport {
  const long = phone.height;
  const short = phone.width;
  const bars = inBrowser ? (sideways ? phone.bars.sideways : phone.bars.upright) : 0;
  const notch = sideways ? Math.max(0, phone.notch - PAGE_PADDING) * 2 : 0;
  return sideways
    ? { phone: phone.name, sideways, width: long - notch, height: short - bars }
    : { phone: phone.name, sideways, width: short, height: long - bars };
}
