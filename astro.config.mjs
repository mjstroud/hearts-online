// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  // We do our own proxy-aware same-origin check in src/middleware.ts.
  security: { checkOrigin: false },
  server: { port: 4321 },
});
