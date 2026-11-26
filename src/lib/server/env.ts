/**
 * Which copy of the site this is. The real site leaves SITE_ENV unset. The dev site at
 * dev.shootthesun.com sets SITE_ENV=dev in fly.dev.toml, which adds a DEV badge, keeps search engines
 * out and turns on the dev tools. (A local `npm run dev` server is import.meta.env.DEV instead.)
 */
export function isDevSite(): boolean {
  return process.env.SITE_ENV?.trim() === 'dev';
}

/** Dev tools (the long-names table) run on a local dev server and on the dev site, never on the real site. */
export function devToolsEnabled(): boolean {
  return import.meta.env.DEV || isDevSite();
}
