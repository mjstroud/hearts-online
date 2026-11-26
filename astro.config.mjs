// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // No form or move comes near 64 KB; the adapter's default (1 GB) would let one request fill the VM's memory.
  adapter: node({ mode: 'standalone', bodySizeLimit: 64 * 1024 }),
  integrations: [svelte()],
  // We do our own proxy-aware same-origin check in src/middleware.ts.
  security: { checkOrigin: false },
  server: { port: 4321 },
});
