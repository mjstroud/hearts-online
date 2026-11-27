// Size budgets for what the browser downloads (ROADMAP.md, ground rule 2). Run after `npm run build`:
//
//   node scripts/check-budgets.mjs [dist folder]
//
// Prints every size it measures, and exits with 1 if anything is over budget or can't be measured.
// Sizes are gzipped at zlib's default level, and 1 KB is 1024 bytes. Plain Node with no dependencies,
// so CI can run it straight after the build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGETS = {
  // Game.svelte, everything it imports statically, and the Svelte island loader. 39.8 KB after Phase 1,
  // 44.3 KB after Phase 2 (table moments, trick inspector, hand-end sequence). Raised from 45 KB under the
  // owner's "adjust as is consistent with best practices": still a small fraction of what a phone page
  // usually ships. Keep rarely seen pieces lazy (dynamic import()) rather than growing this.
  gamePage: 55 * KB,
  // Any other single JS file, so a new island can't quietly bloat.
  chunk: 15 * KB,
  // The CSS one page loads: its stylesheet files plus any CSS inlined into its HTML. 10.2 KB for all CSS
  // together after Phase 1 (self-hosted font rules). Raised from 11 KB with the owner's OK for the Phase 2
  // table visuals: about the most a page should need before it can draw (roughly what one round trip of a
  // fresh connection carries). Measured per page since the phone pass, so the inline CSS counts too.
  css: 14 * KB,
};

const distDir = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));
const clientDir = path.join(distDir, 'client');
const serverDir = path.join(distDir, 'server');

