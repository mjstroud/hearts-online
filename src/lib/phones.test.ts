import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHONES, SIDEWAYS, SIDEWAYS_MAX_HEIGHT, SIDEWAYS_MIN_WIDTH, viewport } from './phones';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Every file under src with one of these endings, as paths from src with forward slashes. */
function filesUnder(dir: string, endings: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, endings));
    else if (endings.some((e) => entry.name.endsWith(e))) out.push(relative(SRC, full).split(sep).join('/'));
  }
  return out;
}

// An @media rule's query runs from `@media` up to its opening brace. No comment in src says "@media", so
// comments aren't stripped first (a CSS-comment pattern would also catch strings such as "image/*").
const MEDIA = /@media\b([^{]*)\{/g;
const LANDSCAPE = /orientation\s*:\s*landscape/;
const squash = (s: string) => s.replace(/\s+/g, '');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('the sideways media query', () => {
  const copies = filesUnder(SRC, ['.svelte', '.astro', '.css']).flatMap((file) =>
    [...read(file).matchAll(MEDIA)].map((m) => ({ file, query: m[1].trim() })).filter((c) => LANDSCAPE.test(c.query)),
  );

  it('is the same in every CSS copy', () => {
    for (const { file, query } of copies) expect({ file, query: squash(query) }).toEqual({ file, query: squash(SIDEWAYS) });
  });

  // So deleting one by accident is noticed.
  it('has a copy in each place that needs one', () => {
    const files = new Set(copies.map((c) => c.file));
    for (const file of ['components/game/Table.svelte', 'components/game/WatchGlow.svelte', 'components/game/Game.svelte', 'layouts/Layout.astro'])
      expect(files).toContain(file);
    expect(copies.length).toBeGreaterThanOrEqual(4);
  });

  // Scripts import SIDEWAYS, and comments point at it, so nothing else can drift.
  it('is written out nowhere else but phones.ts', () => {
    const others = filesUnder(SRC, ['.ts', '.svelte', '.astro']).filter((f) => f !== 'lib/phones.ts' && !f.endsWith('.test.ts'));
    for (const file of others) {
      const rest = read(file).replace(MEDIA, '');
      expect({ file, writesItOut: LANDSCAPE.test(rest) }).toEqual({ file, writesItOut: false });
    }
  });
});

describe('the phone sizes', () => {
  // Upright: the phone's width by its height, less the browser's upright bars.
  // Sideways: its height by its width. The browser's sideways bars come off the height, and a notch
  // beyond the page's own 20px side padding comes off the width, on both sides: (59 - 20) × 2 = 78px on
  // the two iPhones, none on the others. As an app there are no bars.
  // [phone, upright in a browser, upright as an app, sideways in a browser, sideways as an app]
  const expected = [
    ['Small Android', '360×676', '360×780', '780×280', '780×360'], // 780 - 104; 360 - 80
    ['iPhone SE', '375×548', '375×667', '667×325', '667×375'], // 667 - 119; 375 - 50
    ['iPhone', '393×659', '393×852', '774×343', '774×393'], // 852 - 193; 852 - 78 by 393 - 50
    ['Large phone', '430×739', '430×932', '854×380', '854×430'], // 932 - 193; 932 - 78 by 430 - 50
  ];

  it('are what a page gets, in a browser and as an app', () => {
    const rows = PHONES.map((phone) => {
      const size = (sideways: boolean, inBrowser: boolean) => {
        const v = viewport(phone, sideways, inBrowser);
        expect(v).toMatchObject({ phone: phone.name, sideways });
        return `${v.width}×${v.height}`;
      };
      return [phone.name, size(false, true), size(false, false), size(true, true), size(true, false)];
    });
    expect(rows).toEqual(expected);
  });

  // So /dev/phones always tests the layout it means to.
  const all = PHONES.flatMap((p) => [true, false].flatMap((inBrowser) => [viewport(p, false, inBrowser), viewport(p, true, inBrowser)]));

  it('get the sideways layout whenever they are sideways', () => {
    for (const v of all.filter((v) => v.sideways)) {
      const at = `${v.phone} ${v.width}×${v.height}`;
      // CSS calls a screen landscape only when it's wider than it is tall.
      expect(v.width, at).toBeGreaterThan(v.height);
      expect(v.height, at).toBeLessThanOrEqual(SIDEWAYS_MAX_HEIGHT);
      expect(v.width, at).toBeGreaterThanOrEqual(SIDEWAYS_MIN_WIDTH);
    }
  });

  it('never get it upright', () => {
    for (const v of all.filter((v) => !v.sideways)) expect(v.width, `${v.phone} ${v.width}×${v.height}`).toBeLessThanOrEqual(v.height);
  });
});
