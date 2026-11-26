import type { APIRoute } from 'astro';
import { isDevSite } from '../lib/server/env';
import { SITE_NAME } from '../lib/ui';

/** The home-screen app manifest. A route rather than a static file so an installed dev site gets its own name. */
export const GET: APIRoute = () => {
  const name = isDevSite() ? `${SITE_NAME} Dev` : SITE_NAME;
  const manifest = {
    id: '/games',
    name,
    short_name: name,
    description: 'Online Hearts with house rules, for family games that run all year.',
    start_url: '/games',
    scope: '/',
    display: 'standalone',
    theme_color: '#0f0e0d',
    background_color: '#0f0e0d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