function fail(message) {
  console.error(`check-budgets: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(clientDir)) fail(`no build found at ${clientDir}. Run \`npm run build\` first.`);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const clientFiles = walk(clientDir);
const jsFiles = clientFiles.filter((f) => /\.m?js$/.test(f));
const cssFiles = clientFiles.filter((f) => f.endsWith('.css'));
if (!jsFiles.length) fail(`no JavaScript found under ${clientDir}. Did the build finish?`);

/** Path as the site serves it, with forward slashes on every platform. */
const label = (file) => path.relative(clientDir, file).split(path.sep).join('/');

const texts = new Map();
const read = (file) => {
  if (!texts.has(file)) texts.set(file, fs.readFileSync(file, 'utf8'));
  return texts.get(file);
};
const rawSizes = new Map();
const gzipSizes = new Map();
const rawSize = (file) => {
  if (!rawSizes.has(file)) rawSizes.set(file, fs.statSync(file).size);
  return rawSizes.get(file);
};
const gzipSize = (file) => {
  if (!gzipSizes.has(file)) gzipSizes.set(file, gzipSync(fs.readFileSync(file)).length);
  return gzipSizes.get(file);
};

// ---------------------------------------------------------------------------
// Static imports

// Static imports and re-exports, minified or not: import"./a.js", import{x as y}from"./a.js",
// import x,*as y from'./a.js', export{x}from"./a.js", export*from"./a.js". A dynamic import("./a.js")
// doesn't match on purpose: that file only loads when it's needed, so it isn't part of the page.
const STATIC_IMPORT = /(?<![\w$.])(?:import|export)\s*(?:[\w$*{][^;'"`]*?\bfrom\s*)?(["'])([^"'\n]+)\1/g;

/** Where a specifier points inside the build, or null for anything that isn't one of our files. */
function resolveImport(fromFile, specifier) {
  const spec = specifier.split(/[?#]/)[0];
  let target;
  if (spec.startsWith('/')) target = path.join(clientDir, ...spec.split('/'));
  else if (spec.startsWith('./') || spec.startsWith('../')) target = path.resolve(path.dirname(fromFile), spec);
  else return null;
  return fs.existsSync(target) ? target : null;
}

const importCache = new Map();
function staticImports(file) {
  if (!importCache.has(file)) {
    const deps = new Set();
    for (const m of read(file).matchAll(STATIC_IMPORT)) {
      const dep = resolveImport(file, m[2]);
      if (dep && /\.m?js$/.test(dep)) deps.add(dep);
    }
    importCache.set(file, [...deps]);
  }
  return importCache.get(file);
}

/** A file plus everything it imports statically, all the way down. */
function staticClosure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const dep of staticImports(file)) visit(dep);
  };
  visit(entry);
  return seen;
}

// ---------------------------------------------------------------------------
// Which files are which

// Astro's server build records which client file each island became, keyed by source path:
// "C:/…/src/components/game/Game.svelte":"_astro/Game.DpHYstGQ.js". Read that first, because a
// file name alone could change; fall back to the name if a future Astro stores it differently.
function serverManifestEntries() {
  const entries = new Map();
  if (!fs.existsSync(serverDir)) return entries;
  const pair = /"([^"]+)":"\/?(_astro\/[^"]+?\.m?js)"/g;
  for (const file of walk(serverDir).filter((f) => /\.m?js$/.test(f))) {
    for (const m of read(file).matchAll(pair)) entries.set(m[1].replace(/\\+/g, '/'), m[2]);
  }
  return entries;
}

const manifest = serverManifestEntries();
const fromManifest = (test) => {
  for (const [source, output] of manifest) {
    if (!test(source)) continue;
    const file = path.join(clientDir, ...output.split('/'));
    if (fs.existsSync(file)) return file;
  }
  return null;
};

function findGameEntry() {
  // The leading '/' also matches a key stored relative to the project ("src/components/…").
  const listed = fromManifest((source) => `/${source}`.endsWith('/src/components/game/Game.svelte'));
  if (listed) return listed;
  const named = jsFiles.filter((f) => /^Game\.[\w-]+\.m?js$/.test(path.basename(f)));
  if (named.length === 1) return named[0];
  fail(
    named.length
      ? `found more than one game island file (${named.map(label).join(', ')}). Update findGameEntry in scripts/check-budgets.mjs.`
      : 'couldn’t find the file built from src/components/game/Game.svelte. Update findGameEntry in scripts/check-budgets.mjs.',
  );
}

const gameEntry = findGameEntry();
// The Astro script that hydrates Svelte islands. Every island page loads it, the game page included.
const islandLoader = fromManifest((source) => source === '@astrojs/svelte/client.js');

// The Svelte runtime is the file the most other files import. If this ever picks the wrong file,
// the real runtime (about 19 KB) lands in the per-file check and fails loudly rather than slipping by.
const importers = new Map();
for (const file of jsFiles) for (const dep of staticImports(file)) importers.set(dep, (importers.get(dep) ?? 0) + 1);
const runtime =
  [...importers].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || gzipSize(b[0]) - gzipSize(a[0]))[0]?.[0] ?? null;

const roles = new Map([[gameEntry, 'game island']]);
if (runtime) roles.set(runtime, roles.has(runtime) ? `${roles.get(runtime)}, Svelte runtime` : 'Svelte runtime');
if (islandLoader && !roles.has(islandLoader)) roles.set(islandLoader, 'island loader');

// ---------------------------------------------------------------------------
// Each page's CSS

// The server build carries Astro's list of routes as JSON, and each server-rendered page lists the CSS
// its HTML links or inlines (not <style is:inline> blocks, which only dev pages use): {…,"styles":[{"type":"external","src":"/_astro/Layout.x.css"},{"type":"inline",
// "content":"…"}],"routeData":{"route":"/games/[id]","type":"page",…}}. Adding up every CSS file instead
// would mix in pages that never load together, and miss the inline CSS.

/** The JSON array or object that starts at text[start], or undefined if it isn't valid JSON. */
function jsonAt(text, start) {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function findRoutes() {
  if (fs.existsSync(serverDir)) {
    for (const file of walk(serverDir).filter((f) => /\.m?js$/.test(f))) {
      const text = read(file);
      for (const m of text.matchAll(/"routes":\[/g)) {
        const routes = jsonAt(text, m.index + m[0].length - 1);
        if (Array.isArray(routes) && routes.some((r) => r?.routeData?.type === 'page' && Array.isArray(r.styles))) return routes;
      }
    }
  }
  fail(`couldn’t find each route’s "styles" list in ${serverDir}, so CSS per page can’t be measured. Update findRoutes in scripts/check-budgets.mjs.`);
}

const cssPages = [];
const pagesPerCssFile = new Map();
for (const { routeData, styles } of findRoutes()) {
  if (routeData?.type !== 'page') continue;
  // Astro empties a prerendered page's list, so its CSS would quietly go unmeasured.
  if (routeData.prerender) fail(`${routeData.route} is prerendered, and this script can’t measure a prerendered page’s CSS yet. Read its <link> and <style> tags from dist/client in scripts/check-budgets.mjs.`);
  if (!styles?.length) continue;
  const page = { route: routeData.route, files: [], inline: '' };
  for (const style of styles) {
    if (style.type === 'inline') page.inline += style.content;
    else if (style.type === 'external') {
      const file = path.join(clientDir, ...String(style.src).split(/[?#]/)[0].split('/').filter(Boolean));
      if (!fs.existsSync(file)) fail(`${page.route} links ${style.src}, which isn’t in ${clientDir}.`);
      page.files.push(file);
      pagesPerCssFile.set(file, (pagesPerCssFile.get(file) ?? 0) + 1);
    } else fail(`${page.route} has a style of a kind this script doesn’t know (${style.type}). Update scripts/check-budgets.mjs.`);
  }
  // One stream, as the blocks sit together in the page's <head>.
  page.inlineGzip = page.inline ? gzipSync(page.inline).length : 0;
  cssPages.push(page);
}
if (!cssPages.length) fail('the route list in the server build gives no page any CSS. Update findRoutes in scripts/check-budgets.mjs.');

// ---------------------------------------------------------------------------
// Measure

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
const bySize = (a, b) => gzipSize(b) - gzipSize(a) || label(a).localeCompare(label(b));
const sum = (files) => files.reduce((total, f) => total + gzipSize(f), 0);

/** Left-align the first column, right-align the numbers, left-align the notes. */
function printTable(rows) {
  const widths = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  for (const row of rows) {
    const cells = row.map((cell, i) => (i === 0 || i === row.length - 1 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])));
    console.log(`  ${cells.join('   ').trimEnd()}`);
  }
}

const problems = [];
const status = (bytes, budget, what) => {
  if (bytes <= budget) return 'ok';
  problems.push(`${what} is ${kb(bytes)} gzipped (${bytes} bytes), over its ${kb(budget)} budget (${budget} bytes).`);
  return 'OVER';
};

console.log(`Size budgets, gzipped (1 KB = 1024 bytes), from ${distDir}\n`);

const gamePage = new Set(staticClosure(gameEntry));
if (islandLoader) for (const f of staticClosure(islandLoader)) gamePage.add(f);
const gameFiles = [...gamePage].sort(bySize);
const gameTotal = sum(gameFiles);
console.log('Game page JS: Game.svelte, everything it imports statically, and the Svelte island loader');
printTable([
  ['file', 'raw', 'gzip', ''],
  ...gameFiles.map((f) => [label(f), kb(rawSize(f)), kb(gzipSize(f)), roles.get(f) ?? '']),
  ['total', kb(gameFiles.reduce((t, f) => t + rawSize(f), 0)), kb(gameTotal), `budget ${kb(BUDGETS.gamePage)}: ${status(gameTotal, BUDGETS.gamePage, 'Game page JS')}`],
]);
if (!islandLoader) console.log('  (The Svelte island loader wasn’t listed in the server build, so it isn’t counted.)');

console.log(`\nEach JS file: at most ${kb(BUDGETS.chunk)} (the game island and the Svelte runtime are covered above)`);
printTable([
  ['file', 'raw', 'gzip', ''],
  ...[...jsFiles].sort(bySize).map((f) => {
    const exempt = f === gameEntry || f === runtime;
    return [label(f), kb(rawSize(f)), kb(gzipSize(f)), exempt ? `exempt (${roles.get(f)})` : status(gzipSize(f), BUDGETS.chunk, label(f))];
  }),
]);

for (const page of cssPages) page.total = sum(page.files) + page.inlineGzip;
cssPages.sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
// Each file is its own download, so they're gzipped one by one. The inline column only shows when some
// page has inline CSS (build.inlineStylesheets in astro.config.mjs).
const anyInline = cssPages.some((p) => p.inline);
const pageStatus = (p) => status(p.total, BUDGETS.css, `CSS for ${p.route}`);
console.log(`\nCSS per page: at most ${kb(BUDGETS.css)}, counting every stylesheet the page links${anyInline ? ' and the CSS inlined into it' : ''}`);
printTable(
  anyInline
    ? [
        ['page', 'files', 'linked', 'inline', 'total', ''],
        ...cssPages.map((p) => [p.route, String(p.files.length), kb(sum(p.files)), kb(p.inlineGzip), kb(p.total), pageStatus(p)]),
      ]
    : [['page', 'files', 'gzip', ''], ...cssPages.map((p) => [p.route, String(p.files.length), kb(p.total), pageStatus(p)])],
);
const largest = cssPages[0];
console.log(`\nThe largest page, ${largest.route}, loads`);
const inlineRaw = Buffer.byteLength(largest.inline);
printTable([
  ['file', 'raw', 'gzip', ''],
  ...[...largest.files].sort(bySize).map((f) => [label(f), kb(rawSize(f)), kb(gzipSize(f)), '']),
  ...(largest.inline ? [['inline in its HTML', kb(inlineRaw), kb(largest.inlineGzip), '']] : []),
  ['total', kb(largest.files.reduce((t, f) => t + rawSize(f), 0) + inlineRaw), kb(largest.total), ''],
]);

// Not a budget: what a visit to every page would cache. A file no page links is loaded some other way,
// or never, so the per-page table can't count it.
console.log('\nCSS files, and how many pages link each');
printTable([
  ['file', 'raw', 'gzip', ''],
  ...[...cssFiles].sort(bySize).map((f) => {
    const pages = pagesPerCssFile.get(f) ?? 0;
    return [label(f), kb(rawSize(f)), kb(gzipSize(f)), pages ? `${pages} page${pages === 1 ? '' : 's'}` : 'not linked by any page'];
  }),
  ['all files', kb(cssFiles.reduce((t, f) => t + rawSize(f), 0)), kb(sum(cssFiles)), ''],
]);

if (problems.length) {
  console.error('\nOver budget:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nTrim it or lazy-load it. Raise a budget in scripts/check-budgets.mjs only once the owner agrees it’s worth the bytes.');
  // exitCode rather than exit(), so the table isn't cut off when output goes through a pipe.
  process.exitCode = 1;
} else {
  console.log('\nAll size budgets met.');
}
