/**
 * The Terms and the Privacy Policy, and who has agreed to them. Shared by the pages and the middleware.
 *
 * Bump TERMS_VERSION whenever either page changes in a way people should agree to again: everyone
 * signed in is then asked once, on their next page load.
 */

export const TERMS_VERSION = 1;

/** When the current version was written, shown at the top of both pages. */
export const TERMS_UPDATED = 'November 26, 2026';

// The owner chose terms with no operator name, address or governing law (ROADMAP, Decision 6).
// An email address is optional: while it's null, the pages tell people to ask a site admin.
export const CONTACT_EMAIL: string | null = null;

export const MIN_AGE = 13;

/** Where people go to agree to the current version. */
export const ACCEPT_TERMS_PATH = '/accept-terms';

/** A mailto: link for CONTACT_EMAIL, or null when there isn't a usable one. */
export function contactHref(): string | null {
  return CONTACT_EMAIL && /^[^\s@[\]]+@[^\s@[\]]+\.[^\s@[\]]+$/.test(CONTACT_EMAIL) ? `mailto:${CONTACT_EMAIL}` : null;
}

/** True when someone has never agreed, or agreed to an older version. */
export function needsTerms(acceptedVersion: number | null | undefined): boolean {
  return !acceptedVersion || acceptedVersion < TERMS_VERSION;
}

/**
 * Paths that never send anyone to the terms page: everything an open game tab calls in the
 * background, the pages someone needs to read or leave, and every static file.
 */
const NEVER_GATED = [
  // Background calls: game actions, the live stream, photos, health checks.
  '/api',
  '/avatars',
  '/healthz',
  // Signing in and out, and the terms page itself.
  '/login',
  '/logout',
  '/signup',
  '/reset',
  ACCEPT_TERMS_PATH,
  // What people are agreeing to, plus the rules and how to install the app.
  '/terms',
  '/privacy',
  '/rules',
  '/app',
  // Static files.
  '/_astro',
  '/icons',
  '/sw.js',
  '/manifest.webmanifest',
];

/** Whether a page at this path should ask someone who hasn't agreed yet. */
export function termsGatedPath(path: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
  if (NEVER_GATED.some((x) => p === x || p.startsWith(`${x}/`))) return false;
  // Anything that looks like a file (favicon.svg, robots.txt, apple-touch-icon.png) is a static file.
  const last = p.slice(p.lastIndexOf('/') + 1);
  return !/\.[a-z0-9]+$/i.test(last);
}

/**
 * Whether a request is the browser loading a page, as opposed to a fetch, an image, a script or the
 * live stream. Browsers without Sec-Fetch headers are judged by whether they asked for HTML.
 */
export function isPageLoad(method: string, headers: Headers): boolean {
  if (method !== 'GET') return false;
  const dest = headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  return (headers.get('accept') ?? '').includes('text/html');
}
